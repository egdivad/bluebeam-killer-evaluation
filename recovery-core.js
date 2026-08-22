export const RECOVERY_VERSION = 1;
export const RECOVERY_KEY = "current";

const LAYOUT_MODES = new Set(["single", "continuous", "side", "continuous-side"]);

function jsonClone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return null;
}

function cleanDocumentName(value) {
  const name = String(value || "Untitled.pdf").trim().slice(0, 255);
  return name || "Untitled.pdf";
}

function cleanUpdatedAt(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function cleanSources(values) {
  const result = [], keys = new Set();
  for (const value of values || []) {
    const key = String(value?.key || "").trim(), bytes = normalizeBytes(value?.bytes);
    if (!key || !bytes?.length || keys.has(key)) continue;
    keys.add(key);
    result.push({ key, name: cleanDocumentName(value.name), bytes });
  }
  return result;
}

function cleanPages(values, sourceKeys) {
  const result = [], ids = new Set();
  for (const value of values || []) {
    const page = jsonClone(value, null), id = String(page?.id || "").trim();
    if (!page || !id || ids.has(id)) continue;
    if (page.blank) {
      if (!(Number(page.width) > 0) || !(Number(page.height) > 0)) continue;
      page.width = Number(page.width);page.height = Number(page.height);page.blank = true;
    } else {
      page.sourceKey = String(page.sourceKey || "primary");
      page.sourceIndex = Math.max(1, Math.trunc(Number(page.sourceIndex) || 1));
      if (!sourceKeys.has(page.sourceKey)) continue;
      page.blank = false;
    }
    page.id = id;ids.add(id);result.push(page);
  }
  return result;
}

export function createRecoveryRecord({ documentName, pageSources, document }, now = new Date()) {
  const sources = cleanSources(pageSources instanceof Map ? [...pageSources].map(([key, source]) => ({ key, name: source?.name, bytes: source?.bytes })) : pageSources);
  const sourceKeys = new Set(sources.map(source => source.key));
  if (!sourceKeys.has("primary")) throw new Error("The primary PDF source is required.");
  const pages = cleanPages(document?.pages, sourceKeys);
  if (!pages.length) throw new Error("At least one page is required.");
  const pageIds = new Set(pages.map(page => page.id)), annotations = jsonClone(document?.annotations, []).filter(item => item && typeof item === "object" && pageIds.has(item.pageId)), measurementScales = {};
  for (const [pageId, scale] of Object.entries(jsonClone(document?.measurementScales, {}))) if (pageIds.has(pageId) && scale && typeof scale === "object") measurementScales[pageId] = scale;
  return {
    key: RECOVERY_KEY,
    version: RECOVERY_VERSION,
    documentName: cleanDocumentName(documentName),
    updatedAt: cleanUpdatedAt(now),
    sources,
    document: {
      pages,
      page: Math.max(1, Math.min(pages.length, Math.trunc(Number(document?.page) || 1))),
      scale: Math.max(.1, Math.min(8, Number(document?.scale) || 1)),
      layoutMode: LAYOUT_MODES.has(document?.layoutMode) ? document.layoutMode : "single",
      annotations,
      bookmarks: jsonClone(document?.bookmarks, []),
      layers: jsonClone(document?.layers, []),
      measurementScales,
    },
  };
}

export function parseRecoveryRecord(value) {
  if (!value || value.version !== RECOVERY_VERSION || value.key !== RECOVERY_KEY) return null;
  if (!Number.isFinite(new Date(value.updatedAt).getTime())) return null;
  try {
    return createRecoveryRecord({ documentName: value.documentName, pageSources: value.sources, document: value.document }, value.updatedAt);
  } catch {
    return null;
  }
}

export function recoveryRecordSummary(value) {
  const record = parseRecoveryRecord(value);
  if (!record) return null;
  return {
    documentName: record.documentName,
    updatedAt: record.updatedAt,
    pageCount: record.document.pages.length,
    itemCount: record.document.annotations.length,
    byteSize: record.sources.reduce((total, source) => total + source.bytes.byteLength, 0),
  };
}
