import { LEGACY_MODULE_ID, MODULE_ID, readDocumentFlag } from "../constants.js";
import { pointInPolygon, polygonBounds, signedArea } from "../utils/geometry.js";
import { WaterStore } from "./store.js";

const VERTEX_SHADER = `
  attribute vec2 aVertexPosition;
  uniform mat3 projectionMatrix;
  uniform highp vec4 inputSize;
  uniform vec4 outputFrame;
  uniform vec2 uSceneAnchor;
  uniform vec2 uSceneSize;
  varying vec2 vTextureCoord;
  varying vec2 vSceneCoord;

  void main(void) {
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.0)) + outputFrame.xy;
    gl_Position = vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aVertexPosition * (outputFrame.zw * inputSize.zw);
    vec2 screenPosition = (vTextureCoord * inputSize.xy) + outputFrame.xy;
    vSceneCoord = (screenPosition - uSceneAnchor) / max(uSceneSize, vec2(1.0));
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 vTextureCoord;
  varying vec2 vSceneCoord;
  uniform sampler2D uSampler;
  uniform sampler2D uMask;
  uniform sampler2D uTokenMask;
  uniform sampler2D uDungeondraftRipple;
  uniform float uUseTokenMask;
  uniform float uDirectToken;
  uniform float uSurface;
  uniform float uLocalSource;
  uniform float uOpacity;
  uniform vec4 inputClamp;
  uniform highp vec4 inputSize;
  uniform float uTime;
  uniform float uWaveScale;
  uniform float uDistortion;
  uniform vec2 uTextureSize;
  uniform vec2 uScreenPixel;
  uniform float uStageScale;
  uniform vec3 uTint;
  uniform float uTintStrength;
  uniform float uWaveStyle;

  float rippleNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    float lowerLeft = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float lowerRight = fract(sin(dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float upperLeft = fract(sin(dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float upperRight = fract(sin(dot(cell + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(lowerLeft, lowerRight, local.x), mix(upperLeft, upperRight, local.x), local.y);
  }

  float layeredRippleNoise(vec2 point) {
    float value = rippleNoise(point) * 0.57;
    value += rippleNoise((point * 2.07) + vec2(11.7, 4.3)) * 0.29;
    value += rippleNoise((point * 4.13) + vec2(3.1, 19.4)) * 0.14;
    return value;
  }

  float reliefWaveHeight(vec2 point, float time) {
    vec2 slowWarp = vec2(
      sin(dot(point, vec2(0.31, 0.47)) + time * 0.43),
      cos(dot(point, vec2(-0.43, 0.29)) - time * 0.37)
    ) * 0.82;
    vec2 warped = point + slowWarp;
    float height = sin(dot(warped, vec2(0.966, 0.259)) * 1.55 + time * 1.12);
    height += 0.72 * sin(dot(warped, vec2(-0.423, 0.906)) * 2.05 - time * 0.91 + 1.3);
    height += 0.46 * sin(dot(warped, vec2(0.707, 0.707)) * 3.25 + time * 1.38 + 0.4);
    height += 0.28 * sin(dot(warped, vec2(-0.819, 0.574)) * 5.15 - time * 1.72 + 2.1);
    return height / 2.46;
  }

  void main(void) {
    vec4 original = texture2D(uSampler, vTextureCoord);
    if (vSceneCoord.x < 0.0 || vSceneCoord.y < 0.0 || vSceneCoord.x > 1.0 || vSceneCoord.y > 1.0) {
      if (uSurface > 0.5) { gl_FragColor = original; return; }
      discard;
    }
    float maskAlpha = 1.0;
    if (uDirectToken < 0.5) {
      maskAlpha = texture2D(uMask, vSceneCoord).a;
      if (uUseTokenMask > 0.5) maskAlpha *= texture2D(uTokenMask, vSceneCoord).a;
    }
    if (maskAlpha < 0.01) {
      if (uSurface > 0.5) { gl_FragColor = original; return; }
      discard;
    }
    vec2 size = max(uTextureSize, vec2(1.0));
    float scale = max(uWaveScale, 1.0);
    vec2 position = vSceneCoord * size / scale;
    float waveX = sin(position.y * 1.31 + uTime * 1.17)
      + 0.55 * sin(position.x * 0.73 + position.y * 0.42 - uTime * 0.83);
    float waveY = cos(position.x * 1.07 - uTime)
      + 0.45 * cos(position.y * 0.81 - position.x * 0.36 + uTime * 0.71);
    vec2 offset;
    float shimmer;
    if (uWaveStyle > 2.5) {
      vec2 ripplePosition = position * 1.18;
      vec2 firstDrift = vec2(uTime * 0.23, -uTime * 0.15);
      vec2 secondDrift = vec2(-uTime * 0.17, uTime * 0.20);
      float gradientStep = 0.075;

      vec2 firstPoint = ripplePosition + firstDrift;
      float firstHeight = layeredRippleNoise(firstPoint);
      vec2 firstGradient = vec2(
        layeredRippleNoise(firstPoint + vec2(gradientStep, 0.0)) - firstHeight,
        layeredRippleNoise(firstPoint + vec2(0.0, gradientStep)) - firstHeight
      ) / gradientStep;

      vec2 rotatedPoint = vec2(
        ripplePosition.x * 0.8 - ripplePosition.y * 0.6,
        ripplePosition.x * 0.6 + ripplePosition.y * 0.8
      ) * 1.09 + secondDrift + vec2(23.4, 9.7);
      float secondHeight = layeredRippleNoise(rotatedPoint);
      vec2 rotatedGradient = vec2(
        layeredRippleNoise(rotatedPoint + vec2(gradientStep, 0.0)) - secondHeight,
        layeredRippleNoise(rotatedPoint + vec2(0.0, gradientStep)) - secondHeight
      ) / gradientStep;
      vec2 secondGradient = vec2(
        rotatedGradient.x * 0.8 + rotatedGradient.y * 0.6,
        -rotatedGradient.x * 0.6 + rotatedGradient.y * 0.8
      );

      vec2 rippleNormal = clamp(firstGradient + (secondGradient * 0.58), vec2(-1.5), vec2(1.5));
      offset = rippleNormal * uDistortion * 0.62 * uStageScale * uScreenPixel;
      shimmer = 0.0;
    } else if (uWaveStyle > 1.5) {
      vec2 ripplePosition = position * 0.78;
      float gradientStep = 0.115;
      float heightCenter = reliefWaveHeight(ripplePosition, uTime);
      float heightRight = reliefWaveHeight(ripplePosition + vec2(gradientStep, 0.0), uTime);
      float heightLeft = reliefWaveHeight(ripplePosition - vec2(gradientStep, 0.0), uTime);
      float heightDown = reliefWaveHeight(ripplePosition + vec2(0.0, gradientStep), uTime);
      float heightUp = reliefWaveHeight(ripplePosition - vec2(0.0, gradientStep), uTime);
      vec2 surfaceGradient = vec2(heightRight - heightLeft, heightDown - heightUp) / (gradientStep * 2.0);
      vec3 surfaceNormal = normalize(vec3(-surfaceGradient * 1.85, 1.0));
      vec3 lightDirection = normalize(vec3(-0.42, -0.56, 0.72));
      float reflectedLight = max(0.0, dot(surfaceNormal, lightDirection));
      float thinHighlight = pow(reflectedLight, 9.0);
      float broadHighlight = pow(reflectedLight, 3.0);
      offset = ((surfaceGradient * 0.72) + (vec2(waveX, waveY) * 0.06))
        * uDistortion * uStageScale * uScreenPixel;
      shimmer = (thinHighlight * 0.15) + (broadHighlight * 0.035) + (heightCenter * 0.012);
    } else if (uWaveStyle > 0.5) {
      vec2 rippleSize = vec2(512.0, 512.0);
      float rippleScale = max(uWaveScale / 20.0, 0.05);
      vec2 worldPixel = vSceneCoord * size;
      vec2 worldDistortUv = worldPixel / (rippleSize * rippleScale);
      vec2 drift = vec2(uTime * 0.05);
      vec2 distort1 = (texture2D(uDungeondraftRipple, fract(worldDistortUv - drift)).rg - 0.5) * 0.005;
      vec2 distort2 = (texture2D(uDungeondraftRipple, fract(worldDistortUv + drift)).rg - 0.5) * 0.005;
      offset = mix(distort1, distort2, 0.5) * uDistortion;
      shimmer = 0.0;
    } else {
      offset = vec2(waveX, waveY) * uDistortion * 2.25 * uStageScale * uScreenPixel;
      float ripple = 0.5 + 0.5 * sin(position.x * 1.43 + waveY * 0.72 + uTime * 2.15);
      float caustic = pow(ripple, 7.0) * 0.055;
      shimmer = (waveX + waveY) * 0.026 + caustic;
    }
    if (uDirectToken > 0.5 || uLocalSource > 0.5) {
      vec2 tokenScreenFraction = max(inputSize.xy * uScreenPixel, vec2(0.001));
      offset /= tokenScreenFraction;
    }
    vec4 color = texture2D(uSampler, clamp(vTextureCoord + offset, inputClamp.xy, inputClamp.zw));
    color.rgb = mix(color.rgb, color.rgb * uTint, clamp(uTintStrength, 0.0, 1.0));
    color.rgb += shimmer * clamp(uDistortion / 4.0, 0.0, 1.0) * color.a;
    if (uSurface > 0.5) {
      gl_FragColor = mix(original, color, maskAlpha * uOpacity);
      return;
    }
    gl_FragColor = vec4(color.rgb * maskAlpha, color.a * maskAlpha);
  }
`;

function hexToRgb(hex) {
  const value = String(hex ?? "#ffffff").replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) return [1, 1, 1];
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

export class WaterRenderer {
  constructor() {
    this.container = null;
    this.submersionContainer = null;
    this.background = null;
    this.filters = [];
    this.textures = [];
    this.maskTextures = [];
    this.tokenFilterBindings = [];
    this.surfaceFilterBindings = [];
    this.overlayBindings = [];
    this.areaPreviews = new Map();
    this.submersionMaskTexture = null;
    this.submersionMaskCanvas = null;
    this.submersionMaskContext = null;
    this.submersionMaskSignature = "";
    this.dungeondraftRippleTexture = null;
    this.elapsed = 0;
    this._refreshAgain = false;
    this._refreshPromise = null;
    this._tick = this._tick.bind(this);
  }

  requestRefresh() {
    this._refreshAgain = true;
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = (async () => {
      while (this._refreshAgain) {
        await this._nextFrame();
        this._refreshAgain = false;
        await this.refresh();
      }
    })().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  }

  _nextFrame() {
    return new Promise((resolve) => {
      if (canvas?.app?.ticker?.addOnce) canvas.app.ticker.addOnce(resolve);
      else if (typeof requestAnimationFrame === "function") requestAnimationFrame(resolve);
      else setTimeout(resolve, 0);
    });
  }

  previewArea(id, changes) {
    if (!id) return Promise.resolve();
    this.areaPreviews.set(id, foundry.utils.deepClone(changes));
    return this.requestRefresh();
  }

  clearAreaPreview(id) {
    if (!this.areaPreviews.delete(id)) return Promise.resolve();
    return this.requestRefresh();
  }

  async refresh() {
    this.destroy({ defer: true, preservePreviews: true });
    if (!canvas?.ready || !canvas.scene) return;
    if (!game.user.isGM && !game.settings.get(MODULE_ID, "showToPlayers")) return;
    const areas = WaterStore.getAreas().map((area, index) => {
      const preview = this.areaPreviews.get(area.id);
      if (!preview) return area;
      const merged = foundry.utils.mergeObject(area, preview, {
        inplace: false,
        insertKeys: true,
        overwrite: true
      });
      return WaterStore.normalizeArea(merged, index);
    }).filter((area) => area?.enabled && area.geometry.polygons.some((polygon) =>
      polygon.outer.length >= 3 && Math.abs(signedArea(polygon.outer)) >= 0.5
    ));
    if (!areas.length) return;

    if (areas.some((area) => area.settings.wavePreset === "dungeondraft")) {
      try {
        this.dungeondraftRippleTexture = await loadTexture(`modules/${MODULE_ID}/assets/water-distortion-slime.webp`);
      } catch (error) {
        this.dungeondraftRippleTexture = PIXI.Texture.WHITE;
        console.warn(`${MODULE_ID} | Не удалось загрузить карту смещения Dungeondraft`, error);
      }
    }

    this.background = canvas.primary?.background;
    if (!this.background?.texture?.valid || this.background.texture === PIXI.Texture.EMPTY) {
      const rect = canvas.dimensions?.sceneRect;
      if (!rect) return;
      this.background = { position: { x: rect.x, y: rect.y }, anchor: { x: 0, y: 0 },
        width: rect.width, height: rect.height,
        texture: { orig: { width: rect.width, height: rect.height } } };
    }
    const sourceTexture = this.background.texture;

    this.container = new PIXI.Container();
    this.container.name = `${MODULE_ID}-effects`;
    this.container.eventMode = "none";
    this.container.interactiveChildren = false;

    this.submersionContainer = new PIXI.Container();
    this.submersionContainer.name = `${MODULE_ID}-submersion`;
    this.submersionContainer.eventMode = "none";
    this.submersionContainer.interactiveChildren = false;

    const effectsLayer = canvas.pf1eAnimatedWaterEffects;
    const submersionLayer = canvas.pf1eAnimatedWaterSubmersion;
    if (!effectsLayer || !submersionLayer) {
      console.warn(`${MODULE_ID} | Отдельный слой анимации воды не создан`);
      this.container.destroy({ children: true });
      this.submersionContainer.destroy({ children: true });
      this.container = null;
      this.submersionContainer = null;
      return;
    }
    effectsLayer.addChild(this.container);
    submersionLayer.addChild(this.submersionContainer);
    if (effectsLayer.parent) {
      effectsLayer.parent.sortDirty = true;
      effectsLayer.parent.sortChildren();
    }

    const submergedTokens = this._getSubmergedTokens();
    const surfaces = this._getSurfaceMeshes();
    if (submergedTokens.length) this._createSubmersionMaskTexture(sourceTexture, submergedTokens);
    for (const area of areas) {
      const maskTexture = this._createMaskTexture(area, sourceTexture);
      for (const mesh of surfaces) {
        if (!this._surfaceIntersectsArea(mesh, area)) continue;
        this._createAreaEffect(area, sourceTexture, maskTexture, false, mesh);
        if (this.submersionMaskTexture && !mesh.object?.document?.overhead) {
          this._createAreaEffect(area, sourceTexture, maskTexture, true, mesh);
        }
      }
    }
    for (const token of submergedTokens) this._createTokenEffect(token, areas, sourceTexture);
    canvas.app.ticker.add(this._tick);
  }

  _getSurfaceMeshes() {
    const meshes = new Set([canvas.primary?.background,
      ...(canvas.tiles?.placeables ?? []).map((tile) => tile.mesh)]);
    const order = canvas.primary?.children ?? [];
    return [...meshes].filter((mesh) => mesh && !mesh.destroyed && mesh.texture?.valid
      && mesh.texture !== PIXI.Texture.EMPTY)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  _surfaceIntersectsArea(mesh, area) {
    const bounds = mesh.object?.bounds;
    if (!bounds) return true;
    const region = polygonBounds(area.geometry.polygons);
    return region && bounds.x <= region.maxX && bounds.y <= region.maxY
      && bounds.x + bounds.width >= region.minX && bounds.y + bounds.height >= region.minY;
  }

  _syncOverlay({ mesh, sprite, opacity }) {
    if (mesh.destroyed) { sprite.visible = false; return; }
    sprite.texture = mesh.texture;
    sprite.anchor.set(mesh.anchor?.x ?? 0, mesh.anchor?.y ?? 0);
    sprite.position.copyFrom(mesh.position);
    sprite.pivot.copyFrom(mesh.pivot);
    sprite.skew.copyFrom(mesh.skew);
    sprite.rotation = mesh.rotation;
    if (mesh.scale && sprite.scale) sprite.scale.copyFrom(mesh.scale);
    else { sprite.width = mesh.width; sprite.height = mesh.height; }
    sprite.tint = mesh.tint ?? 0xffffff;
    sprite.alpha = opacity * (mesh.alpha ?? 1);
    sprite.visible = mesh.visible !== false && mesh.renderable !== false;
  }

  _createAreaEffect(area, sourceTexture, maskTexture, submersion, mesh) {
    const opacity = Number(area.settings.opacity ?? 1);

    const filter = new PIXI.Filter(VERTEX_SHADER, FRAGMENT_SHADER, {
      uTime: 0,
      uMask: maskTexture,
      uTokenMask: this.submersionMaskTexture ?? PIXI.Texture.WHITE,
      uDungeondraftRipple: this.dungeondraftRippleTexture ?? PIXI.Texture.WHITE,
      uUseTokenMask: submersion ? 1 : 0,
      uDirectToken: 0,
      uSurface: submersion ? 0 : 1,
      uLocalSource: 1,
      uOpacity: opacity,
      uSceneAnchor: [0, 0],
      uSceneSize: [1, 1],
      uScreenPixel: [1, 1],
      uStageScale: 1,
      uWaveScale: Number(area.settings.waveScale ?? 70),
      uDistortion: Number(area.settings.distortion ?? 2.2),
      uTextureSize: [sourceTexture.orig.width, sourceTexture.orig.height],
      uTint: hexToRgb(area.settings.tint),
      uTintStrength: Number(area.settings.tintStrength ?? 0.08),
      uWaveStyle: area.settings.wavePreset === "bubbling"
        ? 3
        : area.settings.wavePreset === "relief"
          ? 2
          : area.settings.wavePreset === "dungeondraft"
            ? 1
            : 0
    });
    filter.padding = Math.ceil(Number(area.settings.distortion ?? 2.2) * 3);
    filter._pf1eAnimatedWaterSpeed = Number(area.settings.speed ?? 0.35);
    this._updateTransformUniforms(filter);
    this.filters.push(filter);
    if (submersion) {
      const sprite = new PIXI.Sprite(mesh.texture);
      sprite.eventMode = "none";
      sprite.filters = [filter];
      const binding = { mesh, sprite, opacity: Math.min(0.58, opacity * 0.52) };
      this._syncOverlay(binding);
      this.overlayBindings.push(binding);
      this.submersionContainer.addChild(sprite);
    } else {
      mesh.filters = [...(mesh.filters ?? []), filter];
      this.surfaceFilterBindings.push({ mesh, filter });
    }
  }

  _createTokenEffect(token, areas, sourceTexture) {
    const mesh = token?.mesh;
    if (!mesh || mesh.destroyed) return;
    const area = this._findTokenArea(token, areas);
    if (!area) return;
    const filter = new PIXI.Filter(VERTEX_SHADER, FRAGMENT_SHADER, {
      uTime: 0,
      uMask: PIXI.Texture.WHITE,
      uTokenMask: PIXI.Texture.WHITE,
      uDungeondraftRipple: this.dungeondraftRippleTexture ?? PIXI.Texture.WHITE,
      uUseTokenMask: 0,
      uDirectToken: 1,
      uSurface: 0,
      uLocalSource: 0,
      uOpacity: 1,
      uSceneAnchor: [0, 0],
      uSceneSize: [1, 1],
      uScreenPixel: [1, 1],
      uStageScale: 1,
      uWaveScale: Number(area.settings.waveScale ?? 70),
      uDistortion: Number(area.settings.distortion ?? 2.2),
      uTextureSize: [sourceTexture.orig.width, sourceTexture.orig.height],
      uTint: [1, 1, 1],
      uTintStrength: 0,
      uWaveStyle: area.settings.wavePreset === "bubbling"
        ? 3
        : area.settings.wavePreset === "relief"
          ? 2
          : area.settings.wavePreset === "dungeondraft"
            ? 1
            : 0
    });
    filter.padding = Math.max(8, Math.ceil(Number(area.settings.distortion ?? 2.2) * 5));
    filter._pf1eAnimatedWaterSpeed = Number(area.settings.speed ?? 0.35);
    filter._pf1eAnimatedWaterTokenFilter = true;
    this._updateTransformUniforms(filter);

    const existingFilters = Array.isArray(mesh.filters)
      ? mesh.filters.filter((entry) => !entry?._pf1eAnimatedWaterTokenFilter)
      : [];
    mesh.filters = [...existingFilters, filter];
    this.filters.push(filter);
    this.tokenFilterBindings.push({ mesh, filter });
  }

  _findTokenArea(token, areas) {
    const bounds = token?.bounds;
    const center = token?.center ?? (bounds ? {
      x: bounds.x + (bounds.width / 2),
      y: bounds.y + (bounds.height / 2)
    } : null);
    if (!center) return areas[0] ?? null;
    const matching = areas.find((area) => (area.geometry?.polygons ?? []).some((polygon) =>
      pointInPolygon([center.x, center.y], polygon.outer)
      && !(polygon.holes ?? []).some((hole) =>
        hole.length >= 3 && pointInPolygon([center.x, center.y], hole)
      )
    ));
    return matching ?? areas[0] ?? null;
  }

  _createMaskTexture(area, sourceTexture) {
    const sourceWidth = Math.max(1, Number(sourceTexture.orig?.width ?? sourceTexture.width ?? 1));
    const sourceHeight = Math.max(1, Number(sourceTexture.orig?.height ?? sourceTexture.height ?? 1));
    const resolution = Math.min(1, 2048 / Math.max(sourceWidth, sourceHeight));
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = Math.max(1, Math.ceil(sourceWidth * resolution));
    maskCanvas.height = Math.max(1, Math.ceil(sourceHeight * resolution));

    const context = maskCanvas.getContext("2d");
    const backgroundWidth = Math.max(1, Number(this.background.width));
    const backgroundHeight = Math.max(1, Number(this.background.height));
    const anchorX = Number(this.background.anchor?.x ?? 0);
    const anchorY = Number(this.background.anchor?.y ?? 0);
    const left = Number(this.background.position?.x ?? 0) - (anchorX * backgroundWidth);
    const top = Number(this.background.position?.y ?? 0) - (anchorY * backgroundHeight);
    const scaleX = maskCanvas.width / backgroundWidth;
    const scaleY = maskCanvas.height / backgroundHeight;
    const traceRing = (points) => {
      if (points.length < 3) return;
      context.moveTo((points[0][0] - left) * scaleX, (points[0][1] - top) * scaleY);
      for (const [x, y] of points.slice(1)) context.lineTo((x - left) * scaleX, (y - top) * scaleY);
      context.closePath();
    };

    context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    context.fillStyle = "#ffffff";
    context.beginPath();
    for (const polygon of area.geometry.polygons) {
      if (polygon.outer.length < 3) continue;
      traceRing(polygon.outer);
      for (const hole of polygon.holes ?? []) traceRing(hole);
    }
    context.fill("evenodd");

    const baseTexture = PIXI.BaseTexture.from(maskCanvas, {
      scaleMode: PIXI.SCALE_MODES.LINEAR,
      mipmap: PIXI.MIPMAP_MODES.OFF
    });
    const maskTexture = new PIXI.Texture(baseTexture);
    this.maskTextures.push(maskTexture);
    return maskTexture;
  }

  _getSubmergedTokens() {
    return (canvas.tokens?.placeables ?? []).filter((token) => {
      const current = readDocumentFlag(token?.document, MODULE_ID, "submerged");
      return current === undefined
        ? readDocumentFlag(token?.document, LEGACY_MODULE_ID, "submerged") === true
        : current === true;
    });
  }

  _createSubmersionMaskTexture(sourceTexture, tokens) {
    const sourceWidth = Math.max(1, Number(sourceTexture.orig?.width ?? sourceTexture.width ?? 1));
    const sourceHeight = Math.max(1, Number(sourceTexture.orig?.height ?? sourceTexture.height ?? 1));
    const resolution = Math.min(1, 2048 / Math.max(sourceWidth, sourceHeight));
    this.submersionMaskCanvas = document.createElement("canvas");
    this.submersionMaskCanvas.width = Math.max(1, Math.ceil(sourceWidth * resolution));
    this.submersionMaskCanvas.height = Math.max(1, Math.ceil(sourceHeight * resolution));
    this.submersionMaskContext = this.submersionMaskCanvas.getContext("2d");
    const baseTexture = PIXI.BaseTexture.from(this.submersionMaskCanvas, {
      scaleMode: PIXI.SCALE_MODES.LINEAR,
      mipmap: PIXI.MIPMAP_MODES.OFF
    });
    this.submersionMaskTexture = new PIXI.Texture(baseTexture);
    this.maskTextures.push(this.submersionMaskTexture);
    this._updateSubmersionMask(tokens, true);
  }

  _updateSubmersionMask(tokens = this._getSubmergedTokens(), force = false) {
    if (!this.submersionMaskTexture || !this.submersionMaskContext || !this.background) return;
    const entries = tokens.map((token) => {
      const bounds = token.bounds;
      return bounds ? [token.id, bounds.x, bounds.y, bounds.width, bounds.height] : null;
    }).filter(Boolean);
    const signature = JSON.stringify(entries);
    if (!force && signature === this.submersionMaskSignature) return;
    this.submersionMaskSignature = signature;

    const context = this.submersionMaskContext;
    const maskCanvas = this.submersionMaskCanvas;
    const backgroundWidth = Math.max(1, Number(this.background.width));
    const backgroundHeight = Math.max(1, Number(this.background.height));
    const anchorX = Number(this.background.anchor?.x ?? 0);
    const anchorY = Number(this.background.anchor?.y ?? 0);
    const left = Number(this.background.position?.x ?? 0) - (anchorX * backgroundWidth);
    const top = Number(this.background.position?.y ?? 0) - (anchorY * backgroundHeight);
    const scaleX = maskCanvas.width / backgroundWidth;
    const scaleY = maskCanvas.height / backgroundHeight;
    context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    context.fillStyle = "#ffffff";
    for (const [, x, y, width, height] of entries) {
      context.beginPath();
      context.ellipse(
        ((x + (width / 2)) - left) * scaleX,
        ((y + (height / 2)) - top) * scaleY,
        Math.max(1, width * scaleX * 0.48),
        Math.max(1, height * scaleY * 0.48),
        0,
        0,
        Math.PI * 2
      );
      context.fill();
    }
    this.submersionMaskTexture.baseTexture.update();
  }

  _tick(delta) {
    this.elapsed += delta / 60;
    for (const binding of this.overlayBindings) this._syncOverlay(binding);
    this._updateSubmersionMask();
    for (const filter of this.filters) {
      try {
        if (!filter?.uniforms) continue;
        filter.uniforms.uTime = this.elapsed * filter._pf1eAnimatedWaterSpeed;
        this._updateTransformUniforms(filter);
      } catch (error) {
        console.warn(`${MODULE_ID} | Пропущен уже уничтоженный фильтр`, error);
      }
    }
  }

  _updateTransformUniforms(filter) {
    const transform = canvas.stage?.worldTransform;
    if (!transform || !this.background) return;
    const backgroundWidth = Math.max(1, Number(this.background.width));
    const backgroundHeight = Math.max(1, Number(this.background.height));
    const anchorX = Number(this.background.anchor?.x ?? 0);
    const anchorY = Number(this.background.anchor?.y ?? 0);
    const left = Number(this.background.position?.x ?? 0) - (anchorX * backgroundWidth);
    const top = Number(this.background.position?.y ?? 0) - (anchorY * backgroundHeight);
    const scaleX = Math.abs(Number(transform.a ?? canvas.stage.scale?.x ?? 1)) || 1;
    const scaleY = Math.abs(Number(transform.d ?? canvas.stage.scale?.y ?? scaleX)) || scaleX;
    const screen = canvas.app?.renderer?.screen;
    const screenWidth = Math.max(1, Number(screen?.width ?? canvas.screenDimensions?.[0] ?? 1));
    const screenHeight = Math.max(1, Number(screen?.height ?? canvas.screenDimensions?.[1] ?? 1));
    filter.uniforms.uSceneAnchor[0] = (left * Number(transform.a ?? scaleX)) + Number(transform.tx ?? 0);
    filter.uniforms.uSceneAnchor[1] = (top * Number(transform.d ?? scaleY)) + Number(transform.ty ?? 0);
    filter.uniforms.uSceneSize[0] = backgroundWidth * scaleX;
    filter.uniforms.uSceneSize[1] = backgroundHeight * scaleY;
    filter.uniforms.uScreenPixel[0] = 1 / screenWidth;
    filter.uniforms.uScreenPixel[1] = 1 / screenHeight;
    filter.uniforms.uStageScale = (scaleX + scaleY) / 2;
  }

  destroy({ defer = false, preservePreviews = false } = {}) {
    if (canvas?.app?.ticker) canvas.app.ticker.remove(this._tick);
    const filters = this.filters.splice(0);
    const textures = this.textures.splice(0);
    const maskTextures = this.maskTextures.splice(0);
    const tokenFilterBindings = this.tokenFilterBindings.splice(0);
    const surfaceFilterBindings = this.surfaceFilterBindings.splice(0);
    this.overlayBindings.length = 0;
    const container = this.container;
    const submersionContainer = this.submersionContainer;
    for (const { mesh, filter } of [...tokenFilterBindings, ...surfaceFilterBindings]) {
      if (!mesh || mesh.destroyed || !Array.isArray(mesh.filters)) continue;
      const remaining = mesh.filters.filter((entry) => entry !== filter);
      mesh.filters = remaining.length ? remaining : null;
    }
    if (container && !container.destroyed) container.parent?.removeChild(container);
    if (submersionContainer && !submersionContainer.destroyed) submersionContainer.parent?.removeChild(submersionContainer);
    const cleanup = () => {
      if (container && !container.destroyed) container.destroy({ children: true });
      if (submersionContainer && !submersionContainer.destroyed) submersionContainer.destroy({ children: true });
      for (const filter of filters) {
        try { filter.destroy(); } catch (_error) { /* Фильтр уже уничтожен вместе со спрайтом. */ }
      }
      for (const texture of textures) {
        try { texture.destroy(false); } catch (_error) { /* Текстура уже уничтожена. */ }
      }
      for (const texture of maskTextures) {
        try { texture.destroy(true); } catch (_error) { /* Текстура маски уже уничтожена. */ }
      }
    };
    if (defer && (container || submersionContainer || filters.length || textures.length || maskTextures.length)) {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(cleanup);
      else setTimeout(cleanup, 0);
    } else cleanup();
    this.container = null;
    this.submersionContainer = null;
    this.background = null;
    this.submersionMaskTexture = null;
    this.submersionMaskCanvas = null;
    this.submersionMaskContext = null;
    this.submersionMaskSignature = "";
    this.dungeondraftRippleTexture = null;
    this.elapsed = 0;
    if (!preservePreviews) this.areaPreviews.clear();
  }
}
