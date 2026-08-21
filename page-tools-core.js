import { normalizePageRotation } from "./page-rotation-core.js";

function cloneValue(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function finite(value) {
  return Number.isFinite(Number(value));
}

export function selectedPageIds(pages, selectedIds = [], currentPage = 1) {
  const available = new Set(pages.map(page => page.id));
  const selected = [...new Set(selectedIds)].filter(id => available.has(id));
  if (selected.length) return selected;
  const current = pages[Math.max(0, Math.min(pages.length - 1, currentPage - 1))];
  return current ? [current.id] : [];
}

export function rotatePoint(point, width, height, direction = 1) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  return direction < 0 ? { x: y, y: width - x } : { x: height - y, y: x };
}

export function rotateRect(rect, width, height, direction = 1) {
  const x = Number(rect?.x) || 0;
  const y = Number(rect?.y) || 0;
  const w = Math.max(0, Number(rect?.w) || 0);
  const h = Math.max(0, Number(rect?.h) || 0);
  return direction < 0
    ? { x: y, y: width - x - w, w: h, h: w }
    : { x: height - y - h, y: x, w: h, h: w };
}

export function rotateAnnotation(annotation, width, height, direction = 1) {
  if (Array.isArray(annotation.points)) annotation.points = annotation.points.map(point => rotatePoint(point, width, height, direction));
  if (Array.isArray(annotation.rects)) annotation.rects = annotation.rects.map(rect => rotateRect(rect, width, height, direction));
  if (["x", "y", "w", "h"].every(key => finite(annotation[key]))) Object.assign(annotation, rotateRect(annotation, width, height, direction));
  if (["sourceX", "sourceY", "sourceW", "sourceH"].every(key => finite(annotation[key]))) {
    const source = rotateRect({ x: annotation.sourceX, y: annotation.sourceY, w: annotation.sourceW, h: annotation.sourceH }, width, height, direction);
    annotation.sourceX = source.x;
    annotation.sourceY = source.y;
    annotation.sourceW = source.w;
    annotation.sourceH = source.h;
  }
  return annotation;
}

export function rotatePages(pages, annotations, pageIds, direction, sizeById) {
  const targets = new Set(pageIds);
  let changed = 0;
  for (const page of pages) {
    if (!targets.has(page.id)) continue;
    const size = sizeById.get(page.id);
    if (!size?.width || !size?.height) continue;
    for (const annotation of annotations) {
      if (annotation.pageId === page.id) rotateAnnotation(annotation, size.width, size.height, direction);
    }
    if (page.blank) {
      [page.width, page.height] = [page.height, page.width];
    } else {
      const step = direction < 0 ? -90 : 90;
      page.rotation = normalizePageRotation((page.rotation || 0) + step);
      if (page.crop) {
        const fullWidth = size.fullWidth || size.width;
        const fullHeight = size.fullHeight || size.height;
        page.crop = rotateRect(page.crop, fullWidth, fullHeight, direction);
      }
    }
    changed += 1;
  }
  return changed;
}

export function duplicatePages(pages, annotations, pageIds, makeId = () => crypto.randomUUID()) {
  const targets = new Set(pageIds);
  const copies = [];
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const source = pages[index];
    if (!targets.has(source.id)) continue;
    const page = { ...cloneValue(source), id: makeId() };
    pages.splice(index + 1, 0, page);
    for (const annotation of annotations.filter(item => item.pageId === source.id)) {
      annotations.push({ ...cloneValue(annotation), id: makeId(), pageId: page.id });
    }
    copies.unshift(page);
  }
  return copies;
}

function shiftAnnotation(annotation, dx, dy) {
  if (Array.isArray(annotation.points)) annotation.points = annotation.points.map(point => ({ ...point, x: (Number(point.x) || 0) - dx, y: (Number(point.y) || 0) - dy }));
  if (Array.isArray(annotation.rects)) annotation.rects = annotation.rects.map(rect => ({ ...rect, x: (Number(rect.x) || 0) - dx, y: (Number(rect.y) || 0) - dy }));
  if (finite(annotation.x)) annotation.x = Number(annotation.x) - dx;
  if (finite(annotation.y)) annotation.y = Number(annotation.y) - dy;
  if (finite(annotation.sourceX)) annotation.sourceX = Number(annotation.sourceX) - dx;
  if (finite(annotation.sourceY)) annotation.sourceY = Number(annotation.sourceY) - dy;
}

export function cropPage(page, annotations, rect) {
  const crop = {
    x: Math.max(0, Number(rect?.x) || 0),
    y: Math.max(0, Number(rect?.y) || 0),
    w: Math.max(1, Number(rect?.w) || 1),
    h: Math.max(1, Number(rect?.h) || 1),
  };
  for (const annotation of annotations) if (annotation.pageId === page.id) shiftAnnotation(annotation, crop.x, crop.y);
  if (page.blank) {
    page.width = crop.w;
    page.height = crop.h;
  } else if (page.crop) {
    page.crop = { x: page.crop.x + crop.x, y: page.crop.y + crop.y, w: crop.w, h: crop.h };
  } else page.crop = crop;
  return crop;
}

export function replacePageRange(pages, annotations, pageIds, replacements) {
  const targets = new Set(pageIds);
  const indexes = pages.map((page, index) => targets.has(page.id) ? index : -1).filter(index => index >= 0);
  if (!indexes.length) return { index: -1, removed: [] };
  const first = Math.min(...indexes);
  const removed = pages.filter(page => targets.has(page.id));
  pages.splice(0, pages.length, ...pages.filter(page => !targets.has(page.id)));
  pages.splice(first, 0, ...replacements);
  for (let index = annotations.length - 1; index >= 0; index -= 1) if (targets.has(annotations[index].pageId)) annotations.splice(index, 1);
  return { index: first, removed };
}
