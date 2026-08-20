export const MODULE_ID = "animated-water";
export const LEGACY_MODULE_ID = "pf1e-animated-water";
export const FLAG_KEY = "waterData";
export const DATA_VERSION = 1;

export function readDocumentFlag(document, scope, key) {
  return document?.flags?.[scope]?.[key] ?? document?._source?.flags?.[scope]?.[key];
}

export const SOURCE_TYPES = Object.freeze({
  POLYGON: "polygon",
  FLOOD_FILL: "floodFill",
  DUNGEONDRAFT: "dungeondraft"
});

export const DEFAULT_AREA_SETTINGS = Object.freeze({
  wavePreset: "classic",
  speed: 0.35,
  waveScale: 70,
  distortion: 2.2,
  tint: "#8ed8e8",
  tintStrength: 0.08,
  opacity: 1
});

export const WAVE_PRESETS = Object.freeze({
  classic: Object.freeze({
    label: "Обычная рябь",
    settings: Object.freeze({
      speed: 0.35,
      waveScale: 70,
      distortion: 2.2,
      tint: "#8ed8e8",
      tintStrength: 0.08,
      opacity: 1
    })
  }),
  dungeondraft: Object.freeze({
    label: "Dungeondraft — Water Brush",
    settings: Object.freeze({
      speed: 1,
      waveScale: 40,
      distortion: 1,
      tint: "#ffffff",
      tintStrength: 0,
      opacity: 1
    })
  }),
  bubbling: Object.freeze({
    label: "Бурлящая рябь",
    settings: Object.freeze({
      speed: 1.35,
      waveScale: 60,
      distortion: 8.6,
      tint: "#ffffff",
      tintStrength: 0,
      opacity: 0.35
    })
  }),
  relief: Object.freeze({
    label: "Рельефная рябь",
    settings: Object.freeze({
      speed: 0.55,
      waveScale: 34,
      distortion: 1.15,
      tint: "#b8edf2",
      tintStrength: 0.06,
      opacity: 1
    })
  })
});

export const MAX_DETECTION_PIXELS = 1_500_000;
export const MIN_POLYGON_POINTS = 3;
