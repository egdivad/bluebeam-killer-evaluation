import { pdfPointToDisplay } from "./page-rotation-core.js";

const FIELD_TYPES = new Map([
  ["PDFTextField", "text"],
  ["PDFCheckBox", "checkbox"],
  ["PDFRadioGroup", "radio"],
  ["PDFDropdown", "dropdown"],
  ["PDFOptionList", "list"],
  ["PDFButton", "button"],
  ["PDFSignature", "signature"]
]);

function fieldType(field) {
  const name = field?.constructor?.name || "";
  if (FIELD_TYPES.has(name)) return FIELD_TYPES.get(name);
  if (typeof field?.getText === "function" || typeof field?.setText === "function") return "text";
  if (typeof field?.isChecked === "function" && typeof field?.check === "function") return "checkbox";
  if (typeof field?.getOptions === "function" && typeof field?.select === "function") return "dropdown";
  return name.replace(/^PDF/, "").replace(/Field$/, "").toLowerCase() || "unknown";
}

function safeCall(target, name, ...args) {
  try { return typeof target?.[name] === "function" ? target[name](...args) : undefined; }
  catch { return undefined; }
}

function fieldValue(field, type) {
  if (type === "text") return safeCall(field, "getText") ?? "";
  if (type === "checkbox") return Boolean(safeCall(field, "isChecked"));
  if (type === "radio" || type === "dropdown" || type === "list") return safeCall(field, "getSelected") ?? "";
  return "";
}

function pageReferenceKey(reference) {
  return reference ? String(reference) : "";
}

function widgetPageIndex(PDFLib, widget, pageRefs) {
  const direct = safeCall(widget, "P") || safeCall(widget, "getPageRef") || widget?.pageRef;
  if (direct && pageRefs.has(pageReferenceKey(direct))) return pageRefs.get(pageReferenceKey(direct));
  const name = value => PDFLib.PDFName?.of?.(value);
  const fromDict = name ? widget?.dict?.get?.(name("P")) : null;
  if (fromDict && pageRefs.has(pageReferenceKey(fromDict))) return pageRefs.get(pageReferenceKey(fromDict));
  return null;
}

function displayWidgetBounds(rect, geometry) {
  const corners = [
    pdfPointToDisplay({ x: rect.x, y: rect.y }, geometry),
    pdfPointToDisplay({ x: rect.x + rect.width, y: rect.y }, geometry),
    pdfPointToDisplay({ x: rect.x + rect.width, y: rect.y + rect.height }, geometry),
    pdfPointToDisplay({ x: rect.x, y: rect.y + rect.height }, geometry)
  ];
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function pageGeometry(page) {
  const crop = safeCall(page, "getCropBox") || { x: 0, y: 0, width: 0, height: 0 }, rotation = safeCall(page, "getRotation")?.angle || 0;
  return { x: crop.x || 0, y: crop.y || 0, width: crop.width || 0, height: crop.height || 0, rotation };
}

function widgetBounds(PDFLib, widget, pages, pageRefs) {
  const rect = safeCall(widget, "getRectangle");
  if (!rect) return null;
  const x = Number(rect.x), y = Number(rect.y), width = Number(rect.width), height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const pageIndex = widgetPageIndex(PDFLib, widget, pageRefs) ?? (pages.length === 1 ? 0 : null), geometry = pageIndex == null ? null : pageGeometry(pages[pageIndex]);
  return { pageIndex, rect: { x, y, width, height }, ...(geometry ? { bounds: displayWidgetBounds({ x, y, width, height }, geometry) } : {}) };
}

export async function detectNativePdfFormFields(PDFLib, bytes) {
  const document = await PDFLib.PDFDocument.load(bytes.slice());
  const pages = safeCall(document, "getPages") || [], pageRefs = new Map(pages.map((page, index) => [pageReferenceKey(page.ref), index]));
  const form = safeCall(document, "getForm");
  const fields = safeCall(form, "getFields") || [];
  return fields.map((field, index) => {
    const type = fieldType(field), widgets = safeCall(field?.acroField, "getWidgets") || [];
    return {
      id: `field-${index + 1}`,
      name: safeCall(field, "getName") || `Field ${index + 1}`,
      type,
      value: fieldValue(field, type),
      options: safeCall(field, "getOptions") || [],
      widgets: widgets.map(widget => widgetBounds(PDFLib, widget, pages, pageRefs)).filter(Boolean)
    };
  });
}

export function formFieldSummary(fields = []) {
  const total = fields.length;
  if (!total) return "No native PDF form fields detected.";
  const counts = new Map();
  for (const field of fields) counts.set(field.type || "unknown", (counts.get(field.type || "unknown") || 0) + 1);
  const details = [...counts].sort(([first], [second]) => first.localeCompare(second)).map(([type, count]) => `${count} ${type}`).join(", ");
  return `${total} native PDF form ${total === 1 ? "field" : "fields"} detected${details ? `: ${details}` : ""}.`;
}

export function mergeRecoveredFormFields(detected = [], recovered = []) {
  const byName = new Map(recovered.filter(field => field?.name).map(field => [field.name, field]));
  const byId = new Map(recovered.filter(field => field?.id).map(field => [field.id, field]));
  const merged = detected.map(field => {
    const saved = byName.get(field.name) || byId.get(field.id);
    return saved ? { ...field, value: saved.value, dirty: Boolean(saved.dirty) } : field;
  });
  for (const field of recovered) if (field?.manual && !merged.some(item => item.id === field.id || item.name === field.name)) merged.push(field);
  return merged;
}

function applyFieldValue(field, descriptor) {
  const type = descriptor?.type && descriptor.type !== "unknown" ? descriptor.type : fieldType(field), value = descriptor?.value;
  if (type === "text") return safeCall(field, "setText", String(value ?? ""));
  if (type === "checkbox") return value ? safeCall(field, "check") : safeCall(field, "uncheck");
  if (type === "radio" || type === "dropdown" || type === "list") return safeCall(field, "select", Array.isArray(value) ? value[0] ?? "" : value);
  return undefined;
}

export async function applyNativePdfFormValues(PDFLib, bytes, fields = [], { flatten = false } = {}) {
  if (!fields.length&&!flatten) return bytes.slice();
  const document = await PDFLib.PDFDocument.load(bytes.slice()), form = safeCall(document, "getForm");
  if (!form) return bytes.slice();
  let changed = 0;
  for (const descriptor of fields) {
    const name = descriptor?.name;
    if (!name) continue;
    const field = safeCall(form, "getField", name);
    if (!field) continue;
    applyFieldValue(field, descriptor);
    changed += 1;
  }
  if (!changed&&!flatten) return bytes.slice();
  safeCall(form, "updateFieldAppearances");
  if (flatten) safeCall(form, "flatten");
  return new Uint8Array(await document.save());
}
