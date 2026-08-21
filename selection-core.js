export function isFreeAreaHighlight(item) {
  return item?.type === "highlight" && !item.rects?.length;
}

export function isCopyablePageItem(item) {
  return item?.type === "markup"
    || item?.type === "measurement" && item.measureKind !== "calibration"
    || isFreeAreaHighlight(item);
}

export function isFormatPaintableItem(item) {
  return item?.type === "highlight"
    || item?.type === "markup"
    || item?.type === "measurement" && item.measureKind !== "calibration";
}

export function isAddedPageObject(item) {
  return ["text", "replacement", "highlight", "markup"].includes(item?.type)
    || item?.type === "measurement" && item.measureKind !== "calibration";
}

export function selectedBatchItems(annotations, selectedIds) {
  const ids = new Set(selectedIds);
  return annotations.filter(item => ids.has(item.id) && isAddedPageObject(item));
}

export function batchCommon(items, getter) {
  if (!items.length) return { mixed: true, value: null };
  const first = getter(items[0], 0);
  return items.every((item, index) => getter(item, index) === first)
    ? { mixed: false, value: first }
    : { mixed: true, value: first };
}

export function batchTextAdapter(item) {
  if (["text", "replacement"].includes(item.type)) return { color: "color" };
  if (item.type === "markup" && item.markupKind === "flag") return { color: "textColor" };
  if (item.type === "markup" && item.markupKind === "callout") return { color: "color" };
  if (item.type === "markup" && item.markupKind === "legend") return { color: "textColor" };
  return null;
}

export function batchTextContentAdapter(item) {
  if (["text", "replacement"].includes(item.type) || item.type === "markup" && item.markupKind === "callout") return { property: "text", label: "Text" };
  if (item.type === "markup" && item.markupKind === "flag") return { property: "text", label: "Flag text" };
  return null;
}

export function batchTextBoxAdapter(item) {
  return ["text", "replacement"].includes(item.type) || item.type === "markup" && item.markupKind === "callout"
    ? { background: "backgroundColor", borderWidth: "borderWidth", borderColor: "borderColor", autoFit: "autoFit" }
    : null;
}

export function batchLineAdapter(item) {
  if (item.type === "markup") return { color: "strokeColor", width: "strokeWidth", type: "lineType" };
  if (item.type === "measurement") return { color: "lineColor", width: "lineWidth", type: "lineType" };
  return null;
}

export function batchFillAdapter(item) {
  if (item.type === "markup" && ["rectangle", "ellipse", "cloud", "polygon", "flag", "legend"].includes(item.markupKind)) {
    return { color: "fillColor", opacity: "fillOpacity", hatch: null, colorLabel: "Fill color", opacityLabel: "Fill strength" };
  }
  if (item.type === "measurement" && ["area", "diameter"].includes(item.measureKind)) {
    return { color: "shadeColor", opacity: "shadeOpacity", hatch: "hatchPattern", colorLabel: "Shape shade", opacityLabel: "Shade strength" };
  }
  return null;
}

export function batchAreaMeasurementAdapter(item) {
  return item.type === "measurement" && ["area", "diameter"].includes(item.measureKind)
    ? { infill: "areaFillEnabled", perimeter: "showPerimeterLength", area: item.measureKind === "diameter" ? "showAreaValue" : null }
    : null;
}

export function batchGeometryAdapter(item) {
  if (["text", "replacement"].includes(item.type)
    || item.type === "highlight" && !item.rects?.length
    || item.type === "markup" && ["callout", "legend"].includes(item.markupKind)) return { x: "x", y: "y", w: "w", h: "h" };
  return null;
}
