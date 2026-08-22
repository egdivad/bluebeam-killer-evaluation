const MARKUP_TYPES = [
  ["line", "Line"],
  ["arrow", "Arrow"],
  ["rectangle", "Rectangle"],
  ["ellipse", "Ellipse"],
  ["cloud", "Cloud"],
  ["polygon", "Polygon"],
  ["freehand", "Freehand"],
  ["flag", "Flag"],
  ["callout", "Callout"],
  ["legend", "Takeoff Legend"],
  ["stamp", "Stamp"],
];

const MEASUREMENT_TYPES = [
  ["length", "Length"],
  ["polyline", "Polyline"],
  ["area", "Area"],
  ["perimeter", "Perimeter"],
  ["diameter", "Diameter"],
  ["angle", "Angle"],
  ["count", "Count"],
];

export const SELECTION_FILTER_TYPE_OPTIONS = [
  { value: "", label: "All object types" },
  { value: "highlight", label: "Highlights" },
  { value: "text", label: "Inserted text" },
  { value: "replacement", label: "Edited text" },
  { value: "sticky-note", label: "Sticky Notes" },
  { value: "markup", label: "All markups" },
  ...MARKUP_TYPES.map(([value, label]) => ({ value: `markup:${value}`, label: `Markup · ${label}` })),
  { value: "measurement", label: "All measurements" },
  ...MEASUREMENT_TYPES.map(([value, label]) => ({ value: `measurement:${value}`, label: `Measurement · ${label}` })),
];

export function normalizeSelectionColor(value) {
  if (typeof value !== "string") return "";
  const color = value.trim().toLowerCase();
  if (!color || color === "transparent" || color === "none") return "";
  if (/^#[0-9a-f]{3}$/.test(color)) return `#${[...color.slice(1)].map(character => character.repeat(2)).join("")}`;
  return /^#[0-9a-f]{6}$/.test(color) ? color : "";
}

export function selectionItemType(item = {}) {
  if (item.type === "markup") return `markup:${item.markupKind || ""}`;
  if (item.type === "measurement") return `measurement:${item.measureKind || ""}`;
  return item.type || "";
}

export function selectionItemColors(item = {}) {
  const values = item.type === "highlight"
    ? [item.highlightColor]
    : item.type === "sticky-note"
      ? [item.color]
      : item.type === "markup"
        ? [item.strokeColor, item.lineColor, item.fillColor, item.textColor, item.backgroundColor, item.borderColor]
        : item.type === "measurement"
          ? [item.lineColor, item.color, item.labelColor, item.fillColor, item.shadeColor]
          : [item.color, item.backgroundColor, item.borderColor];
  return [...new Set(values.map(normalizeSelectionColor).filter(Boolean))];
}

export function selectionFilterColors(items = []) {
  return [...new Set(items.flatMap(selectionItemColors))].sort((left, right) => left.localeCompare(right));
}

function matchesType(item, type) {
  if (!type) return true;
  if (type === "markup") return item.type === "markup";
  if (type === "measurement") return item.type === "measurement" && item.measureKind !== "calibration";
  return selectionItemType(item) === type;
}

export function filterSelectionItems(items = [], { type = "", layer = "*", color = "" } = {}) {
  const normalizedColor = normalizeSelectionColor(color);
  return items.filter(item => matchesType(item, type)
    && (layer === "*" || (layer === "none" ? !item.layerId : item.layerId === layer))
    && (!normalizedColor || selectionItemColors(item).includes(normalizedColor)));
}

export function applySelectionMode(currentIds = [], matchedIds = [], mode = "replace") {
  const current = [...new Set(currentIds)];
  const matched = [...new Set(matchedIds)];
  if (mode === "add") return [...new Set([...current, ...matched])];
  if (mode === "remove") {
    const removed = new Set(matched);
    return current.filter(id => !removed.has(id));
  }
  return matched;
}
