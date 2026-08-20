import {
  DATA_VERSION,
  FLAG_KEY,
  LEGACY_MODULE_ID,
  MODULE_ID,
  SOURCE_TYPES,
  WAVE_PRESETS,
  readDocumentFlag
} from "../constants.js";
import { getDefaultAreaSettings } from "../settings.js";
import { normalizePolygon } from "../utils/geometry.js";

export class WaterStore {
  static get scene() {
    return canvas?.scene ?? game.scenes?.active ?? null;
  }

  static getData(scene = this.scene) {
    const current = readDocumentFlag(scene, MODULE_ID, FLAG_KEY);
    const stored = current ?? readDocumentFlag(scene, LEGACY_MODULE_ID, FLAG_KEY);
    const areas = Array.isArray(stored?.areas) ? stored.areas : [];
    return {
      version: DATA_VERSION,
      areas: areas.map((area, index) => this.normalizeArea(area, index)).filter(Boolean)
    };
  }

  static getAreas(scene = this.scene) {
    return this.getData(scene).areas;
  }

  static normalizeArea(area, index = 0) {
    if (!area || !area.geometry) return null;
    const polygons = (area.geometry.polygons ?? []).map((polygon) => ({
      outer: normalizePolygon(polygon.outer),
      holes: (polygon.holes ?? []).map(normalizePolygon).filter((hole) => hole.length > 0)
    })).filter((polygon) => polygon.outer.length > 0 || polygon.holes.length > 0);
    if (!polygons.length) return null;
    const storedSettings = area.settings ?? {};
    const legacyDungeondraftSettings = {
      speed: 0.28,
      waveScale: 55,
      distortion: 0.9,
      tint: "#72c9d4",
      tintStrength: 0.2,
      opacity: 0.92
    };
    const usesLegacyDungeondraftPreset = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(legacyDungeondraftSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const previousReliefSettings = {
      speed: 0.55,
      waveScale: 34,
      distortion: 1.15,
      tint: "#b8edf2",
      tintStrength: 0.06,
      opacity: 1
    };
    const usesPreviousReliefAsDungeondraft = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(previousReliefSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const previousWaterBrushSettings = {
      speed: 0.46,
      waveScale: 22,
      distortion: 1.1,
      tint: "#b8edf2",
      tintStrength: 0.025,
      opacity: 1
    };
    const usesPreviousWaterBrushPreset = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(previousWaterBrushSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const previousNormalMapSettings = {
      speed: 0.5,
      waveScale: 16,
      distortion: 0.7,
      tint: "#ffffff",
      tintStrength: 0,
      opacity: 1
    };
    const usesPreviousNormalMapPreset = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(previousNormalMapSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const manualComparisonSettings = {
      speed: 1.35,
      waveScale: 55,
      distortion: 9.3,
      tint: "#ffffff",
      tintStrength: 0.18,
      opacity: 0.35
    };
    const usesManualComparisonSettings = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(manualComparisonSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const calibratedBubblingSettings = {
      speed: 1.35,
      waveScale: 60,
      distortion: 8.6,
      tint: "#ffffff",
      tintStrength: 0,
      opacity: 0.35
    };
    const usesCalibratedBubblingSettings = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(calibratedBubblingSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const firstVerticalLineSettings = {
      speed: 0.85,
      waveScale: 22,
      distortion: 2.4,
      tint: "#ffffff",
      tintStrength: 0,
      opacity: 0.72
    };
    const roundedVerticalLineSettings = { ...firstVerticalLineSettings, waveScale: 20 };
    const usesFirstVerticalLineSettings = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(firstVerticalLineSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const usesRoundedVerticalLineSettings = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(roundedVerticalLineSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const contrastedVerticalLineSettings = {
      speed: 0.75,
      waveScale: 35,
      distortion: 4.2,
      tint: "#ffffff",
      tintStrength: 0,
      opacity: 0.82
    };
    const usesContrastedVerticalLineSettings = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(contrastedVerticalLineSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const pureVerticalLineSettings = {
      speed: 0.75,
      waveScale: 35,
      distortion: 4.2,
      tint: "#ffffff",
      tintStrength: 0,
      opacity: 1
    };
    const usesPureVerticalLineSettings = storedSettings.wavePreset === "dungeondraft"
      && Object.entries(pureVerticalLineSettings)
        .every(([key, value]) => storedSettings[key] === value);
    const settings = { ...getDefaultAreaSettings(), ...storedSettings };
    if (usesManualComparisonSettings || usesCalibratedBubblingSettings) {
      settings.wavePreset = "bubbling";
      Object.assign(settings, WAVE_PRESETS.bubbling.settings);
    } else if (usesLegacyDungeondraftPreset
      || usesPreviousReliefAsDungeondraft
      || usesPreviousWaterBrushPreset
      || usesPreviousNormalMapPreset
      || usesFirstVerticalLineSettings
      || usesRoundedVerticalLineSettings
      || usesContrastedVerticalLineSettings
      || usesPureVerticalLineSettings) {
      Object.assign(settings, WAVE_PRESETS.dungeondraft.settings);
    }
    return {
      id: String(area.id || foundry.utils.randomID()),
      name: String(area.name || `Водная область ${index + 1}`),
      source: Object.values(SOURCE_TYPES).includes(area.source) ? area.source : SOURCE_TYPES.POLYGON,
      enabled: area.enabled !== false,
      geometry: { polygons },
      settings
    };
  }

  static async saveAreas(areas, scene = this.scene) {
    if (!scene) throw new Error("Нет активной сцены");
    if (!game.user?.isGM) throw new Error("Изменять водные области может только ведущий");
    const normalized = areas.map((area, index) => this.normalizeArea(area, index)).filter(Boolean);
    await scene.setFlag(MODULE_ID, FLAG_KEY, { version: DATA_VERSION, areas: normalized });
    return normalized;
  }

  static async addArea(area, scene = this.scene) {
    const normalized = this.normalizeArea({
      id: foundry.utils.randomID(),
      enabled: true,
      settings: getDefaultAreaSettings(),
      ...area
    }, this.getAreas(scene).length);
    if (!normalized) throw new Error("Водная область не содержит допустимого полигона");
    const areas = this.getAreas(scene);
    areas.push(normalized);
    await this.saveAreas(areas, scene);
    return normalized;
  }

  static async updateArea(id, changes, scene = this.scene) {
    const areas = this.getAreas(scene);
    const index = areas.findIndex((area) => area.id === id);
    if (index < 0) return null;
    areas[index] = foundry.utils.mergeObject(areas[index], changes, {
      inplace: false,
      insertKeys: true,
      overwrite: true
    });
    await this.saveAreas(areas, scene);
    return areas[index];
  }

  static async deleteArea(id, scene = this.scene) {
    const areas = this.getAreas(scene).filter((area) => area.id !== id);
    return this.saveAreas(areas, scene);
  }

  static async clear(scene = this.scene) {
    return this.saveAreas([], scene);
  }
}
