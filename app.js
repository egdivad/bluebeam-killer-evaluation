import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
import { addBlankPage, alignElementToPage, annotationsForPageId, buildEditableTextBlocks, calculateAnchoredScroll, calculateFitScale, calculatePanScroll, calibrateDrawingScale, constrainMoveDelta, constrainPointToAxis, createHighlightGeometry, extractVectorSegments, formatMeasurement, getExportPlan, makeSourcePages, measurementBounds, measurementFillBoundary, measurementHatchSegments, measurementLineDash, measurementPerimeterValue, measurementValue, pageNumberLabel, pointDistance, removeControlPoint, removePage, reorderPage, shortcutCommand, shouldInsertText, snapPointToSegments, syncAnnotationPages } from "./editor-core.js?v=58";
import { MARKUP_LABELS, arrowheadGeometry, cloudPath, copyPageItem, groupMarkupRows, makeMarkup, markupBounds, markupListRows, rowsToCsv, sortMarkupRows } from "./markup-core.js?v=6";
import { addPdfLibAnnotation } from "./pdf-annotations.js?v=3";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const state = { pdf: null, bytes: null, pages: [], page: 1, scale: 1, layoutMode: "single", tool: "select", highlightColor: "#ffd84d", snapToContent: false, annotations: [], textBlocks: [], measurementScales: {}, selectedId: null, selectedIds: [], history: [], future: [], renderToken: 0, thumbnailRenderToken: 0, layoutRenderToken: 0 };
const els = { canvas: $("pdfCanvas"), shell: $("pageShell"), stage: $("pageStage"), empty: $("emptyState"), text: $("textLayer"), ann: $("annotationLayer"), draw: $("drawLayer") };
let toastTimer;
let thumbnailRefreshTimer;
let layoutObserver=null;
let measurementDraft=null;
let markupDraft=null;
let suppressMarkupClick=false;
let markupPointDrag=null;
let markupMove=null;
let itemClipboard=null;
let itemPasteSequence=0;
let pendingCalibration=null;
let measurementPointDrag=null;
let measurementMove=null;
let suppressMeasurementClick=false;
let selectedControlPoint=null;
let displayedScale=1;
let zoomAnchorToken=0;
const panState={spaceHeld:false,dragging:false,pointerId:null,startPointer:null,startScroll:null};
const pendingThumbnailPageIds=new Set();
const vectorSegmentCache=new Map();
const vectorSegmentLoads=new Map();

function spacePanBlocked(target){return target instanceof Element&&Boolean(target.closest("input,textarea,select,[contenteditable='true'],dialog[open]"));}
function setSpacePan(active){panState.spaceHeld=active&&Boolean(state.pdf);$("canvasArea").classList.toggle("pan-ready",panState.spaceHeld);if(!panState.spaceHeld)stopPanDrag();}
function stopPanDrag(){if(panState.pointerId!==null&&$("canvasArea").hasPointerCapture?.(panState.pointerId))$("canvasArea").releasePointerCapture(panState.pointerId);panState.dragging=false;panState.pointerId=null;panState.startPointer=null;panState.startScroll=null;$("canvasArea").classList.remove("pan-dragging");}
$("canvasArea").addEventListener("pointerdown",event=>{if(!panState.spaceHeld||event.button!==0)return;event.preventDefault();event.stopPropagation();panState.dragging=true;panState.pointerId=event.pointerId;panState.startPointer={x:event.clientX,y:event.clientY};panState.startScroll={left:$("canvasArea").scrollLeft,top:$("canvasArea").scrollTop};$("canvasArea").classList.add("pan-dragging");$("canvasArea").setPointerCapture(event.pointerId);},true);
$("canvasArea").addEventListener("pointermove",event=>{if(!panState.dragging||event.pointerId!==panState.pointerId)return;event.preventDefault();const next=calculatePanScroll(panState.startScroll,panState.startPointer,{x:event.clientX,y:event.clientY});$("canvasArea").scrollLeft=next.left;$("canvasArea").scrollTop=next.top;});
$("canvasArea").addEventListener("pointerup",event=>{if(event.pointerId===panState.pointerId)stopPanDrag();});
$("canvasArea").addEventListener("pointercancel",event=>{if(event.pointerId===panState.pointerId)stopPanDrag();});
window.addEventListener("blur",()=>setSpacePan(false));

function applyTheme(theme,persist=false){const selected=theme==="dark"?"dark":"light";document.documentElement.dataset.theme=selected;const button=$("themeToggle"),dark=selected==="dark";button.setAttribute("aria-pressed",String(dark));button.setAttribute("aria-label",dark?"Use light mode":"Use dark mode");button.title=dark?"Use light mode":"Use dark mode";if(persist)try{localStorage.setItem("bluebeam-killer-theme",selected);}catch{}}
applyTheme(document.documentElement.dataset.theme);
$("themeToggle").onclick=()=>applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark",true);

function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2200); }
function markChanged() { $("saveState").textContent="Changes saved locally"; if(!$("markupsPanel")?.hidden)renderMarkupsList(); }
function showControlPointHint(annotation,selected=false){const supported=annotation?.type==="markup"&&annotation.markupKind==="polygon"||annotation?.type==="measurement"&&["area","perimeter"].includes(annotation.measureKind);$("saveState").textContent=supported?(selected?"Control point selected • Drag to move or press Delete to remove":"Select a control point to move or remove it"):"Changes saved locally";}
function queueThumbnailRefresh(pageId=currentPageDescriptor()?.id){if(!pageId)return;pendingThumbnailPageIds.add(pageId);clearTimeout(thumbnailRefreshTimer);thumbnailRefreshTimer=setTimeout(()=>{const pageIds=[...pendingThumbnailPageIds];pendingThumbnailPageIds.clear();for(const id of pageIds){refreshThumbnail(id);refreshLayoutPreview(id);}},180);}
function updateHistoryButtons(){$("undoButton").disabled=!state.history.length;$("redoButton").disabled=!state.future.length;}
function snapshot() { state.history.push(JSON.stringify(state.annotations)); if(state.history.length>30)state.history.shift();state.future=[];updateHistoryButtons(); }
function currentPageDescriptor(){return state.pages[state.page-1];}
function pageAnnotations() { const descriptor=currentPageDescriptor();return state.annotations.filter(a=>a.pageId? a.pageId===descriptor?.id:a.page===state.page); }
function isAnnotationVisible(annotation){return annotation.visible!==false;}
function isSelected(id){return state.selectedId===id||state.selectedIds.includes(id);}
function setSingleSelection(id){state.selectedId=id;state.selectedIds=id?[id]:[];}
function syncPageNumbers(){syncAnnotationPages(state.pages,state.annotations);}
function updatePageUi(){const count=state.pages.length;$("pageCount").textContent=`${count} ${count===1?"page":"pages"}`;$("totalPages").textContent=count;}
function setTool(tool) { cancelMeasurementDraft();cancelMarkupDraft();state.tool=tool; document.querySelectorAll(".tool").forEach(b=>{ const active=b.dataset.tool===tool||(b.dataset.tool==="measure"&&tool.startsWith("measure-"))||(b.dataset.tool==="markup"&&tool.startsWith("markup-")); b.classList.toggle("active",active); b.setAttribute("aria-pressed",String(active)); }); $("highlightPalette").hidden=tool!=="highlight"; els.shell.className=`page-shell tool-${tool}`; clearSelection(); if(state.pdf){const instructions={"measure-calibrate":"Click two points with a known distance.","measure-length":"Click the start and end points.","measure-polyline":"Click each point. Double-click or press Enter to finish.","measure-area":"Click each corner. Double-click or press Enter to finish.","measure-perimeter":"Click each corner. Double-click or press Enter to finish.","measure-diameter":"Click opposite sides of the circle.","measure-angle":"Click the first arm, vertex, and second arm.","measure-count":"Click each item to count it.","markup-polygon":"Click each corner. Double-click or press Enter to finish."};$("saveState").textContent=tool==="highlight"?"Choose a color and drag across text • Esc to stop":(instructions[tool]||(tool.startsWith("markup-")?"Drag on the page to place the markup.":"Changes saved locally"));} }
function updateItemClipboardButtons(){const selected=state.annotations.find(item=>item.id===state.selectedId),copyable=selected?.type==="markup"||selected?.type==="measurement"&&selected.measureKind!=="calibration";$("copyItemButton").disabled=!copyable;$("pasteItemButton").disabled=!itemClipboard||!state.pdf;}
function clearSelection() { const editor=els.ann.querySelector("textarea.annotation-editor"),hadSelection=Boolean(state.selectedId||state.selectedIds.length); if(editor){const a=state.annotations.find(x=>x.id===editor.dataset.id);if(a)a.text=editor.value;} state.selectedId=null;state.selectedIds=[];selectedControlPoint=null;if(state.tool==="select"&&state.pdf)$("saveState").textContent="Changes saved locally"; if(editor||hadSelection)renderAnnotations();else document.querySelectorAll(".annotation,.markup-item,.measurement-item").forEach(e=>e.classList.remove("selected")); const empty=$("inspectorEmpty");empty.querySelector("strong").textContent="No item selected";empty.querySelector("p").textContent="Select an annotation to change its style.";$("inspector").classList.remove("open"); empty.hidden=false; $("inspectorContent").hidden=true; $("deleteButton").disabled=true;updateItemClipboardButtons();renderMarkupsList(); }
function selectAllPageDrawingItems(){const ids=pageAnnotations().filter(item=>item.type==="markup"||item.type==="measurement"&&item.measureKind!=="calibration").map(item=>item.id);state.selectedId=null;state.selectedIds=ids;renderAnnotations();const empty=$("inspectorEmpty");$("inspector").classList.toggle("open",Boolean(ids.length));empty.hidden=false;$("inspectorContent").hidden=true;empty.querySelector("strong").textContent=ids.length?`${ids.length} items selected`:"No items on this page";empty.querySelector("p").textContent=ids.length?"Use Delete to remove the selected markups and measurements.":"This page has no markups or measurements.";$("deleteButton").disabled=!ids.length;$("deleteButton").title="Delete selected items";updateItemClipboardButtons();renderMarkupsList();toast(ids.length?`${ids.length} items selected on this page.`:"There are no markups or measurements on this page.");}
function selectAnnotation(id) {
  setSingleSelection(id); renderAnnotations();
  const a=state.annotations.find(x=>x.id===id); if(!a)return;
  updateItemClipboardButtons();
  const isHighlight=a.type==="highlight";
  $("inspector").classList.add("open"); $("inspectorEmpty").hidden=true; $("inspectorContent").hidden=false; $("deleteButton").disabled=false;
  $("textProperties").hidden=false;$("measurementProperties").hidden=true;$("markupProperties").hidden=true;
  $("textValue").value=a.text||""; $("textValue").disabled=isHighlight;
  $("fontFamily").disabled=isHighlight; $("fontFamily").value=a.fontChoice&&a.fontChoice!=="original"?a.fontFamily:"original";
  $("fontSize").disabled=isHighlight; $("fontSize").value=a.fontSize||16; $("fontSizeValue").value=`${Math.round((a.fontSize||16)*10)/10} pt`;
  $("borderWidth").disabled=isHighlight;$("borderWidth").value=a.borderWidth||0;$("borderWidthValue").value=`${a.borderWidth||0} pt`;
  $("autoFitTextBox").disabled=isHighlight;$("autoFitTextBox").checked=Boolean(a.autoFit);
  $("borderSwatches").querySelectorAll("button").forEach(b=>{b.disabled=isHighlight;b.classList.toggle("selected",b.dataset.borderColor===(a.borderColor||"#15191f"));});
  $("swatches").querySelectorAll("button").forEach(b=>b.classList.toggle("selected",b.dataset.color===(a.color||"#15191f")));
  $("backgroundSwatches").querySelectorAll("button").forEach(b=>{b.disabled=isHighlight;b.classList.toggle("selected",b.dataset.bg===(a.backgroundColor||"transparent"));});
  $("highlightColorField").hidden=!isHighlight;document.querySelectorAll("[data-highlight-color]").forEach(b=>b.classList.toggle("selected",b.dataset.highlightColor===(a.highlightColor||"#ffd84d")));
  $("selectedVisibility").checked=isAnnotationVisible(a);$("highlightColorCustom").value=a.highlightColor||"#ffd84d";$("textColorCustom").value=a.color||"#15191f";if(a.backgroundColor&&a.backgroundColor!=="transparent")$("backgroundColorCustom").value=a.backgroundColor;$("borderColorCustom").value=a.borderColor||"#15191f";
  $("horizontalAlign").querySelectorAll("button").forEach(b=>{b.disabled=isHighlight;b.classList.toggle("selected",b.dataset.align===(a.textAlign||"left"));});
  $("verticalAlign").querySelectorAll("button").forEach(b=>{b.disabled=isHighlight;b.classList.toggle("selected",b.dataset.align===(a.verticalAlign||"top"));});
  syncGeometryControls(a,isHighlight);
  $("deleteButton").title=a.type==="replacement"?"Delete existing text":"Delete inserted text box";
  $("deleteButton").setAttribute("aria-label",$("deleteButton").title);
}

async function openPdf(file) {
  try { const bytes=new Uint8Array(await file.arrayBuffer()); await loadPdf(bytes,file.name); } catch(err) { console.error(err); toast("This PDF could not be opened."); }
}
async function loadPdf(bytes,name) {
  state.bytes=bytes; state.pdf=await pdfjsLib.getDocument({data:bytes.slice()}).promise; state.pages=makeSourcePages(state.pdf.numPages);state.page=1; state.annotations=[]; state.textBlocks=[]; state.measurementScales={};state.selectedId=null;state.selectedIds=[];state.history=[];state.future=[];itemClipboard=null;itemPasteSequence=0;vectorSegmentCache.clear();vectorSegmentLoads.clear();updateHistoryButtons();updateItemClipboardButtons();
  $("snapToContentButton").disabled=false;updateSnapToggle();
  $("fileName").textContent=name;updatePageUi();els.empty.hidden=true; els.stage.hidden=false;
  await renderPage(); renderThumbnails(); markChanged();
}
async function renderPage() {
  if(!state.pdf)return; const token=++state.renderToken,descriptor=currentPageDescriptor(),renderScale=state.scale,factor=renderScale*1.25;let page=null,viewport;
  if(descriptor.blank)viewport={width:descriptor.width*factor,height:descriptor.height*factor};else{page=await state.pdf.getPage(descriptor.sourceIndex);viewport=page.getViewport({scale:factor});}if(token!==state.renderToken)return;
  const ratio=window.devicePixelRatio||1;displayedScale=renderScale; els.canvas.width=viewport.width*ratio; els.canvas.height=viewport.height*ratio; els.canvas.style.width=`${viewport.width}px`; els.canvas.style.height=`${viewport.height}px`; els.shell.style.width=`${viewport.width}px`; els.shell.style.height=`${viewport.height}px`;
  const ctx=els.canvas.getContext("2d");if(descriptor.blank){ctx.save();ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle="#fff";ctx.fillRect(0,0,viewport.width,viewport.height);ctx.restore();}else await page.render({canvasContext:ctx,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null}).promise;
  els.text.innerHTML=""; const textItems=[];
  if(!descriptor.blank){const content=await page.getTextContent();for(const item of content.items){ if(!item.str)continue; const tx=pdfjsLib.Util.transform(viewport.transform,item.transform),sourceStyle=content.styles[item.fontName]||{}; const angle=Math.atan2(tx[1],tx[0]); const fontHeight=Math.hypot(tx[2],tx[3]); const width=Math.max(item.width*state.scale*1.25,4),top=tx[5]-fontHeight,fontFamily=sourceStyle.fontFamily||"sans-serif",fontSignature=`${item.fontName||""} ${fontFamily}`,fontWeight=/bold|black|heavy/i.test(fontSignature)?"700":"400",fontStyle=/italic|oblique/i.test(fontSignature)?"italic":"normal"; const span=document.createElement("span"); span.textContent=item.str; span.dataset.text=item.str; span.style.left=`${tx[4]}px`; span.style.top=`${top}px`; span.style.fontSize=`${fontHeight}px`; span.style.fontFamily=fontFamily; span.style.fontWeight=fontWeight; span.style.fontStyle=fontStyle; span.style.transform=`rotate(${angle}rad)`; span.style.width=`${width}px`; span.style.height=`${fontHeight*1.18}px`; els.text.appendChild(span); textItems.push({span,text:item.str,x:tx[4],y:top,w:width,h:fontHeight*1.18,fontName:item.fontName,fontHeight,fontFamily,fontWeight,fontStyle}); }}
  state.textBlocks=buildEditableTextBlocks(textItems);
  $("pageInput").value=state.page; $("prevPage").disabled=state.page<=1; $("nextPage").disabled=state.page>=state.pages.length; $("zoomValue").textContent=`${Math.round(state.scale*100)}%`;const original=$("originalPageNumber");if(descriptor.blank){original.textContent="Inserted page";original.hidden=false;}else if(descriptor.sourceIndex!==state.page){original.textContent=`Original page ${descriptor.sourceIndex}`;original.hidden=false;}else original.hidden=true;updateMeasurementScaleStatus(); renderAnnotations(); document.querySelectorAll(".thumbnail").forEach((e,i)=>e.classList.toggle("active",i+1===state.page));renderPageLayout();if(state.snapToContent)void ensureVectorSegments(descriptor);
}
function layoutPageIndexes(){
  if(state.layoutMode==="single")return[state.page-1];
  if(state.layoutMode==="side"){const start=(state.page-1)%2===0?state.page-1:state.page-2;return[start,start+1].filter(index=>index>=0&&index<state.pages.length);}
  return state.pages.map((_,index)=>index);
}
async function getDescriptorPageSize(descriptor){
  if(descriptor.blank)return{width:descriptor.width,height:descriptor.height};
  const page=await state.pdf.getPage(descriptor.sourceIndex),viewport=page.getViewport({scale:1});
  return{width:viewport.width,height:viewport.height};
}
async function renderPageLayout(){
  if(!state.pdf)return;
  const token=++state.layoutRenderToken;
  layoutObserver?.disconnect();layoutObserver=null;
  els.stage.querySelectorAll(".layout-page-preview").forEach(item=>item.remove());
  els.stage.className=`page-stage layout-${state.layoutMode}`;
  if(state.layoutMode==="single"){els.stage.append(els.shell);return;}
  const indexes=layoutPageIndexes(),activeWidth=els.shell.clientWidth,activeHeight=els.shell.clientHeight;
  const entries=[];
  for(const index of indexes){
    if(token!==state.layoutRenderToken)return;
    if(index===state.page-1){els.stage.append(els.shell);continue;}
    const descriptor=state.pages[index],wrapper=document.createElement("button"),canvas=document.createElement("canvas"),label=document.createElement("span");
    wrapper.type="button";wrapper.className="layout-page-preview";wrapper.dataset.pageId=descriptor.id;wrapper.dataset.pageNumber=String(index+1);wrapper.setAttribute("aria-label",`Open page ${index+1}`);
    wrapper.style.width=`${activeWidth}px`;wrapper.style.height=`${activeHeight}px`;
    canvas.width=Math.max(1,Math.round(activeWidth));canvas.height=Math.max(1,Math.round(activeHeight));
    const placeholder=canvas.getContext("2d");placeholder.fillStyle="#fff";placeholder.fillRect(0,0,canvas.width,canvas.height);
    label.className="layout-page-number";label.textContent=String(index+1);wrapper.append(canvas,label);wrapper.onclick=()=>goPage(index+1);els.stage.append(wrapper);entries.push({descriptor,wrapper,canvas});
  }
  if(token!==state.layoutRenderToken)return;
  if("IntersectionObserver" in window){
    layoutObserver=new IntersectionObserver(records=>{for(const record of records){if(!record.isIntersecting)continue;layoutObserver?.unobserve(record.target);const entry=entries.find(item=>item.wrapper===record.target);if(entry)paintLayoutPreview(entry.descriptor,entry.canvas,token,entry.wrapper);}}, {root:$("canvasArea"),rootMargin:"600px"});
    entries.forEach(entry=>layoutObserver.observe(entry.wrapper));
  }else for(const entry of entries)paintLayoutPreview(entry.descriptor,entry.canvas,token,entry.wrapper);
}
async function paintLayoutPreview(descriptor,canvas,token=state.layoutRenderToken,wrapper=canvas.closest(".layout-page-preview")){
  if(!state.pdf||token!==state.layoutRenderToken||!canvas.isConnected)return;
  const factor=state.scale*1.25,ratio=Math.min(window.devicePixelRatio||1,1.5);let width,height,page=null,viewport;
  if(descriptor.blank){width=descriptor.width*factor;height=descriptor.height*factor;}else{page=await state.pdf.getPage(descriptor.sourceIndex);if(token!==state.layoutRenderToken||!canvas.isConnected)return;viewport=page.getViewport({scale:factor});width=viewport.width;height=viewport.height;}
  wrapper.style.width=`${width}px`;wrapper.style.height=`${height}px`;canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
  const ctx=canvas.getContext("2d");if(descriptor.blank){ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);}else await page.render({canvasContext:ctx,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null}).promise;
  if(token!==state.layoutRenderToken||!canvas.isConnected)return;
  ctx.save();ctx.setTransform(ratio,0,0,ratio,0,0);for(const a of annotationsForPageId(state.annotations,descriptor.id)){if(a.type==="replacement"){ctx.fillStyle="#fff";ctx.fillRect((a.sourceX??a.x)*factor,(a.sourceY??a.y)*factor,(a.sourceW??a.w)*factor,(a.sourceH??a.h)*factor);}drawCanvasAnnotation(ctx,a,factor);}ctx.restore();
}
function refreshLayoutPreview(pageId){const wrapper=[...els.stage.querySelectorAll(".layout-page-preview")].find(item=>item.dataset.pageId===pageId),descriptor=state.pages.find(page=>page.id===pageId),canvas=wrapper?.querySelector("canvas");if(wrapper&&descriptor&&canvas)paintLayoutPreview(descriptor,canvas,state.layoutRenderToken,wrapper);}
function renderThumbnails(){
  const token=++state.thumbnailRenderToken,list=$("thumbnails"),descriptors=[...state.pages],entries=[];list.innerHTML="";
  descriptors.forEach((descriptor,index)=>{
    const n=index+1,c=document.createElement("canvas");c.className="thumbnail-canvas";c.dataset.pageId=descriptor.id;c.width=120;c.height=156;
    const placeholder=c.getContext("2d");placeholder.fillStyle="#fff";placeholder.fillRect(0,0,c.width,c.height);
    const b=document.createElement("button");b.className=`thumbnail ${n===state.page?"active":""}`;b.append(c);
    const label=document.createElement("span");label.className="thumbnail-label";label.textContent=pageNumberLabel(descriptor,index);b.append(label);b.onclick=()=>goPage(n);
    const actions=document.createElement("div");actions.className="thumbnail-actions";
    for(const [iconName,title,handler,disabled,className] of [["arrow-up","Move page up",()=>movePage(index,index-1),index===0,""],["arrow-down","Move page down",()=>movePage(index,index+1),index===descriptors.length-1,""],["x","Delete page",()=>deletePage(index),descriptors.length===1,"delete-page"]]){const button=document.createElement("button"),icon=document.createElement("span");icon.className=`ui-icon icon-${iconName}`;icon.setAttribute("aria-hidden","true");button.append(icon);button.title=title;button.setAttribute("aria-label",title);button.disabled=disabled;button.className=className;button.onclick=handler;actions.append(button);}
    const item=document.createElement("div");item.className="thumbnail-item";item.draggable=true;item.dataset.index=index;
    item.ondragstart=e=>{e.dataTransfer.setData("text/plain",String(index));item.classList.add("dragging");};item.ondragend=()=>item.classList.remove("dragging");item.ondragover=e=>{e.preventDefault();item.classList.add("drag-over");};item.ondragleave=()=>item.classList.remove("drag-over");item.ondrop=e=>{e.preventDefault();item.classList.remove("drag-over");movePage(Number(e.dataTransfer.getData("text/plain")),index);};
    item.append(b,actions);list.append(item);entries.push({descriptor,canvas:c});
  });
  paintThumbnailImages(entries,token);
}
async function paintThumbnailImages(entries,token){
  for(const {descriptor,canvas} of entries){
    if(token!==state.thumbnailRenderToken)return;
    await paintThumbnailCanvas(descriptor,canvas,token);
  }
}
async function paintThumbnailCanvas(descriptor,canvas,token=state.thumbnailRenderToken){if(descriptor.blank){canvas.width=descriptor.width*.23;canvas.height=descriptor.height*.23;const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);paintThumbnailAnnotations(descriptor,canvas,.23);return;}const page=await state.pdf.getPage(descriptor.sourceIndex);if(token!==state.thumbnailRenderToken)return;const viewport=page.getViewport({scale:.23});canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;if(token!==state.thumbnailRenderToken)return;paintThumbnailAnnotations(descriptor,canvas,.23);}
async function refreshThumbnail(pageId){if(!state.pdf)return;const descriptor=state.pages.find(page=>page.id===pageId),canvas=[...document.querySelectorAll(".thumbnail-canvas")].find(item=>item.dataset.pageId===pageId);if(!descriptor||!canvas)return;try{await paintThumbnailCanvas(descriptor,canvas);}catch(err){console.error("Thumbnail refresh failed",err);}}
function paintThumbnailAnnotations(descriptor,canvas,scale){const ctx=canvas.getContext("2d");for(const a of annotationsForPageId(state.annotations,descriptor.id).filter(isAnnotationVisible)){if(a.type==="replacement"){ctx.save();ctx.fillStyle="#fff";ctx.fillRect((a.sourceX??a.x)*scale,(a.sourceY??a.y)*scale,(a.sourceW??a.w)*scale,(a.sourceH??a.h)*scale);ctx.restore();}drawCanvasAnnotation(ctx,a,scale);}}
async function movePage(from,to){clearSelection();if(!reorderPage(state.pages,state.annotations,from,to))return;state.page=to+1;updatePageUi();await renderPage();renderThumbnails();markChanged();}
async function deletePage(index){if(state.pages.length===1){toast("The document must have one page.");return;}if(!window.confirm(`Delete page ${index+1}?`))return;clearSelection();const activeId=currentPageDescriptor()?.id,removed=removePage(state.pages,state.annotations,index);if(!removed)return;const activeIndex=state.pages.findIndex(page=>page.id===activeId);state.page=activeIndex>=0?activeIndex+1:Math.min(index+1,state.pages.length);updatePageUi();await renderPage();renderThumbnails();markChanged();}
async function insertBlankPage(){const current=currentPageDescriptor();let width,height;if(current.blank){width=current.width;height=current.height;}else{const page=await state.pdf.getPage(current.sourceIndex),viewport=page.getViewport({scale:1});width=viewport.width;height=viewport.height;}clearSelection();const insertIndex=state.page;addBlankPage(state.pages,state.annotations,insertIndex,{width,height});state.page=insertIndex+1;updatePageUi();await renderPage();renderThumbnails();markChanged();toast("Blank page inserted.");}
function renderAnnotations(){
  els.ann.innerHTML=""; const factor=state.scale*1.25;
  for(const a of pageAnnotations()){
    if(!isAnnotationVisible(a))continue;
    if(a.type==="measurement"||a.type==="markup")continue;
    if(a.type==="replacement"){
      const cover=document.createElement("div");cover.className="original-text-cover";
      cover.style.left=`${(a.sourceX??a.x)*factor}px`;cover.style.top=`${(a.sourceY??a.y)*factor}px`;
      cover.style.width=`${(a.sourceW??a.w)*factor}px`;cover.style.height=`${(a.sourceH??a.h)*factor}px`;els.ann.append(cover);
      if(a.deleted)continue;
    }
    const editing=a.id===state.selectedId&&a.type!=="highlight",el=document.createElement(editing?"textarea":"div");
    el.dataset.id=a.id; el.className=`annotation ${a.type} ${editing?"selected annotation-editor":isSelected(a.id)?"selected":""}`;
    el.style.left=`${a.x*factor}px`; el.style.top=`${a.y*factor}px`; el.style.width=`${a.w*factor}px`; el.style.height=`${a.h*factor}px`;
    if(a.type==="highlight"){
      const highlightColor=hexToCssRgba(a.highlightColor||"#ffd84d",.42);
      if(a.rects?.length){
        el.style.backgroundColor="transparent";
        for(const rect of a.rects){const segment=document.createElement("span");segment.className="highlight-segment";segment.style.left=`${(rect.x-a.x)*factor}px`;segment.style.top=`${(rect.y-a.y)*factor}px`;segment.style.width=`${rect.w*factor}px`;segment.style.height=`${rect.h*factor}px`;segment.style.backgroundColor=highlightColor;el.append(segment);}
      }else el.style.backgroundColor=highlightColor;
    }
    if(a.type!=="highlight"){
      if(editing){el.value=a.text;el.setAttribute("aria-label","Edit PDF text");}else el.textContent=a.text;
      el.style.fontSize=`${a.fontSize*factor}px`; el.style.color=a.color; el.style.backgroundColor=a.backgroundColor||"transparent";
      el.style.fontFamily=a.fontFamily||"Arial, Helvetica, sans-serif";el.style.fontWeight=a.fontWeight||"400";el.style.fontStyle=a.fontStyle||"normal";
      el.style.borderStyle="solid";el.style.borderWidth=`${editing?2:(a.borderWidth||0)*factor}px`;el.style.borderColor=editing?"#2078b8":a.borderColor||"#15191f";
      applyTextPosition(el,a,editing);el.spellcheck=true;el.setAttribute("spellcheck","true");
      if(editing){el.oninput=()=>{a.text=el.value;if(a.autoFit){fitAnnotationToText(a);positionSelectedBox(a,factor);}$("textValue").value=a.text;markChanged();queueThumbnailRefresh(a.pageId);};el.onblur=()=>{a.text=el.value;markChanged();queueThumbnailRefresh(a.pageId);};el.onclick=e=>e.stopPropagation();}
    }
    if(!editing)el.onclick=(e)=>{e.stopPropagation();selectAnnotation(a.id);if(a.type!=="highlight")setTimeout(()=>focusSelectedText(a.id),0);};
    els.ann.append(el);
    if(editing)addBoxHandles(a,factor);
  }
  renderMeasurementOverlay(factor);renderMarkupOverlay(factor);
}
const svgNamespace="http://www.w3.org/2000/svg";
function createSvgElement(name,attributes={}){const element=document.createElementNS(svgNamespace,name);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));return element;}
function markupLineDash(type="solid"){return measurementLineDash(type).join(" ");}
function appendSvgArrowhead(group,tip,adjacent,style,stroke,width){if(!style||style==="none")return;const size=10+width*2,geometry=arrowheadGeometry(tip,adjacent,size),common={class:"markup-shape",stroke,"stroke-width":width};let element;if(style==="open")element=createSvgElement("polyline",{...common,points:`${geometry.left.x},${geometry.left.y} ${tip.x},${tip.y} ${geometry.right.x},${geometry.right.y}`,fill:"none"});else if(style==="circle")element=createSvgElement("circle",{...common,cx:geometry.center.x,cy:geometry.center.y,r:size*.28,fill:"white"});else if(style==="square")element=createSvgElement("rect",{...common,x:geometry.center.x-size*.28,y:geometry.center.y-size*.28,width:size*.56,height:size*.56,fill:"white"});else if(style==="diamond"){const back={x:geometry.left.x+geometry.right.x-tip.x,y:geometry.left.y+geometry.right.y-tip.y};element=createSvgElement("polygon",{...common,points:`${tip.x},${tip.y} ${geometry.left.x},${geometry.left.y} ${back.x},${back.y} ${geometry.right.x},${geometry.right.y}`,fill:"white"});}else element=createSvgElement("polygon",{...common,points:`${tip.x},${tip.y} ${geometry.left.x},${geometry.left.y} ${geometry.right.x},${geometry.right.y}`,fill:style==="filled"?stroke:"white"});group.append(element);}
function appendMarkupGraphic(svg,annotation,factor,draft=false){
  const sourcePoints=annotation.points||[],points=sourcePoints.map(point=>({x:point.x*factor,y:point.y*factor}));if(!points.length)return;const kind=annotation.markupKind,stroke=annotation.strokeColor||"#d04a3a",width=annotation.strokeWidth||2,fill=annotation.fillColor||"#fff2a8",fillOpacity=annotation.fillOpacity??0,group=createSvgElement("g",{class:`markup-item ${draft?"markup-draft":""} ${isSelected(annotation.id)?"selected":""}`}),attrs={class:"markup-shape",stroke,"stroke-width":width,"stroke-dasharray":markupLineDash(annotation.lineType),fill:"none"};let shape;
  if(kind==="ellipse"&&points.length>1){const bounds=markupBounds(sourcePoints);shape=createSvgElement("ellipse",{...attrs,cx:(bounds.x+bounds.w/2)*factor,cy:(bounds.y+bounds.h/2)*factor,rx:bounds.w*factor/2,ry:bounds.h*factor/2,fill,"fill-opacity":fillOpacity});}
  else if(kind==="cloud"&&points.length>1){const bounds=markupBounds(sourcePoints),scaled={x:bounds.x*factor,y:bounds.y*factor,w:bounds.w*factor,h:bounds.h*factor};shape=createSvgElement("path",{...attrs,d:cloudPath(scaled),fill,"fill-opacity":fillOpacity});}
  else if(kind==="rectangle"&&points.length>1){const bounds=markupBounds(sourcePoints);shape=createSvgElement("rect",{...attrs,x:bounds.x*factor,y:bounds.y*factor,width:bounds.w*factor,height:bounds.h*factor,fill,"fill-opacity":fillOpacity});}
  else{const closed=kind==="polygon",tag=closed?"polygon":"polyline";shape=createSvgElement(tag,{...attrs,points:points.map(point=>`${point.x},${point.y}`).join(" "),fill:closed?fill:"none","fill-opacity":closed?fillOpacity:0});}
  group.append(shape);if(kind==="arrow"&&points.length>1){appendSvgArrowhead(group,points[0],points[1],annotation.startArrow||"none",stroke,width);appendSvgArrowhead(group,points.at(-1),points.at(-2),annotation.endArrow||"filled",stroke,width);}
  if(!draft){group.dataset.id=annotation.id;group.addEventListener("pointerdown",event=>startMarkupMove(event,annotation.id));group.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();selectedControlPoint=null;selectMarkup(annotation.id);});const editablePoints=kind==="freehand"?points.map((point,index)=>({point,index})).filter((_,index,list)=>index===0||index===list.length-1):points.map((point,index)=>({point,index}));for(const{point,index}of editablePoints){const active=selectedControlPoint?.type==="markup"&&selectedControlPoint.id===annotation.id&&selectedControlPoint.index===index,marker=createSvgElement("circle",{class:`markup-point ${active?"active-control-point":""}`,cx:point.x,cy:point.y,r:active?6:4});marker.setAttribute("aria-label",kind==="polygon"?"Control point. Press Delete to remove it.":"Control point");if(kind==="polygon"){const title=createSvgElement("title");title.textContent="Drag to move. Click and press Delete to remove.";marker.append(title);}marker.addEventListener("pointerdown",event=>startMarkupPointDrag(event,annotation.id,index));marker.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();});group.append(marker);}}svg.append(group);
}
function renderMarkupOverlay(factor){const markups=pageAnnotations().filter(annotation=>annotation.type==="markup"&&isAnnotationVisible(annotation));if(!markups.length)return;const svg=createSvgElement("svg",{class:"markup-svg",viewBox:`0 0 ${els.shell.clientWidth} ${els.shell.clientHeight}`,"aria-label":"Drawing markups"});for(const annotation of markups)appendMarkupGraphic(svg,annotation,factor);els.ann.append(svg);}
function syncPresetSelection(containerId,color){$(containerId)?.querySelectorAll("[data-preset]").forEach(button=>button.classList.toggle("selected",button.dataset.preset.toLowerCase()===String(color).toLowerCase()));}
function selectMarkup(id){const a=state.annotations.find(item=>item.id===id&&item.type==="markup");if(!a)return;setSingleSelection(id);renderAnnotations();$("deleteButton").disabled=false;$("deleteButton").title="Delete markup";$("deleteButton").setAttribute("aria-label","Delete markup");$("inspector").classList.add("open");$("inspectorEmpty").hidden=true;$("inspectorContent").hidden=false;$("textProperties").hidden=true;$("measurementProperties").hidden=true;$("markupProperties").hidden=false;$("selectedVisibility").checked=isAnnotationVisible(a);$("markupKind").textContent=`${MARKUP_LABELS[a.markupKind]||"Drawing"} markup`;$("markupSubject").value=a.subject||MARKUP_LABELS[a.markupKind]||"Markup";$("markupStatus").value=a.status||"None";$("markupComment").value=a.comment||"";$("markupLineWidth").value=a.strokeWidth||2;$("markupLineWidthValue").value=`${a.strokeWidth||2} pt`;$("markupLineColor").value=a.strokeColor||"#d04a3a";$("markupLineColorValue").value=(a.strokeColor||"#d04a3a").toUpperCase();syncPresetSelection("markupLinePresets",a.strokeColor||"#d04a3a");$("markupLineType").value=a.lineType||"solid";$("markupFillColor").value=a.fillColor||"#fff2a8";$("markupFillColorValue").value=(a.fillColor||"#fff2a8").toUpperCase();syncPresetSelection("markupFillPresets",a.fillColor||"#fff2a8");$("markupFillOpacity").value=Math.round((a.fillOpacity||0)*100);$("markupFillOpacityValue").value=`${Math.round((a.fillOpacity||0)*100)}%`;$("markupFillFields").hidden=["line","arrow","freehand"].includes(a.markupKind);$("markupArrowFields").hidden=a.markupKind!=="arrow";$("markupStartArrow").value=a.startArrow||"none";$("markupEndArrow").value=a.endArrow||"filled";updateItemClipboardButtons();renderMarkupsList();showControlPointHint(a);}
function startMarkupPointDrag(event,id,index){event.preventDefault();event.stopPropagation();const annotation=state.annotations.find(item=>item.id===id);if(!annotation)return;snapshot();selectedControlPoint=annotation.markupKind==="polygon"?{type:"markup",id,index}:null;markupPointDrag={id,index,pageId:annotation.pageId};event.currentTarget.classList.toggle("active-control-point",Boolean(selectedControlPoint));event.currentTarget.setAttribute("r",selectedControlPoint?"6":"4");event.currentTarget.setPointerCapture?.(event.pointerId);showControlPointHint(annotation,true);}
window.addEventListener("pointermove",event=>{if(!markupPointDrag)return;const annotation=state.annotations.find(item=>item.id===markupPointDrag.id);if(!annotation)return;const previous=annotation.points[Math.max(0,markupPointDrag.index-1)];annotation.points[markupPointDrag.index]=constrainPointToAxis(previous,measurementPointFromEvent(event),event.shiftKey);Object.assign(annotation,markupBounds(annotation.points));renderAnnotations();});
window.addEventListener("pointerup",()=>{if(!markupPointDrag)return;const annotation=state.annotations.find(item=>item.id===markupPointDrag.id),pageId=markupPointDrag.pageId,unchanged=state.history.at(-1)===JSON.stringify(state.annotations);markupPointDrag=null;if(unchanged){state.history.pop();updateHistoryButtons();}else{markChanged();queueThumbnailRefresh(pageId);}showControlPointHint(annotation,true);});
function startMarkupMove(event,id){if(state.tool!=="select"||event.button!==0||event.target.closest(".markup-point"))return;event.preventDefault();event.stopPropagation();const annotation=state.annotations.find(item=>item.id===id);if(!annotation)return;const wasSingle=state.selectedId===id&&state.selectedIds.length===1;setSingleSelection(id);markupMove={id,pageId:annotation.pageId,start:measurementPointFromEvent(event),points:annotation.points.map(point=>({...point})),bounds:markupBounds(annotation.points),moved:false};if(!wasSingle)selectMarkup(id);}
window.addEventListener("pointermove",event=>{if(!markupMove)return;const annotation=state.annotations.find(item=>item.id===markupMove.id);if(!annotation)return;const current=measurementPointFromEvent(event),raw={x:current.x-markupMove.start.x,y:current.y-markupMove.start.y};if(!markupMove.moved&&Math.hypot(raw.x,raw.y)<.5)return;if(!markupMove.moved){snapshot();markupMove.moved=true;}const locked=constrainMoveDelta(raw.x,raw.y,event.shiftKey),factor=state.scale*1.25,pageW=els.shell.clientWidth/factor,pageH=els.shell.clientHeight/factor,dx=Math.max(-markupMove.bounds.x,Math.min(pageW-markupMove.bounds.x-markupMove.bounds.w,locked.dx)),dy=Math.max(-markupMove.bounds.y,Math.min(pageH-markupMove.bounds.y-markupMove.bounds.h,locked.dy));annotation.points=markupMove.points.map(point=>({x:point.x+dx,y:point.y+dy}));Object.assign(annotation,markupBounds(annotation.points));renderAnnotations();});
window.addEventListener("pointerup",()=>{if(!markupMove)return;const{pageId,moved}=markupMove;markupMove=null;if(moved){markChanged();queueThumbnailRefresh(pageId);}});
function measurementLabelLines(annotation){if(annotation.measureKind==="count")return[String(annotation.countValue||1)];const scale=annotation.measurementScale||{unitsPerPoint:1,unit:"pt"},value=measurementValue(annotation.measureKind,annotation.points,scale),formatted=formatMeasurement(annotation.measureKind,value,scale.unit),lines=[annotation.measureKind==="area"?`A: ${formatted}`:formatted];if(["area","diameter"].includes(annotation.measureKind)&&annotation.showPerimeterLength){const perimeter=measurementPerimeterValue(annotation.measureKind,annotation.points,scale);lines.push(`P: ${formatMeasurement("perimeter",perimeter,scale.unit)}`);}return lines;}
function measurementLabel(annotation){return measurementLabelLines(annotation)[0];}
function measurementLabelPoint(annotation,points){if(annotation.measureKind==="count")return{x:points[0].x+12,y:points[0].y-10};if(annotation.measureKind==="area"||annotation.measureKind==="perimeter")return{x:points.reduce((sum,point)=>sum+point.x,0)/points.length,y:points.reduce((sum,point)=>sum+point.y,0)/points.length};if(annotation.measureKind==="polyline")return points.at(-1);if(annotation.measureKind==="angle")return{x:points[1].x+10,y:points[1].y-10};return{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2-7};}
function appendMeasurementGraphic(svg,annotation,factor,draft=false){
  const points=(annotation.points||[]).map(point=>({x:point.x*factor,y:point.y*factor}));if(!points.length)return;
  const lineColor=annotation.lineColor||annotation.color||"#d04a3a",labelColor=annotation.labelColor||lineColor,lineWidth=annotation.lineWidth||1.6,dashes=measurementLineDash(annotation.lineType||"solid").join(" "),group=createSvgElement("g",{class:`measurement-item ${draft?"measurement-draft":""} ${isSelected(annotation.id)?"selected":""}`});group.style.color=lineColor;
  const styleShape=shape=>{shape.style.stroke=lineColor;shape.style.strokeWidth=String(lineWidth);shape.style.strokeDasharray=dashes;return shape;};
  if(annotation.measureKind==="diameter"&&points.length>1){const center={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},radius=pointDistance(points[0],points[1])/2;if(annotation.areaFillEnabled!==false){const fill=createSvgElement("circle",{class:"measurement-area",cx:center.x,cy:center.y,r:radius});fill.style.fill=annotation.shadeColor||lineColor;fill.style.fillOpacity=String(annotation.shadeOpacity??.13);group.append(fill);const boundary=measurementFillBoundary("diameter",points);for(const [first,last] of measurementHatchSegments(boundary,annotation.hatchPattern||"none",8*factor)){const hatch=createSvgElement("line",{class:"measurement-hatch",x1:first.x,y1:first.y,x2:last.x,y2:last.y});hatch.style.stroke=annotation.shadeColor||lineColor;group.append(hatch);}}group.append(styleShape(createSvgElement("circle",{class:"measurement-shape",cx:center.x,cy:center.y,r:radius})),styleShape(createSvgElement("line",{class:"measurement-shape",x1:points[0].x,y1:points[0].y,x2:points[1].x,y2:points[1].y})));}
  else if(annotation.measureKind==="count"){group.append(styleShape(createSvgElement("circle",{class:"measurement-shape measurement-count",cx:points[0].x,cy:points[0].y,r:9})));}
  else if(points.length>1){const closed=annotation.measureKind==="area"||annotation.measureKind==="perimeter",pointList=points.map(point=>`${point.x},${point.y}`).join(" "),shape=styleShape(createSvgElement(closed?"polygon":"polyline",{class:"measurement-shape",points:pointList}));if(annotation.measureKind==="area"&&annotation.areaFillEnabled!==false){const fill=createSvgElement("polygon",{class:"measurement-area",points:pointList});fill.style.fill=annotation.shadeColor||lineColor;fill.style.fillOpacity=String(annotation.shadeOpacity??.13);group.append(fill);for(const [first,last] of measurementHatchSegments(points,annotation.hatchPattern||"none",8*factor)){const hatch=createSvgElement("line",{class:"measurement-hatch",x1:first.x,y1:first.y,x2:last.x,y2:last.y});hatch.style.stroke=annotation.shadeColor||lineColor;group.append(hatch);}}group.append(shape);}
  for(const [index,point] of points.entries()){const editable=!draft&&annotation.measureKind!=="calibration",removable=["area","perimeter"].includes(annotation.measureKind),active=selectedControlPoint?.type==="measurement"&&selectedControlPoint.id===annotation.id&&selectedControlPoint.index===index,marker=createSvgElement("circle",{class:`measurement-point ${editable?"editable":""} ${active?"active-control-point":""}`,cx:point.x,cy:point.y,r:active?6:editable&&isSelected(annotation.id)?5:3});marker.style.stroke=lineColor;if(editable){marker.setAttribute("aria-label",removable?"Control point. Press Delete to remove it.":"Control point");if(removable){const title=createSvgElement("title");title.textContent="Drag to move. Click and press Delete to remove.";marker.append(title);}marker.addEventListener("pointerdown",event=>startMeasurementPointDrag(event,annotation.id,index));marker.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();});}group.append(marker);}
  if(!draft&&annotation.measureKind!=="calibration"||!draft&&points.length>1){const position=measurementLabelPoint(annotation,points),label=createSvgElement("text",{class:"measurement-label",x:position.x+5,y:position.y-5});label.style.fill=labelColor;for(const [index,line] of measurementLabelLines(annotation).entries()){const tspan=createSvgElement("tspan",{x:position.x+5,dy:index?13:0});tspan.textContent=line;label.append(tspan);}group.append(label);}
  if(!draft){group.dataset.id=annotation.id;group.addEventListener("pointerdown",event=>startMeasurementMove(event,annotation.id));group.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();selectedControlPoint=null;selectMeasurement(annotation.id);});}
  svg.append(group);
}
function renderMeasurementOverlay(factor){const measurements=pageAnnotations().filter(annotation=>annotation.type==="measurement"&&isAnnotationVisible(annotation));if(!measurements.length)return;const svg=createSvgElement("svg",{class:"measurement-svg",viewBox:`0 0 ${els.shell.clientWidth} ${els.shell.clientHeight}`,"aria-label":"Drawing measurements"});for(const annotation of measurements)appendMeasurementGraphic(svg,annotation,factor);els.ann.append(svg);}
function syncMeasurementAreaControls(annotation){const fillEnabled=annotation.areaFillEnabled!==false;$("measurementAreaFill").checked=fillEnabled;$("measurementShowPerimeter").checked=Boolean(annotation.showPerimeterLength);for(const id of ["measurementShadeColor","measurementShadeOpacity","measurementHatchPattern"])$(id).disabled=!fillEnabled;}
function selectMeasurement(id){
  setSingleSelection(id);renderAnnotations();const a=state.annotations.find(annotation=>annotation.id===id);if(!a)return;
  updateItemClipboardButtons();
  $("deleteButton").disabled=false;$("deleteButton").title="Delete measurement";$("deleteButton").setAttribute("aria-label","Delete measurement");
  $("inspector").classList.add("open");$("inspectorEmpty").hidden=true;$("inspectorContent").hidden=false;$("textProperties").hidden=true;$("measurementProperties").hidden=false;$("markupProperties").hidden=true;
  $("selectedVisibility").checked=isAnnotationVisible(a);
  $("measurementKind").textContent=`${a.measureKind} measurement`;
  $("measurementLineWidth").value=a.lineWidth||1.6;$("measurementLineWidthValue").value=`${a.lineWidth||1.6} pt`;
  for(const [inputId,outputId,presetId,value] of [["measurementLineColor","measurementLineColorValue","measurementLinePresets",a.lineColor||a.color||"#d04a3a"],["measurementLabelColor","measurementLabelColorValue","measurementLabelPresets",a.labelColor||a.color||"#b33427"],["measurementShadeColor","measurementShadeColorValue","measurementShadePresets",a.shadeColor||a.color||"#d04a3a"]]){$(inputId).value=value;$(outputId).value=value.toUpperCase();syncPresetSelection(presetId,value);}
  $("measurementLineType").value=a.lineType||"solid";$("measurementShadeOpacity").value=Math.round((a.shadeOpacity??.13)*100);$("measurementShadeOpacityValue").value=`${Math.round((a.shadeOpacity??.13)*100)}%`;$("measurementHatchPattern").value=a.hatchPattern||"none";
  $("measurementAreaFields").hidden=!["area","diameter"].includes(a.measureKind);syncMeasurementAreaControls(a);
  showControlPointHint(a);
}
function renderMeasurementDraft(){els.draw.querySelector(".measurement-svg")?.remove();if(!measurementDraft)return;const points=[...measurementDraft.points];if(measurementDraft.hover)points.push(measurementDraft.hover);if(!points.length)return;const factor=state.scale*1.25,svg=createSvgElement("svg",{class:"measurement-svg",viewBox:`0 0 ${els.shell.clientWidth} ${els.shell.clientHeight}`});appendMeasurementGraphic(svg,{measureKind:measurementDraft.kind,points},factor,true);els.draw.append(svg);}
function cancelMeasurementDraft(){measurementDraft=null;els.draw?.querySelector(".measurement-svg")?.remove();updateSnapIndicator(null);}
function applyTextPosition(el,a,editing){ el.style.textAlign=a.textAlign||"left"; if(!editing){el.style.display="grid";el.style.alignContent=a.verticalAlign==="middle"?"center":a.verticalAlign==="bottom"?"end":"start";} }
function addBoxHandles(a,factor){
  const move=document.createElement("button"),remove=document.createElement("button"),resize=document.createElement("button");
  move.type="button"; move.className="box-handle move-handle"; move.textContent="Move"; move.title="Move text box. Hold Shift to lock movement to 45-degree steps.";move.setAttribute("aria-label",move.title);
  move.style.left=`${a.x*factor}px`; move.style.top=`${Math.max(0,a.y*factor-20)}px`;
  remove.type="button";remove.className="box-handle delete-handle";remove.textContent="Delete";remove.setAttribute("aria-label",a.type==="replacement"?"Delete selected PDF text":"Delete inserted text box");
  remove.style.left=`${a.x*factor+48}px`;remove.style.top=`${Math.max(0,a.y*factor-20)}px`;
  resize.type="button"; resize.className="box-handle resize-handle"; resize.setAttribute("aria-label","Resize text box");
  resize.style.left=`${(a.x+a.w)*factor-7}px`; resize.style.top=`${(a.y+a.h)*factor-7}px`;
  move.addEventListener("pointerdown",e=>startBoxTransform(e,a,"move")); resize.addEventListener("pointerdown",e=>startBoxTransform(e,a,"resize"));
  move.onclick=resize.onclick=e=>e.stopPropagation();remove.onpointerdown=e=>e.stopPropagation();remove.onclick=e=>{e.stopPropagation();deleteAnnotation(a.id);};els.ann.append(move,remove);if(!a.autoFit)els.ann.append(resize);
}
function syncGeometryControls(a,disabled=a.type==="highlight"){
  for(const [id,value] of [["posX",a.x],["posY",a.y],["boxWidth",a.w],["boxHeight",a.h]]){const input=$(id);input.disabled=disabled||(a.autoFit&&(id==="boxWidth"||id==="boxHeight"));input.value=Math.round(value*10)/10;}
}
function fitAnnotationToText(a){
  const canvas=fitAnnotationToText.canvas||(fitAnnotationToText.canvas=document.createElement("canvas")),ctx=canvas.getContext("2d"),size=a.fontSize||16,border=a.borderWidth||0;
  ctx.font=`${a.fontStyle||"normal"} ${a.fontWeight||"400"} ${size}px ${a.fontFamily||"Arial, sans-serif"}`;
  const pageW=els.shell.clientWidth/(state.scale*1.25),pageH=els.shell.clientHeight/(state.scale*1.25),maxW=Math.max(30,pageW-a.x),padding=8+border*2;
  const paragraphs=(a.text||"").split(/\r?\n/),natural=Math.max(30,...paragraphs.map(line=>ctx.measureText(line||" ").width+padding));a.w=Math.min(maxW,natural);
  const usable=Math.max(10,a.w-padding);let lineCount=0;
  for(const paragraph of paragraphs){if(!paragraph){lineCount++;continue;}let line="";for(const word of paragraph.split(/\s+/)){const candidate=line?`${line} ${word}`:word;if(!line||ctx.measureText(candidate).width<=usable)line=candidate;else{lineCount++;line=word;}}if(line)lineCount++;}
  a.h=Math.min(Math.max(12,lineCount*size*1.25+6+border*2),Math.max(12,pageH-a.y));
}
function positionSelectedBox(a,factor){const editor=els.ann.querySelector(`textarea[data-id="${a.id}"]`),move=els.ann.querySelector(".move-handle"),remove=els.ann.querySelector(".delete-handle"),resize=els.ann.querySelector(".resize-handle");if(editor){editor.style.width=`${a.w*factor}px`;editor.style.height=`${a.h*factor}px`;}if(move){move.style.left=`${a.x*factor}px`;move.style.top=`${Math.max(0,a.y*factor-20)}px`;}if(remove){remove.style.left=`${a.x*factor+48}px`;remove.style.top=`${Math.max(0,a.y*factor-20)}px`;}if(resize){resize.style.left=`${(a.x+a.w)*factor-7}px`;resize.style.top=`${(a.y+a.h)*factor-7}px`;}syncGeometryControls(a);}
let boxTransform=null;
function startBoxTransform(e,a,mode){
  e.preventDefault();e.stopPropagation();
  const editor=els.ann.querySelector(`textarea[data-id="${a.id}"]`);if(editor)a.text=editor.value;
  boxTransform={id:a.id,mode,startX:e.clientX,startY:e.clientY,x:a.x,y:a.y,w:a.w,h:a.h};
  e.currentTarget.setPointerCapture(e.pointerId);
}
window.addEventListener("pointermove",e=>{
  if(!boxTransform)return;
  const a=state.annotations.find(x=>x.id===boxTransform.id);if(!a)return;
  const factor=state.scale*1.25,rawDx=(e.clientX-boxTransform.startX)/factor,rawDy=(e.clientY-boxTransform.startY)/factor,{dx,dy}=boxTransform.mode==="move"?constrainMoveDelta(rawDx,rawDy,e.shiftKey):{dx:rawDx,dy:rawDy};
  const pageW=els.shell.clientWidth/factor,pageH=els.shell.clientHeight/factor;
  if(boxTransform.mode==="move"){a.x=Math.max(0,Math.min(pageW-a.w,boxTransform.x+dx));a.y=Math.max(0,Math.min(pageH-a.h,boxTransform.y+dy));}
  else{a.w=Math.max(30,Math.min(pageW-a.x,boxTransform.w+dx));a.h=Math.max(12,Math.min(pageH-a.y,boxTransform.h+dy));}
  const editor=els.ann.querySelector(`textarea[data-id="${a.id}"]`),move=els.ann.querySelector(".move-handle"),remove=els.ann.querySelector(".delete-handle"),resize=els.ann.querySelector(".resize-handle");
  if(editor){editor.style.left=`${a.x*factor}px`;editor.style.top=`${a.y*factor}px`;editor.style.width=`${a.w*factor}px`;editor.style.height=`${a.h*factor}px`;}
  if(move){move.style.left=`${a.x*factor}px`;move.style.top=`${Math.max(0,a.y*factor-20)}px`;}
  if(remove){remove.style.left=`${a.x*factor+48}px`;remove.style.top=`${Math.max(0,a.y*factor-20)}px`;}
  if(resize){resize.style.left=`${(a.x+a.w)*factor-7}px`;resize.style.top=`${(a.y+a.h)*factor-7}px`;}
  syncGeometryControls(a);
});
window.addEventListener("pointerup",()=>{if(boxTransform){const a=state.annotations.find(x=>x.id===boxTransform.id);boxTransform=null;markChanged();queueThumbnailRefresh(a?.pageId);}});
function goPage(n){ if(!state.pdf)return;const nextPage=Math.max(1,Math.min(state.pages.length,n));if(nextPage===state.page)return;clearSelection();state.page=nextPage;renderPage(); }
function addAnnotation(a){ snapshot(); const item={id:crypto.randomUUID(),page:state.page,pageId:currentPageDescriptor()?.id,color:"#15191f",highlightColor:state.highlightColor,backgroundColor:"transparent",borderWidth:0,borderColor:"#15191f",autoFit:false,fontSize:16,fontChoice:"original",fontFamily:"Arial, Helvetica, sans-serif",originalFontFamily:"Arial, Helvetica, sans-serif",fontWeight:"400",originalFontWeight:"400",fontStyle:"normal",originalFontStyle:"normal",textAlign:"left",verticalAlign:"top",...a};if(item.autoFit)fitAnnotationToText(item);state.annotations.push(item); markChanged();queueThumbnailRefresh(item.pageId); renderAnnotations(); selectAnnotation(item.id); return item.id; }
function addHighlightBoxes(boxes){ const geometry=createHighlightGeometry(boxes);if(!geometry)return;snapshot();const item={id:crypto.randomUUID(),page:state.page,pageId:currentPageDescriptor()?.id,color:"#15191f",highlightColor:state.highlightColor,fontSize:16,type:"highlight",...geometry};state.annotations.push(item);markChanged();queueThumbnailRefresh(item.pageId);selectAnnotation(item.id); }
function focusSelectedText(id){ const el=els.ann.querySelector(`[data-id="${id}"]`); if(!el)return; el.focus(); if(el instanceof HTMLTextAreaElement){el.select();return;} const range=document.createRange(); range.selectNodeContents(el); const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
function caretAtPoint(x,y){ if(document.caretPositionFromPoint){ const p=document.caretPositionFromPoint(x,y); return p?{node:p.offsetNode,offset:p.offset}:null; } const r=document.caretRangeFromPoint?.(x,y); return r?{node:r.startContainer,offset:r.startOffset}:null; }
function rangeBetween(start,end){ const range=document.createRange(); range.setStart(start.node,start.offset); range.setEnd(end.node,end.offset); if(range.collapsed&&(start.node!==end.node||start.offset!==end.offset)){ range.setStart(end.node,end.offset); range.setEnd(start.node,start.offset); } return range; }
function currentDrawingScale(pageId=currentPageDescriptor()?.id){return pageId?state.measurementScales[pageId]:null;}
function updateMeasurementScaleStatus(){const scale=currentDrawingScale(),status=$("measureScaleStatus");status.textContent=scale?`1 pt = ${Math.round(scale.unitsPerPoint*10000)/10000} ${scale.unit}`:"Scale not set";}
function positionFloatingMenu(button,menu){const rect=button.getBoundingClientRect(),gap=6,edge=10;menu.style.maxHeight=`${Math.max(120,window.innerHeight-edge*2)}px`;const width=menu.offsetWidth,height=menu.offsetHeight,left=Math.max(edge,Math.min(rect.left,window.innerWidth-width-edge)),roomBelow=window.innerHeight-rect.bottom-edge,roomAbove=rect.top-edge,openAbove=height>roomBelow&&roomAbove>roomBelow,available=Math.max(120,openAbove?roomAbove-gap:roomBelow-gap);menu.style.left=`${left}px`;menu.style.top=`${openAbove?Math.max(edge,rect.top-Math.min(height,available)-gap):rect.bottom+gap}px`;menu.style.maxHeight=`${available}px`;}
function positionMeasureMenu(){positionFloatingMenu($("measureButton"),$("measureMenu"));}
function toggleMeasureMenu(){const menu=$("measureMenu"),opening=menu.hidden;$("markupMenu").hidden=true;if(opening){updateMeasurementScaleStatus();menu.hidden=false;positionMeasureMenu();}else menu.hidden=true;}
function selectMeasurementTool(kind){const scaleRequired=!['calibrate','angle','count'].includes(kind);if(scaleRequired&&!currentDrawingScale()){setTool("measure-calibrate");toast("Set the drawing scale first.");}else setTool(`measure-${kind}`);$("measureMenu").hidden=true;}
function updateSnapToggle(){const button=$("snapToContentButton");button.setAttribute("aria-pressed",String(state.snapToContent));button.classList.toggle("selected",state.snapToContent);button.title=state.snapToContent?"Turn off snap to PDF vector content":"Snap measurements to PDF vector content";}
function updateSnapIndicator(snap){let indicator=els.draw.querySelector(".snap-indicator");if(!snap){indicator?.remove();return;}if(!indicator){indicator=document.createElement("span");indicator.setAttribute("aria-hidden","true");els.draw.append(indicator);}indicator.className=`snap-indicator snap-${snap.type}`;const factor=state.scale*1.25;indicator.style.left=`${snap.point.x*factor}px`;indicator.style.top=`${snap.point.y*factor}px`;}
async function ensureVectorSegments(descriptor=currentPageDescriptor()){
  if(!descriptor)return[];if(vectorSegmentCache.has(descriptor.id))return vectorSegmentCache.get(descriptor.id);if(descriptor.blank){vectorSegmentCache.set(descriptor.id,[]);return[];}
  if(vectorSegmentLoads.has(descriptor.id))return vectorSegmentLoads.get(descriptor.id);
  const load=(async()=>{try{const page=await state.pdf.getPage(descriptor.sourceIndex),operatorList=await page.getOperatorList(),viewport=page.getViewport({scale:1});const segments=extractVectorSegments(operatorList,pdfjsLib.OPS,viewport.transform);vectorSegmentCache.set(descriptor.id,segments);return segments;}catch(error){console.error("Vector snap extraction failed",error);vectorSegmentCache.set(descriptor.id,[]);return[];}finally{vectorSegmentLoads.delete(descriptor.id);}})();
  vectorSegmentLoads.set(descriptor.id,load);return load;
}
async function toggleSnapToContent(){if(!state.pdf)return;state.snapToContent=!state.snapToContent;updateSnapToggle();updateSnapIndicator(null);if(!state.snapToContent){toast("Vector snap off.");return;}toast("Reading vector content...");const descriptor=currentPageDescriptor(),segments=await ensureVectorSegments(descriptor);if(!state.snapToContent||descriptor.id!==currentPageDescriptor()?.id)return;toast(segments.length?`Vector snap on. ${segments.length.toLocaleString()} segments found.`:"Vector snap is on. No vector paths were found on this page.");}
function measurementPointFromEvent(event){const factor=state.scale*1.25,rect=els.shell.getBoundingClientRect();return{x:Math.max(0,Math.min(els.shell.clientWidth/factor,(event.clientX-rect.left)/factor)),y:Math.max(0,Math.min(els.shell.clientHeight/factor,(event.clientY-rect.top)/factor))};}
function placementMeasurementPoint(point,points,shiftKey){
  const anchor=points.length?points[points.length-1]:null,constrained=constrainPointToAxis(anchor,point,shiftKey);
  if(!state.snapToContent){updateSnapIndicator(null);return constrained;}
  const segments=vectorSegmentCache.get(currentPageDescriptor()?.id)||[],factor=state.scale*1.25,options={};
  if(shiftKey&&anchor){options.anchor=anchor;options.direction={x:constrained.x-anchor.x,y:constrained.y-anchor.y};}
  const snapped=snapPointToSegments(constrained,segments,10/factor,options);updateSnapIndicator(snapped);return snapped?.point||constrained;
}
function startMeasurementPointDrag(event,id,index){const annotation=state.annotations.find(item=>item.id===id&&item.type==="measurement");if(!annotation)return;event.preventDefault();event.stopPropagation();snapshot();suppressMeasurementClick=true;selectedControlPoint=["area","perimeter"].includes(annotation.measureKind)?{type:"measurement",id,index}:null;measurementPointDrag={id,index,pageId:annotation.pageId};event.currentTarget.classList.toggle("active-control-point",Boolean(selectedControlPoint));event.currentTarget.setAttribute("r",selectedControlPoint?"6":"5");if(state.selectedId!==id)selectMeasurement(id);showControlPointHint(annotation,true);}
window.addEventListener("pointermove",event=>{if(!measurementPointDrag)return;const annotation=state.annotations.find(item=>item.id===measurementPointDrag.id);if(!annotation)return;annotation.points[measurementPointDrag.index]=placementMeasurementPoint(measurementPointFromEvent(event),[],false);Object.assign(annotation,measurementBounds(annotation.points));renderAnnotations();});
window.addEventListener("pointerup",()=>{if(!measurementPointDrag)return;const annotation=state.annotations.find(item=>item.id===measurementPointDrag.id),pageId=measurementPointDrag.pageId,unchanged=state.history.at(-1)===JSON.stringify(state.annotations);measurementPointDrag=null;updateSnapIndicator(null);if(unchanged){state.history.pop();updateHistoryButtons();}else{markChanged();queueThumbnailRefresh(pageId);}showControlPointHint(annotation,true);setTimeout(()=>{suppressMeasurementClick=false;},0);});
function startMeasurementMove(event,id){if(state.tool!=="select"||event.button!==0||event.target.closest(".measurement-point"))return;event.preventDefault();event.stopPropagation();const annotation=state.annotations.find(item=>item.id===id&&item.type==="measurement"&&item.measureKind!=="calibration");if(!annotation)return;const wasSingle=state.selectedId===id&&state.selectedIds.length===1;setSingleSelection(id);measurementMove={id,pageId:annotation.pageId,start:measurementPointFromEvent(event),points:annotation.points.map(point=>({...point})),bounds:measurementBounds(annotation.points),moved:false};if(!wasSingle)selectMeasurement(id);}
window.addEventListener("pointermove",event=>{if(!measurementMove)return;const annotation=state.annotations.find(item=>item.id===measurementMove.id);if(!annotation)return;const current=measurementPointFromEvent(event),raw={x:current.x-measurementMove.start.x,y:current.y-measurementMove.start.y};if(!measurementMove.moved&&Math.hypot(raw.x,raw.y)<.5)return;if(!measurementMove.moved){snapshot();measurementMove.moved=true;}const locked=constrainMoveDelta(raw.x,raw.y,event.shiftKey),factor=state.scale*1.25,pageW=els.shell.clientWidth/factor,pageH=els.shell.clientHeight/factor,dx=Math.max(-measurementMove.bounds.x,Math.min(pageW-measurementMove.bounds.x-measurementMove.bounds.w,locked.dx)),dy=Math.max(-measurementMove.bounds.y,Math.min(pageH-measurementMove.bounds.y-measurementMove.bounds.h,locked.dy));annotation.points=measurementMove.points.map(point=>({x:point.x+dx,y:point.y+dy}));Object.assign(annotation,measurementBounds(annotation.points));renderAnnotations();});
window.addEventListener("pointerup",()=>{if(!measurementMove)return;const{pageId,moved}=measurementMove;measurementMove=null;if(moved){markChanged();queueThumbnailRefresh(pageId);}});
function addMeasurement(kind,points,scale=currentDrawingScale(),extra={}){const bounds=measurementBounds(points);snapshot();const annotation={id:crypto.randomUUID(),type:"measurement",measureKind:kind,points:points.map(point=>({...point})),measurementScale:scale?{...scale}:null,page:state.page,pageId:currentPageDescriptor()?.id,color:"#d04a3a",lineColor:"#d04a3a",lineWidth:1.6,labelColor:"#b33427",lineType:"solid",shadeColor:"#d04a3a",shadeOpacity:.13,hatchPattern:"none",areaFillEnabled:true,showPerimeterLength:false,...bounds,...extra};state.annotations.push(annotation);markChanged();queueThumbnailRefresh(annotation.pageId);renderAnnotations();selectMeasurement(annotation.id);return annotation;}
function finishMeasurementDraft(){
  if(!measurementDraft)return;const {kind,points}=measurementDraft,minPoints=kind==="polyline"?2:3;if(points.length<minPoints){toast(`Add at least ${minPoints} points.`);return;}
  cancelMeasurementDraft();addMeasurement(kind,points);
}
function undoMeasurementDraftPoint(){if(!measurementDraft||!["polyline","area","perimeter"].includes(measurementDraft.kind)||!measurementDraft.points.length)return false;measurementDraft.points.pop();measurementDraft.hover=null;updateSnapIndicator(null);renderMeasurementDraft();toast("Last measurement point removed.");return true;}
function completeFixedMeasurement(kind,points){
  cancelMeasurementDraft();
  if(kind==="calibrate"){pendingCalibration={points:points.map(point=>({...point})),pageId:currentPageDescriptor()?.id};$("scaleDistance").value="1";$("scaleDialog").showModal();$("scaleDistance").focus();$("scaleDistance").select();return;}
  addMeasurement(kind,points,kind==="angle"?null:currentDrawingScale());
}
function handleMeasurementClick(event){
  if(suppressMeasurementClick){event.preventDefault();event.stopPropagation();suppressMeasurementClick=false;return;}
  if(!state.tool.startsWith("measure-")||event.target.closest(".measurement-item:not(.measurement-draft)"))return;
  const kind=state.tool.slice(8);
  event.preventDefault();event.stopPropagation();if(event.detail>1&&["polyline","area","perimeter"].includes(kind))return;
  const point=measurementPointFromEvent(event);
  if(kind==="count"){const countValue=pageAnnotations().filter(annotation=>annotation.type==="measurement"&&annotation.measureKind==="count").length+1;addMeasurement("count",[placementMeasurementPoint(point,[],false)],null,{countValue});updateSnapIndicator(null);return;}
  if(!measurementDraft||measurementDraft.kind!==kind)measurementDraft={kind,points:[],hover:null};
  measurementDraft.points.push(placementMeasurementPoint(point,measurementDraft.points,event.shiftKey));measurementDraft.hover=null;renderMeasurementDraft();
  const needed=kind==="angle"?3:["calibrate","length","diameter"].includes(kind)?2:Infinity;
  if(measurementDraft.points.length>=needed)completeFixedMeasurement(kind,[...measurementDraft.points]);
}
els.shell.addEventListener("click",handleMeasurementClick,true);
function isDrawingPlacementTool(){return state.tool.startsWith("measure-")||state.tool.startsWith("markup-");}
els.shell.addEventListener("mousedown",event=>{if(!isDrawingPlacementTool()||event.button!==0)return;event.preventDefault();window.getSelection()?.removeAllRanges();},true);
els.shell.addEventListener("contextmenu",event=>{if(!isDrawingPlacementTool())return;event.preventDefault();event.stopPropagation();},true);
els.shell.addEventListener("dblclick",event=>{if(!state.tool.startsWith("measure-")||!["polyline","area","perimeter"].includes(state.tool.slice(8)))return;event.preventDefault();event.stopPropagation();finishMeasurementDraft();},true);
els.shell.addEventListener("pointermove",event=>{if(!state.tool.startsWith("measure-"))return;const point=placementMeasurementPoint(measurementPointFromEvent(event),measurementDraft?.points||[],event.shiftKey);if(!measurementDraft)return;measurementDraft.hover=point;renderMeasurementDraft();});
els.shell.addEventListener("pointerleave",()=>{if(!measurementPointDrag)updateSnapIndicator(null);});

function addMarkup(kind,points){if(points.length<2)return null;snapshot();const item=makeMarkup(kind,points,state.page,currentPageDescriptor()?.id,crypto.randomUUID());state.annotations.push(item);markChanged();queueThumbnailRefresh(item.pageId);renderAnnotations();selectMarkup(item.id);renderMarkupsList();return item.id;}
function renderMarkupDraft(){els.draw.querySelector(".markup-svg")?.remove();if(!markupDraft?.points.length)return;const points=markupDraft.hover?[...markupDraft.points,markupDraft.hover]:markupDraft.points,svg=createSvgElement("svg",{class:"markup-svg",viewBox:`0 0 ${els.shell.clientWidth} ${els.shell.clientHeight}`});appendMarkupGraphic(svg,{type:"markup",markupKind:markupDraft.kind,points,strokeColor:"#d04a3a",strokeWidth:2,lineType:"dashed",fillColor:"#fff2a8",fillOpacity:.12},state.scale*1.25,true);els.draw.append(svg);}
function cancelMarkupDraft(){markupDraft=null;els.draw?.querySelector(".markup-svg")?.remove();}
function undoMarkupDraftPoint(){if(markupDraft?.kind!=="polygon"||!markupDraft.points.length)return false;markupDraft.points.pop();markupDraft.hover=null;renderMarkupDraft();toast("Last markup point removed.");return true;}
function finishMarkupDraft(){if(!markupDraft)return;const{kind,points}=markupDraft,minimum=kind==="polygon"?3:2;cancelMarkupDraft();if(points.length>=minimum)addMarkup(kind,points);else toast(kind==="polygon"?"A polygon needs at least three points.":"Add a second point to finish the markup.");}
els.shell.addEventListener("pointerdown",event=>{if(!state.tool.startsWith("markup-")||event.button!==0)return;const kind=state.tool.slice(7);if(kind==="polygon")return;event.preventDefault();event.stopPropagation();const point=measurementPointFromEvent(event);markupDraft={kind,points:[point],hover:point,pointerId:event.pointerId};els.shell.setPointerCapture(event.pointerId);renderMarkupDraft();},true);
els.shell.addEventListener("pointermove",event=>{if(!markupDraft)return;const point=measurementPointFromEvent(event);if(markupDraft.kind==="polygon")markupDraft.hover=constrainPointToAxis(markupDraft.points.at(-1),point,event.shiftKey);else if(markupDraft.kind==="freehand"){const last=markupDraft.points.at(-1);if(pointDistance(last,point)>1.5)markupDraft.points.push(point);markupDraft.hover=null;}else markupDraft.hover=constrainPointToAxis(markupDraft.points[0],point,event.shiftKey);renderMarkupDraft();},true);
els.shell.addEventListener("pointerup",event=>{if(!markupDraft||markupDraft.kind==="polygon"||event.pointerId!==markupDraft.pointerId)return;event.preventDefault();event.stopPropagation();const end=markupDraft.kind==="freehand"?null:markupDraft.hover;if(end)markupDraft.points.push(end);suppressMarkupClick=true;finishMarkupDraft();},true);
els.shell.addEventListener("click",event=>{if(!suppressMarkupClick)return;suppressMarkupClick=false;event.preventDefault();event.stopPropagation();},true);
els.shell.addEventListener("click",event=>{if(state.tool!=="markup-polygon")return;event.preventDefault();event.stopPropagation();if(event.detail>1)return;const point=measurementPointFromEvent(event);if(!markupDraft)markupDraft={kind:"polygon",points:[],hover:null};markupDraft.points.push(constrainPointToAxis(markupDraft.points.at(-1),point,event.shiftKey));markupDraft.hover=null;renderMarkupDraft();},true);
els.shell.addEventListener("dblclick",event=>{if(state.tool!=="markup-polygon")return;event.preventDefault();event.stopPropagation();finishMarkupDraft();},true);

$("measureButton").onclick=event=>{event.stopPropagation();toggleMeasureMenu();};
$("snapToContentButton").onclick=toggleSnapToContent;
$("measureMenu").onclick=event=>{event.stopPropagation();const button=event.target.closest("[data-measure-tool]");if(button)selectMeasurementTool(button.dataset.measureTool);};
function positionMarkupMenu(){positionFloatingMenu($("markupButton"),$("markupMenu"));}
$("markupButton").onclick=event=>{event.stopPropagation();const menu=$("markupMenu"),opening=menu.hidden;$("measureMenu").hidden=true;menu.hidden=!opening;if(opening)positionMarkupMenu();};
$("markupMenu").onclick=event=>{event.stopPropagation();const button=event.target.closest("[data-markup-tool]");if(!button)return;setTool(`markup-${button.dataset.markupTool}`);$("markupMenu").hidden=true;};
document.addEventListener("click",event=>{if(!event.target.closest("#measureMenu,#measureButton"))$("measureMenu").hidden=true;if(!event.target.closest("#markupMenu,#markupButton"))$("markupMenu").hidden=true;});
window.addEventListener("resize",()=>{if(!$("measureMenu").hidden)positionMeasureMenu();if(!$("markupMenu").hidden)positionMarkupMenu();});
$("scaleForm").onsubmit=event=>{event.preventDefault();if(!pendingCalibration)return;const scale=calibrateDrawingScale(pendingCalibration.points,$("scaleDistance").value,$("scaleUnit").value);if(!scale){toast("Enter a valid distance.");return;}state.measurementScales[pendingCalibration.pageId]=scale;const points=pendingCalibration.points;pendingCalibration=null;$("scaleDialog").close();addMeasurement("calibration",points,scale);updateMeasurementScaleStatus();setTool("measure-length");toast("Drawing scale set for this page.");};
$("cancelScale").onclick=()=>{$("scaleDialog").close();pendingCalibration=null;setTool("select");};
$("scaleDialog").addEventListener("close",()=>{if($("scaleDialog").returnValue!=="default")pendingCalibration=null;});

els.text.addEventListener("click",e=>{ const span=e.target.closest("span"); if(!span||state.tool!=="edit")return; const factor=state.scale*1.25, block=state.textBlocks.find(b=>b.id===span.dataset.blockId); const r=span.getBoundingClientRect(), pr=els.shell.getBoundingClientRect(),computed=getComputedStyle(span); const box=block?{x:block.x/factor,y:block.y/factor,w:block.w/factor,h:block.h/factor,text:block.text,fontSize:block.fontHeight/factor,fontFamily:block.fontFamily,fontWeight:block.fontWeight,fontStyle:block.fontStyle}:{x:(r.left-pr.left)/factor,y:(r.top-pr.top)/factor,w:r.width/factor,h:r.height/factor,text:span.dataset.text,fontSize:Math.max(8,r.height/factor*.75),fontFamily:computed.fontFamily,fontWeight:computed.fontWeight,fontStyle:computed.fontStyle}; e.stopPropagation(); const id=addAnnotation({...box,sourceX:box.x,sourceY:box.y,sourceW:box.w,sourceH:box.h,backgroundColor:"transparent",autoFit:true,originalFontFamily:box.fontFamily,originalFontWeight:box.fontWeight,originalFontStyle:box.fontStyle,baseH:box.h,type:"replacement"}); setTimeout(()=>focusSelectedText(id),0); });
let highlightStart=null;
els.text.addEventListener("pointerdown",e=>{ if(state.tool!=="highlight"||!e.target.closest("span"))return; const caret=caretAtPoint(e.clientX,e.clientY); if(!caret||!els.text.contains(caret.node))return; e.preventDefault(); e.stopPropagation(); highlightStart=caret; els.text.setPointerCapture(e.pointerId); });
els.text.addEventListener("pointermove",e=>{ if(!highlightStart)return; const end=caretAtPoint(e.clientX,e.clientY); if(!end||!els.text.contains(end.node))return; const range=rangeBetween(highlightStart,end), selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
els.text.addEventListener("pointerup",e=>{ if(!highlightStart)return; e.preventDefault(); e.stopPropagation(); const end=caretAtPoint(e.clientX,e.clientY), start=highlightStart; highlightStart=null; if(!end||!els.text.contains(end.node))return; const range=rangeBetween(start,end), pageRect=els.shell.getBoundingClientRect(), factor=state.scale*1.25; const boxes=Array.from(range.getClientRects()).filter(r=>r.width>1&&r.height>1).map(r=>({x:(r.left-pageRect.left)/factor,y:(r.top-pageRect.top+2)/factor,w:r.width/factor,h:Math.max(r.height-4,2)/factor})); window.getSelection()?.removeAllRanges(); addHighlightBoxes(boxes); });
els.shell.addEventListener("click",e=>{ const targetIsAnnotation=Boolean(e.target.closest(".annotation,.box-handle"));if(targetIsAnnotation)return; if(!shouldInsertText(state.tool,state.selectedId,targetIsAnnotation)){clearSelection();return;} const factor=state.scale*1.25,r=els.shell.getBoundingClientRect(),w=150,h=40,x=Math.max(0,Math.min(els.shell.clientWidth/factor-w,(e.clientX-r.left)/factor)),y=Math.max(0,Math.min(els.shell.clientHeight/factor-h,(e.clientY-r.top)/factor)); const id=addAnnotation({type:"text",text:"Type here",x,y,w,h}); setTimeout(()=>focusSelectedText(id),0); });
let drag=null;
els.shell.addEventListener("pointerdown",e=>{ if(state.tool!=="highlight"||e.target.closest("span"))return; const r=els.shell.getBoundingClientRect(); drag={x:e.clientX-r.left,y:e.clientY-r.top}; const d=document.createElement("div"); d.className="highlight-draft"; d.id="draft";d.style.backgroundColor=hexToCssRgba(state.highlightColor,.45); els.draw.append(d); els.shell.setPointerCapture(e.pointerId); });
els.shell.addEventListener("pointermove",e=>{ if(!drag)return; const r=els.shell.getBoundingClientRect(), x=e.clientX-r.left,y=e.clientY-r.top,d=$("draft"); d.style.left=`${Math.min(x,drag.x)}px`; d.style.top=`${Math.min(y,drag.y)}px`; d.style.width=`${Math.abs(x-drag.x)}px`; d.style.height=`${Math.abs(y-drag.y)}px`; });
els.shell.addEventListener("pointerup",e=>{ if(!drag)return; const r=els.shell.getBoundingClientRect(), x=e.clientX-r.left,y=e.clientY-r.top,factor=state.scale*1.25,w=Math.abs(x-drag.x),h=Math.abs(y-drag.y); $("draft")?.remove(); if(w>5&&h>5)addAnnotation({type:"highlight",x:Math.min(x,drag.x)/factor,y:Math.min(y,drag.y)/factor,w:w/factor,h:h/factor}); drag=null; });

document.querySelectorAll(".tool").forEach(b=>{if(!["measureButton","markupButton"].includes(b.id))b.onclick=()=>setTool(b.dataset.tool);});
$("openButton").onclick=$("emptyOpenButton").onclick=()=>$("fileInput").click(); $("fileInput").onchange=e=>e.target.files[0]&&openPdf(e.target.files[0]);
$("insertPageButton").onclick=()=>state.pdf&&insertBlankPage();
$("prevPage").onclick=()=>goPage(state.page-1); $("nextPage").onclick=()=>goPage(state.page+1); $("pageInput").onchange=e=>goPage(Number(e.target.value)||1);
async function changeDocumentZoom(delta,anchorClient=null){
  if(!state.pdf)return;const next=Math.max(.25,Math.min(2,Math.round((state.scale+delta)*100)/100));if(next===state.scale)return;
  const area=$("canvasArea"),areaRect=area.getBoundingClientRect(),anchor=anchorClient||{x:areaRect.left+area.clientWidth/2,y:areaRect.top+area.clientHeight/2},shellRect=els.shell.getBoundingClientRect(),oldFactor=displayedScale*1.25,pagePoint={x:(anchor.x-shellRect.left)/oldFactor,y:(anchor.y-shellRect.top)/oldFactor},token=++zoomAnchorToken;
  state.scale=next;await renderPage();if(token!==zoomAnchorToken)return;await new Promise(resolve=>requestAnimationFrame(resolve));if(token!==zoomAnchorToken)return;
  const nextRect=els.shell.getBoundingClientRect(),newFactor=displayedScale*1.25,nextScroll=calculateAnchoredScroll({left:area.scrollLeft,top:area.scrollTop},anchor,{x:nextRect.left+pagePoint.x*newFactor,y:nextRect.top+pagePoint.y*newFactor});area.scrollLeft=nextScroll.left;area.scrollTop=nextScroll.top;
}
$("zoomIn").onclick=()=>changeDocumentZoom(.1); $("zoomOut").onclick=()=>changeDocumentZoom(-.1);
window.addEventListener("wheel",event=>{if(!event.ctrlKey)return;event.preventDefault();if(!event.deltaY)return;const area=$("canvasArea"),rect=area.getBoundingClientRect(),inside=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;changeDocumentZoom(event.deltaY<0?.1:-.1,inside?{x:event.clientX,y:event.clientY}:null);},{passive:false,capture:true});
async function restoreAnnotationHistory(source,target){if(!source.length)return;target.push(JSON.stringify(state.annotations));state.annotations=JSON.parse(source.pop());state.selectedId=null;clearSelection();updateHistoryButtons();await renderPage();renderThumbnails();markChanged();}
$("undoButton").onclick=()=>restoreAnnotationHistory(state.history,state.future);
$("redoButton").onclick=()=>restoreAnnotationHistory(state.future,state.history);
function deleteAnnotation(id){const a=state.annotations.find(x=>x.id===id);if(!a)return;clearSelection();snapshot();if(a.type==="replacement"){a.text="";a.deleted=true;a.x=a.sourceX??a.x;a.y=a.sourceY??a.y;a.w=a.sourceW??a.w;a.h=a.sourceH??a.h;a.backgroundColor="#ffffff";toast("Selected PDF text deleted.");}else{state.annotations=state.annotations.filter(x=>x.id!==a.id);toast(a.type==="highlight"?"Highlight deleted.":a.type==="measurement"?"Measurement deleted.":a.type==="markup"?"Markup deleted.":"Inserted text box deleted.");}renderAnnotations();markChanged();queueThumbnailRefresh(a.pageId);}
function deleteSelectedControlPoint(){if(!selectedControlPoint)return false;const {type,id,index}=selectedControlPoint,item=state.annotations.find(annotation=>annotation.id===id),supported=type==="markup"?item?.type==="markup"&&item.markupKind==="polygon":type==="measurement"&&item?.type==="measurement"&&["area","perimeter"].includes(item.measureKind);if(!supported){selectedControlPoint=null;return false;}const points=removeControlPoint(item.points,index);if(!points){toast("A closed shape must have at least three points.");return true;}snapshot();item.points=points;Object.assign(item,item.type==="markup"?markupBounds(points):measurementBounds(points));selectedControlPoint=null;renderAnnotations();markChanged();queueThumbnailRefresh(item.pageId);toast("Control point removed.");return true;}
function deleteSelectedItems(){const ids=state.selectedIds.length?[...state.selectedIds]:state.selectedId?[state.selectedId]:[];if(!ids.length)return;if(ids.length===1){deleteAnnotation(ids[0]);return;}const pageIds=new Set(state.annotations.filter(item=>ids.includes(item.id)).map(item=>item.pageId));snapshot();state.annotations=state.annotations.filter(item=>!ids.includes(item.id));clearSelection();renderAnnotations();markChanged();for(const pageId of pageIds)queueThumbnailRefresh(pageId);toast(`${ids.length} selected items deleted.`);}
$("deleteButton").onclick=deleteSelectedItems;
function copySelectedItem(){const a=state.annotations.find(item=>item.id===state.selectedId&&(item.type==="markup"||item.type==="measurement"&&item.measureKind!=="calibration"));if(!a)return false;itemClipboard=JSON.parse(JSON.stringify(a));itemPasteSequence=0;updateItemClipboardButtons();toast(`${a.type==="measurement"?"Measurement":"Markup"} copied.`);return true;}
function pasteCopiedItem(){if(!itemClipboard||!state.pdf)return false;if(state.tool!=="select")setTool("select");const factor=state.scale*1.25,pageSize={width:els.shell.clientWidth/factor,height:els.shell.clientHeight/factor},sequence=itemPasteSequence%5+1,item=copyPageItem(itemClipboard,{id:crypto.randomUUID(),page:state.page,pageId:currentPageDescriptor()?.id,pageSize,offset:sequence*12});if(!item)return false;itemPasteSequence=sequence;if(item.type==="measurement"){Object.assign(item,measurementBounds(item.points));item.measurementScale=currentDrawingScale()||item.measurementScale;if(item.measureKind==="count")item.countValue=pageAnnotations().filter(annotation=>annotation.type==="measurement"&&annotation.measureKind==="count").length+1;}snapshot();state.annotations.push(item);markChanged();queueThumbnailRefresh(item.pageId);renderAnnotations();item.type==="measurement"?selectMeasurement(item.id):selectMarkup(item.id);toast(`${item.type==="measurement"?"Measurement":"Markup"} pasted.`);return true;}
$("copyItemButton").onclick=copySelectedItem;
$("pasteItemButton").onclick=pasteCopiedItem;
$("closeInspector").onclick=clearSelection;
$("textValue").oninput=e=>updateSelected({text:e.target.value}); $("fontSize").oninput=e=>{ $("fontSizeValue").value=`${e.target.value} pt`;updateSelected({fontSize:Number(e.target.value)}); };
$("borderWidth").oninput=e=>{$("borderWidthValue").value=`${e.target.value} pt`;updateSelected({borderWidth:Number(e.target.value)});};
$("fontFamily").onchange=e=>{ const a=state.annotations.find(x=>x.id===state.selectedId); if(!a)return; if(e.target.value==="original")updateSelected({fontChoice:"original",fontFamily:a.originalFontFamily||"Arial, Helvetica, sans-serif",fontWeight:a.originalFontWeight||"400",fontStyle:a.originalFontStyle||"normal"});else updateSelected({fontChoice:e.target.value,fontFamily:e.target.value,fontWeight:"400",fontStyle:"normal"}); };
function bindAlignment(id,property){ $(id).onclick=e=>{const button=e.target.closest("button");if(!button||button.disabled)return;$(id).querySelectorAll("button").forEach(b=>b.classList.toggle("selected",b===button));updateSelected({[property]:button.dataset.align});}; }
bindAlignment("horizontalAlign","textAlign");bindAlignment("verticalAlign","verticalAlign");
$("pageAlignment").onclick=e=>{const button=e.target.closest("button");if(!button)return;alignSelectedToPage(button.dataset.pageAlign);};
function alignSelectedToPage(mode){const a=state.annotations.find(x=>x.id===state.selectedId);if(!a)return;const factor=state.scale*1.25,pageSize={width:els.shell.clientWidth/factor,height:els.shell.clientHeight/factor},next=alignElementToPage(a,pageSize,mode),dx=next.x-a.x,dy=next.y-a.y;snapshot();a.x=next.x;a.y=next.y;if(a.type==="highlight"&&a.rects?.length)for(const rect of a.rects){rect.x+=dx;rect.y+=dy;}renderAnnotations();syncGeometryControls(a);markChanged();queueThumbnailRefresh(a.pageId);}
function updateSelected(patch){ const a=state.annotations.find(x=>x.id===state.selectedId); if(!a)return; Object.assign(a,patch);if(a.autoFit)fitAnnotationToText(a);renderAnnotations();syncGeometryControls(a);markChanged();queueThumbnailRefresh(a.pageId); }
function updateSelectedMeasurement(patch){const a=state.annotations.find(annotation=>annotation.id===state.selectedId&&annotation.type==="measurement");if(!a)return;Object.assign(a,patch);renderAnnotations();markChanged();queueThumbnailRefresh(a.pageId);}
$("measurementLineWidth").oninput=e=>{$("measurementLineWidthValue").value=`${e.target.value} pt`;updateSelectedMeasurement({lineWidth:Number(e.target.value)});};
for(const [inputId,outputId,presetId,property] of [["measurementLineColor","measurementLineColorValue","measurementLinePresets","lineColor"],["measurementLabelColor","measurementLabelColorValue","measurementLabelPresets","labelColor"],["measurementShadeColor","measurementShadeColorValue","measurementShadePresets","shadeColor"]]){$(inputId).oninput=e=>{$(outputId).value=e.target.value.toUpperCase();syncPresetSelection(presetId,e.target.value);updateSelectedMeasurement(property==="lineColor"?{lineColor:e.target.value,color:e.target.value}:{[property]:e.target.value});};}
$("measurementLineType").onchange=e=>updateSelectedMeasurement({lineType:e.target.value});
$("measurementShadeOpacity").oninput=e=>{$("measurementShadeOpacityValue").value=`${e.target.value}%`;updateSelectedMeasurement({shadeOpacity:Number(e.target.value)/100});};
$("measurementHatchPattern").onchange=e=>updateSelectedMeasurement({hatchPattern:e.target.value});
$("measurementAreaFill").onchange=e=>{const a=state.annotations.find(annotation=>annotation.id===state.selectedId&&annotation.type==="measurement");if(!a)return;updateSelectedMeasurement({areaFillEnabled:e.target.checked});syncMeasurementAreaControls(a);};
$("measurementShowPerimeter").onchange=e=>updateSelectedMeasurement({showPerimeterLength:e.target.checked});
function updateSelectedMarkup(patch){const a=state.annotations.find(item=>item.id===state.selectedId&&item.type==="markup");if(!a)return;Object.assign(a,patch);renderAnnotations();markChanged();queueThumbnailRefresh(a.pageId);}
$("markupSubject").oninput=e=>updateSelectedMarkup({subject:e.target.value});
$("markupStatus").onchange=e=>updateSelectedMarkup({status:e.target.value});
$("markupComment").oninput=e=>updateSelectedMarkup({comment:e.target.value});
$("markupLineWidth").oninput=e=>{$("markupLineWidthValue").value=`${e.target.value} pt`;updateSelectedMarkup({strokeWidth:Number(e.target.value)});};
$("markupLineColor").oninput=e=>{$("markupLineColorValue").value=e.target.value.toUpperCase();syncPresetSelection("markupLinePresets",e.target.value);updateSelectedMarkup({strokeColor:e.target.value});};
$("markupLineType").onchange=e=>updateSelectedMarkup({lineType:e.target.value});
$("markupStartArrow").onchange=e=>updateSelectedMarkup({startArrow:e.target.value});
$("markupEndArrow").onchange=e=>updateSelectedMarkup({endArrow:e.target.value});
$("markupFillColor").oninput=e=>{$("markupFillColorValue").value=e.target.value.toUpperCase();syncPresetSelection("markupFillPresets",e.target.value);updateSelectedMarkup({fillColor:e.target.value});};
$("markupFillOpacity").oninput=e=>{$("markupFillOpacityValue").value=`${e.target.value}%`;updateSelectedMarkup({fillOpacity:Number(e.target.value)/100});};
$("swatches").onclick=e=>{ const b=e.target.closest("button"); if(!b)return; $("swatches").querySelectorAll("button").forEach(x=>x.classList.toggle("selected",x===b));$("textColorCustom").value=b.dataset.color;updateSelected({color:b.dataset.color}); };
$("backgroundSwatches").onclick=e=>{ const b=e.target.closest("button"); if(!b||b.disabled)return; $("backgroundSwatches").querySelectorAll("button").forEach(x=>x.classList.toggle("selected",x===b));if(b.dataset.bg!=="transparent")$("backgroundColorCustom").value=b.dataset.bg;updateSelected({backgroundColor:b.dataset.bg}); };
$("borderSwatches").onclick=e=>{const b=e.target.closest("button");if(!b||b.disabled)return;$("borderSwatches").querySelectorAll("button").forEach(x=>x.classList.toggle("selected",x===b));$("borderColorCustom").value=b.dataset.borderColor;updateSelected({borderColor:b.dataset.borderColor});};
$("textColorCustom").oninput=e=>{$("swatches").querySelectorAll("button").forEach(button=>button.classList.remove("selected"));updateSelected({color:e.target.value});};
$("backgroundColorCustom").oninput=e=>{$("backgroundSwatches").querySelectorAll("button").forEach(button=>button.classList.remove("selected"));updateSelected({backgroundColor:e.target.value});};
$("borderColorCustom").oninput=e=>{$("borderSwatches").querySelectorAll("button").forEach(button=>button.classList.remove("selected"));updateSelected({borderColor:e.target.value});};
$("autoFitTextBox").onchange=e=>updateSelected({autoFit:e.target.checked});
document.querySelectorAll("[data-highlight-color]").forEach(b=>b.onclick=e=>{e.stopPropagation();setHighlightColor(b.dataset.highlightColor);});
function setHighlightColor(color){state.highlightColor=color;$("highlightToolCustom").value=color;$("highlightColorCustom").value=color;els.shell.style.setProperty("--active-highlight",hexToCssRgba(color,.55));document.querySelectorAll("[data-highlight-color]").forEach(b=>b.classList.toggle("selected",b.dataset.highlightColor===color));const a=state.annotations.find(x=>x.id===state.selectedId);if(a?.type==="highlight"){state.annotations.filter(x=>x.id===a.id||(a.groupId&&x.groupId===a.groupId)).forEach(x=>x.highlightColor=color);renderAnnotations();markChanged();queueThumbnailRefresh(a.pageId);}}
$("highlightToolCustom").oninput=e=>setHighlightColor(e.target.value);
$("highlightColorCustom").oninput=e=>setHighlightColor(e.target.value);
function bindPresetPicker(containerId,inputId){$(containerId).onclick=event=>{const button=event.target.closest("[data-preset]");if(!button)return;event.preventDefault();const input=$(inputId);if(input.disabled)return;input.value=button.dataset.preset;input.dispatchEvent(new Event("input",{bubbles:true}));};}
for(const pair of [["measurementLinePresets","measurementLineColor"],["measurementLabelPresets","measurementLabelColor"],["measurementShadePresets","measurementShadeColor"],["markupLinePresets","markupLineColor"],["markupFillPresets","markupFillColor"]])bindPresetPicker(...pair);
$("selectedVisibility").onchange=e=>{const a=state.annotations.find(item=>item.id===state.selectedId);if(!a)return;a.visible=e.target.checked;renderAnnotations();markChanged();queueThumbnailRefresh(a.pageId);};
for(const [id,property,min] of [["posX","x",0],["posY","y",0],["boxWidth","w",30],["boxHeight","h",12]]){$(id).onchange=e=>{const value=Math.max(min,Number(e.target.value)||min);updateSelected({[property]:value});};}
$("toggleSidebar").onclick=()=>$("sidebar").classList.toggle("open");
function currentMarkupsRows(){return markupListRows(state.annotations,state.pages,item=>item.type==="measurement"?measurementLabelLines(item).join(" / "):"");}
const markupsListState={sortKey:"page",sortDirection:"asc",groupKey:""};
function setItemVisibility(id,visible){const item=state.annotations.find(annotation=>annotation.id===id);if(!item)return;item.visible=visible;if(item.pageId===currentPageDescriptor()?.id)renderAnnotations();markChanged();queueThumbnailRefresh(item.pageId);}
function appendMarkupsListRow(body,row){const tr=document.createElement("tr");tr.dataset.id=row.id;tr.classList.toggle("selected",isSelected(row.id));tr.classList.toggle("item-hidden",!row.visible);const visibilityCell=document.createElement("td"),visibility=document.createElement("input");visibility.type="checkbox";visibility.checked=row.visible;visibility.setAttribute("aria-label",`${row.visible?"Hide":"Show"} ${row.subject}`);visibility.onclick=event=>event.stopPropagation();visibility.onchange=event=>{event.stopPropagation();setItemVisibility(row.id,visibility.checked);};visibilityCell.className="visibility-column";visibilityCell.append(visibility);tr.append(visibilityCell);for(const value of [row.page,row.type,row.subject,row.value]){const td=document.createElement("td");td.textContent=String(value);tr.append(td);}const statusCell=document.createElement("td"),status=document.createElement("select");for(const value of ["None","Accepted","Rejected","Completed","Cancelled"]){const option=document.createElement("option");option.value=option.textContent=value;option.selected=value===row.status;status.append(option);}status.onclick=event=>event.stopPropagation();status.onchange=event=>{event.stopPropagation();const item=state.annotations.find(annotation=>annotation.id===row.id);if(item){item.status=status.value;markChanged();}};statusCell.append(status);tr.append(statusCell);const commentCell=document.createElement("td"),comment=document.createElement("input");comment.type="text";comment.value=row.comment;comment.setAttribute("aria-label",`Comment for ${row.subject}`);comment.onclick=event=>event.stopPropagation();comment.onchange=event=>{event.stopPropagation();const item=state.annotations.find(annotation=>annotation.id===row.id);if(item){item.comment=comment.value;markChanged();}};commentCell.append(comment);tr.append(commentCell);tr.onclick=async()=>{if(state.page!==row.page){state.page=row.page;await renderPage();}const item=state.annotations.find(annotation=>annotation.id===row.id);if(item?.type==="measurement")selectMeasurement(row.id);else if(item?.type==="markup")selectMarkup(row.id);else selectAnnotation(row.id);};body.append(tr);}
function renderMarkupsList(){const body=$("markupsTableBody");if(!body||$("markupsPanel")?.hidden)return;const allRows=currentMarkupsRows(),query=($("markupsFilter")?.value||"").trim().toLowerCase(),rows=allRows.filter(row=>!query||`${row.page} ${row.type} ${row.subject} ${row.value} ${row.status} ${row.comment}`.toLowerCase().includes(query)),allVisibility=$("markupsVisibilityAll");allVisibility.disabled=!allRows.length;allVisibility.checked=Boolean(allRows.length)&&allRows.every(row=>row.visible);allVisibility.indeterminate=allRows.some(row=>row.visible)&&allRows.some(row=>!row.visible);body.innerHTML="";$("markupsTableHead").querySelectorAll("button[data-sort-key]").forEach(button=>{const active=button.dataset.sortKey===markupsListState.sortKey;button.toggleAttribute("data-sort-direction",active);if(active)button.dataset.sortDirection=markupsListState.sortDirection;else delete button.dataset.sortDirection;button.closest("th").setAttribute("aria-sort",active?(markupsListState.sortDirection==="asc"?"ascending":"descending"):"none");});let groups;if(markupsListState.groupKey){const groupDirection=markupsListState.sortKey===markupsListState.groupKey&&markupsListState.sortDirection==="desc"?-1:1;groups=groupMarkupRows(rows,markupsListState.groupKey).sort((a,b)=>String(a.value).localeCompare(String(b.value),undefined,{numeric:true,sensitivity:"base"})*groupDirection);for(const group of groups)group.rows=sortMarkupRows(group.rows,markupsListState.sortKey,markupsListState.sortDirection);}else groups=groupMarkupRows(sortMarkupRows(rows,markupsListState.sortKey,markupsListState.sortDirection));for(const group of groups){if(markupsListState.groupKey){const groupRow=document.createElement("tr"),cell=document.createElement("td");groupRow.className="markup-group-row";cell.colSpan=7;cell.textContent=`${$("markupsGroupBy").selectedOptions[0].text}: ${group.value} (${group.rows.length})`;groupRow.append(cell);body.append(groupRow);}for(const row of group.rows)appendMarkupsListRow(body,row);}$("markupsEmpty").hidden=Boolean(rows.length);}
function setMarkupsListOpen(open){const panel=$("markupsPanel"),editor=panel.closest(".editor");panel.hidden=!open;editor.classList.toggle("markups-open",open);$("markupsListButton").setAttribute("aria-pressed",String(open));$("markupsListButton").title=open?"Hide Markups List":"Show Markups List";if(open)renderMarkupsList();}
$("markupsListButton").onclick=()=>setMarkupsListOpen($("markupsPanel").hidden);
$("closeMarkupsList").onclick=()=>setMarkupsListOpen(false);
$("markupsFilter").oninput=renderMarkupsList;
$("markupsVisibilityAll").onchange=event=>{const rows=currentMarkupsRows();for(const row of rows){const item=state.annotations.find(annotation=>annotation.id===row.id);if(item)item.visible=event.target.checked;}renderAnnotations();markChanged();for(const descriptor of state.pages)queueThumbnailRefresh(descriptor.id);toast(event.target.checked?"All items are visible.":"All items are hidden.");};
$("markupsGroupBy").onchange=event=>{markupsListState.groupKey=event.target.value;renderMarkupsList();};
$("markupsTableHead").onclick=event=>{const button=event.target.closest("button[data-sort-key]");if(!button)return;const key=button.dataset.sortKey;if(markupsListState.sortKey===key)markupsListState.sortDirection=markupsListState.sortDirection==="asc"?"desc":"asc";else{markupsListState.sortKey=key;markupsListState.sortDirection="asc";}renderMarkupsList();};
$("exportMarkupsCsv").onclick=()=>{const rows=currentMarkupsRows(),blob=new Blob([rowsToCsv(rows)],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${$("fileName").textContent.replace(/\.pdf$/i,"")}-markups.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("Markups and measurements saved as CSV.");};
const panelSizeLimits={sidebar:{min:160,max:420},inspector:{min:210,max:460},markups:{min:120,max:520}};
function setPanelSize(kind,value,persist=false){const limits=panelSizeLimits[kind],workspace=document.querySelector(".workspace"),editor=document.querySelector(".editor"),otherWidth=kind==="sidebar"?$("inspector").getBoundingClientRect().width:$("sidebar").getBoundingClientRect().width,dynamicMax=kind==="markups"?Math.max(limits.min,Math.min(limits.max,editor.clientHeight-274)):Math.max(limits.min,Math.min(limits.max,workspace.clientWidth-otherWidth-360)),size=Math.round(Math.max(limits.min,Math.min(dynamicMax,value)));if(kind==="sidebar")workspace.style.setProperty("--sidebar-width",`${size}px`);else if(kind==="inspector")workspace.style.setProperty("--inspector-width",`${size}px`);else editor.style.setProperty("--markups-height",`${size}px`);if(persist)try{localStorage.setItem(`bluebeam-killer-${kind}-size`,String(size));}catch{}return size;}
function bindPanelResizer(id,kind){const handle=$(id),panel=kind==="sidebar"?$("sidebar"):kind==="inspector"?$("inspector"):$("markupsPanel");let resize=null;handle.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();resize={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startSize:kind==="markups"?panel.getBoundingClientRect().height:panel.getBoundingClientRect().width};handle.classList.add("resizing");handle.setPointerCapture(event.pointerId);});handle.addEventListener("pointermove",event=>{if(!resize||event.pointerId!==resize.pointerId)return;const delta=kind==="sidebar"?event.clientX-resize.startX:kind==="inspector"?resize.startX-event.clientX:resize.startY-event.clientY;setPanelSize(kind,resize.startSize+delta);});const finish=event=>{if(!resize||event.pointerId!==resize.pointerId)return;const size=kind==="markups"?panel.getBoundingClientRect().height:panel.getBoundingClientRect().width;resize=null;handle.classList.remove("resizing");setPanelSize(kind,size,true);};handle.addEventListener("pointerup",finish);handle.addEventListener("pointercancel",finish);handle.addEventListener("keydown",event=>{const decrease=event.key==="ArrowLeft"||event.key==="ArrowDown",increase=event.key==="ArrowRight"||event.key==="ArrowUp";if(!decrease&&!increase)return;event.preventDefault();const current=kind==="markups"?panel.getBoundingClientRect().height:panel.getBoundingClientRect().width,direction=kind==="inspector"?-1:1;setPanelSize(kind,current+(increase?10:-10)*direction,true);});}
for(const [id,kind] of [["sidebarResizer","sidebar"],["inspectorResizer","inspector"],["markupsPanelResizer","markups"]]){bindPanelResizer(id,kind);try{const saved=Number(localStorage.getItem(`bluebeam-killer-${kind}-size`));if(saved)setPanelSize(kind,saved);}catch{}}
function openShortcutDialog(){if(!$("shortcutDialog").open)$("shortcutDialog").showModal();}
$("keyboardShortcutsButton").onclick=openShortcutDialog;
$("closeShortcutDialog").onclick=()=>$("shortcutDialog").close();
$("shortcutDialog").onclick=e=>{if(e.target===$("shortcutDialog"))$("shortcutDialog").close();};
function updateLayoutButtons(){$("pageLayoutControls").querySelectorAll("[data-layout-mode]").forEach(button=>{const active=button.dataset.layoutMode===state.layoutMode;button.classList.toggle("selected",active);button.setAttribute("aria-pressed",String(active));});}
function setLayoutMode(mode){if(!["single","continuous","side","continuous-side"].includes(mode))return;clearSelection();state.layoutMode=mode;updateLayoutButtons();if(state.pdf)renderPage();}
async function applyFitMode(mode){if(!state.pdf)return;const size=await getDescriptorPageSize(currentPageDescriptor()),area=$("canvasArea");state.scale=calculateFitScale(size,{width:area.clientWidth,height:area.clientHeight},state.layoutMode,mode);await renderPage();}
$("pageLayoutControls").onclick=e=>{const button=e.target.closest("[data-view-command]");if(!button)return;runShortcut(button.dataset.viewCommand);};
function runShortcut(command){
  if(command==="select"||command==="highlight"||command==="insert"||command==="edit"){setTool(command);return;}
  if(command.startsWith("markup-")){setTool(command);return;}
  if(command.startsWith("measure-")){selectMeasurementTool(command.slice(8));return;}
  if(command==="open"){$("fileInput").click();return;}
  if(command==="export"){$("exportButton").click();return;}
  if(command==="undo"){$("undoButton").click();return;}
  if(command==="redo"){$("redoButton").click();return;}
  if(command==="delete"){if(!deleteSelectedControlPoint())$("deleteButton").click();return;}
  if(command==="previous-page"){goPage(state.page-1);return;}
  if(command==="next-page"){goPage(state.page+1);return;}
  if(command==="first-page"){goPage(1);return;}
  if(command==="last-page"){goPage(state.pages.length);return;}
  if(command==="zoom-in"){$("zoomIn").click();return;}
  if(command==="zoom-out"){$("zoomOut").click();return;}
  if(command==="fit-page"){applyFitMode("page");return;}
  if(command==="fit-width"){applyFitMode("width");return;}
  if(command==="actual-size"){applyFitMode("actual");return;}
  if(command==="layout-single"){setLayoutMode("single");return;}
  if(command==="layout-continuous"){setLayoutMode("continuous");return;}
  if(command==="layout-side"){setLayoutMode("side");return;}
  if(command==="layout-continuous-side"){setLayoutMode("continuous-side");return;}
  if(command==="insert-page"){if(state.pdf)insertBlankPage();return;}
  if(command==="delete-page"){if(state.pdf)deletePage(state.page-1);return;}
  if(command==="show-shortcuts"){openShortcutDialog();return;}
  const alignment=command.startsWith("align-")?command.slice(6):null;if(alignment)alignSelectedToPage(alignment);
}
document.addEventListener("keydown",e=>{
  if(e.code==="Space"&&!spacePanBlocked(e.target)&&state.pdf){e.preventDefault();if(!e.repeat)setSpacePan(true);return;}
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==="z"&&(undoMeasurementDraftPoint()||undoMarkupDraftPoint())){e.preventDefault();return;}
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&!spacePanBlocked(e.target)&&e.key.toLowerCase()==="a"&&state.pdf){e.preventDefault();selectAllPageDrawingItems();return;}
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&!spacePanBlocked(e.target)&&e.key.toLowerCase()==="c"&&state.annotations.some(item=>item.id===state.selectedId&&(item.type==="markup"||item.type==="measurement"&&item.measureKind!=="calibration"))){e.preventDefault();copySelectedItem();return;}
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&!spacePanBlocked(e.target)&&e.key.toLowerCase()==="v"&&itemClipboard){e.preventDefault();pasteCopiedItem();return;}
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&["+","=","-"].includes(e.key)){e.preventDefault();changeDocumentZoom(e.key==="-"?-.1:.1);return;}
  if(e.key==="Enter"&&measurementDraft&&["polyline","area","perimeter"].includes(measurementDraft.kind)&&!e.target.matches("input,textarea,select")){e.preventDefault();finishMeasurementDraft();return;}
  if(e.key==="Enter"&&markupDraft?.kind==="polygon"&&!e.target.matches("input,textarea,select")){e.preventDefault();finishMarkupDraft();return;}
  if(e.key==="Escape"){
    if($("shortcutDialog").open){e.preventDefault();$("shortcutDialog").close();return;}
    window.getSelection()?.removeAllRanges();highlightStart=null;drag=null;$("draft")?.remove();setTool("select");toast("Edit saved. Tool off.");return;
  }
  const command=shortcutCommand(e);if(!command)return;
  const inTextField=e.target.matches("input,textarea,[contenteditable='true']"),allowedInTextField=command==="open"||command==="export"||command==="show-shortcuts"||command.startsWith("align-");
  if(inTextField&&!allowedInTextField)return;e.preventDefault();runShortcut(command);
});
document.addEventListener("keyup",e=>{if(e.code==="Space"&&(panState.spaceHeld||panState.dragging)){e.preventDefault();setSpacePan(false);}});

$("exportButton").onclick=()=>{if(!state.bytes){toast("Open a PDF first.");return;}$("exportDialog").showModal();};
$("cancelExport").onclick=()=>$("exportDialog").close();
$("exportDialog").onclick=event=>{if(event.target===$("exportDialog"))$("exportDialog").close();};
$("exportChoices").onclick=async event=>{const button=event.target.closest("[data-export-mode]");if(!button)return;const mode=button.dataset.exportMode;$("exportDialog").close();try{const suffix=mode==="editable"?"-editable.pdf":"-edited.pdf",fileName=$("fileName").textContent.replace(/\.pdf$/i,suffix),saveHandle=await chooseSaveLocation(fileName);if(saveHandle===null){toast("Export canceled.");return;}toast(mode==="editable"?"Preparing editable PDF annotations...":"Preparing secure flattened export...");const output=await buildExportPdf(mode);await savePdfLocally(output,fileName,saveHandle);toast(mode==="editable"?"Editable PDF saved.":"Flattened PDF saved.");}catch(err){console.error(err);toast("The PDF could not be exported.");}};
async function buildExportPdf(mode="flattened"){
  const source=await PDFLib.PDFDocument.load(state.bytes.slice()),doc=await PDFLib.PDFDocument.create();
  const vectorAnnotations=state.annotations.filter(isAnnotationVisible);
  for(const {page:descriptor,pageNumber,flattenSource} of getExportPlan(state.pages,vectorAnnotations)){
    if(descriptor.blank){
      doc.addPage([descriptor.width,descriptor.height]);
    }else if(flattenSource){
      const rendered=await renderSecurePage(pageNumber),image=await doc.embedPng(rendered.png);
      const page=doc.addPage([rendered.width,rendered.height]);page.drawImage(image,{x:0,y:0,width:rendered.width,height:rendered.height});
    }else{
      const [page]=await doc.copyPages(source,[descriptor.sourceIndex-1]);doc.addPage(page);
    }
  }
  const fontKeys=[...new Set(vectorAnnotations.filter(a=>a.type!=="highlight"&&!a.deleted).map(standardFontKey))],fonts={};
  for(const key of fontKeys)fonts[key]=await doc.embedFont(PDFLib.StandardFonts[key]);
  for(const a of vectorAnnotations){const page=doc.getPage(a.page-1),label=a.type==="measurement"?measurementLabelLines(a).join(" / "):"";if(mode==="editable"&&addPdfLibAnnotation(PDFLib,page,a,label))continue;drawVectorAnnotation(page,a,fonts);}
  return doc.save();
}
async function renderSecurePage(pageNumber){
  const descriptor=state.pages[pageNumber-1],pdfPage=await state.pdf.getPage(descriptor.sourceIndex),scale=2,viewport=pdfPage.getViewport({scale}),canvas=document.createElement("canvas");
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext("2d");await pdfPage.render({canvasContext:ctx,viewport}).promise;
  const annotations=state.annotations.filter(a=>a.page===pageNumber&&isAnnotationVisible(a));
  for(const a of annotations.filter(a=>a.type==="replacement"))restoreBackgroundPixels(ctx,a,scale,canvas.width,canvas.height);
  return{png:canvas.toDataURL("image/png"),width:viewport.width/scale,height:viewport.height/scale};
}
function restoreBackgroundPixels(ctx,a,scale,canvasWidth,canvasHeight){
  const pad=Math.max(2,Math.round(scale)),gap=Math.max(3,Math.round(scale*2)),band=Math.max(3,Math.round(scale*2));
  const sourceX=a.sourceX??a.x,sourceY=a.sourceY??a.y,sourceW=a.sourceW??a.w,sourceH=a.sourceH??a.h;
  const x0=Math.max(0,Math.floor(sourceX*scale)-pad),y0=Math.max(0,Math.floor(sourceY*scale)-pad),x1=Math.min(canvasWidth,Math.ceil((sourceX+sourceW)*scale)+pad),y1=Math.min(canvasHeight,Math.ceil((sourceY+sourceH)*scale)+pad);
  if(x1<=x0||y1<=y0)return;
  const image=ctx.getImageData(0,0,canvasWidth,canvasHeight),data=image.data,original=new Uint8ClampedArray(data);
  for(let y=y0;y<y1;y++){
    const left=averageRowPixels(original,canvasWidth,y,Math.max(0,x0-gap-band),Math.max(0,x0-gap));
    const right=averageRowPixels(original,canvasWidth,y,Math.min(canvasWidth,x1+gap),Math.min(canvasWidth,x1+gap+band));
    const start=left||right||[255,255,255,255],end=right||left||start,span=Math.max(1,x1-x0-1);
    for(let x=x0;x<x1;x++){const t=(x-x0)/span,index=(y*canvasWidth+x)*4;for(let channel=0;channel<4;channel++)data[index+channel]=Math.round(start[channel]*(1-t)+end[channel]*t);}
  }
  ctx.putImageData(image,0,0);
}
function averageRowPixels(data,width,y,start,end){if(end<=start)return null;const total=[0,0,0,0];let count=0;for(let x=start;x<end;x++){const index=(y*width+x)*4;for(let channel=0;channel<4;channel++)total[channel]+=data[index+channel];count++;}return count?total.map(value=>value/count):null;}
function traceMeasurementPath(ctx,points,closed=false){ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))ctx.lineTo(point.x,point.y);if(closed)ctx.closePath();}
function drawCanvasMeasurement(ctx,a,scale){
  const points=(a.points||[]).map(point=>({x:point.x*scale,y:point.y*scale}));if(!points.length)return;const lineColor=a.lineColor||a.color||"#d04a3a",labelColor=a.labelColor||lineColor,lineWidth=a.lineWidth||1.6;ctx.save();ctx.strokeStyle=lineColor;ctx.fillStyle=lineColor;ctx.lineWidth=Math.max(.5,lineWidth*scale);ctx.setLineDash(measurementLineDash(a.lineType||"solid",scale));ctx.lineJoin="round";ctx.lineCap="round";
  if(a.measureKind==="diameter"&&points.length>1){const center={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},radius=pointDistance(points[0],points[1])/2;if(a.areaFillEnabled!==false){ctx.save();ctx.globalAlpha=a.shadeOpacity??.13;ctx.fillStyle=a.shadeColor||lineColor;ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.fill();ctx.restore();const boundary=measurementFillBoundary("diameter",points),hatches=measurementHatchSegments(boundary,a.hatchPattern||"none",8*scale);if(hatches.length){ctx.save();ctx.strokeStyle=a.shadeColor||lineColor;ctx.lineWidth=Math.max(.5,.8*scale);ctx.setLineDash([]);for(const [first,last] of hatches){ctx.beginPath();ctx.moveTo(first.x,first.y);ctx.lineTo(last.x,last.y);ctx.stroke();}ctx.restore();}}ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.moveTo(points[0].x,points[0].y);ctx.lineTo(points[1].x,points[1].y);ctx.stroke();}
  else if(a.measureKind==="count"){ctx.beginPath();ctx.arc(points[0].x,points[0].y,Math.max(3,9*scale),0,Math.PI*2);ctx.stroke();}
  else if(points.length>1){const closed=a.measureKind==="area"||a.measureKind==="perimeter";traceMeasurementPath(ctx,points,closed);if(a.measureKind==="area"&&a.areaFillEnabled!==false){ctx.save();ctx.globalAlpha=a.shadeOpacity??.13;ctx.fillStyle=a.shadeColor||lineColor;ctx.fill();ctx.restore();const hatches=measurementHatchSegments(points,a.hatchPattern||"none",8*scale);if(hatches.length){ctx.save();ctx.strokeStyle=a.shadeColor||lineColor;ctx.lineWidth=Math.max(.5,.8*scale);ctx.setLineDash([]);for(const [first,last] of hatches){ctx.beginPath();ctx.moveTo(first.x,first.y);ctx.lineTo(last.x,last.y);ctx.stroke();}ctx.restore();traceMeasurementPath(ctx,points,true);}}ctx.stroke();}
  const labelPoint=measurementLabelPoint(a,points),labelSize=Math.max(5,10*scale);ctx.font=`700 ${labelSize}px Arial, sans-serif`;ctx.fillStyle=labelColor;measurementLabelLines(a).forEach((line,index)=>ctx.fillText(line,labelPoint.x+4,labelPoint.y-4+index*labelSize*1.25));ctx.restore();
}
function drawCanvasArrowhead(ctx,tip,adjacent,style,stroke,size){if(!style||style==="none")return;const geometry=arrowheadGeometry(tip,adjacent,size),back={x:geometry.left.x+geometry.right.x-tip.x,y:geometry.left.y+geometry.right.y-tip.y};ctx.save();ctx.setLineDash([]);ctx.strokeStyle=stroke;ctx.fillStyle=style==="filled"?stroke:"#fff";ctx.beginPath();if(style==="circle")ctx.arc(geometry.center.x,geometry.center.y,size*.28,0,Math.PI*2);else if(style==="square")ctx.rect(geometry.center.x-size*.28,geometry.center.y-size*.28,size*.56,size*.56);else{ctx.moveTo(geometry.left.x,geometry.left.y);ctx.lineTo(tip.x,tip.y);ctx.lineTo(geometry.right.x,geometry.right.y);if(style==="diamond")ctx.lineTo(back.x,back.y);if(style!=="open")ctx.closePath();}if(style!=="open")ctx.fill();ctx.stroke();ctx.restore();}
function drawCanvasMarkup(ctx,a,scale){const points=(a.points||[]).map(point=>({x:point.x*scale,y:point.y*scale}));if(points.length<2)return;const kind=a.markupKind,stroke=a.strokeColor||"#d04a3a",width=a.strokeWidth||2,fill=a.fillColor||"#fff2a8",opacity=a.fillOpacity??0,bounds=markupBounds(a.points),scaledBounds={x:bounds.x*scale,y:bounds.y*scale,w:bounds.w*scale,h:bounds.h*scale};ctx.save();ctx.strokeStyle=stroke;ctx.fillStyle=fill;ctx.lineWidth=Math.max(.5,width*scale);ctx.setLineDash(measurementLineDash(a.lineType||"solid",scale));ctx.lineJoin="round";ctx.lineCap="round";let path=null;ctx.beginPath();if(kind==="ellipse")ctx.ellipse((bounds.x+bounds.w/2)*scale,(bounds.y+bounds.h/2)*scale,bounds.w*scale/2,bounds.h*scale/2,0,0,Math.PI*2);else if(kind==="cloud")path=new Path2D(cloudPath(scaledBounds));else if(kind==="rectangle")ctx.rect(scaledBounds.x,scaledBounds.y,scaledBounds.w,scaledBounds.h);else{ctx.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))ctx.lineTo(point.x,point.y);if(kind==="polygon")ctx.closePath();}if(!["line","arrow","freehand"].includes(kind)&&opacity>0){ctx.save();ctx.globalAlpha=opacity;path?ctx.fill(path):ctx.fill();ctx.restore();}path?ctx.stroke(path):ctx.stroke();if(kind==="arrow"){const size=(10+width*2)*scale;drawCanvasArrowhead(ctx,points[0],points[1],a.startArrow||"none",stroke,size);drawCanvasArrowhead(ctx,points.at(-1),points.at(-2),a.endArrow||"filled",stroke,size);}ctx.restore();}
function drawCanvasAnnotation(ctx,a,scale){
  if(a.deleted)return;
  if(a.type==="measurement"){drawCanvasMeasurement(ctx,a,scale);return;}
  if(a.type==="markup"){drawCanvasMarkup(ctx,a,scale);return;}
  const x=a.x*scale,y=a.y*scale,w=a.w*scale,h=a.h*scale;
  if(a.type==="highlight"){ctx.save();ctx.globalAlpha=.38;ctx.fillStyle=a.highlightColor||"#ffd84d";for(const rect of a.rects?.length?a.rects:[a])ctx.fillRect(rect.x*scale,rect.y*scale,rect.w*scale,rect.h*scale);ctx.restore();return;}
  ctx.save();
  if(a.backgroundColor&&a.backgroundColor!=="transparent"){ctx.fillStyle=a.backgroundColor;ctx.fillRect(x,y,w,h);}
  if((a.borderWidth||0)>0){ctx.strokeStyle=a.borderColor||"#15191f";ctx.lineWidth=a.borderWidth*scale;ctx.strokeRect(x,y,w,h);}
  ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
  const size=(a.fontSize||16)*scale,lineHeight=size*1.2;ctx.font=`${a.fontStyle||"normal"} ${a.fontWeight||"400"} ${size}px ${a.fontFamily||"Arial, sans-serif"}`;ctx.textBaseline="top";ctx.fillStyle=a.color||"#15191f";
  const lines=wrapTextForCanvas(a.text||"",ctx,Math.max(w,10)),contentHeight=lines.length*lineHeight,verticalFactor=a.verticalAlign==="middle"?.5:a.verticalAlign==="bottom"?1:0,firstY=y+Math.max(0,h-contentHeight)*verticalFactor,horizontalFactor=a.textAlign==="center"?.5:a.textAlign==="right"?1:0;
  lines.forEach((line,index)=>{const lineX=x+Math.max(0,w-ctx.measureText(line).width)*horizontalFactor;ctx.fillText(line,lineX,firstY+index*lineHeight);});ctx.restore();
}
function wrapTextForCanvas(text,ctx,maxWidth){const lines=[];for(const paragraph of text.split(/\r?\n/)){if(!paragraph){lines.push("");continue;}let line="";for(const word of paragraph.split(/\s+/)){const candidate=line?`${line} ${word}`:word;if(!line||ctx.measureText(candidate).width<=maxWidth)line=candidate;else{lines.push(line);line=word;}}if(line)lines.push(line);}return lines.length?lines:[""];}
function drawVectorMeasurement(page,a,font){
  const{height}=page.getSize(),points=a.points||[];if(!points.length)return;const lineValue=hexToRgb(a.lineColor||a.color||"#d04a3a"),labelValue=hexToRgb(a.labelColor||a.lineColor||a.color||"#b33427"),shadeValue=hexToRgb(a.shadeColor||a.lineColor||a.color||"#d04a3a"),color=PDFLib.rgb(lineValue.r,lineValue.g,lineValue.b),labelColor=PDFLib.rgb(labelValue.r,labelValue.g,labelValue.b),shadeColor=PDFLib.rgb(shadeValue.r,shadeValue.g,shadeValue.b),dashArray=measurementLineDash(a.lineType||"solid"),line={color,thickness:a.lineWidth||1.6,opacity:1,dashArray};
  const drawSegment=(first,last)=>page.drawLine({start:{x:first.x,y:height-first.y},end:{x:last.x,y:height-last.y},...line});
  if(a.measureKind==="diameter"&&points.length>1){const center={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},radius=pointDistance(points[0],points[1])/2;if(a.areaFillEnabled!==false){page.drawCircle({x:center.x,y:height-center.y,size:radius,color:shadeColor,opacity:a.shadeOpacity??.13});const boundary=measurementFillBoundary("diameter",points);for(const [first,last] of measurementHatchSegments(boundary,a.hatchPattern||"none",8))page.drawLine({start:{x:first.x,y:height-first.y},end:{x:last.x,y:height-last.y},color:shadeColor,thickness:.8});}page.drawCircle({x:center.x,y:height-center.y,size:radius,borderColor:color,borderWidth:a.lineWidth||1.6,borderDashArray:dashArray});drawSegment(points[0],points[1]);}
  else if(a.measureKind==="count"){page.drawCircle({x:points[0].x,y:height-points[0].y,size:9,borderColor:color,borderWidth:a.lineWidth||1.6,borderDashArray:dashArray});}
  else{if(a.measureKind==="area"&&a.areaFillEnabled!==false&&points.length>2){const path=points.map((point,index)=>`${index?"L":"M"} ${point.x} ${height-point.y}`).join(" ")+" Z";page.drawSvgPath(path,{color:shadeColor,opacity:a.shadeOpacity??.13});for(const [first,last] of measurementHatchSegments(points,a.hatchPattern||"none",8))page.drawLine({start:{x:first.x,y:height-first.y},end:{x:last.x,y:height-last.y},color:shadeColor,thickness:.8});}for(let index=1;index<points.length;index++)drawSegment(points[index-1],points[index]);if((a.measureKind==="area"||a.measureKind==="perimeter")&&points.length>2)drawSegment(points.at(-1),points[0]);}
  for(const point of points)page.drawCircle({x:point.x,y:height-point.y,size:2.2,color});
  const labelPoint=measurementLabelPoint(a,points);measurementLabelLines(a).forEach((label,index)=>page.drawText(label,{x:labelPoint.x+4,y:height-labelPoint.y+4-index*10,size:8,font,color:labelColor}));
}
function drawVectorArrowhead(page,tip,adjacent,style,stroke,width){if(!style||style==="none")return;const size=10+width*2,geometry=arrowheadGeometry(tip,adjacent,size),white=PDFLib.rgb(1,1,1),back={x:geometry.left.x+geometry.right.x-tip.x,y:geometry.left.y+geometry.right.y-tip.y},line=point=>({x:point.x,y:point.y});if(style==="open"){page.drawLine({start:line(geometry.left),end:line(tip),color:stroke,thickness:width});page.drawLine({start:line(tip),end:line(geometry.right),color:stroke,thickness:width});return;}if(style==="circle"){page.drawCircle({x:geometry.center.x,y:geometry.center.y,size:size*.28,color:white,borderColor:stroke,borderWidth:width});return;}if(style==="square"){page.drawRectangle({x:geometry.center.x-size*.28,y:geometry.center.y-size*.28,width:size*.56,height:size*.56,color:white,borderColor:stroke,borderWidth:width});return;}const polygon=style==="diamond"?[tip,geometry.left,back,geometry.right]:[tip,geometry.left,geometry.right],path=polygon.map((point,index)=>`${index?"L":"M"} ${point.x} ${point.y}`).join(" ")+" Z";page.drawSvgPath(path,{color:style==="filled"?stroke:white,borderColor:stroke,borderWidth:width});}
function drawVectorMarkup(page,a){const points=a.points||[];if(points.length<2)return;const{height}=page.getSize(),pdfPoints=points.map(point=>({x:point.x,y:height-point.y})),kind=a.markupKind,bounds=markupBounds(points),pdfBounds={x:bounds.x,y:height-bounds.y-bounds.h,w:bounds.w,h:bounds.h},strokeValue=hexToRgb(a.strokeColor||"#d04a3a"),fillValue=hexToRgb(a.fillColor||"#fff2a8"),stroke=PDFLib.rgb(strokeValue.r,strokeValue.g,strokeValue.b),fill=PDFLib.rgb(fillValue.r,fillValue.g,fillValue.b),width=a.strokeWidth||2,line={color:stroke,thickness:width,dashArray:measurementLineDash(a.lineType||"solid")},drawSegment=(first,last)=>page.drawLine({start:first,end:last,...line});if(kind==="ellipse")page.drawEllipse({x:bounds.x+bounds.w/2,y:height-bounds.y-bounds.h/2,xScale:bounds.w/2,yScale:bounds.h/2,color:fill,opacity:a.fillOpacity??0,borderColor:stroke,borderWidth:width,borderDashArray:line.dashArray});else if(kind==="cloud")page.drawSvgPath(cloudPath(pdfBounds,"pdf"),{color:fill,opacity:a.fillOpacity??0,borderColor:stroke,borderWidth:width});else if(kind==="rectangle")page.drawRectangle({x:pdfBounds.x,y:pdfBounds.y,width:pdfBounds.w,height:pdfBounds.h,color:fill,opacity:a.fillOpacity??0,borderColor:stroke,borderWidth:width,borderDashArray:line.dashArray});else{if(kind==="polygon"){const path=pdfPoints.map((point,index)=>`${index?"L":"M"} ${point.x} ${point.y}`).join(" ")+" Z";page.drawSvgPath(path,{color:fill,opacity:a.fillOpacity??0,borderColor:stroke,borderWidth:width});}for(let index=1;index<pdfPoints.length;index++)drawSegment(pdfPoints[index-1],pdfPoints[index]);if(kind==="polygon")drawSegment(pdfPoints.at(-1),pdfPoints[0]);if(kind==="arrow"){drawVectorArrowhead(page,pdfPoints[0],pdfPoints[1],a.startArrow||"none",stroke,width);drawVectorArrowhead(page,pdfPoints.at(-1),pdfPoints.at(-2),a.endArrow||"filled",stroke,width);}}}
function drawVectorAnnotation(page,a,fonts){
  if(a.deleted||!isAnnotationVisible(a))return;
  if(a.type==="measurement"){drawVectorMeasurement(page,a,fonts[standardFontKey(a)]);return;}
  if(a.type==="markup"){drawVectorMarkup(page,a);return;}
  const{height}=page.getSize(),x=a.x,y=height-a.y-a.h,w=a.w,h=a.h;
  if(a.type==="highlight"){const c=hexToRgb(a.highlightColor||"#ffd84d");for(const rect of a.rects?.length?a.rects:[a])page.drawRectangle({x:rect.x,y:height-rect.y-rect.h,width:rect.w,height:rect.h,color:PDFLib.rgb(c.r,c.g,c.b),opacity:.38});return;}
  if(a.backgroundColor&&a.backgroundColor!=="transparent"){const bg=hexToRgb(a.backgroundColor);page.drawRectangle({x,y,width:w,height:h,color:PDFLib.rgb(bg.r,bg.g,bg.b)});}
  if((a.borderWidth||0)>0){const border=hexToRgb(a.borderColor||"#15191f");page.drawRectangle({x,y,width:w,height:h,borderColor:PDFLib.rgb(border.r,border.g,border.b),borderWidth:a.borderWidth});}
  const c=hexToRgb(a.color),font=fonts[standardFontKey(a)],size=a.fontSize||16,lineHeight=size*1.2,lines=wrapTextForPdf(a.text||"",font,size,Math.max(w,10)),contentHeight=lines.length*lineHeight,verticalFactor=a.verticalAlign==="middle"?.5:a.verticalAlign==="bottom"?1:0,firstY=height-a.y-size-Math.max(0,h-contentHeight)*verticalFactor,horizontalFactor=a.textAlign==="center"?.5:a.textAlign==="right"?1:0;
  lines.forEach((line,index)=>{const lineWidth=font.widthOfTextAtSize(line,size),lineX=x+Math.max(0,w-lineWidth)*horizontalFactor;page.drawText(line,{x:lineX,y:firstY-index*lineHeight,size,font,color:PDFLib.rgb(c.r,c.g,c.b)});});
}
async function chooseSaveLocation(fileName){if(typeof window.showSaveFilePicker!=="function")return undefined;try{return await window.showSaveFilePicker({suggestedName:fileName,types:[{description:"PDF document",accept:{"application/pdf":[".pdf"]}}]});}catch(err){if(err.name==="AbortError")return null;throw err;}}
async function savePdfLocally(output,fileName,saveHandle){const blob=new Blob([output],{type:"application/pdf"});if(saveHandle){const writable=await saveHandle.createWritable();await writable.write(blob);await writable.close();return;}const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function wrapTextForPdf(text,font,size,maxWidth){ const lines=[]; for(const paragraph of text.split(/\r?\n/)){ if(!paragraph){lines.push("");continue;} let line=""; for(const word of paragraph.split(/\s+/)){ const candidate=line?`${line} ${word}`:word; if(!line||font.widthOfTextAtSize(candidate,size)<=maxWidth)line=candidate;else{lines.push(line);line=word;} } if(line)lines.push(line); } return lines.length?lines:[""]; }
function standardFontKey(a){ const family=(a.fontFamily||"").toLowerCase(),bold=Number.parseInt(a.fontWeight,10)>=600||/bold/.test(a.fontWeight||""),italic=/italic|oblique/.test(a.fontStyle||""); if(/courier|mono/.test(family))return bold?(italic?"CourierBoldOblique":"CourierBold"):(italic?"CourierOblique":"Courier"); if(/times|georgia|serif/.test(family)&&!/sans/.test(family))return bold?(italic?"TimesRomanBoldItalic":"TimesRomanBold"):(italic?"TimesRomanItalic":"TimesRoman"); return bold?(italic?"HelveticaBoldOblique":"HelveticaBold"):(italic?"HelveticaOblique":"Helvetica"); }
function hexToRgb(hex){ const n=parseInt(hex.slice(1),16);return{r:((n>>16)&255)/255,g:((n>>8)&255)/255,b:(n&255)/255}; }
function hexToCssRgba(hex,alpha){const c=hexToRgb(hex);return`rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${alpha})`;}
