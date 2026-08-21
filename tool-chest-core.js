const TOOL_CHEST_VERSION = 1;
const SUPPORTED_TYPES = new Set(["text", "highlight", "markup", "measurement"]);
const OMIT_FIELDS = new Set(["id", "page", "pageId", "layerId", "layerName", "deleted", "visible", "status", "comment", "x", "y", "sourceX", "sourceY", "sourceW", "sourceH", "rects", "countValue", "measurementScale"]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanName(value, fallback = "Saved tool") { return String(value || fallback).trim().slice(0, 100) || fallback; }

export function toolKind(item) {
  if (!item || !SUPPORTED_TYPES.has(item.type)) return null;
  if (item.type === "markup") return `markup:${item.markupKind}`;
  if (item.type === "measurement") return `measurement:${item.measureKind}`;
  if (item.type === "highlight") return "highlight";
  return "text";
}

export function captureTool(item, name, id = crypto.randomUUID()) {
  const kind = toolKind(item);if (!kind) return null;
  const properties = {};
  for (const [key, value] of Object.entries(item)) if (!OMIT_FIELDS.has(key) && key !== "points") properties[key] = clone(value);
  if (item.type === "markup") {
    const bounds = item.points?.length ? { x: Math.min(...item.points.map(p => p.x)), y: Math.min(...item.points.map(p => p.y)) } : { x: 0, y: 0 };
    properties.points = (item.points || []).map(point => ({ x: point.x - bounds.x, y: point.y - bounds.y }));
    if (item.markupKind === "callout") { properties.w = item.w;properties.h = item.h; }
  }
  return { id: String(id), name: cleanName(name, item.subject || kind), kind, properties, source: "bluebeam-killer" };
}

export function sanitizeTool(tool) {
  if (!tool || typeof tool !== "object" || typeof tool.properties !== "object") return null;
  const kind = String(tool.kind || "");
  if (!/^(text|highlight|markup:(line|arrow|rectangle|ellipse|cloud|polygon|freehand|flag|callout)|measurement:(length|polyline|area|perimeter|diameter|angle|count))$/.test(kind)) return null;
  return { id: String(tool.id || crypto.randomUUID()), name: cleanName(tool.name, kind), kind, properties: clone(tool.properties), source: tool.source === "bluebeam" ? "bluebeam" : "bluebeam-killer" };
}

export function exportToolChest(tools = []) { return JSON.stringify({ app: "Bluebeam Killer", version: TOOL_CHEST_VERSION, tools: tools.map(sanitizeTool).filter(Boolean) }, null, 2); }

export function importToolChestJson(text) {
  const value = JSON.parse(text);
  if (value?.version !== TOOL_CHEST_VERSION || !Array.isArray(value.tools)) throw new Error("This Tool Chest file is not supported.");
  const tools = value.tools.map(sanitizeTool).filter(Boolean);
  return { tools, skipped: value.tools.length - tools.length };
}

function xmlValue(block, names) {
  for (const name of names) {
    const attribute = block.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));if (attribute) return attribute[1];
    const element = block.match(new RegExp(`<${name}[^>]*>([^<]+)</${name}>`, "i"));if (element) return element[1].trim();
  }
  return "";
}
function btxKind(block) {
  const value = `${xmlValue(block,["Type","Subtype","ToolType","Subject"])} ${block.slice(0,220)}`.toLowerCase();
  for (const [match,kind] of [["callout","markup:callout"],["cloud","markup:cloud"],["polyline","measurement:polyline"],["perimeter","measurement:perimeter"],["diameter","measurement:diameter"],["measurearea","measurement:area"],["area measurement","measurement:area"],["highlight","highlight"],["free text","text"],["textbox","text"],["arrow","markup:arrow"],["ellipse","markup:ellipse"],["circle","markup:ellipse"],["rectangle","markup:rectangle"],["square","markup:rectangle"],["polygon","markup:polygon"],["line","markup:line"]]) if (value.includes(match)) return kind;
  return null;
}
function colorValue(value, fallback) {
  const match = String(value || "").match(/#?[0-9a-f]{6}/i);return match ? `#${match[0].replace("#", "").toLowerCase()}` : fallback;
}

export function importBluebeamBtxText(text) {
  const source = String(text || "");
  if (!source.trim().startsWith("<")) throw new Error("This BTX file is binary or uses an unsupported Bluebeam format.");
  const blocks = source.match(/<(?:Tool|Markup|Item)\b[\s\S]*?<\/(?:Tool|Markup|Item)>/gi) || [];
  const tools = [], skipped = [];
  for (const block of blocks) {
    const kind = btxKind(block);if (!kind) { skipped.push(xmlValue(block,["Name","Subject"]) || "Unknown tool");continue; }
    const type = kind.split(":")[0], subtype = kind.split(":")[1], name = xmlValue(block,["Name","Subject","Label"]) || subtype || type;
    const properties = { type };
    if (type === "markup") { properties.markupKind = subtype;properties.strokeColor = colorValue(xmlValue(block,["Color","StrokeColor","LineColor"]),"#d04a3a");properties.fillColor = colorValue(xmlValue(block,["FillColor","InteriorColor"]),"#fff2a8");properties.strokeWidth = Number(xmlValue(block,["Width","LineWidth"])) || 2;properties.fillOpacity = .15; }
    if (type === "measurement") { properties.measureKind = subtype;properties.lineColor = colorValue(xmlValue(block,["Color","StrokeColor","LineColor"]),"#d04a3a");properties.lineWidth = Number(xmlValue(block,["Width","LineWidth"])) || 1.6; }
    if (type === "highlight") properties.highlightColor = colorValue(xmlValue(block,["Color","FillColor"]),"#ffd84d");
    if (type === "text") { properties.color = colorValue(xmlValue(block,["TextColor","Color"]),"#15191f");properties.backgroundColor = colorValue(xmlValue(block,["FillColor","InteriorColor"]),"#ffffff");properties.fontSize = Number(xmlValue(block,["FontSize","TextSize"])) || 16; }
    tools.push(sanitizeTool({ id: crypto.randomUUID(), name, kind, properties, source: "bluebeam" }));
  }
  if (!blocks.length) throw new Error("No readable tool records were found in this BTX file.");
  return { tools: tools.filter(Boolean), skipped: skipped.length, skippedNames: skipped };
}

export function applyToolProperties(item, tool) {
  const safe = sanitizeTool(tool);if (!item || !safe || toolKind(item) !== safe.kind) return false;
  const preserve = { id: item.id, page: item.page, pageId: item.pageId, x: item.x, y: item.y, points: item.points, layerId: item.layerId, layerName: item.layerName };
  if (item.type !== "text") { preserve.w = item.w;preserve.h = item.h; }
  Object.assign(item, clone(safe.properties), preserve);
  return true;
}
