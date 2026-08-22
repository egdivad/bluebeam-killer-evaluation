import { measurementAreaValue, measurementPerimeterValue, measurementValue } from "./measurement-core.js?v=2";
import { DEFAULT_MEASUREMENT_PRECISION, measurementScaleLabel, normalizeMeasurementPrecision } from "./measurement-scale-core.js?v=1";

export const TAKEOFF_GROUPS = ["type", "subject", "layer", "page", "scale", "unit"];

const TYPE_LABELS = {
  length: "Length",
  polyline: "Polyline",
  area: "Area",
  perimeter: "Perimeter",
  diameter: "Diameter",
  angle: "Angle",
  count: "Count",
};

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function scaleFor(annotation) {
  if (["count", "angle"].includes(annotation.measureKind)) return { unitsPerPoint: 1, unit: "", precision: annotation.measureKind === "angle" ? 1 : 0 };
  const scale = annotation.measurementScale;
  return scale && safeNumber(scale.unitsPerPoint) > 0
    ? { unitsPerPoint: safeNumber(scale.unitsPerPoint), unit: String(scale.unit || "pt"), precision: normalizeMeasurementPrecision(scale.precision), ...(safeNumber(scale.ratio) > 0 ? { ratio: safeNumber(scale.ratio) } : {}), ...(scale.presetName ? { presetName: String(scale.presetName) } : {}) }
    : { unitsPerPoint: 1, unit: "pt", precision: DEFAULT_MEASUREMENT_PRECISION };
}

function scaleLabel(kind, scale) {
  if (["count", "angle"].includes(kind)) return "Not applicable";
  return measurementScaleLabel(scale).replace(/ · \d+ dp$/, "");
}

export function measurementTakeoffRecord(annotation, pages = []) {
  if (annotation?.type !== "measurement" || annotation.deleted || annotation.measureKind === "calibration") return null;
  const pageById = new Map(pages.map((page, index) => [page.id, index + 1]));
  const kind = annotation.measureKind;
  const scale = scaleFor(annotation);
  const value = measurementValue(kind, annotation.points || [], scale);
  const type = TYPE_LABELS[kind] || kind || "Measurement";
  const record = {
    id: annotation.id,
    pageId: annotation.pageId,
    page: pageById.get(annotation.pageId) || annotation.page || 1,
    type,
    subject: annotation.subject || `${type} Measurement`,
    layer: annotation.layerName || "No layer",
    scale: scaleLabel(kind, scale),
    unit: scale.unit,
    scaleFactor: scale.unitsPerPoint,
    precision: scale.precision,
    quantity: 1,
    length: 0,
    perimeter: 0,
    area: 0,
  };
  if (["length", "polyline", "diameter"].includes(kind)) record.length = safeNumber(value);
  if (["area", "perimeter", "diameter"].includes(kind)) record.perimeter = safeNumber(measurementPerimeterValue(kind, annotation.points || [], scale));
  if (["area", "diameter"].includes(kind)) record.area = safeNumber(measurementAreaValue(kind, annotation.points || [], scale));
  return record;
}

function groupValue(record, groupBy) {
  if (groupBy === "page") return `Page ${record.page}`;
  return String(record[groupBy] || "No value");
}

export function buildTakeoffSummary(annotations = [], pages = [], options = {}) {
  const groupBy = TAKEOFF_GROUPS.includes(options.groupBy) ? options.groupBy : "type";
  const scopePageId = options.scopePageId || null;
  const records = annotations.map(annotation => measurementTakeoffRecord(annotation, pages)).filter(Boolean).filter(record => !scopePageId || record.pageId === scopePageId);
  const groups = new Map();
  for (const record of records) {
    const group = groupValue(record, groupBy);
    const key = `${group}\u0000${record.unit}\u0000${record.scaleFactor}`;
    if (!groups.has(key)) groups.set(key, { group, unit: record.unit, scale: record.scale, precision: record.precision, quantity: 0, length: 0, perimeter: 0, area: 0, itemIds: [] });
    const row = groups.get(key);
    row.quantity += record.quantity;
    row.length += record.length;
    row.perimeter += record.perimeter;
    row.area += record.area;
    row.precision = Math.max(row.precision, record.precision);
    row.itemIds.push(record.id);
  }
  return [...groups.values()].sort((first, last) => first.group.localeCompare(last.group, undefined, { numeric: true, sensitivity: "base" }) || first.unit.localeCompare(last.unit));
}

export function formatTakeoffNumber(value, precision = 2) {
  const number = safeNumber(value), places = normalizeMeasurementPrecision(precision);
  return number.toLocaleString(undefined, { maximumFractionDigits: places, minimumFractionDigits: places });
}

export function formatTakeoffMetric(value, unit, area = false, precision = DEFAULT_MEASUREMENT_PRECISION) {
  if (!safeNumber(value)) return "—";
  return `${formatTakeoffNumber(value, precision)}${unit ? ` ${unit}${area ? "²" : ""}` : ""}`;
}

export function takeoffSummaryToCsv(rows = []) {
  const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [["Group", "Quantity", "Length", "Perimeter", "Area", "Unit", "Scale", "Precision"], ...rows.map(row => [row.group, row.quantity, formatTakeoffNumber(row.length, row.precision), formatTakeoffNumber(row.perimeter, row.precision), formatTakeoffNumber(row.area, row.precision), row.unit, row.scale, row.precision])].map(row => row.map(cell).join(",")).join("\r\n");
}

export function takeoffSummaryToJson(rows = []) {
  return JSON.stringify(rows.map(({ itemIds, ...row }) => row), null, 2);
}
