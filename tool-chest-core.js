import { sanitizeStampPreset } from "./stamp-core.js?v=2";

const TOOL_CHEST_VERSION = 1;
const SUPPORTED_TYPES = new Set(["text", "highlight", "markup", "measurement"]);
const OMIT_FIELDS = new Set(["id", "page", "pageId", "layerId", "layerName", "layerVisible", "layerLocked", "layerPrintable", "deleted", "visible", "status", "comment", "x", "y", "sourceX", "sourceY", "sourceW", "sourceH", "rects", "countValue", "measurementScale"]);

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
  if (!/^(text|highlight|markup:(line|arrow|rectangle|ellipse|cloud|polygon|freehand|flag|callout|legend|stamp)|measurement:(length|polyline|area|perimeter|diameter|angle|count))$/.test(kind)) return null;
  let properties=clone(tool.properties);if(kind==="markup:stamp"){const stamp=sanitizeStampPreset({id:tool.id,name:tool.name,...properties});if(!stamp)return null;const{id,name,builtIn,...safe}=stamp;properties={type:"markup",markupKind:"stamp",...safe,subject:cleanName(properties.subject,"Stamp"),comment:typeof properties.comment==="string"?properties.comment.slice(0,5000):"",status:typeof properties.status==="string"?properties.status.slice(0,80):"None"};}
  return { id: String(tool.id || crypto.randomUUID()), name: cleanName(tool.name, kind), kind, properties, source: tool.source === "bluebeam" ? "bluebeam" : "bluebeam-killer" };
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
function hexBytes(value) {
  const hex=String(value||"").trim();if(!hex||hex.length%2||!/^[0-9a-f]+$/i.test(hex))throw new Error("Invalid compressed BTX data.");
  const bytes=new Uint8Array(hex.length/2);for(let index=0;index<bytes.length;index++)bytes[index]=Number.parseInt(hex.slice(index*2,index*2+2),16);return bytes;
}
async function inflateHex(value) {
  if(typeof DecompressionStream!=="function")throw new Error("This browser cannot decompress Bluebeam BTX tools.");
  const stream=new Blob([hexBytes(value)]).stream().pipeThrough(new DecompressionStream("deflate"));return new Response(stream).text();
}
function pdfArray(raw,key){const match=raw.match(new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`,"i"));return match?match[1].trim().split(/\s+/).map(Number).filter(Number.isFinite):[];}
function pdfNumber(raw,key,fallback=0){const match=raw.match(new RegExp(`/${key}\\s+(-?\\d+(?:\\.\\d+)?)`,"i"));return match?Number(match[1]):fallback;}
function pdfName(raw,key){return raw.match(new RegExp(`/${key}\\s*/([^/<>\\[\\]()\\s]+)`,"i"))?.[1]||"";}
function pdfString(raw,key){const value=raw.match(new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\)])*)\\)`,"i"))?.[1]||"";return value.replace(/\\([\\()])/g,"$1");}
function componentHex(value){return Math.round(Math.max(0,Math.min(1,value))*255).toString(16).padStart(2,"0");}
function pdfColor(raw,key,fallback){const values=pdfArray(raw,key);if(values.length===1)return`#${componentHex(values[0]).repeat(3)}`;if(values.length>=3)return`#${componentHex(values[0])}${componentHex(values[1])}${componentHex(values[2])}`;return fallback;}
function styleColor(raw,fallback){return raw.match(/color\s*:\s*(#[0-9a-f]{6})/i)?.[1].toLowerCase()||fallback;}
function btxLineType(raw){const value=raw.match(/\/BS\s*<<[\s\S]*?\/S\s*\/([A-Za-z]+)/i)?.[1]?.toLowerCase();return value==="d"?"dashed":value==="b"?"dotted":"solid";}
function btxArrow(value){const name=String(value||"").replace(/^\//,"").toLowerCase();if(name.includes("closed")||name.includes("filled"))return"filled";if(name.includes("open"))return"open";if(name.includes("circle"))return"circle";if(name.includes("square"))return"square";if(name.includes("diamond"))return"diamond";return"none";}
function btxArrowEnds(raw){const values=raw.match(/\/LE\s*\[([^\]]+)\]/i)?.[1]?.match(/\/[A-Za-z]+/g)||[];if(values.length)return[btxArrow(values[0]),btxArrow(values[1])];const single=pdfName(raw,"LE");return[single?btxArrow(single):"none","none"];}
function btxKind(typeName,raw){const type=String(typeName||"").toLowerCase();if(type.includes("annotationpolygon"))return raw.includes("/PolygonCloud")?"markup:cloud":"markup:polygon";if(type.includes("annotationfreetext"))return raw.includes("/FreeTextCallout")?"markup:callout":"text";if(type.includes("annotationink"))return"markup:freehand";if(type.includes("annotationcircle"))return raw.includes("/CircleDimension")?"measurement:diameter":"markup:ellipse";if(type.includes("annotationsquare"))return"markup:rectangle";if(type.includes("annotationhighlight"))return"highlight";if(type.includes("annotationline")){if(raw.includes("/LineDimension"))return"measurement:length";const ends=btxArrowEnds(raw);return raw.includes("/LineArrow")||ends.some(value=>value!=="none")?"markup:arrow":"markup:line";}return null;}
function btxProperties(kind,raw){const[type,subtype]=kind.split(":"),stroke=pdfColor(raw,"C",styleColor(raw,"#d04a3a")),fill=pdfColor(raw,"IC",stroke),width=pdfNumber(raw,"W",type==="measurement"?1.6:2),opacity=Math.max(0,Math.min(1,pdfNumber(raw,"FillOpacity",0))),subject=pdfString(raw,"Subj");
  if(type==="markup"){const properties={type,markupKind:subtype,subject:subject||undefined,strokeColor:stroke,strokeWidth:width,lineType:btxLineType(raw),fillColor:fill,fillOpacity:opacity};if(subtype==="arrow"){const[startArrow,endArrow]=btxArrowEnds(raw);properties.startArrow=startArrow;properties.endArrow=endArrow;}if(subtype==="callout"){properties.text=pdfString(raw,"Contents")||"Callout";properties.color=styleColor(raw,stroke);properties.backgroundColor="#ffffff";properties.borderColor=stroke;properties.borderWidth=width;properties.fontFamily="Arial, Helvetica, sans-serif";properties.fontSize=pdfNumber(raw,"Tf",Number(raw.match(/font-size\s*:\s*(\d+(?:\.\d+)?)pt/i)?.[1])||12);properties.startArrow=btxArrow(pdfName(raw,"LE"))||"open";}return properties;}
  if(type==="measurement")return{type,measureKind:subtype,lineColor:stroke,color:stroke,labelColor:styleColor(raw,stroke),lineWidth:width,lineType:btxLineType(raw)};
  if(type==="highlight")return{type,highlightColor:stroke};
  return{type,text:pdfString(raw,"Contents")||"Text",color:styleColor(raw,stroke),backgroundColor:"transparent",borderColor:stroke,borderWidth:width,fontChoice:"Arial, Helvetica, sans-serif",fontFamily:"Arial, Helvetica, sans-serif",fontSize:Number(raw.match(/font-size\s*:\s*(\d+(?:\.\d+)?)pt/i)?.[1])||12,textAlign:raw.match(/text-align\s*:\s*(left|center|right)/i)?.[1]?.toLowerCase()||"left",verticalAlign:"top"};
}
function btxToolLabel(kind){const value=kind.split(":").at(-1);return value[0].toUpperCase()+value.slice(1).replace("freehand","Freehand");}

export async function importBluebeamBtxText(text) {
  const source=String(text||"").replace(/^\uFEFF/,"");if(!source.trim().startsWith("<"))throw new Error("This BTX file is binary or uses an unsupported Bluebeam format.");
  const blocks=source.match(/<ToolChestItem\b[\s\S]*?<\/ToolChestItem>/gi)||source.match(/<(?:Tool|Markup|Item)\b[\s\S]*?<\/(?:Tool|Markup|Item)>/gi)||[];if(!blocks.length)throw new Error("No readable tool records were found in this BTX file.");
  let title="Bluebeam",titleHex=xmlValue(source,["Title"]);try{if(titleHex)title=(await inflateHex(titleHex)).trim()||title;}catch{}
  const tools=[],skipped=[],nameCounts=new Map();for(const block of blocks){try{const rawHex=xmlValue(block,["Raw"]),raw=rawHex?await inflateHex(rawHex):block,typeName=xmlValue(block,["Type"]),kind=btxKind(typeName,raw);if(!kind)throw new Error("Unsupported annotation type");const properties=btxProperties(kind,raw),subject=properties.subject||pdfString(raw,"Subj")||title,label=btxToolLabel(kind),baseName=`${subject} ${label}`.trim(),count=(nameCounts.get(baseName)||0)+1;nameCounts.set(baseName,count);const name=count>1?`${baseName} ${count}`:baseName;tools.push(sanitizeTool({id:crypto.randomUUID(),name,kind,properties,source:"bluebeam"}));}catch{skipped.push(xmlValue(block,["Name"])||"Unknown tool");}}
  return{title,tools:tools.filter(Boolean),skipped:skipped.length,skippedNames:skipped};
}

export function applyToolProperties(item, tool) {
  const safe = sanitizeTool(tool);if (!item || !safe || toolKind(item) !== safe.kind) return false;
  const preserve = { id: item.id, page: item.page, pageId: item.pageId, x: item.x, y: item.y, points: item.points, layerId: item.layerId, layerName: item.layerName };
  if (item.type !== "text") { preserve.w = item.w;preserve.h = item.h; }
  Object.assign(item, clone(safe.properties), preserve);
  return true;
}
