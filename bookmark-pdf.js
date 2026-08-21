import { makeBookmark } from "./bookmark-core.js";

async function destinationPageIndex(pdf, destination) {
  try {
    const resolved = typeof destination === "string" ? await pdf.getDestination(destination) : destination;
    const target = resolved?.[0];
    if (Number.isInteger(target)) return target;
    return target ? await pdf.getPageIndex(target) : null;
  } catch {
    return null;
  }
}

export async function readPdfBookmarks(pdf, pages, makeId = () => crypto.randomUUID()) {
  const outline = await pdf.getOutline() || [];
  async function convert(items) {
    const converted = [];
    for (const item of items || []) {
      const pageIndex = await destinationPageIndex(pdf, item.dest);
      const color = item.color ? [...item.color].map(value => Math.max(0, Math.min(1, Number(value) / 255))) : null;
      const children = await convert(item.items), pageId = Number.isInteger(pageIndex) ? pages[pageIndex]?.id : null;
      if (!pageId && !children.length) continue;
      converted.push(makeBookmark(item.title, pageId, {
        id: makeId(),
        bold: item.bold,
        italic: item.italic,
        color,
        open: typeof item.count === "number" ? item.count >= 0 : true,
        children,
      }));
    }
    return converted;
  }
  return convert(outline);
}

function descendantCount(bookmark) {
  return bookmark.children.reduce((total, child) => total + 1 + descendantCount(child), 0);
}

export function writePdfBookmarks(PDFLib, document, bookmarks, pages) {
  const context = document.context, name = value => PDFLib.PDFName.of(value), pageMap = new Map();
  pages.forEach((page, index) => pageMap.set(page.id, document.getPage(index)));

  function createLevel(items, parentReference) {
    const valid = items.filter(bookmark => bookmark?.title && (pageMap.has(bookmark.pageId) || bookmark.children?.length));
    const entries = valid.map(bookmark => {
      const dictionary = context.obj({ Title: PDFLib.PDFHexString.fromText(bookmark.title), Parent: parentReference });
      const reference = context.register(dictionary);
      return { bookmark, dictionary, reference };
    });
    entries.forEach((entry, index) => {
      const { bookmark, dictionary } = entry, page = pageMap.get(bookmark.pageId);
      if (page) dictionary.set(name("Dest"), context.obj([page.ref, name("Fit")]));
      if (index) dictionary.set(name("Prev"), entries[index - 1].reference);
      if (index + 1 < entries.length) dictionary.set(name("Next"), entries[index + 1].reference);
      const style = (bookmark.italic ? 1 : 0) + (bookmark.bold ? 2 : 0);
      if (style) dictionary.set(name("F"), PDFLib.PDFNumber.of(style));
      if (Array.isArray(bookmark.color) && bookmark.color.length === 3) dictionary.set(name("C"), context.obj(bookmark.color.map(value => Math.max(0, Math.min(1, Number(value) || 0)))));
      const children = createLevel(bookmark.children || [], entry.reference);
      if (children.first) {
        dictionary.set(name("First"), children.first);
        dictionary.set(name("Last"), children.last);
        const count = descendantCount(bookmark);
        dictionary.set(name("Count"), PDFLib.PDFNumber.of(bookmark.open === false ? -count : count));
      }
    });
    return { first: entries[0]?.reference || null, last: entries.at(-1)?.reference || null };
  }

  const root = context.obj({ Type: name("Outlines") }), rootReference = context.register(root);
  const level = createLevel(bookmarks, rootReference);
  if (!level.first) {
    document.catalog.delete(name("Outlines"));
    return 0;
  }
  root.set(name("First"), level.first);
  root.set(name("Last"), level.last);
  const count = bookmarks.reduce((total, bookmark) => total + 1 + descendantCount(bookmark), 0);
  root.set(name("Count"), PDFLib.PDFNumber.of(count));
  document.catalog.set(name("Outlines"), rootReference);
  return count;
}
