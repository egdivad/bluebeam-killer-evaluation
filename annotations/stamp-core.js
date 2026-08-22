export const MAX_STAMP_IMAGE_BYTES = 700_000;

const DEFAULT_FONT = "Arial, Helvetica, sans-serif";
const textStyle = {
  stampKind: "text",
  fontFamily: DEFAULT_FONT,
  fontChoice: DEFAULT_FONT,
  fontSize: 24,
  fontWeight: "700",
  fontStyle: "normal",
  textUnderline: false,
  textAlign: "center",
  verticalAlign: "middle",
  lineType: "solid",
  strokeWidth: 2,
  fillOpacity: 0.12,
};

export const STANDARD_STAMP_PRESETS = Object.freeze([
  Object.freeze({ id: "standard:draft", name: "Draft", builtIn: true, text: "DRAFT", stampName: "Draft", strokeColor: "#d04a3a", fillColor: "#d04a3a", textColor: "#b33427", ...textStyle }),
  Object.freeze({ id: "standard:approved", name: "Approved", builtIn: true, text: "APPROVED", stampName: "Approved", strokeColor: "#16845b", fillColor: "#16845b", textColor: "#126b4a", ...textStyle }),
  Object.freeze({ id: "standard:reviewed", name: "Reviewed", builtIn: true, text: "REVIEWED", stampName: "Reviewed", strokeColor: "#2563eb", fillColor: "#2563eb", textColor: "#1d4ed8", ...textStyle }),
  Object.freeze({ id: "standard:for-information", name: "For Information", builtIn: true, text: "FOR INFORMATION", stampName: "ForInformation", strokeColor: "#7c3aed", fillColor: "#7c3aed", textColor: "#6d28d9", ...textStyle, fontSize: 19 }),
]);

function cleanText(value, fallback = "STAMP", maximum = 120) {
  return String(value || fallback).trim().replace(/\s+/g, " ").slice(0, maximum) || fallback;
}

function cleanName(value, fallback = "Custom stamp") {
  return cleanText(value, fallback, 80);
}

function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function safeNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function stampImageByteLength(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg);base64,([a-z0-9+/=]+)$/i);
  if (!match) return 0;
  const data = match[2], padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
}

export function isSafeStampImageDataUrl(dataUrl) {
  const length = stampImageByteLength(dataUrl);
  return length > 0 && length <= MAX_STAMP_IMAGE_BYTES;
}

export function sanitizeStampPreset(value, { allowBuiltIn = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stampKind = value.stampKind === "image" ? "image" : "text";
  const imageDataUrl = stampKind === "image" && isSafeStampImageDataUrl(value.imageDataUrl) ? value.imageDataUrl : "";
  if (stampKind === "image" && !imageDataUrl) return null;
  const text = stampKind === "text" ? cleanText(value.text) : "";
  const name = cleanName(value.name, stampKind === "image" ? "Image stamp" : text);
  const id = String(value.id || crypto.randomUUID()).slice(0, 120);
  return {
    id,
    name,
    builtIn: Boolean(allowBuiltIn && value.builtIn),
    stampKind,
    stampName: cleanText(value.stampName, stampKind === "image" ? "Custom" : "Custom", 60).replace(/[^A-Za-z0-9_-]/g, "") || "Custom",
    text,
    imageDataUrl,
    imageMimeType: imageDataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : stampKind === "image" ? "image/png" : "",
    aspectRatio: safeNumber(value.aspectRatio, stampKind === "image" ? 1.6 : 3.2, 0.1, 10),
    rotation: safeNumber(value.rotation, 0, 0, 359),
    strokeColor: safeColor(value.strokeColor, stampKind === "image" ? "#15191f" : "#d04a3a"),
    strokeWidth: safeNumber(value.strokeWidth, stampKind === "image" ? 0 : 2, 0, 10),
    lineType: ["solid", "dashed", "dotted", "centerline"].includes(value.lineType) ? value.lineType : "solid",
    fillColor: safeColor(value.fillColor, stampKind === "image" ? "#ffffff" : "#d04a3a"),
    fillOpacity: safeNumber(value.fillOpacity, stampKind === "image" ? 0 : 0.12, 0, 1),
    textColor: safeColor(value.textColor, "#b33427"),
    fontFamily: typeof value.fontFamily === "string" && value.fontFamily.length <= 200 ? value.fontFamily : DEFAULT_FONT,
    fontChoice: typeof value.fontChoice === "string" && value.fontChoice.length <= 200 ? value.fontChoice : DEFAULT_FONT,
    fontSize: safeNumber(value.fontSize, 24, 8, 48),
    fontWeight: ["400", "500", "600", "700"].includes(String(value.fontWeight)) ? String(value.fontWeight) : "700",
    fontStyle: value.fontStyle === "italic" ? "italic" : "normal",
    textUnderline: Boolean(value.textUnderline),
    textAlign: ["left", "center", "right"].includes(value.textAlign) ? value.textAlign : "center",
    verticalAlign: ["top", "middle", "bottom"].includes(value.verticalAlign) ? value.verticalAlign : "middle",
  };
}

export function makeTextStampPreset(text, options = {}) {
  const value = cleanText(text);
  return sanitizeStampPreset({
    id: options.id || crypto.randomUUID(),
    name: options.name || value,
    text: value,
    stampKind: "text",
    stampName: options.stampName || "Custom",
    strokeColor: options.strokeColor || "#d04a3a",
    fillColor: options.fillColor || "#d04a3a",
    textColor: options.textColor || "#b33427",
    ...textStyle,
    ...options,
  });
}

export function makeImageStampPreset({ name, imageDataUrl, aspectRatio = 1.6, id = crypto.randomUUID() }) {
  return sanitizeStampPreset({ id, name, stampKind: "image", stampName: "Custom", imageDataUrl, aspectRatio, strokeColor: "#15191f", strokeWidth: 0, fillColor: "#ffffff", fillOpacity: 0 });
}

export function stampPresetProperties(preset) {
  const safe = sanitizeStampPreset(preset, { allowBuiltIn: true });
  if (!safe) return null;
  const { id, name, builtIn, ...properties } = safe;
  return structuredClone(properties);
}

export function captureStampPreset(annotation, name, id = crypto.randomUUID()) {
  if (annotation?.type !== "markup" || annotation.markupKind !== "stamp") return null;
  return sanitizeStampPreset({ ...annotation, id, name, builtIn: false });
}

export function defaultStampPoints(anchor, pageSize, preset) {
  const safe = sanitizeStampPreset(preset, { allowBuiltIn: true }) || STANDARD_STAMP_PRESETS[0];
  const width = Math.min(safe.stampKind === "image" ? 170 : 190, pageSize.width);
  const idealHeight = safe.stampKind === "image" ? width / safe.aspectRatio : 54;
  const height = Math.min(Math.max(28, idealHeight), pageSize.height);
  const fittedWidth = Math.min(width, height * (safe.stampKind === "image" ? safe.aspectRatio : width / height));
  const x = Math.max(0, Math.min(pageSize.width - fittedWidth, anchor.x - fittedWidth / 2));
  const y = Math.max(0, Math.min(pageSize.height - height, anchor.y - height / 2));
  return [{ x, y }, { x: x + fittedWidth, y: y + height }];
}
