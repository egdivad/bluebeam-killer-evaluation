export function makeBookmark(title, pageId = null, options = {}) {
  return {
    id: options.id || crypto.randomUUID(),
    title: String(title || "Untitled bookmark").trim().slice(0, 200) || "Untitled bookmark",
    pageId: pageId || null,
    bold: options.bold === true,
    italic: options.italic === true,
    color: Array.isArray(options.color) ? options.color.slice(0, 3) : null,
    open: options.open !== false,
    children: Array.isArray(options.children) ? options.children : [],
  };
}

export function flattenBookmarks(bookmarks = [], depth = 0) {
  const rows = [];
  for (const bookmark of bookmarks) {
    rows.push({ bookmark, depth });
    rows.push(...flattenBookmarks(bookmark.children, depth + 1));
  }
  return rows;
}

export function findBookmark(bookmarks, id) {
  for (const bookmark of bookmarks) {
    if (bookmark.id === id) return bookmark;
    const child = findBookmark(bookmark.children, id);
    if (child) return child;
  }
  return null;
}

function findBookmarkLocation(bookmarks, id, parent = null) {
  for (let index = 0; index < bookmarks.length; index += 1) {
    const bookmark = bookmarks[index];
    if (bookmark.id === id) return { bookmark, siblings: bookmarks, index, parent };
    const child = findBookmarkLocation(bookmark.children, id, bookmark);
    if (child) return child;
  }
  return null;
}

export function renameBookmark(bookmarks, id, title) {
  const bookmark = findBookmark(bookmarks, id), value = String(title || "").trim();
  if (!bookmark || !value) return false;
  bookmark.title = value.slice(0, 200);
  return true;
}

export function removeBookmark(bookmarks, id) {
  const location = findBookmarkLocation(bookmarks, id);
  if (!location) return null;
  return location.siblings.splice(location.index, 1)[0];
}

export function moveBookmark(bookmarks, id, direction) {
  const location = findBookmarkLocation(bookmarks, id), offset = direction < 0 ? -1 : 1;
  if (!location) return false;
  const target = location.index + offset;
  if (target < 0 || target >= location.siblings.length) return false;
  [location.siblings[location.index], location.siblings[target]] = [location.siblings[target], location.siblings[location.index]];
  return true;
}

export function removeBookmarksForPage(bookmarks, pageId) {
  let removed = 0;
  for (let index = bookmarks.length - 1; index >= 0; index -= 1) {
    const bookmark = bookmarks[index];
    removed += removeBookmarksForPage(bookmark.children, pageId);
    if (bookmark.pageId === pageId) {
      if (bookmark.children.length) {
        bookmark.pageId = null;
      } else {
        bookmarks.splice(index, 1);
        removed += 1;
      }
    }
  }
  return removed;
}

export function bookmarkPageNumber(bookmark, pages) {
  const index = pages.findIndex(page => page.id === bookmark?.pageId);
  return index >= 0 ? index + 1 : null;
}

export function bookmarkCount(bookmarks) {
  return flattenBookmarks(bookmarks).length;
}
