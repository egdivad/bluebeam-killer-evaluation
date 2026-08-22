import { isAddedPageObject, movePageItemFromSnapshot, pageItemSelectionBounds } from "./selection-core.js";

const EPSILON = 1e-7;

export function canArrangeMoveItem(item) {
  return isAddedPageObject(item)
    && !(item.type === "highlight" && item.rects?.length);
}

export function canArrangeSizeItem(item) {
  if (!canArrangeMoveItem(item) || item.type === "sticky-note") return false;
  if (Number(item.rotation)) return false;
  if (item.type === "measurement" && ["count", "diameter"].includes(item.measureKind)) return false;
  return true;
}

function minimumArrangeSize(item) {
  if (["text", "replacement"].includes(item?.type) || item?.type === "markup" && item.markupKind === "callout") {
    return { width: 30, height: 12 };
  }
  if (item?.type === "highlight" && !item.rects?.length) return { width: 6, height: 6 };
  return { width: 0, height: 0 };
}

function cloneGeometry(item) {
  return {
    ...item,
    points: Array.isArray(item.points) ? item.points.map(point => ({ ...point })) : item.points,
    rects: Array.isArray(item.rects) ? item.rects.map(rect => ({ ...rect })) : item.rects,
  };
}

function clampStart(start, size, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return start;
  if (size >= limit) return 0;
  return Math.max(0, Math.min(limit - size, start));
}

export function resizePageItemToBounds(item, targetBounds, currentBounds = pageItemSelectionBounds(item)) {
  if (!item || !currentBounds || !targetBounds) return false;
  const currentWidth = Number(currentBounds.w), currentHeight = Number(currentBounds.h);
  const targetWidth = Number(targetBounds.w), targetHeight = Number(targetBounds.h);
  if (![currentWidth, currentHeight, targetWidth, targetHeight].every(Number.isFinite)) return false;
  const widthChanges = Math.abs(targetWidth - currentWidth) > EPSILON;
  const heightChanges = Math.abs(targetHeight - currentHeight) > EPSILON;
  if (!widthChanges && !heightChanges) return false;
  if (widthChanges && (currentWidth <= EPSILON || targetWidth <= EPSILON)) return false;
  if (heightChanges && (currentHeight <= EPSILON || targetHeight <= EPSILON)) return false;

  const scaleX = widthChanges ? targetWidth / currentWidth : 1;
  const scaleY = heightChanges ? targetHeight / currentHeight : 1;
  const mapX = value => Number(targetBounds.x) + (Number(value) - Number(currentBounds.x)) * scaleX;
  const mapY = value => Number(targetBounds.y) + (Number(value) - Number(currentBounds.y)) * scaleY;

  if (Array.isArray(item.points)) item.points = item.points.map(point => ({ ...point, x: mapX(point.x), y: mapY(point.y) }));
  if (Array.isArray(item.rects)) item.rects = item.rects.map(rect => ({ ...rect, x: mapX(rect.x), y: mapY(rect.y), w: Number(rect.w) * scaleX, h: Number(rect.h) * scaleY }));
  if (Number.isFinite(Number(item.x))) item.x = mapX(item.x);
  if (Number.isFinite(Number(item.y))) item.y = mapY(item.y);
  if (Number.isFinite(Number(item.w))) item.w = Number(item.w) * scaleX;
  if (Number.isFinite(Number(item.h))) item.h = Number(item.h) * scaleY;
  return true;
}

export function matchSelectionSize(items, mode = "both", pageSize = {}) {
  const candidates = (items || []).filter(canArrangeSizeItem), skippedIds = (items || []).filter(item => !canArrangeSizeItem(item)).map(item => item.id);
  const needsWidth = mode === "width" || mode === "both", needsHeight = mode === "height" || mode === "both";
  const reference = candidates.find(item => {
    const bounds = pageItemSelectionBounds(item);
    return bounds && (!needsWidth || bounds.w > EPSILON) && (!needsHeight || bounds.h > EPSILON);
  });
  if (!reference) return { referenceId: null, changedIds: [], skippedIds: [...new Set(skippedIds)] };
  const referenceBounds = pageItemSelectionBounds(reference), changedIds = [];

  for (const item of candidates) {
    if (item === reference) continue;
    const bounds = pageItemSelectionBounds(item);
    if (!bounds || needsWidth && bounds.w <= EPSILON || needsHeight && bounds.h <= EPSILON) {
      skippedIds.push(item.id);
      continue;
    }
    const width = needsWidth ? referenceBounds.w : bounds.w, height = needsHeight ? referenceBounds.h : bounds.h;
    const minimum = minimumArrangeSize(item);
    if (width < minimum.width || height < minimum.height) {
      skippedIds.push(item.id);
      continue;
    }
    const x = clampStart(bounds.x + (bounds.w - width) / 2, width, Number(pageSize.width));
    const y = clampStart(bounds.y + (bounds.h - height) / 2, height, Number(pageSize.height));
    if (resizePageItemToBounds(item, { x, y, w: width, h: height }, bounds)) changedIds.push(item.id);
  }
  return { referenceId: reference.id, changedIds, skippedIds: [...new Set(skippedIds)] };
}

export function distributeSelection(items, axis = "horizontal") {
  const horizontal = axis === "horizontal", skippedIds = (items || []).filter(item => !canArrangeMoveItem(item)).map(item => item.id);
  const entries = (items || []).filter(canArrangeMoveItem).map(item => ({ item, bounds: pageItemSelectionBounds(item) })).filter(entry => entry.bounds);
  entries.sort((first, second) => horizontal ? first.bounds.x - second.bounds.x : first.bounds.y - second.bounds.y);
  if (entries.length < 3) return { changedIds: [], skippedIds: [...new Set(skippedIds)], gap: null };

  const start = horizontal ? entries[0].bounds.x : entries[0].bounds.y;
  const last = entries.at(-1).bounds;
  const end = horizontal ? last.x + last.w : last.y + last.h;
  const occupied = entries.reduce((total, entry) => total + (horizontal ? entry.bounds.w : entry.bounds.h), 0);
  const gap = (end - start - occupied) / (entries.length - 1), changedIds = [];
  let cursor = start;

  for (const [index, entry] of entries.entries()) {
    const position = horizontal ? entry.bounds.x : entry.bounds.y;
    const delta = index === 0 || index === entries.length - 1 ? 0 : cursor - position;
    if (Math.abs(delta) > EPSILON) {
      const source = cloneGeometry(entry.item);
      movePageItemFromSnapshot(entry.item, source, horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
      changedIds.push(entry.item.id);
    }
    cursor += (horizontal ? entry.bounds.w : entry.bounds.h) + gap;
  }
  return { changedIds, skippedIds: [...new Set(skippedIds)], gap };
}
