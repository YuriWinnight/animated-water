import { normalizePolygon, signedArea } from "../utils/geometry.js";

const WATER_KEY = /(water|liquid|river|lake|pond)/i;
const POINT_KEY = /(points|vertices|polygon|outline|contour|path|shape)/i;

function pointsFrom(value) {
  if (!Array.isArray(value)) return null;
  if (value.length >= 6 && value.every((item) => Number.isFinite(Number(item)))) {
    const result = [];
    for (let i = 0; i + 1 < value.length; i += 2) result.push([Number(value[i]), Number(value[i + 1])]);
    return normalizePolygon(result);
  }
  const result = normalizePolygon(value);
  return result.length >= 3 ? result : null;
}

function collectPolygons(node, output, depth = 0) {
  if (depth > 12 || node == null) return;
  const direct = pointsFrom(node);
  if (direct?.length >= 3) {
    output.push(direct);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPolygons(item, output, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (POINT_KEY.test(key) || Array.isArray(value)) collectPolygons(value, output, depth + 1);
  }
}

function findWaterNodes(node, output, path = "root", depth = 0) {
  if (depth > 14 || node == null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const childPath = `${path}.${key}`;
    if (WATER_KEY.test(key)) output.push({ path: childPath, value });
    if (value && typeof value === "object") findWaterNodes(value, output, childPath, depth + 1);
  }
}

function findMapDimensions(data) {
  const candidates = [];
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    const width = Number(node.width ?? node.map_width ?? node.mapWidth ?? node.image_width);
    const height = Number(node.height ?? node.map_height ?? node.mapHeight ?? node.image_height);
    if (width > 0 && height > 0) candidates.push({ width, height, score: width * height });
    for (const value of Object.values(node)) if (value && typeof value === "object") walk(value, depth + 1);
  };
  walk(data);
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

async function parseFile(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== "function") throw new Error("Этот браузер не умеет распаковывать gzip-файлы");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error("ZIP-контейнер пока не поддерживается. Распакуйте JSON из файла вручную.");
  }
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function deduplicate(polygons) {
  const seen = new Set();
  return polygons.filter((points) => {
    if (points.length < 3 || Math.abs(signedArea(points)) < 0.5) return false;
    const key = JSON.stringify(points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class DungeondraftImporter {
  static async inspect(file) {
    const data = await parseFile(file);
    const waterNodes = [];
    findWaterNodes(data, waterNodes);
    const rawPolygons = [];
    for (const node of waterNodes) collectPolygons(node.value, rawPolygons);
    return {
      fileName: file.name,
      polygons: deduplicate(rawPolygons),
      dimensions: findMapDimensions(data),
      paths: [...new Set(waterNodes.map((node) => node.path))]
    };
  }

  static transform(result) {
    const dimensions = canvas.dimensions;
    const rect = {
      x: Number(dimensions.sceneX ?? 0),
      y: Number(dimensions.sceneY ?? 0),
      width: Number(dimensions.sceneWidth ?? dimensions.width),
      height: Number(dimensions.sceneHeight ?? dimensions.height)
    };
    const background = canvas.primary?.backgroundSource;
    const fallback = {
      width: Number(background?.naturalWidth ?? background?.videoWidth ?? rect.width),
      height: Number(background?.naturalHeight ?? background?.videoHeight ?? rect.height)
    };
    const source = result.dimensions ?? fallback;
    return result.polygons.map((points) => ({
      outer: points.map(([x, y]) => [
        rect.x + (x / source.width) * rect.width,
        rect.y + (y / source.height) * rect.height
      ]),
      holes: []
    }));
  }
}
