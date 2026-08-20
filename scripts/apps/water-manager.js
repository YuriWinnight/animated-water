import { MODULE_ID, SOURCE_TYPES, WAVE_PRESETS } from "../constants.js";
import { DungeondraftImporter } from "../core/dungeondraft.js";
import { WaterStore } from "../core/store.js";

const sourceLabels = {
  [SOURCE_TYPES.POLYGON]: "PF1EAW.Source.Polygon",
  [SOURCE_TYPES.FLOOD_FILL]: "PF1EAW.Source.FloodFill",
  [SOURCE_TYPES.DUNGEONDRAFT]: "PF1EAW.Source.Dungeondraft"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[character]);
}

export class WaterAreaConfig extends FormApplication {
  constructor(area, options = {}) {
    super(area, options);
    this.area = area;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "animated-water-config",
      title: "Настройки водной области",
      template: `modules/${MODULE_ID}/templates/water-area-config.hbs`,
      width: 430,
      closeOnSubmit: true
    });
  }

  getData() {
    const wavePresets = Object.fromEntries(
      Object.entries(WAVE_PRESETS).map(([key, preset]) => [key, preset.label])
    );
    return { area: this.area, wavePresets };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const syncValue = (input) => {
      html.find(`[data-live-output="${input.name}"]`).text(input.value);
    };
    html.find("input[data-live-value]").on("input", (event) => syncValue(event.currentTarget));
    html.find("input[data-live-value]").on("change", () => this._previewSettings(html));
    html.find('select[name="settings.wavePreset"]').on("change", (event) => {
      const preset = WAVE_PRESETS[event.currentTarget.value];
      if (!preset) return;
      for (const [key, value] of Object.entries(preset.settings)) {
        const input = html.find(`[name="settings.${key}"]`);
        input.val(value);
        input.trigger("input");
      }
      this._previewSettings(html);
    });
  }

  _previewSettings(html) {
    const numberKeys = ["speed", "waveScale", "distortion", "tintStrength", "opacity"];
    const settings = {
      wavePreset: html.find('[name="settings.wavePreset"]').val(),
      tint: html.find('[name="settings.tint"]').val()
    };
    for (const key of numberKeys) settings[key] = Number(html.find(`[name="settings.${key}"]`).val());
    window.PF1EAnimatedWater?.renderer?.previewArea(this.area.id, { settings });
  }

  async _updateObject(_event, formData) {
    const expanded = foundry.utils.expandObject(formData);
    await WaterStore.updateArea(this.area.id, expanded);
    await window.PF1EAnimatedWater?.renderer?.clearAreaPreview(this.area.id);
  }

  async close(options) {
    await window.PF1EAnimatedWater?.renderer?.clearAreaPreview(this.area.id);
    return super.close(options);
  }
}

export class WaterManager extends Application {
  static instance = null;

  constructor(options = {}) {
    super(options);
    WaterManager.instance = this;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "animated-water-manager",
      title: "Animated Water",
      template: `modules/${MODULE_ID}/templates/water-manager.hbs`,
      width: 520,
      height: "auto",
      resizable: true
    });
  }

  getData() {
    const areas = WaterStore.getAreas().map((area) => ({
      ...area,
      sourceLabel: game.i18n.localize(sourceLabels[area.source] ?? "PF1EAW.Source.Polygon"),
      points: area.geometry.polygons.reduce((sum, polygon) => sum
        + polygon.outer.length
        + (polygon.holes ?? []).reduce((holeSum, hole) => holeSum + hole.length, 0), 0)
    }));
    const interaction = window.PF1EAnimatedWater?.interaction;
    const geometryMode = interaction?.mode === "draw" || interaction?.mode === "edit";
    return {
      areas,
      hasAreas: areas.length > 0,
      sceneName: canvas.scene?.name ?? "—",
      geometryMode,
      editingShape: interaction?.mode === "edit",
      editingAreaName: interaction?.editArea?.name ?? ""
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action='draw']").on("click", () => this._startDraw());
    html.find("[data-action='detect']").on("click", () => window.PF1EAnimatedWater.interaction.startDetect());
    html.find("[data-action='import']").on("click", () => html.find("input[name='dungeondraft-file']").trigger("click"));
    html.find("input[name='dungeondraft-file']").on("change", (event) => this._importFile(event.currentTarget.files?.[0]));
    html.find("[data-action='edit']").on("click", (event) => this._edit(event));
    html.find("[data-action='edit-shape']").on("click", (event) => this._editShape(event));
    html.find("[data-action='toggle']").on("click", (event) => this._toggle(event));
    html.find("[data-action='delete']").on("click", (event) => this._delete(event));
    html.find("[data-action='clear']").on("click", () => this._clear());
    html.find("[data-action='save-shape']").on("click", () => this._saveShape());
    html.find("[data-action='undo-shape']").on("click", () => this._undoShape());
    html.find("[data-action='cancel-shape']").on("click", () => this._cancelShape());
  }

  _areaFromEvent(event) {
    const id = event.currentTarget.closest("[data-area-id]")?.dataset.areaId;
    return WaterStore.getAreas().find((area) => area.id === id);
  }

  _edit(event) {
    const area = this._areaFromEvent(event);
    if (area) new WaterAreaConfig(area).render(true);
  }

  _editShape(event) {
    const area = this._areaFromEvent(event);
    if (area) {
      window.PF1EAnimatedWater.interaction.startEdit(area);
      this.render(false);
    }
  }

  _startDraw() {
    window.PF1EAnimatedWater.interaction.startDraw();
    this.render(false);
  }

  async _saveShape() {
    await window.PF1EAnimatedWater.interaction.saveEdit();
    this.render(false);
  }

  _undoShape() {
    window.PF1EAnimatedWater.interaction.undo();
  }

  _cancelShape() {
    window.PF1EAnimatedWater.interaction.cancel({ returnToTokens: true });
    this.render(false);
  }

  async _toggle(event) {
    const area = this._areaFromEvent(event);
    if (area) await WaterStore.updateArea(area.id, { enabled: !area.enabled });
  }

  async _delete(event) {
    const area = this._areaFromEvent(event);
    if (!area) return;
    const confirmed = await Dialog.confirm({
      title: "Удалить водную область",
      content: `<p>Удалить «${escapeHtml(area.name)}»?</p>`
    });
    if (confirmed) {
      const interaction = window.PF1EAnimatedWater?.interaction;
      if (interaction?.mode === "edit" && interaction.editArea?.id === area.id) {
        interaction.cancel({ returnToTokens: true });
      }
      await WaterStore.deleteArea(area.id);
      this.render(false);
    }
  }

  async _clear() {
    const confirmed = await Dialog.confirm({
      title: "Удалить все водные области",
      content: "<p>Это действие удалит водные области только текущей сцены.</p>"
    });
    if (confirmed) await WaterStore.clear();
  }

  async _importFile(file) {
    if (!file) return;
    try {
      const result = await DungeondraftImporter.inspect(file);
      if (!result.polygons.length) {
        const paths = result.paths.length ? ` Похожие поля: ${result.paths.map((path) => escapeHtml(path)).join(", ")}` : "";
        throw new Error(`Полигоны воды не найдены. Нужен пример структуры этого файла.${paths}`);
      }
      const polygons = DungeondraftImporter.transform(result);
      await WaterStore.addArea({
        name: `Dungeondraft: ${file.name}`,
        source: SOURCE_TYPES.DUNGEONDRAFT,
        geometry: { polygons },
        settings: {
          wavePreset: "dungeondraft",
          ...WAVE_PRESETS.dungeondraft.settings
        }
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Ошибка импорта Dungeondraft`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.render(false);
    }
  }

  async close(options) {
    if (WaterManager.instance === this) WaterManager.instance = null;
    return super.close(options);
  }
}
