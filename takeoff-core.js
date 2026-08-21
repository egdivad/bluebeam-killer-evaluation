import { measurementAreaValue, measurementPerimeterValue, measurementValue } from "./measurement-core.js";

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
  if (["count", "angle"].includes(annotation.measureKind)) return { unitsPerPoint: 1, unit: "" };
  const scale = annotation.measurementScale;
  return scale && safeNumber(scale.unitsPerPoint) > 0
    ? { unitsPerPoint: safeNumber(scale.unitsPerPoint), unit: String(scale.unit || "pt") }
    : { unitsPerPoint: 1, unit: "pt" };
}

function scaleLabel(kind, scale) {
  if (["count", "angle"].includes(kind)) return "Not applicable";
  return `1 pt = ${formatTakeoffNumber(scale.unitsPerPoint)} ${scale.unit}`;
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
    if (!groups.has(key)) groups.set(key, { group, unit: record.unit, scale: record.scale, quantity: 0, length: 0, perimeter: 0, area: 0, itemIds: [] });
    const row = groups.get(key);
    row.quantity += record.quantity;
    row.length += record.length;
    row.perimeter += record.perimeter;
    row.area += record.area;
    row.itemIds.push(record.id);
  }
  return [...groups.values()].sort((first, last) => first.group.localeCompare(last.group, undefined, { numeric: true, sensitivity: "base" }) || first.unit.localeCompare(last.unit));
}

export function formatTakeoffNumber(value, precision = 2) {
  const number = safeNumber(value);
  return number.toLocaleString(undefined, { maximumFractionDigits: precision, minimumFractionDigits: 0 });
}

export function formatTakeoffMetric(value, unit, area = false) {
  if (!safeNumber(value)) return "—";
  return `${formatTakeoffNumber(value)}${unit ? ` ${unit}${area ? "²" : ""}` : ""}`;
}

export function takeoffSummaryToCsv(rows = []) {
  const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [["Group", "Quantity", "Length", "Perimeter", "Area", "Unit", "Scale"], ...rows.map(row => [row.group, row.quantity, row.length, row.perimeter, row.area, row.unit, row.scale])].map(row => row.map(cell).join(",")).join("\r\n");
}

export function takeoffSummaryToJson(rows = []) {
  return JSON.stringify(rows.map(({ itemIds, ...row }) => row), null, 2);
}
