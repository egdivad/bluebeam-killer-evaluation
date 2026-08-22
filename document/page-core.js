export function makeSourcePages(count, makeId = () => crypto.randomUUID()) {
  return Array.from({ length: count }, (_, index) => ({
    id: makeId(),
    sourceIndex: index + 1,
    blank: false,
  }));
}

export function syncAnnotationPages(pages, annotations) {
  const pageNumbers = new Map(pages.map((page, index) => [page.id, index + 1]));
  for (const annotation of annotations) {
    if (annotation.pageId && pageNumbers.has(annotation.pageId)) {
      annotation.page = pageNumbers.get(annotation.pageId);
    }
  }
}

export function reorderPage(pages, annotations, from, to) {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return false;
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  syncAnnotationPages(pages, annotations);
  return true;
}

export function removePage(pages, annotations, index) {
  if (pages.length <= 1 || index < 0 || index >= pages.length) return null;
  const [removed] = pages.splice(index, 1);
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    if (annotations[i].pageId === removed.id) annotations.splice(i, 1);
  }
  syncAnnotationPages(pages, annotations);
  return removed;
}

export function addBlankPage(pages, annotations, index, size, makeId = () => crypto.randomUUID()) {
  const page = { id: makeId(), blank: true, width: size.width, height: size.height };
  pages.splice(index, 0, page);
  syncAnnotationPages(pages, annotations);
  return page;
}

export function getExportPlan(pages, annotations) {
  const editedPageIds = new Set(
    annotations.filter((annotation) => annotation.type === "replacement").map((annotation) => annotation.pageId),
  );
  return pages.map((page, index) => ({
    page,
    pageNumber: index + 1,
    flattenSource: !page.blank && editedPageIds.has(page.id),
  }));
}

export function annotationsForPageId(annotations, pageId) {
  return annotations.filter((annotation) => annotation.pageId === pageId);
}

export function pageNumberLabel(descriptor, index) {
  const current = index + 1;
  if (descriptor?.blank) return `${current} · Inserted`;
  if (descriptor?.imported) return `${current} · Replacement ${descriptor.sourceIndex}`;
  if (descriptor?.sourceIndex && descriptor.sourceIndex !== current) return `${current} · Original ${descriptor.sourceIndex}`;
  return String(current);
}

export function mostVisiblePage(viewport, candidates, currentPage = 1) {
  let best = null;
  const viewportCenterX = (viewport.left + viewport.right) / 2;
  const viewportCenterY = (viewport.top + viewport.bottom) / 2;
  for (const candidate of candidates) {
    const rect = candidate.rect;
    const width = Math.max(0, Math.min(viewport.right, rect.right) - Math.max(viewport.left, rect.left));
    const height = Math.max(0, Math.min(viewport.bottom, rect.bottom) - Math.max(viewport.top, rect.top));
    const area = width * height;
    if (!area) continue;
    const centerDistance = Math.hypot((rect.left + rect.right) / 2 - viewportCenterX, (rect.top + rect.bottom) / 2 - viewportCenterY);
    const keepsCurrentPage = candidate.pageNumber === currentPage;
    if (!best || area > best.area || (area === best.area && keepsCurrentPage && !best.keepsCurrentPage) || (area === best.area && keepsCurrentPage === best.keepsCurrentPage && centerDistance < best.centerDistance)) {
      best = { pageNumber: candidate.pageNumber, area, centerDistance, keepsCurrentPage };
    }
  }
  return best?.pageNumber || currentPage;
}
