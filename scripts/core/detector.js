import { MAX_DETECTION_PIXELS } from "../constants.js";
import { pointInPolygon, signedArea, simplifyPolygonToLimit } from "../utils/geometry.js";

function sceneRect() {
  const dimensions = canvas.dimensions;
  return {
    x: Number(dimensions.sceneX ?? 0),
    y: Number(dimensions.sceneY ?? 0),
    width: Number(dimensions.sceneWidth ?? dimensions.width),
    height: Number(dimensions.sceneHeight ?? dimensions.height)
  };
}

function getSourceSize(source) {
  return {
    width: Number(source.naturalWidth ?? source.videoWidth ?? source.width),
    height: Number(source.naturalHeight ?? source.videoHeight ?? source.height)
  };
}

function rgbToHsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = ((b - r) / delta) + 2;
    else hue = ((r - g) / delta) + 4;
    hue = ((hue / 6) + 1) % 1;
  }
  return {
    hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum
  };
}

function hsvDistance(red, green, blue, target) {
  const color = rgbToHsv(red, green, blue);
  let hueDifference = Math.abs(color.hue - target.hue);
  hueDifference = Math.min(hueDifference, 1 - hueDifference);
  // У малонасыщенных цветов тон ненадёжен, поэтому его вес зависит от
  // насыщенности обоих цветов. Насыщенность отделяет синюю воду от травы,
  // а яркость сохраняет границы берегов и камней.
  const hue = 2 * hueDifference * Math.sqrt(color.saturation * target.saturation);
  const saturation = 0.8 * (color.saturation - target.saturation);
  const value = 0.85 * (color.value - target.value);
  return Math.hypot(hue, saturation, value);
}

export class WaterDetector {
  static async detect(scenePoint, tolerancePercent = 18) {
    const source = canvas.primary?.backgroundSource;
    if (!source) throw new Error("У сцены нет доступного фонового изображения");
    const sourceSize = getSourceSize(source);
    if (!sourceSize.width || !sourceSize.height) throw new Error("Не удалось прочитать размер фонового изображения");

    const scale = Math.min(1, Math.sqrt(MAX_DETECTION_PIXELS / (sourceSize.width * sourceSize.height)));
    const width = Math.max(1, Math.round(sourceSize.width * scale));
    const height = Math.max(1, Math.round(sourceSize.height * scale));
    const bitmap = document.createElement("canvas");
    bitmap.width = width;
    bitmap.height = height;
    const context = bitmap.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);

    let image;
    try {
      image = context.getImageData(0, 0, width, height);
    } catch (error) {
      throw new Error("Браузер запретил читать пиксели фона. Поместите карту в хранилище Foundry того же сервера.", { cause: error });
    }

    const rect = sceneRect();
    const startX = Math.floor(((scenePoint.x - rect.x) / rect.width) * width);
    const startY = Math.floor(((scenePoint.y - rect.y) / rect.height) * height);
    if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
      throw new Error("Кликните внутри фонового изображения сцены");
    }

    const maximumSelected = Math.floor(width * height * 0.25);
    const selected = this._floodFill(
      image.data, width, height, startX, startY, tolerancePercent, maximumSelected
    );
    const selectedCount = selected.reduce((sum, value) => sum + value, 0);
    if (selectedCount < 4) throw new Error("Область слишком мала. Увеличьте допуск цвета.");
    if (selectedCount > width * height * 0.25) {
      throw new Error("Связанная область заняла больше четверти карты. Уменьшите допуск цвета или обведите воду вручную.");
    }

    const loops = this._traceBoundary(selected, width, height).filter((loop) => loop.length >= 3);
    const clickedOuter = this._selectClickedOuter(loops, startX, startY);
    if (!clickedOuter) throw new Error("Не удалось построить границу выбранной воды");
    const nearest = simplifyPolygonToLimit(clickedOuter, 72, 2);
    const outerArea = Math.abs(signedArea(clickedOuter));
    const minimumHoleArea = Math.max(12, outerArea * 0.0004);
    const holes = loops
      .filter((loop) => signedArea(loop) < 0)
      .filter((loop) => pointInPolygon(loop[0], clickedOuter))
      .filter((loop) => {
        const area = Math.abs(signedArea(loop));
        return area >= minimumHoleArea && area < outerArea * 0.6;
      })
      .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
      .slice(0, 12)
      .map((loop) => simplifyPolygonToLimit(loop, 36, 1.5));

    // Результат клика всегда содержит один ближайший внешний регион. Значимые
    // внутренние границы сохраняются как отверстия, чтобы камни, декор и другие
    // предметы внутри воды не покрывались эффектом.
    const polygon = {
      outer: this._toScene(nearest, width, height, rect),
      holes: holes.map((hole) => this._toScene(hole, width, height, rect))
    };
    return { polygons: [polygon], selectedCount, sampleSize: { width, height } };
  }

  static _selectClickedOuter(loops, startX, startY) {
    const clickedPoint = [startX + 0.5, startY + 0.5];
    const outerLoops = loops.filter((loop) => signedArea(loop) > 0);
    const enclosing = outerLoops
      .filter((loop) => pointInPolygon(clickedPoint, loop))
      .sort((a, b) => Math.abs(signedArea(a)) - Math.abs(signedArea(b)))[0];
    if (enclosing) return enclosing;

    const distance = (loop) => {
      let minimum = Number.POSITIVE_INFINITY;
      for (const [x, y] of loop) minimum = Math.min(minimum, Math.hypot(x - clickedPoint[0], y - clickedPoint[1]));
      return minimum;
    };
    return outerLoops.sort((a, b) => distance(a) - distance(b))[0] ?? null;
  }

  static _floodFill(data, width, height, startX, startY, tolerancePercent, maximumSelected = Infinity) {
    const selected = new Uint8Array(width * height);
    const queued = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    const startIndex = startY * width + startX;
    const threshold = Math.max(1, Math.min(100, Number(tolerancePercent))) / 100;
    const sample = this._sampleTarget(data, width, height, startX, startY, threshold);
    const target = sample.color;
    const targetAlpha = sample.alpha;
    let head = 0;
    let tail = 0;
    let selectedCount = 0;
    queue[tail++] = startIndex;
    queued[startIndex] = 1;
    const enqueue = (index) => {
      if (queued[index]) return;
      queued[index] = 1;
      queue[tail++] = index;
    };

    while (head < tail) {
      const index = queue[head++];
      const rgba = index * 4;
      const colorDistance = hsvDistance(data[rgba], data[rgba + 1], data[rgba + 2], target);
      if (colorDistance > threshold || Math.abs(data[rgba + 3] - targetAlpha) > 32) continue;
      selected[index] = 1;
      selectedCount += 1;
      if (selectedCount > maximumSelected) {
        throw new Error("Связанная область заняла больше четверти карты. Уменьшите допуск цвета или обведите воду вручную.");
      }
      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) enqueue(index - 1);
      if (x + 1 < width) enqueue(index + 1);
      if (y > 0) enqueue(index - width);
      if (y + 1 < height) enqueue(index + width);
    }
    return selected;
  }

  static _sampleTarget(data, width, height, startX, startY, threshold) {
    const centerOffset = ((startY * width) + startX) * 4;
    const center = rgbToHsv(data[centerOffset], data[centerOffset + 1], data[centerOffset + 2]);
    const centerAlpha = data[centerOffset + 3];
    const sampleThreshold = Math.min(0.08, Math.max(0.025, threshold * 0.45));
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    let count = 0;
    for (let y = Math.max(0, startY - 2); y <= Math.min(height - 1, startY + 2); y += 1) {
      for (let x = Math.max(0, startX - 2); x <= Math.min(width - 1, startX + 2); x += 1) {
        const offset = ((y * width) + x) * 4;
        if (Math.abs(data[offset + 3] - centerAlpha) > 16) continue;
        if (hsvDistance(data[offset], data[offset + 1], data[offset + 2], center) > sampleThreshold) continue;
        red += data[offset];
        green += data[offset + 1];
        blue += data[offset + 2];
        alpha += data[offset + 3];
        count += 1;
      }
    }
    if (!count) return { color: center, alpha: centerAlpha };
    return {
      color: rgbToHsv(red / count, green / count, blue / count),
      alpha: alpha / count
    };
  }

  static _traceBoundary(selected, width, height) {
    const edges = [];
    const add = (x1, y1, x2, y2, direction) => edges.push({ x1, y1, x2, y2, direction });
    const filled = (x, y) => x >= 0 && y >= 0 && x < width && y < height && selected[y * width + x];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!filled(x, y)) continue;
        if (!filled(x, y - 1)) add(x, y, x + 1, y, 0);
        if (!filled(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
        if (!filled(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
        if (!filled(x - 1, y)) add(x, y + 1, x, y, 3);
      }
    }

    const outgoing = new Map();
    const key = (x, y) => `${x},${y}`;
    edges.forEach((edge, index) => {
      const list = outgoing.get(key(edge.x1, edge.y1)) ?? [];
      list.push(index);
      outgoing.set(key(edge.x1, edge.y1), list);
    });
    const used = new Uint8Array(edges.length);
    const loops = [];

    for (let start = 0; start < edges.length; start += 1) {
      if (used[start]) continue;
      const loop = [];
      let current = start;
      let guard = 0;
      while (!used[current] && guard++ <= edges.length) {
        const edge = edges[current];
        used[current] = 1;
        loop.push([edge.x1, edge.y1]);
        const candidates = (outgoing.get(key(edge.x2, edge.y2)) ?? []).filter((index) => !used[index]);
        if (!candidates.length) break;
        const turnOrder = [1, 0, 3, 2]; // направо, прямо, налево, назад
        candidates.sort((a, b) => {
          const turnA = (edges[a].direction - edge.direction + 4) % 4;
          const turnB = (edges[b].direction - edge.direction + 4) % 4;
          return turnOrder.indexOf(turnA) - turnOrder.indexOf(turnB);
        });
        current = candidates[0];
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }

  static _classifyLoops(loops) {
    const outers = loops.filter((loop) => signedArea(loop) > 0)
      .map((outer) => ({ outer, holes: [] }))
      .sort((a, b) => Math.abs(signedArea(b.outer)) - Math.abs(signedArea(a.outer)));
    const holes = loops.filter((loop) => signedArea(loop) < 0);
    for (const hole of holes) {
      const owner = outers.find((polygon) => pointInPolygon(hole[0], polygon.outer));
      if (owner) owner.holes.push(hole);
    }
    return outers;
  }

  static _toScene(points, width, height, rect) {
    return points.map(([x, y]) => [
      rect.x + (x / width) * rect.width,
      rect.y + (y / height) * rect.height
    ]);
  }
}
