export const MEASUREMENT_UNITS = Object.freeze([
  { value: "mm", label: "Millimetres (mm)", millimetres: 1 },
  { value: "cm", label: "Centimetres (cm)", millimetres: 10 },
  { value: "m", label: "Metres (m)", millimetres: 1000 },
  { value: "in", label: "Inches (in)", millimetres: 25.4 },
  { value: "ft", label: "Feet (ft)", millimetres: 304.8 },
]);

export const STANDARD_SCALE_RATIOS = Object.freeze([1, 2, 5, 10, 20, 25, 50, 100, 200, 500]);
export const DEFAULT_MEASUREMENT_UNIT = "mm";
export const DEFAULT_MEASUREMENT_PRECISION = 2;
export const MAX_CUSTOM_SCALE_PRESETS = 50;

const MILLIMETRES_PER_POINT = 25.4 / 72;
const units = new Map(MEASUREMENT_UNITS.map(unit => [unit.value, unit]));

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeMeasurementPrecision(value, fallback = DEFAULT_MEASUREMENT_PRECISION) {
  const number = finiteNumber(value);
  return number === null ? fallback : Math.max(0, Math.min(6, Math.round(number)));
}

export function normalizeMeasurementUnit(value, fallback = DEFAULT_MEASUREMENT_UNIT) {
  return units.has(value) ? value : fallback;
}

export function scaleFromRatio(ratio, unit = DEFAULT_MEASUREMENT_UNIT, precision = DEFAULT_MEASUREMENT_PRECISION, name = "") {
  const safeRatio = finiteNumber(ratio), safeUnit = normalizeMeasurementUnit(unit);
  if (!(safeRatio > 0) || safeRatio > 1_000_000) return null;
  const unitDefinition = units.get(safeUnit);
  return {
    unitsPerPoint: safeRatio * MILLIMETRES_PER_POINT / unitDefinition.millimetres,
    unit: safeUnit,
    precision: normalizeMeasurementPrecision(precision),
    ratio: safeRatio,
    ...(String(name || "").trim() ? { presetName: String(name).trim().slice(0, 80) } : {}),
  };
}

export function normalizeMeasurementScale(input, fallback = null) {
  const unitsPerPoint = finiteNumber(input?.unitsPerPoint);
  if (!(unitsPerPoint > 0)) return fallback;
  const unit = typeof input?.unit === "string" && /^[A-Za-z]{1,8}$/.test(input.unit) ? input.unit : fallback?.unit || "pt";
  const ratio = finiteNumber(input?.ratio);
  const presetName = typeof input?.presetName === "string" ? input.presetName.trim().slice(0, 80) : "";
  return {
    unitsPerPoint,
    unit,
    precision: normalizeMeasurementPrecision(input?.precision, fallback?.precision ?? DEFAULT_MEASUREMENT_PRECISION),
    ...(ratio > 0 ? { ratio } : {}),
    ...(presetName ? { presetName } : {}),
  };
}

export function measurementScaleLabel(scale) {
  const safe = normalizeMeasurementScale(scale);
  if (!safe) return "Scale not set";
  const precision = `${safe.precision} dp`;
  if (safe.ratio > 0) return `1:${Number(safe.ratio.toPrecision(8))} · ${safe.unit} · ${precision}`;
  const factor = Number(safe.unitsPerPoint.toPrecision(8));
  return `1 pt = ${factor} ${safe.unit} · ${precision}`;
}

export function scaleTargetPageIds(pages = [], selectedPageIds = [], currentPageId = null, scope = "current") {
  const validIds = new Set(pages.map(page => page?.id).filter(Boolean));
  if (scope === "all") return [...validIds];
  if (scope === "selected") {
    const selected = [...new Set(selectedPageIds)].filter(id => validIds.has(id));
    if (selected.length) return selected;
  }
  return currentPageId && validIds.has(currentPageId) ? [currentPageId] : [];
}

export function makeScalePreset({ id, name, ratio, unit, precision } = {}) {
  const scale = scaleFromRatio(ratio, unit, precision, name), safeName = String(name || "").trim().slice(0, 80);
  if (!scale || !safeName) return null;
  const generatedId = `scale-${safeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${scale.ratio}-${scale.unit}`;
  return {
    id: typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : generatedId.slice(0, 100),
    name: safeName,
    ratio: scale.ratio,
    unit: scale.unit,
    precision: scale.precision,
  };
}

export function sanitizeScalePresets(input) {
  if (!Array.isArray(input)) return [];
  const result = [], ids = new Set();
  for (const value of input) {
    const preset = makeScalePreset(value);
    if (!preset || ids.has(preset.id)) continue;
    ids.add(preset.id);
    result.push(preset);
    if (result.length >= MAX_CUSTOM_SCALE_PRESETS) break;
  }
  return result;
}

export function sanitizeMeasurementScalePreferences(input = {}) {
  return {
    unit: normalizeMeasurementUnit(input?.unit),
    precision: normalizeMeasurementPrecision(input?.precision),
    customPresets: sanitizeScalePresets(input?.customPresets),
  };
}
