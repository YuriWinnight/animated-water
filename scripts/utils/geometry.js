const EPSILON = 0.000001;

export function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += (a[0] * b[1]) - (b[0] * a[1]);
  }
  return sum / 2;
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const t = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / ((dx * dx) + (dy * dy))
  ));
  return Math.hypot(
    point[0] - (start[0] + t * dx),
    point[1] - (start[1] + t * dy)
  );
}

export function simplifyPolygon(points, tolerance = 1) {
  if (points.length <= 4) return points.slice();
  const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
  const source = closed ? points.slice(0, -1) : points.slice();

  const simplify = (list) => {
    if (list.length <= 2) return list;
    let maxDistance = 0;
    let split = 0;
    for (let i = 1; i < list.length - 1; i += 1) {
      const distance = distanceToSegment(list[i], list[0], list.at(-1));
      if (distance > maxDistance) {
        maxDistance = distance;
        split = i;
      }
    }
    if (maxDistance <= tolerance) return [list[0], list.at(-1)];
    const left = simplify(list.slice(0, split + 1));
    const right = simplify(list.slice(split));
    return left.slice(0, -1).concat(right);
  };

  // Разрываем кольцо в наиболее удалённой от первой точки вершине.
  let farthest = 1;
  let farthestDistance = 0;
  for (let i = 1; i < source.length; i += 1) {
    const distance = Math.hypot(source[i][0] - source[0][0], source[i][1] - source[0][1]);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthest = i;
    }
  }
  const firstHalf = simplify(source.slice(0, farthest + 1));
  const secondHalf = simplify(source.slice(farthest).concat([source[0]]));
  const result = firstHalf.slice(0, -1).concat(secondHalf.slice(0, -1));
  return result.length >= 3 ? result : source;
}

export function simplifyPolygonToLimit(points, maximumPoints = 72, initialTolerance = 2) {
  if (points.length <= maximumPoints) return simplifyPolygon(points, initialTolerance);
  let tolerance = initialTolerance;
  let simplified = simplifyPolygon(points, tolerance);
  while (simplified.length > maximumPoints && tolerance < 128) {
    tolerance *= 1.5;
    simplified = simplifyPolygon(points, tolerance);
  }
  if (simplified.length <= maximumPoints) return simplified;

  const step = simplified.length / maximumPoints;
  return Array.from({ length: maximumPoints }, (_, index) => simplified[Math.floor(index * step)]);
}

export function polygonBounds(polygons) {
  const points = polygons.flatMap((polygon) => [polygon.outer, ...(polygon.holes ?? [])]).flat();
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

export function normalizePolygon(points) {
  const clean = [];
  for (const point of points ?? []) {
    const x = Number(Array.isArray(point) ? point[0] : point?.x);
    const y = Number(Array.isArray(point) ? point[1] : point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const previous = clean.at(-1);
    if (!previous || previous[0] !== x || previous[1] !== y) clean.push([x, y]);
  }
  if (clean.length > 3 && clean[0][0] === clean.at(-1)[0] && clean[0][1] === clean.at(-1)[1]) {
    clean.pop();
  }
  return clean;
}
