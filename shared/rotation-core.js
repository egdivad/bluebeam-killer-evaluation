const ROTATABLE_MARKUP_KINDS = new Set(["rectangle", "ellipse", "cloud", "flag", "callout", "stamp"]);

export function normalizeRotation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const normalized = ((number % 360) + 360) % 360;
  return Math.abs(normalized) < 1e-9 ? 0 : normalized;
}

export function snapRotation(value, step = 15) {
  const interval = Math.max(1, Number(step) || 15);
  return normalizeRotation(Math.round(normalizeRotation(value) / interval) * interval);
}

export function canRotatePageItem(item) {
  if (["text", "replacement"].includes(item?.type)) return true;
  return item?.type === "markup" && ROTATABLE_MARKUP_KINDS.has(item.markupKind);
}

export function rotatePoint(point, center, degrees) {
  const radians = normalizeRotation(degrees) * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const dx = Number(point?.x) - Number(center?.x), dy = Number(point?.y) - Number(center?.y);
  return {
    x: Number(center?.x) + dx * cosine - dy * sine,
    y: Number(center?.y) + dx * sine + dy * cosine,
  };
}

export function inverseRotatePoint(point, center, degrees) {
  return rotatePoint(point, center, -normalizeRotation(degrees));
}

function addPoint(points, point) {
  const x = Number(point?.x), y = Number(point?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
}

export function unrotatedItemBounds(item) {
  if (!canRotatePageItem(item)) return null;
  const points = [];
  if (Array.isArray(item.points)) for (const point of item.points) addPoint(points, point);
  if (Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))) {
    const x = Number(item.x), y = Number(item.y), w = Math.max(0, Number(item.w) || 0), h = Math.max(0, Number(item.h) || 0);
    addPoint(points, { x, y });
    addPoint(points, { x: x + w, y: y + h });
  }
  if (!points.length) return null;
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

export function rotationCenter(item) {
  if (item?.type === "markup" && item.markupKind === "callout" && Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))) {
    return { x: Number(item.x) + Math.max(0, Number(item.w) || 0) / 2, y: Number(item.y) + Math.max(0, Number(item.h) || 0) / 2 };
  }
  const bounds = unrotatedItemBounds(item);
  return bounds ? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 } : null;
}

export function rotatedBoxFromWorldCorners(fixedWorld, movingWorld, degrees, { minWidth = 0, minHeight = 0, signX = 0, signY = 0 } = {}) {
  const angle = normalizeRotation(degrees), radians = -angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const worldDx = Number(movingWorld?.x) - Number(fixedWorld?.x), worldDy = Number(movingWorld?.y) - Number(fixedWorld?.y);
  let dx = worldDx * cosine - worldDy * sine, dy = worldDx * sine + worldDy * cosine;
  const directionX = signX || Math.sign(dx) || 1, directionY = signY || Math.sign(dy) || 1;
  if (Math.abs(dx) < minWidth) dx = directionX * minWidth;
  if (Math.abs(dy) < minHeight) dy = directionY * minHeight;
  const rotatedDx = dx * Math.cos(-radians) - dy * Math.sin(-radians), rotatedDy = dx * Math.sin(-radians) + dy * Math.cos(-radians);
  const fixed = { x: Number(fixedWorld.x) - (dx - rotatedDx) / 2, y: Number(fixedWorld.y) - (dy - rotatedDy) / 2 }, moving = { x: fixed.x + dx, y: fixed.y + dy };
  return { fixed, moving, bounds: { x: Math.min(fixed.x, moving.x), y: Math.min(fixed.y, moving.y), w: Math.abs(dx), h: Math.abs(dy) } };
}

export function rotatedItemCorners(item) {
  const bounds = unrotatedItemBounds(item), center = rotationCenter(item);
  if (!bounds || !center) return [];
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ];
  return corners.map(point => rotatePoint(point, center, item.rotation || 0));
}

export function rotatedItemBounds(item) {
  const corners = rotatedItemCorners(item);
  if (!corners.length) return null;
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function rotationHandlePoint(item, offset = 24) {
  const bounds = unrotatedItemBounds(item), center = rotationCenter(item);
  if (!bounds || !center) return null;
  return rotatePoint({ x: center.x, y: bounds.y - Math.max(0, Number(offset) || 0) }, center, item.rotation || 0);
}

export function pointerRotation(center, pointer, useSteps = false, step = 15) {
  if (!center || !pointer) return 0;
  const angle = Math.atan2(Number(pointer.y) - Number(center.y), Number(pointer.x) - Number(center.x)) * 180 / Math.PI + 90;
  return useSteps ? snapRotation(angle, step) : normalizeRotation(angle);
}

export function rotationPageCorrection(item, pageSize) {
  const bounds = rotatedItemBounds(item);
  if (!bounds) return { dx: 0, dy: 0 };
  const pageWidth = Math.max(0, Number(pageSize?.width) || 0), pageHeight = Math.max(0, Number(pageSize?.height) || 0);
  let dx = 0, dy = 0;
  if (bounds.w > pageWidth) dx = pageWidth / 2 - (bounds.x + bounds.w / 2);
  else if (bounds.x < 0) dx = -bounds.x;
  else if (bounds.x + bounds.w > pageWidth) dx = pageWidth - bounds.x - bounds.w;
  if (bounds.h > pageHeight) dy = pageHeight / 2 - (bounds.y + bounds.h / 2);
  else if (bounds.y < 0) dy = -bounds.y;
  else if (bounds.y + bounds.h > pageHeight) dy = pageHeight - bounds.y - bounds.h;
  return { dx, dy };
}
