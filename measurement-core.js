import { pointDistance } from "./geometry-core.js";

export function measurementLineDash(lineType, factor = 1) {
  const patterns = {
    solid: [],
    dashed: [8, 5],
    dotted: [1.5, 4],
    centerline: [12, 4, 2, 4],
  };
  return (patterns[lineType] || patterns.solid).map(value => value * factor);
}

function cross(first, second) {
  return first.x * second.y - first.y * second.x;
}

function hatchForDirection(points, direction, spacing) {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const ray = { x: direction.x / length, y: direction.y / length };
  const normal = { x: -ray.y, y: ray.x };
  const offsets = points.map(point => point.x * normal.x + point.y * normal.y);
  const min = Math.min(...offsets), max = Math.max(...offsets), segments = [];
  const start = Math.floor(min / spacing) * spacing;
  for (let offset = start; offset <= max + spacing * 0.25; offset += spacing) {
    const origin = { x: normal.x * offset, y: normal.y * offset }, intersections = [];
    for (let index = 0; index < points.length; index++) {
      const first = points[index], last = points[(index + 1) % points.length];
      const edge = { x: last.x - first.x, y: last.y - first.y };
      const denominator = cross(ray, edge);
      if (Math.abs(denominator) < 1e-9) continue;
      const delta = { x: first.x - origin.x, y: first.y - origin.y };
      const along = cross(delta, edge) / denominator;
      const edgePosition = cross(delta, ray) / denominator;
      if (edgePosition >= -1e-9 && edgePosition < 1 - 1e-9) intersections.push({ along, point: { x: origin.x + ray.x * along, y: origin.y + ray.y * along } });
    }
    intersections.sort((first, last) => first.along - last.along);
    for (let index = 0; index + 1 < intersections.length; index += 2) segments.push([intersections[index].point, intersections[index + 1].point]);
  }
  return segments;
}

export function measurementHatchSegments(points, pattern, spacing = 8) {
  if (!Array.isArray(points) || points.length < 3 || !pattern || pattern === "none") return [];
  const directions = {
    diagonal: [{ x: 1, y: 1 }],
    crosshatch: [{ x: 1, y: 1 }, { x: 1, y: -1 }],
    horizontal: [{ x: 1, y: 0 }],
    vertical: [{ x: 0, y: 1 }],
  }[pattern] || [];
  return directions.flatMap(direction => hatchForDirection(points, direction, Math.max(2, spacing)));
}

export function polylineDistance(points = [], closed = false) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += pointDistance(points[index - 1], points[index]);
  if (closed && points.length > 2) total += pointDistance(points[points.length - 1], points[0]);
  return total;
}

export function polygonArea(points = []) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(sum) / 2;
}

export function angleDegrees(points = []) {
  if (points.length < 3) return 0;
  const [first, vertex, last] = points;
  const firstAngle = Math.atan2(first.y - vertex.y, first.x - vertex.x);
  const lastAngle = Math.atan2(last.y - vertex.y, last.x - vertex.x);
  let angle = Math.abs((lastAngle - firstAngle) * 180 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

export function calibrateDrawingScale(points, knownDistance, unit = "mm") {
  const rawDistance = pointDistance(points?.[0], points?.[1]);
  const distance = Number(knownDistance);
  if (!(rawDistance > 0) || !(distance > 0)) return null;
  return { unitsPerPoint: distance / rawDistance, unit };
}

export function measurementValue(kind, points = [], scale = { unitsPerPoint: 1, unit: "pt" }) {
  const multiplier = scale?.unitsPerPoint || 1;
  if (kind === "angle") return angleDegrees(points);
  if (kind === "count") return points.length;
  if (kind === "area") return polygonArea(points) * multiplier * multiplier;
  if (kind === "perimeter") return polylineDistance(points, true) * multiplier;
  if (kind === "polyline") return polylineDistance(points, false) * multiplier;
  return pointDistance(points[0], points[1]) * multiplier;
}

export function measurementPerimeterValue(kind, points = [], scale = { unitsPerPoint: 1, unit: "pt" }) {
  if (kind === "diameter") return Math.PI * pointDistance(points[0], points[1]) * (scale?.unitsPerPoint || 1);
  return measurementValue("perimeter", points, scale);
}

export function measurementAreaValue(kind, points = [], scale = { unitsPerPoint: 1, unit: "pt" }) {
  if (kind === "diameter") {
    const diameter = measurementValue("diameter", points, scale);
    return Math.PI * (diameter / 2) ** 2;
  }
  return measurementValue("area", points, scale);
}

export function measurementFillBoundary(kind, points = [], segmentCount = 48) {
  if (kind !== "diameter") return points.map(point => ({ ...point }));
  if (points.length < 2) return [];
  const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  const radius = pointDistance(points[0], points[1]) / 2;
  return Array.from({ length: Math.max(12, segmentCount) }, (_, index) => {
    const angle = index / Math.max(12, segmentCount) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

export function formatMeasurement(kind, value, unit = "mm") {
  if (kind === "count") return String(Math.round(value));
  if (kind === "angle") return `${Math.round(value * 10) / 10}°`;
  const rounded = Math.round(value * 100) / 100;
  return kind === "area" ? `${rounded} ${unit}²` : `${rounded} ${unit}`;
}

export function measurementBounds(points = []) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
