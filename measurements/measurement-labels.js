import { formatMeasurement, measurementAreaValue, measurementBounds, measurementPerimeterValue, measurementValue } from "./measurement-core.js?v=2";

export function measurementLabelLines(annotation) {
  if (annotation.measureKind === "count") return [String(annotation.countValue || 1)];
  const scale = annotation.measurementScale || { unitsPerPoint: 1, unit: "pt", precision: 2 };
  const value = measurementValue(annotation.measureKind, annotation.points, scale);
  const formatted = formatMeasurement(annotation.measureKind, value, scale.unit, scale.precision);
  const lines = [annotation.measureKind === "area" ? `A: ${formatted}` : annotation.measureKind === "diameter" ? `D: ${formatted}` : formatted];
  if (["area", "diameter"].includes(annotation.measureKind) && annotation.showPerimeterLength) {
    const perimeter = measurementPerimeterValue(annotation.measureKind, annotation.points, scale);
    lines.push(`P: ${formatMeasurement("perimeter", perimeter, scale.unit, scale.precision)}`);
  }
  if (annotation.measureKind === "diameter" && annotation.showAreaValue) {
    const area = measurementAreaValue("diameter", annotation.points, scale);
    lines.push(`A: ${formatMeasurement("area", area, scale.unit, scale.precision)}`);
  }
  return lines;
}

export function measurementLabel(annotation) {
  return measurementLabelLines(annotation)[0];
}

export function measurementLabelPoint(annotation, points) {
  if (annotation.measureKind === "count") return { x: points[0].x + 12, y: points[0].y - 10 };
  if (["area", "perimeter", "diameter"].includes(annotation.measureKind)) {
    const bounds = measurementBounds(points);
    return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  }
  if (annotation.measureKind === "polyline") return points.at(-1);
  if (annotation.measureKind === "angle") return { x: points[1].x + 10, y: points[1].y - 10 };
  return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 - 7 };
}

export function canShowMeasurementLabel(annotation, points, draft) {
  if (annotation.measureKind === "calibration") return false;
  if (!draft) return true;
  if (annotation.measureKind === "count") return points.length >= 1;
  if (["area", "perimeter", "angle"].includes(annotation.measureKind)) return points.length >= 3;
  return points.length >= 2;
}
