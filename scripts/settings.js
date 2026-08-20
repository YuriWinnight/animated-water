import { DEFAULT_AREA_SETTINGS, MODULE_ID } from "./constants.js";

export function registerSettings() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, {
    scope: "world",
    config: true,
    ...data
  });

  register("defaultSpeed", {
    name: "PF1EAW.Settings.DefaultSpeed.Name",
    hint: "PF1EAW.Settings.DefaultSpeed.Hint",
    type: Number,
    default: DEFAULT_AREA_SETTINGS.speed,
    range: { min: 0, max: 2, step: 0.05 }
  });

  register("defaultWaveScale", {
    name: "PF1EAW.Settings.DefaultWaveScale.Name",
    hint: "PF1EAW.Settings.DefaultWaveScale.Hint",
    type: Number,
    default: DEFAULT_AREA_SETTINGS.waveScale,
    range: { min: 10, max: 300, step: 5 }
  });

  register("defaultDistortion", {
    name: "PF1EAW.Settings.DefaultDistortion.Name",
    hint: "PF1EAW.Settings.DefaultDistortion.Hint",
    type: Number,
    default: DEFAULT_AREA_SETTINGS.distortion,
    range: { min: 0, max: 12, step: 0.1 }
  });

  register("detectionTolerance", {
    name: "PF1EAW.Settings.DetectionTolerance.Name",
    hint: "PF1EAW.Settings.DetectionTolerance.Hint",
    type: Number,
    default: 18,
    range: { min: 1, max: 60, step: 1 }
  });

  game.settings.register(MODULE_ID, "showToPlayers", {
    name: "PF1EAW.Settings.ShowToPlayers.Name",
    hint: "PF1EAW.Settings.ShowToPlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => window.PF1EAnimatedWater?.renderer?.requestRefresh()
  });
}

export function getDefaultAreaSettings() {
  return {
    ...DEFAULT_AREA_SETTINGS,
    speed: game.settings.get(MODULE_ID, "defaultSpeed"),
    waveScale: game.settings.get(MODULE_ID, "defaultWaveScale"),
    distortion: game.settings.get(MODULE_ID, "defaultDistortion")
  };
}
