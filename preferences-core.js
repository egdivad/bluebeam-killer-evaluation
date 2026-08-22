import { MARKUP_FORMAT_KEYS, MEASUREMENT_FORMAT_KEYS } from "./markup-core.js?v=23";
import { STICKY_NOTE_FORMAT_KEYS } from "./sticky-note-core.js?v=1";

export const PREFERENCES_KEY="bluebeam-killer-preferences";
export const PREFERENCES_VERSION=1;
export const MARKUP_DEFAULT_TYPES=["line","arrow","rectangle","ellipse","cloud","polygon","freehand","flag","callout","legend","stamp"];
export const MEASUREMENT_DEFAULT_TYPES=["length","polyline","area","perimeter","diameter","angle","count"];
export const TEXT_FORMAT_KEYS=["fontFamily","fontChoice","fontSize","fontWeight","fontStyle","textUnderline","textAlign","verticalAlign","color","backgroundColor","borderWidth","borderColor","autoFit","rotation"];
export const HIGHLIGHT_FORMAT_KEYS=["highlightColor"];

const themes=new Set(["light","dark","system"]),layouts=new Set(["single","continuous","side","continuous-side"]),lineTypes=new Set(["solid","dashed","dotted","centerline"]),arrowTypes=new Set(["none","open","closed","filled","circle","square","diamond"]),alignments=new Set(["left","center","right"]),verticalAlignments=new Set(["top","middle","bottom"]),hatches=new Set(["none","diagonal","crosshatch","horizontal","vertical"]),statuses=new Set(["None","Accepted","Rejected","Completed","Cancelled"]),colors=new Set(["strokeColor","fillColor","textColor","color","backgroundColor","borderColor","lineColor","labelColor","shadeColor","highlightColor"]),numbers=new Set(["strokeWidth","fillOpacity","fontSize","borderWidth","lineWidth","shadeOpacity","rotation"]),booleans=new Set(["textUnderline","showFlagText","autoFit","areaFillEnabled","showPerimeterLength","showAreaValue"]);

export function createPreferences(){return{version:PREFERENCES_VERSION,theme:"system",pageLayout:"single",snapToContent:false,cursorHints:true,textDefaults:{},highlightDefaults:{},markupDefaults:{},measurementDefaults:{},stickyNoteDefaults:{},interface:{sidebarSize:240,inspectorSize:null,markupsSize:null,inspectorCollapsed:false,markupsCollapsed:false}};}

function safeNumber(value,min,max){const number=Number(value);return Number.isFinite(number)?Math.max(min,Math.min(max,number)):null;}
function safeStyleValue(key,value){
  if(colors.has(key))return typeof value==="string"&&(/^(#[0-9a-f]{6}|transparent)$/i.test(value))?value:null;
  if(numbers.has(key)){const ranges={strokeWidth:[0,10],fillOpacity:[0,1],fontSize:[8,48],borderWidth:[0,10],lineWidth:[.5,8],shadeOpacity:[0,1],rotation:[0,359]},range=ranges[key];return safeNumber(value,range[0],range[1]);}
  if(booleans.has(key))return typeof value==="boolean"?value:null;
  if(key==="lineType")return lineTypes.has(value)?value:null;
  if(key==="startArrow"||key==="endArrow")return arrowTypes.has(value)?value:null;
  if(key==="textAlign")return alignments.has(value)?value:null;
  if(key==="verticalAlign")return verticalAlignments.has(value)?value:null;
  if(key==="hatchPattern")return hatches.has(value)?value:null;
  if(key==="fontWeight")return ["400","500","600","700"].includes(String(value))?String(value):null;
  if(key==="fontStyle")return ["normal","italic"].includes(value)?value:null;
  if(key==="fontFamily"||key==="fontChoice")return typeof value==="string"&&value.length<=200?value:null;
  if(key==="subject"||key==="author")return typeof value==="string"&&value.length<=200?value:null;
  if(key==="status")return statuses.has(value)?value:null;
  return null;
}
function sanitizeStyle(style,keys){const result={};if(!style||typeof style!=="object"||Array.isArray(style))return result;for(const key of keys){if(!Object.hasOwn(style,key))continue;const value=safeStyleValue(key,style[key]);if(value!==null)result[key]=value;}return result;}
function sanitizeDefaultMap(input,types,keys){const result={};if(!input||typeof input!=="object"||Array.isArray(input))return result;for(const type of types)if(Object.hasOwn(input,type)){const style=sanitizeStyle(input[type],keys);if(Object.keys(style).length)result[type]=style;}return result;}

export function sanitizePreferences(input={}){
  const result=createPreferences();if(!input||typeof input!=="object"||Array.isArray(input))return result;
  if(themes.has(input.theme))result.theme=input.theme;if(layouts.has(input.pageLayout))result.pageLayout=input.pageLayout;if(typeof input.snapToContent==="boolean")result.snapToContent=input.snapToContent;if(typeof input.cursorHints==="boolean")result.cursorHints=input.cursorHints;
  result.textDefaults=sanitizeDefaultMap(input.textDefaults,["insert"],TEXT_FORMAT_KEYS);result.highlightDefaults=sanitizeDefaultMap(input.highlightDefaults,["highlight"],HIGHLIGHT_FORMAT_KEYS);result.markupDefaults=sanitizeDefaultMap(input.markupDefaults,MARKUP_DEFAULT_TYPES,MARKUP_FORMAT_KEYS);result.measurementDefaults=sanitizeDefaultMap(input.measurementDefaults,MEASUREMENT_DEFAULT_TYPES,MEASUREMENT_FORMAT_KEYS);result.stickyNoteDefaults=sanitizeDefaultMap(input.stickyNoteDefaults,["sticky-note"],STICKY_NOTE_FORMAT_KEYS);
  const view=input.interface;if(view&&typeof view==="object"&&!Array.isArray(view)){for(const[key,min,max]of[["sidebarSize",160,420],["inspectorSize",210,460],["markupsSize",120,520]]){const value=safeNumber(view[key],min,max);if(value!==null)result.interface[key]=value;}for(const key of ["inspectorCollapsed","markupsCollapsed"])if(typeof view[key]==="boolean")result.interface[key]=view[key];}
  return result;
}

export function parsePreferences(raw){const parsed=typeof raw==="string"?JSON.parse(raw):raw;if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||!Number.isInteger(parsed.version)||parsed.version<1)throw new Error("The preference file is not valid.");if(parsed.version>PREFERENCES_VERSION)throw new Error("This preference file is from a newer app version.");return sanitizePreferences(parsed);}
export function preferenceType(item){if(item?.type==="text")return{group:"textDefaults",kind:"insert"};if(item?.type==="highlight")return{group:"highlightDefaults",kind:"highlight"};if(item?.type==="sticky-note")return{group:"stickyNoteDefaults",kind:"sticky-note"};if(item?.type==="markup"&&MARKUP_DEFAULT_TYPES.includes(item.markupKind))return{group:"markupDefaults",kind:item.markupKind};if(item?.type==="measurement"&&MEASUREMENT_DEFAULT_TYPES.includes(item.measureKind))return{group:"measurementDefaults",kind:item.measureKind};return null;}
export function captureItemDefault(item){const type=preferenceType(item);if(!type)return null;const keys=type.group==="textDefaults"?TEXT_FORMAT_KEYS:type.group==="highlightDefaults"?HIGHLIGHT_FORMAT_KEYS:type.group==="stickyNoteDefaults"?STICKY_NOTE_FORMAT_KEYS:type.group==="markupDefaults"?MARKUP_FORMAT_KEYS:MEASUREMENT_FORMAT_KEYS;return sanitizeStyle(item,keys);}
export function applyItemDefault(item,preferences){const type=preferenceType(item);if(!type)return item;return Object.assign(item,structuredClone(preferences?.[type.group]?.[type.kind]||{}));}
export function savedDefaultCount(preferences){return Object.keys(preferences?.textDefaults||{}).length+Object.keys(preferences?.highlightDefaults||{}).length+Object.keys(preferences?.markupDefaults||{}).length+Object.keys(preferences?.measurementDefaults||{}).length+Object.keys(preferences?.stickyNoteDefaults||{}).length;}
