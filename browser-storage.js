import { PREFERENCES_KEY, createPreferences, parsePreferences, sanitizePreferences } from "./preferences-core.js";
import { sanitizeTool } from "./tool-chest-core.js";
import { sanitizeStampPreset } from "./stamp-core.js";

export const TOOL_CHEST_KEY = "bluebeam-killer-tool-chest";
export const STAMP_PRESETS_KEY = "bluebeam-killer-stamp-presets";

export function loadUserPreferences(storage = localStorage) {
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    if (raw) return parsePreferences(raw);
  } catch (error) {
    console.warn("Saved preferences could not be read.", error);
  }

  const migrated = createPreferences();
  try {
    const theme = storage.getItem("bluebeam-killer-theme");
    if (["light", "dark"].includes(theme)) migrated.theme = theme;
    for (const kind of ["sidebar", "inspector", "markups"]) {
      const size = Number(storage.getItem(`bluebeam-killer-${kind}-size`));
      if (size) migrated.interface[`${kind}Size`] = size;
    }
    for (const kind of ["inspector", "markups"]) {
      migrated.interface[`${kind}Collapsed`] = storage.getItem(`bluebeam-killer-${kind}-collapsed`) === "true";
    }
  } catch {}
  return sanitizePreferences(migrated);
}

export function saveUserPreferences(preferences, storage = localStorage) {
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch (error) {
    console.warn("Preferences could not be saved.", error);
    return false;
  }
}

export function loadToolChest(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(TOOL_CHEST_KEY) || "[]");
    return Array.isArray(value) ? value.map(sanitizeTool).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveToolChest(tools, storage = localStorage) {
  try {
    storage.setItem(TOOL_CHEST_KEY, JSON.stringify(tools));
    return true;
  } catch (error) {
    console.warn("The Tool Chest could not be saved.", error);
    return false;
  }
}

export function loadStampPresets(storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(STAMP_PRESETS_KEY) || "[]");
    return Array.isArray(value) ? value.map(item => sanitizeStampPreset(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveStampPresets(presets, storage = localStorage) {
  try {
    const safe = Array.isArray(presets) ? presets.map(item => sanitizeStampPreset(item)).filter(Boolean) : [];
    storage.setItem(STAMP_PRESETS_KEY, JSON.stringify(safe));
    return true;
  } catch (error) {
    console.warn("Stamp presets could not be saved.", error);
    return false;
  }
}
