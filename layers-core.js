export const NO_LAYER_ID = "";

export function createLayer(name, id = crypto.randomUUID()) {
  const cleanName = String(name || "").trim().slice(0, 80);
  if (!cleanName) throw new Error("A layer name is required.");
  return { id: String(id), name: cleanName, visible: true, locked: false, printable: true };
}

export function normalizeLayers(layers = []) {
  const result = [], ids = new Set(), names = new Set();
  for (const value of layers) {
    const id = String(value?.id || "").trim(), name = String(value?.name || "").trim().slice(0, 80);
    const nameKey = name.toLocaleLowerCase();
    if (!id || !name || ids.has(id) || names.has(nameKey)) continue;
    ids.add(id);names.add(nameKey);result.push({ id, name, visible: value.visible !== false, locked: value.locked === true, printable: value.printable !== false });
  }
  return result;
}

export function deriveLayersFromAnnotations(annotations = []) {
  return normalizeLayers(annotations.filter(item => item?.layerId && item?.layerName).map(item => ({ id: item.layerId, name: item.layerName, visible: item.layerVisible !== false, locked: item.layerLocked === true, printable: item.layerPrintable !== false })));
}

export function assignAnnotationLayer(annotation, layer = null) {
  if (!annotation) return annotation;
  annotation.layerId = layer?.id || null;
  annotation.layerName = layer?.name || "";
  annotation.layerVisible = layer ? layer.visible !== false : true;
  annotation.layerLocked = layer ? layer.locked === true : false;
  annotation.layerPrintable = layer ? layer.printable !== false : true;
  return annotation;
}

export function removeLayer(layers, annotations, layerId) {
  const index = layers.findIndex(layer => layer.id === layerId);
  if (index < 0) return false;
  layers.splice(index, 1);
  for (const annotation of annotations) if (annotation.layerId === layerId) assignAnnotationLayer(annotation);
  return true;
}

export function isLayerVisible(annotation, layers = []) {
  if (!annotation?.layerId) return true;
  const layer = layers.find(item => item.id === annotation.layerId);
  return !layer || layer.visible !== false;
}

export function isLayerLocked(annotation, layers = []) {
  if (!annotation?.layerId) return false;
  const layer = layers.find(item => item.id === annotation.layerId);
  return layer ? layer.locked === true : annotation.layerLocked === true;
}

export function isLayerPrintable(annotation, layers = []) {
  if (!annotation?.layerId) return true;
  const layer = layers.find(item => item.id === annotation.layerId);
  return layer ? layer.printable !== false : annotation.layerPrintable !== false;
}

export function layerItemCount(annotations = [], layerId = null) {
  return annotations.filter(item => (item.layerId || null) === (layerId || null) && !item.deleted).length;
}
