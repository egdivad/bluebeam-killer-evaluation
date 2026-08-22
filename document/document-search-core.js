function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryPattern(query) {
  return query.trim().split(/\s+/).filter(Boolean).map(escapedPattern).join("\\s+");
}

function isWordCharacter(value) {
  return Boolean(value && /[\p{L}\p{N}_]/u.test(value));
}

export function createSearchPageIndex(pageId, sourceIndex, items = []) {
  let text = "";
  const ranges = [];
  let previous = null;
  for (const item of items) {
    const value = typeof item?.str === "string" ? item.str : "";
    if (!value) continue;
    if (text) {
      if (previous?.hasEOL) text += "\n";
      else if (!/\s$/.test(text) && !/^\s/.test(value)) text += " ";
    }
    const start = text.length;
    text += value;
    ranges.push({ itemIndex: ranges.length, start, end: text.length });
    previous = item;
  }
  return { pageId, sourceIndex, text, ranges };
}

export function searchPageIndex(pageIndex, query, options = {}) {
  const pattern = queryPattern(query);
  if (!pattern || !pageIndex?.text) return [];
  const expression = new RegExp(pattern, options.matchCase ? "gu" : "giu");
  const results = [];
  let match;
  while ((match = expression.exec(pageIndex.text))) {
    const start = match.index, end = start + match[0].length;
    if (options.wholeWord && (isWordCharacter(pageIndex.text[start - 1]) || isWordCharacter(pageIndex.text[end]))) continue;
    const segments = pageIndex.ranges.filter(range => range.end > start && range.start < end).map(range => ({
      itemIndex: range.itemIndex,
      start: Math.max(0, start - range.start),
      end: Math.min(range.end, end) - range.start,
    })).filter(segment => segment.end > segment.start);
    const contextStart = Math.max(0, start - 42), contextEnd = Math.min(pageIndex.text.length, end + 58);
    const excerpt = pageIndex.text.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim();
    results.push({
      id: `${pageIndex.pageId}:${start}:${end}`,
      pageId: pageIndex.pageId,
      sourceIndex: pageIndex.sourceIndex,
      start,
      end,
      match: match[0],
      excerpt: `${contextStart ? "…" : ""}${excerpt}${contextEnd < pageIndex.text.length ? "…" : ""}`,
      segments,
    });
    if (!match[0].length) expression.lastIndex += 1;
  }
  return results;
}

export function searchDocumentIndexes(indexes, query, options = {}, limit = 5000) {
  const results = [];
  for (const pageIndex of indexes) {
    results.push(...searchPageIndex(pageIndex, query, options));
    if (results.length >= limit) return results.slice(0, limit);
  }
  return results;
}

export function orderSearchResults(results, pages) {
  const order = new Map(pages.map((page, index) => [page.id, index]));
  return results.filter(result => order.has(result.pageId)).sort((first, last) => {
    const pageDifference = order.get(first.pageId) - order.get(last.pageId);
    return pageDifference || first.start - last.start;
  });
}

export function nextSearchResultIndex(currentIndex, resultCount, direction = 1) {
  if (!resultCount) return -1;
  const start = currentIndex >= 0 ? currentIndex : direction < 0 ? 0 : -1;
  return (start + direction + resultCount) % resultCount;
}
