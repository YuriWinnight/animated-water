import { LEGACY_MODULE_ID, MODULE_ID, readDocumentFlag } from "./constants.js";
import { WaterManager } from "./apps/water-manager.js";
import { WaterInteractionController } from "./core/interaction.js";
import { AnimatedWaterEffectsLayer, AnimatedWaterLayer, AnimatedWaterSubmersionLayer } from "./core/layer.js";
import { WaterRenderer } from "./core/renderer.js";
import { WaterStore } from "./core/store.js";
import { registerSettings } from "./settings.js";

function selectedTokensAreSubmerged() {
  const documents = (canvas.tokens?.controlled ?? [])
    .map((token) => token.document)
    .filter((document) => document?.isOwner);
  return documents.length > 0 && documents.every(tokenIsSubmerged);
}

function tokenIsSubmerged(document) {
  const current = readDocumentFlag(document, MODULE_ID, "submerged");
  return current === undefined
    ? readDocumentFlag(document, LEGACY_MODULE_ID, "submerged") === true
    : current === true;
}

function syncSubmersionToolState() {
  const active = selectedTokensAreSubmerged();
  const waterControl = ui.controls?.controls?.find((control) => control.name === MODULE_ID);
  const tool = waterControl?.tools?.find((entry) => entry.name === "toggle-submersion");
  if (tool) tool.active = active;
  ui.controls?.element
    ?.find?.('[data-tool="toggle-submersion"]')
    ?.toggleClass?.("active", active);
}

async function setSelectedTokensSubmersion(submerged) {
  const documents = (canvas.tokens?.controlled ?? [])
    .map((token) => token.document)
    .filter((document) => document?.isOwner);
  if (!documents.length) {
    ui.notifications.warn(game.i18n.localize("PF1EAW.Token.SelectFirst"));
    syncSubmersionToolState();
    return;
  }
  await Promise.all(documents.map((document) => document.setFlag(MODULE_ID, "submerged", submerged)));
  await window.PF1EAnimatedWater?.renderer?.requestRefresh();
  syncSubmersionToolState();
}

Hooks.once("init", () => {
  registerSettings();
  CONFIG.Canvas.layers.pf1eAnimatedWater = {
    layerClass: AnimatedWaterLayer,
    group: "interface"
  };
  CONFIG.Canvas.layers.pf1eAnimatedWaterEffects = {
    layerClass: AnimatedWaterEffectsLayer,
    group: "primary"
  };
  CONFIG.Canvas.layers.pf1eAnimatedWaterSubmersion = {
    layerClass: AnimatedWaterSubmersionLayer,
    group: "interface"
  };
  window.PF1EAnimatedWater = {
    renderer: new WaterRenderer(),
    interaction: new WaterInteractionController(),
    openManager: () => {
      const manager = WaterManager.instance;
      const managerElement = manager?.element?.[0];
      if (manager?.rendered && managerElement?.nodeType === 1) manager.bringToTop();
      else if (manager?._state === Application.RENDER_STATES?.RENDERING) return;
      else {
        WaterManager.instance = null;
        new WaterManager().render(true);
      }
    }
  };
  console.log(`${MODULE_ID} | Инициализация версии 1.3.5`);
});

Hooks.on("renderSceneControls", (controls, html) => {
  if (controls.control?.name !== MODULE_ID) return;
  const tokenControlNames = new Set(
    controls.controls
      .filter((control) => control.layer === "tokens")
      .map((control) => control.name)
  );
  html.find(".scene-control").on("click.animated-water", (event) => {
    const controlName = event.currentTarget?.dataset?.control;
    if (!tokenControlNames.has(controlName)) return;
    queueMicrotask(() => {
      if (ui.controls !== controls || controls.control?.name !== controlName) return;
      controls.initialize({ control: controlName });
    });
  });
});

Hooks.on("getSceneControlButtons", (controls) => {
  const isGM = game.user?.isGM === true;
  const tools = [{
    name: "select",
    title: "PF1EAW.Controls.SelectTokens",
    icon: "fas fa-mouse-pointer",
    onClick: () => canvas.pf1eAnimatedWater?.activate({ tool: "select" })
  }];
  if (isGM) tools.push(
    {
      name: "manager",
      title: "PF1EAW.Controls.Manager",
      icon: "fas fa-list",
      button: true,
      onClick: () => window.PF1EAnimatedWater.openManager()
    },
    {
      name: "detect",
      title: "PF1EAW.Controls.Detect",
      icon: "fas fa-eye-dropper",
      button: true,
      onClick: () => window.PF1EAnimatedWater.interaction.startDetect()
    },
    {
      name: "draw",
      title: "PF1EAW.Controls.Draw",
      icon: "fas fa-draw-polygon",
      button: true,
      onClick: () => window.PF1EAnimatedWater.interaction.startDraw()
    }
  );
  tools.push({
    name: "toggle-submersion",
    title: "PF1EAW.Controls.ToggleSubmersion",
    icon: "fas fa-swimmer",
    toggle: true,
    active: selectedTokensAreSubmerged(),
    onClick: (active) => setSelectedTokensSubmersion(active)
  });
  controls.push({
    name: MODULE_ID,
    title: "PF1EAW.Controls.Title",
    icon: "fas fa-water",
    layer: "pf1eAnimatedWater",
    visible: true,
    activeTool: "select",
    tools
  });
});

Hooks.on("canvasReady", async () => {
  canvas.app?.view?.classList.remove("pf1e-aw-crosshair", "pf1e-aw-busy");
  await window.PF1EAnimatedWater?.renderer?.requestRefresh();
  WaterManager.instance?.render(false);
});

Hooks.on("controlToken", syncSubmersionToolState);
Hooks.on("canvasTearDown", () => {
  canvas.app?.view?.classList.remove("pf1e-aw-crosshair", "pf1e-aw-busy");
  window.PF1EAnimatedWater?.interaction?.cancel();
  window.PF1EAnimatedWater?.renderer?.destroy();
});

Hooks.on("updateScene", (scene, changes) => {
  if (scene.id !== canvas?.scene?.id) return;
  const waterFlagsChanged = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)
    || foundry.utils.hasProperty(changes, `flags.${LEGACY_MODULE_ID}`);
  if (!waterFlagsChanged) return;
  const interaction = window.PF1EAnimatedWater?.interaction;
  if (interaction?.mode === "edit" && interaction.editArea
    && !WaterStore.getAreas(scene).some((area) => area.id === interaction.editArea.id)) {
    interaction.cancel({ returnToTokens: true });
  }
  window.PF1EAnimatedWater?.renderer?.requestRefresh();
  WaterManager.instance?.render(false);
});

Hooks.on("updateToken", (document, changes) => {
  if (document.parent?.id !== canvas?.scene?.id) return;
  const flagChanged = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)
    || Object.hasOwn(changes, `flags.${MODULE_ID}.submerged`)
    || foundry.utils.hasProperty(changes, `flags.${LEGACY_MODULE_ID}`)
    || Object.hasOwn(changes, `flags.${LEGACY_MODULE_ID}.submerged`);
  if (flagChanged) {
    window.PF1EAnimatedWater?.renderer?.requestRefresh();
    syncSubmersionToolState();
  }
});

Hooks.on("createToken", (document) => {
  if (document.parent?.id === canvas?.scene?.id && tokenIsSubmerged(document)) {
    window.PF1EAnimatedWater?.renderer?.requestRefresh();
  }
});

Hooks.on("deleteToken", (document) => {
  if (document.parent?.id === canvas?.scene?.id && tokenIsSubmerged(document)) {
    window.PF1EAnimatedWater?.renderer?.requestRefresh();
  }
});

Hooks.on("deleteScene", (scene) => {
  if (scene.id === canvas?.scene?.id) window.PF1EAnimatedWater?.renderer?.destroy();
});
