import { canRotatePageItem, rotatedItemBounds } from "../shared/rotation-core.js?v=1";

export function isFreeAreaHighlight(item) {
  return item?.type === "highlight" && !item.rects?.length;
}

export function isCopyablePageItem(item) {
  return item?.type === "text"
    || item?.type === "markup"
    || item?.type === "sticky-note"
    || item?.type === "measurement" && item.measureKind !== "calibration"
    || isFreeAreaHighlight(item);
}

export function isFormatPaintableItem(item) {
  return ["text", "replacement"].includes(item?.type)
    || item?.type === "highlight"
    || item?.type === "sticky-note"
    || item?.type === "markup"
    || item?.type === "measurement" && item.measureKind !== "calibration";
}

export function isAddedPageObject(item) {
  return ["text", "replacement", "highlight", "markup", "sticky-note"].includes(item?.type)
    || item?.type === "measurement" && item.measureKind !== "calibration";
}

export function normalizeSelectionRectangle(start, end) {
  const first = start || { x: 0, y: 0 }, last = end || first;
  return {
    x: Math.min(Number(first.x) || 0, Number(last.x) || 0),
    y: Math.min(Number(first.y) || 0, Number(last.y) || 0),
    w: Math.abs((Number(last.x) || 0) - (Number(first.x) || 0)),
    h: Math.abs((Number(last.y) || 0) - (Number(first.y) || 0)),
  };
}

export function pageItemSelectionBounds(item, { countRadius = 9, visualScale = 0 } = {}) {
  if (!isAddedPageObject(item)) return null;
  const boxes = [], addBox = value => {
    const x = Number(value?.x), y = Number(value?.y), w = Math.max(0, Number(value?.w) || 0), h = Math.max(0, Number(value?.h) || 0);
    if (Number.isFinite(x) && Number.isFinite(y)) boxes.push({ x, y, w, h });
  };
  if (Array.isArray(item.rects) && item.rects.length) for (const rect of item.rects) addBox(rect);
  if (Array.isArray(item.points) && item.points.length) for (const point of item.points) addBox({ x: point.x, y: point.y, w: 0, h: 0 });
  if (item.type === "measurement" && item.measureKind === "diameter" && item.points?.length > 1) {
    const first = item.points[0], last = item.points[1];
    const centerX = (Number(first.x) + Number(last.x)) / 2, centerY = (Number(first.y) + Number(last.y)) / 2;
    const radius = Math.hypot(Number(last.x) - Number(first.x), Number(last.y) - Number(first.y)) / 2;
    addBox({ x: centerX - radius, y: centerY - radius, w: radius * 2, h: radius * 2 });
  }
  if (item.type === "measurement" && item.measureKind === "count" && item.points?.length) {
    const point = item.points[0], radius = Math.max(0, Number(countRadius) || 0);
    addBox({ x: Number(point.x) - radius, y: Number(point.y) - radius, w: radius * 2, h: radius * 2 });
  }
  if (Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))) addBox(item);
  if (!boxes.length) return null;
  const rotated=canRotatePageItem(item)&&Number(item.rotation)?rotatedItemBounds(item):null;
  const left = rotated?.x??Math.min(...boxes.map(box => box.x)), top = rotated?.y??Math.min(...boxes.map(box => box.y)), right = rotated?rotated.x+rotated.w:Math.max(...boxes.map(box => box.x + box.w)), bottom = rotated?rotated.y+rotated.h:Math.max(...boxes.map(box => box.y + box.h));
  const scale = Number(visualScale); let padding = 0;
  if (Number.isFinite(scale) && scale > 0 && item.type === "markup") {
    const width = Math.max(0, Number(item.strokeWidth) || 2), kind = item.markupKind;
    padding = width / 2;
    if (kind === "cloud") padding = Math.max(padding, 10 + width / 2);
    const hasArrow = kind === "arrow" && ((item.startArrow || "none") !== "none" || (item.endArrow || "filled") !== "none") || kind === "callout" && (item.startArrow || "filled") !== "none";
    if (hasArrow) padding = Math.max(padding, 10 + width * 2 + width / 2);
    if (["callout", "legend"].includes(kind)) padding = Math.max(padding, Math.max(0, Number(item.borderWidth) || 0) / 2);
    padding /= scale;
  } else if (Number.isFinite(scale) && scale > 0 && item.type === "measurement") padding = Math.max(0, Number(item.lineWidth) || 1.6) / 2 / scale;
  return { x: left - padding, y: top - padding, w: right - left + padding * 2, h: bottom - top + padding * 2 };
}

export function rectangleSelectedIds(items, rectangle, currentIds = [], toggle = false, boundsOptions = {}) {
  const start = { x: Number(rectangle?.x) || 0, y: Number(rectangle?.y) || 0 };
  const area = normalizeSelectionRectangle(start, { x: start.x + (Number(rectangle?.w) || 0), y: start.y + (Number(rectangle?.h) || 0) }), hits = [];
  for (const item of items || []) {
    const bounds = pageItemSelectionBounds(item, boundsOptions);
    if (!bounds) continue;
    const inside = bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.w <= area.x + area.w && bounds.y + bounds.h <= area.y + area.h;
    if (inside && item.id) hits.push(item.id);
  }
  if (!toggle) return [...new Set(hits)];
  const selected = new Set(currentIds || []);
  for (const id of hits) selected.has(id) ? selected.delete(id) : selected.add(id);
  return [...selected];
}

const SELECTION_EPSILON = 1e-7;

function pointOnSegment(point, start, end) {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > SELECTION_EPSILON) return false;
  return point.x >= Math.min(start.x, end.x) - SELECTION_EPSILON
    && point.x <= Math.max(start.x, end.x) + SELECTION_EPSILON
    && point.y >= Math.min(start.y, end.y) - SELECTION_EPSILON
    && point.y <= Math.max(start.y, end.y) + SELECTION_EPSILON;
}

export function pointInPolygon(point, polygon = []) {
  if (!point || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous], end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    const crosses = (start.y > point.y) !== (end.y > point.y)
      && point.x < (end.x - start.x) * (point.y - start.y) / (end.y - start.y) + start.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(first, second, third) {
  const value = (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  return Math.abs(value) <= SELECTION_EPSILON ? 0 : Math.sign(value);
}

function segmentsProperlyIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  return orientation(firstStart, firstEnd, secondStart) * orientation(firstStart, firstEnd, secondEnd) < 0
    && orientation(secondStart, secondEnd, firstStart) * orientation(secondStart, secondEnd, firstEnd) < 0;
}

export function boundsInsidePolygon(bounds, polygon = []) {
  if (!bounds || polygon.length < 3) return false;
  const left = Number(bounds.x), top = Number(bounds.y), right = left + Number(bounds.w), bottom = top + Number(bounds.h);
  if (![left, top, right, bottom].every(Number.isFinite)) return false;
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  if (!corners.every(point => pointInPolygon(point, polygon))) return false;
  if (polygon.some(point => point.x > left + SELECTION_EPSILON && point.x < right - SELECTION_EPSILON && point.y > top + SELECTION_EPSILON && point.y < bottom - SELECTION_EPSILON)) return false;
  const boundsEdges = corners.map((point, index) => [point, corners[(index + 1) % corners.length]]);
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index], end = polygon[(index + 1) % polygon.length];
    if (boundsEdges.some(([edgeStart, edgeEnd]) => segmentsProperlyIntersect(start, end, edgeStart, edgeEnd))) return false;
  }
  return true;
}

export function lassoSelectedIds(items, polygon, currentIds = [], toggle = false, boundsOptions = {}) {
  const hits = [];
  for (const item of items || []) {
    const bounds = pageItemSelectionBounds(item, boundsOptions);
    if (boundsInsidePolygon(bounds, polygon) && item.id) hits.push(item.id);
  }
  if (!toggle) return [...new Set(hits)];
  const selected = new Set(currentIds || []);
  for (const id of hits) selected.has(id) ? selected.delete(id) : selected.add(id);
  return [...selected];
}

export function groupSelectionBounds(items, boundsOptions = {}) {
  const boxes = (items || []).map(item => pageItemSelectionBounds(item, boundsOptions)).filter(Boolean);
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.w)), bottom = Math.max(...boxes.map(box => box.y + box.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function constrainGroupMoveDelta(bounds, delta, pageSize) {
  if (!bounds) return { dx: 0, dy: 0 };
  const pageWidth = Math.max(0, Number(pageSize?.width) || 0), pageHeight = Math.max(0, Number(pageSize?.height) || 0);
  const requestedX = Number(delta?.dx) || 0, requestedY = Number(delta?.dy) || 0;
  const clampAxis = (requested, start, size, limit) => {
    if (size >= limit) return 0;
    return Math.max(-start, Math.min(limit - start - size, requested));
  };
  return {
    dx: clampAxis(requestedX, bounds.x, bounds.w, pageWidth),
    dy: clampAxis(requestedY, bounds.y, bounds.h, pageHeight),
  };
}

export function keyboardMoveDelta(direction, accelerated = false) {
  const amount = accelerated ? 10 : 1;
  return ({
    left: { dx: -amount, dy: 0 },
    right: { dx: amount, dy: 0 },
    up: { dx: 0, dy: -amount },
    down: { dx: 0, dy: amount },
  })[direction] || null;
}

export function movePageItemFromSnapshot(item, source, delta) {
  if (!item || !source) return item;
  const dx = Number(delta?.dx) || 0, dy = Number(delta?.dy) || 0;
  if (Array.isArray(source.points)) item.points = source.points.map(point => ({ ...point, x: Number(point.x) + dx, y: Number(point.y) + dy }));
  if (Array.isArray(source.rects)) item.rects = source.rects.map(rect => ({ ...rect, x: Number(rect.x) + dx, y: Number(rect.y) + dy }));
  if (Number.isFinite(Number(source.x))) item.x = Number(source.x) + dx;
  if (Number.isFinite(Number(source.y))) item.y = Number(source.y) + dy;
  return item;
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
  if (item.type === "markup" && item.markupKind === "stamp" && item.stampKind !== "image") return { color: "textColor" };
  return null;
}

export function batchTextContentAdapter(item) {
  if (["text", "replacement"].includes(item.type) || item.type === "markup" && item.markupKind === "callout") return { property: "text", label: "Text" };
  if (item.type === "markup" && item.markupKind === "flag") return { property: "text", label: "Flag text" };
  if (item.type === "markup" && item.markupKind === "stamp" && item.stampKind !== "image") return { property: "text", label: "Stamp text" };
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
  if (item.type === "markup" && ["rectangle", "ellipse", "cloud", "polygon", "flag", "legend", "stamp"].includes(item.markupKind)) {
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
    || item.type === "sticky-note"
    || item.type === "highlight" && !item.rects?.length
    || item.type === "markup" && ["callout", "legend", "stamp"].includes(item.markupKind)) return { x: "x", y: "y", w: "w", h: "h" };
  return null;
}
