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

export function shouldInsertText(tool, selectedId, targetIsAnnotation) {
  return tool === "insert" && !selectedId && !targetIsAnnotation;
}
