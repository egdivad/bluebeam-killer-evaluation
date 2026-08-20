const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

function rgb(hex = "#000000") {
  const value = String(hex).replace("#", "").padEnd(6, "0").slice(0, 6), number = Number.parseInt(value, 16) || 0;
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

function blendWithWhite(hex, opacity) {
  return rgb(hex).map(channel => 1 - ((1 - channel) * clamp01(opacity)));
}
function blendRgbWithWhite(color, opacity) { return color.map(channel => 1 - ((1 - channel) * clamp01(opacity))); }

const appearanceFontRefs = new WeakMap();
const numberText = value => String(Math.round(Number(value) * 1000) / 1000);
const colorText = color => color.map(numberText).join(" ");
const escapePdfText = value => String(value ?? "").replace(/[^\x20-\x7e]/g, character => character === "²" ? "^2" : "?").replace(/([\\()])/g, "\\$1");

function appearanceFontName(annotation) {
  const bold=Number.parseInt(annotation?.fontWeight,10)>=600||/bold/i.test(annotation?.fontWeight||""),italic=/italic|oblique/i.test(annotation?.fontStyle||"");
  return bold?(italic?"HelvBI":"HelvB"):(italic?"HelvI":"Helv");
}

function appearanceFont(PDFLib, page, fontName="Helv") {
  const context = page.doc.context, name = value => PDFLib.PDFName.of(value);
  let references = appearanceFontRefs.get(page.doc);
  if (!references) { references=new Map();appearanceFontRefs.set(page.doc,references); }
  let reference = references.get(fontName);
  if (!reference) {
    const baseFont=({Helv:"Helvetica",HelvB:"Helvetica-Bold",HelvI:"Helvetica-Oblique",HelvBI:"Helvetica-BoldOblique"})[fontName]||"Helvetica";
    reference = context.register(context.obj({ Type: name("Font"), Subtype: name("Type1"), BaseFont: name(baseFont), Encoding: name("WinAnsiEncoding") }));
    references.set(fontName,reference);
  }
  page.node.setFontDictionary(name(fontName),reference);
  return reference;
}

function localPoints(values, rect) {
  const points=[];
  for(let index=0;index<values.length;index+=2)points.push({x:values[index]-rect[0],y:values[index+1]-rect[1]});
  return points;
}

function ellipsePath(width, height, inset) {
  const left=inset,right=width-inset,bottom=inset,top=height-inset,cx=(left+right)/2,cy=(bottom+top)/2,rx=Math.max(0,(right-left)/2),ry=Math.max(0,(top-bottom)/2),k=.5522847498;
  return `${numberText(cx+rx)} ${numberText(cy)} m ${numberText(cx+rx)} ${numberText(cy+k*ry)} ${numberText(cx+k*rx)} ${numberText(cy+ry)} ${numberText(cx)} ${numberText(cy+ry)} c ${numberText(cx-k*rx)} ${numberText(cy+ry)} ${numberText(cx-rx)} ${numberText(cy+k*ry)} ${numberText(cx-rx)} ${numberText(cy)} c ${numberText(cx-rx)} ${numberText(cy-k*ry)} ${numberText(cx-k*rx)} ${numberText(cy-ry)} ${numberText(cx)} ${numberText(cy-ry)} c ${numberText(cx+k*rx)} ${numberText(cy-ry)} ${numberText(cx+rx)} ${numberText(cy-k*ry)} ${numberText(cx+rx)} ${numberText(cy)} c h`;
}

function cloudPath(width, height, inset) {
  const left=inset,right=width-inset,bottom=inset,top=height-inset,step=Math.max(8,Math.min(18,Math.min(width,height)/3)),nodes=[];
  for(let x=left;x<right;x+=step)nodes.push({x,y:bottom,n:{x:0,y:-1}});nodes.push({x:right,y:bottom,n:{x:1,y:0}});
  for(let y=bottom+step;y<top;y+=step)nodes.push({x:right,y,n:{x:1,y:0}});nodes.push({x:right,y:top,n:{x:0,y:1}});
  for(let x=right-step;x>left;x-=step)nodes.push({x,y:top,n:{x:0,y:1}});nodes.push({x:left,y:top,n:{x:-1,y:0}});
  for(let y=top-step;y>bottom;y-=step)nodes.push({x:left,y,n:{x:-1,y:0}});
  let output=`${numberText(nodes[0].x)} ${numberText(nodes[0].y)} m`;
  for(let index=0;index<nodes.length;index++){const first=nodes[index],last=nodes[(index+1)%nodes.length],normal={x:(first.n.x+last.n.x)/2,y:(first.n.y+last.n.y)/2},distance=Math.hypot(last.x-first.x,last.y-first.y),control={x:(first.x+last.x)/2+normal.x*distance*.32,y:(first.y+last.y)/2+normal.y*distance*.32},cp1={x:first.x+(control.x-first.x)*2/3,y:first.y+(control.y-first.y)*2/3},cp2={x:last.x+(control.x-last.x)*2/3,y:last.y+(control.y-last.y)*2/3};output+=` ${numberText(cp1.x)} ${numberText(cp1.y)} ${numberText(cp2.x)} ${numberText(cp2.y)} ${numberText(last.x)} ${numberText(last.y)} c`;}
  return `${output} h`;
}

function lineEndingPath(tip, adjacent, ending, size) {
  if (!ending || ending === "None") return "";
  const dx=tip.x-adjacent.x,dy=tip.y-adjacent.y,length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length,px=-uy,py=ux,back={x:tip.x-ux*size,y:tip.y-uy*size},left={x:back.x+px*size*.42,y:back.y+py*size*.42},right={x:back.x-px*size*.42,y:back.y-py*size*.42};
  if(ending==="OpenArrow")return `${numberText(left.x)} ${numberText(left.y)} m ${numberText(tip.x)} ${numberText(tip.y)} l ${numberText(right.x)} ${numberText(right.y)} l S`;
  if(ending==="Circle")return `${ellipsePath(size*.7,size*.7,0)} B`;
  return `${numberText(left.x)} ${numberText(left.y)} m ${numberText(tip.x)} ${numberText(tip.y)} l ${numberText(right.x)} ${numberText(right.y)} l h B`;
}

function wrapAppearanceText(value, width, size, height) {
  const maxCharacters=Math.max(1,Math.floor((width-8)/(size*.55))),maxLines=Math.max(1,Math.floor((height-6)/(size*1.18))),lines=[];
  for(const paragraph of String(value??"").split(/\r?\n/)){let line="";for(const word of paragraph.split(/\s+/)){const next=line?`${line} ${word}`:word;if(next.length<=maxCharacters)line=next;else{if(line)lines.push(line);line=word;}}if(line||!paragraph)lines.push(line);}
  return lines.slice(0,maxLines);
}

function annotationAppearance(PDFLib, page, spec) {
  const context=page.doc.context,rect=spec.rect,width=Math.max(.1,rect[2]-rect[0]),height=Math.max(.1,rect[3]-rect[1]),stroke=spec.color||[0,0,0],fill=spec.interiorColor,lineWidth=Math.max(.25,spec.width||1),commands=["q",`${colorText(stroke)} RG`,`${colorText(fill||stroke)} rg`,`${numberText(lineWidth)} w`,"1 J 1 j"];
  if(spec.border?.dash?.length)commands.push(`[${spec.border.dash.map(numberText).join(" ")}] 0 d`);
  const paint=fill?"B":"S",inset=lineWidth/2;
  if(spec.subtype==="FreeText"&&spec.callout){const points=localPoints(spec.calloutLine,rect),box=[spec.calloutBox[0]-rect[0],spec.calloutBox[1]-rect[1],spec.calloutBox[2]-rect[0],spec.calloutBox[3]-rect[1]],boxWidth=box[2]-box[0],boxHeight=box[3]-box[1];commands.push(`${numberText(points[0].x)} ${numberText(points[0].y)} m ${numberText(points[1].x)} ${numberText(points[1].y)} l ${numberText(points[2].x)} ${numberText(points[2].y)} l S`,lineEndingPath(points[2],points[1],spec.calloutEnding,10+lineWidth*2),`${colorText(spec.boxBorderColor||stroke)} RG`,`${colorText(spec.interiorColor||[1,1,1])} rg`,`${numberText(spec.boxBorderWidth??lineWidth)} w`,`${numberText(box[0])} ${numberText(box[1])} ${numberText(boxWidth)} ${numberText(boxHeight)} re B`);}
  else if(spec.subtype==="Line"&&spec.line){const points=localPoints(spec.line,rect);commands.push(`${numberText(points[0].x)} ${numberText(points[0].y)} m ${numberText(points[1].x)} ${numberText(points[1].y)} l S`);const size=10+lineWidth*2;commands.push(lineEndingPath(points[0],points[1],spec.lineEndings?.[0],size),lineEndingPath(points[1],points[0],spec.lineEndings?.[1],size));}
  else if(spec.subtype==="Square")commands.push(`${numberText(inset)} ${numberText(inset)} ${numberText(Math.max(0,width-lineWidth))} ${numberText(Math.max(0,height-lineWidth))} re ${paint}`);
  else if(spec.subtype==="Circle")commands.push(`${ellipsePath(width,height,inset)} ${paint}`);
  else if(["Polygon","PolyLine"].includes(spec.subtype)&&spec.vertices){const points=localPoints(spec.vertices,rect);if(spec.intent==="PolygonCloud")commands.push(`${cloudPath(width,height,inset)} ${paint}`);else{commands.push(`${numberText(points[0].x)} ${numberText(points[0].y)} m`);for(const point of points.slice(1))commands.push(`${numberText(point.x)} ${numberText(point.y)} l`);if(spec.subtype==="Polygon")commands.push("h");commands.push(paint);}}
  else if(spec.subtype==="Ink"&&spec.inkList){for(const values of spec.inkList){const points=localPoints(values,rect);commands.push(`${numberText(points[0].x)} ${numberText(points[0].y)} m`);for(const point of points.slice(1))commands.push(`${numberText(point.x)} ${numberText(point.y)} l`);commands.push("S");}}
  else if(spec.subtype==="Highlight"&&spec.quadPoints){commands.push(`${colorText(blendRgbWithWhite(spec.color||[1,.85,.3],.38))} rg`);for(let index=0;index<spec.quadPoints.length;index+=8){const points=localPoints(spec.quadPoints.slice(index,index+8),rect);commands.push(`${numberText(points[0].x)} ${numberText(points[0].y)} m ${numberText(points[1].x)} ${numberText(points[1].y)} l ${numberText(points[3].x)} ${numberText(points[3].y)} l ${numberText(points[2].x)} ${numberText(points[2].y)} l h f`);}}
  else if(spec.subtype==="FreeText"&&spec.flag){const notch=Math.min(width*.28,height*.55),path=`${numberText(notch)} ${numberText(inset)} m ${numberText(width-inset)} ${numberText(inset)} l ${numberText(width-inset)} ${numberText(height-inset)} l ${numberText(notch)} ${numberText(height-inset)} l ${numberText(inset)} ${numberText(height/2)} l h`;commands.push(`${path} ${paint}`);}
  else if(spec.subtype==="FreeText"&&(fill||spec.width>0))commands.push(`${numberText(inset)} ${numberText(inset)} ${numberText(Math.max(0,width-lineWidth))} ${numberText(Math.max(0,height-lineWidth))} re ${paint}`);
  const textValue=spec.subtype==="FreeText"?spec.contents:(spec.measure&&spec.contents?spec.contents:"");
  let usesFont=false,fontName=spec.defaultAppearance?.font||"Helv";
  if(textValue){const size=spec.defaultAppearance?.size||Math.min(10,Math.max(6,height/5)),textColor=spec.defaultAppearance?.color||stroke,calloutBox=spec.calloutBox?[spec.calloutBox[0]-rect[0],spec.calloutBox[1]-rect[1],spec.calloutBox[2]-rect[0],spec.calloutBox[3]-rect[1]]:null,textLeft=calloutBox?calloutBox[0]+4:spec.flag?Math.min(width*.28,height*.55)+4:4,textRight=calloutBox?calloutBox[2]-4:width-4,textHeight=calloutBox?calloutBox[3]-calloutBox[1]:height,lines=wrapAppearanceText(textValue,textRight-textLeft,size,textHeight),lineHeight=size*1.18,contentHeight=lines.length*lineHeight,vertical=spec.verticalAlign||"top",firstY=calloutBox?(vertical==="middle"?(calloutBox[1]+calloutBox[3]+contentHeight)/2-size:vertical==="bottom"?calloutBox[1]+contentHeight-size+4:calloutBox[3]-size-4):vertical==="middle"?(height+contentHeight)/2-size:vertical==="bottom"?contentHeight-size+4:height-size-4,underlines=[];usesFont=true;commands.push("BT",`${colorText(textColor)} rg`,`/${fontName} ${numberText(size)} Tf`);lines.forEach((line,index)=>{const estimatedWidth=line.length*size*.55,x=spec.textAlign==="center"?(textLeft+textRight-estimatedWidth)/2:spec.textAlign==="right"?textRight-estimatedWidth:textLeft,y=firstY-index*lineHeight;commands.push(`1 0 0 1 ${numberText(x)} ${numberText(y)} Tm (${escapePdfText(line)}) Tj`);if(spec.textUnderline)underlines.push(`${numberText(x)} ${numberText(y-1.5)} m ${numberText(x+estimatedWidth)} ${numberText(y-1.5)} l S`);});commands.push("ET");if(underlines.length)commands.push(`${colorText(textColor)} RG`,`${numberText(Math.max(.6,size/16))} w`,...underlines);}
  commands.push("Q");
  const resources=usesFont?{Font:{[fontName]:appearanceFont(PDFLib,page,fontName)}}:{};
  return context.register(context.flateStream(commands.filter(Boolean).join("\n"),{Type:"XObject",Subtype:"Form",FormType:1,BBox:context.obj([0,0,width,height]),Matrix:context.obj([1,0,0,1,0,0]),Resources:resources}));
}

function pdfPoint(point, pageHeight) { return { x: point.x, y: pageHeight - point.y }; }
function flatPoints(points, pageHeight) { return points.flatMap(point => { const pdf = pdfPoint(point, pageHeight);return [pdf.x, pdf.y]; }); }
function boundsRect(points, pageHeight, padding = 3) {
  const xs = points.map(point => point.x), ys = points.map(point => point.y), left = Math.min(...xs) - padding, right = Math.max(...xs) + padding, top = Math.min(...ys) - padding, bottom = Math.max(...ys) + padding;
  return [left, pageHeight - bottom, right, pageHeight - top];
}
function boxRect(annotation, pageHeight, padding = 0) { return [annotation.x - padding, pageHeight - annotation.y - annotation.h - padding, annotation.x + annotation.w + padding, pageHeight - annotation.y + padding]; }
function calloutConnectionPoint(annotation){const landing=annotation.points?.[1]||{x:annotation.x,y:annotation.y},left=annotation.x,top=annotation.y,right=left+annotation.w,bottom=top+annotation.h,clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),candidates=[{x:left,y:clamp(landing.y,top,bottom)},{x:right,y:clamp(landing.y,top,bottom)},{x:clamp(landing.x,left,right),y:top},{x:clamp(landing.x,left,right),y:bottom}];return candidates.sort((a,b)=>Math.hypot(a.x-landing.x,a.y-landing.y)-Math.hypot(b.x-landing.x,b.y-landing.y))[0];}
function borderStyle(lineType = "solid") {
  if (lineType === "dotted") return { style: "D", dash: [1, 2] };
  if (lineType === "dashed") return { style: "D", dash: [5, 3] };
  if (lineType === "centerline") return { style: "D", dash: [9, 3, 2, 3] };
  return { style: "S", dash: [] };
}
function lineEnding(value = "none") { return ({ none: "None", open: "OpenArrow", closed: "ClosedArrow", filled: "ClosedArrow", circle: "Circle", square: "Square", diamond: "Diamond" })[value] || "None"; }
function common(annotation, subtype, rect, color, width, opacity = 1) {
  return { subtype, rect, color: color ? rgb(color) : null, width, opacity: clamp01(opacity), border: borderStyle(annotation.lineType), id: annotation.id, subject: annotation.subject || subtype, contents: annotation.comment || "", title: "Bluebeam Killer" };
}
function measureSpec(annotation) {
  const scale = annotation.measurementScale;
  if (!scale || !Number.isFinite(scale.unitsPerPoint) || scale.unitsPerPoint <= 0) return null;
  return { ratio: `1 pt = ${scale.unitsPerPoint} ${scale.unit}`, unit: scale.unit || "pt", distanceFactor: scale.unitsPerPoint, areaFactor: scale.unitsPerPoint ** 2 };
}

function markupSpec(annotation, pageHeight) {
  const points = annotation.points || [];if (points.length < 2) return null;
  const width = annotation.strokeWidth || 2, color = annotation.strokeColor || "#d04a3a", fill = annotation.fillColor || "#fff2a8", opacity = annotation.fillOpacity ?? 0;
  if(annotation.markupKind==="flag"){const spec=common(annotation,"FreeText",boundsRect(points,pageHeight,0),color,width);spec.interiorColor=blendWithWhite(fill,opacity);spec.contents=annotation.showFlagText===false?"":annotation.text||"";spec.subject=annotation.subject||"Flag";spec.defaultAppearance={font:appearanceFontName(annotation),size:annotation.fontSize||14,color:rgb(annotation.textColor||"#ffffff")};spec.justification=annotation.textAlign==="left"?0:annotation.textAlign==="right"?2:1;spec.textAlign=annotation.textAlign||"center";spec.verticalAlign=annotation.verticalAlign||"middle";spec.textUnderline=Boolean(annotation.textUnderline);spec.flag=true;return spec;}
  if(annotation.markupKind==="callout"){const connection=calloutConnectionPoint(annotation),boxPoints=[{x:annotation.x,y:annotation.y},{x:annotation.x+annotation.w,y:annotation.y+annotation.h}],spec=common(annotation,"FreeText",boundsRect([...points,connection,...boxPoints],pageHeight,width+6),color,width);spec.contents=annotation.text||"";spec.subject=annotation.subject||"Callout";spec.callout=true;spec.calloutLine=flatPoints([connection,points[1],points[0]],pageHeight);spec.calloutBox=boxRect(annotation,pageHeight);spec.rectDifferences=[spec.calloutBox[0]-spec.rect[0],spec.calloutBox[1]-spec.rect[1],spec.rect[2]-spec.calloutBox[2],spec.rect[3]-spec.calloutBox[3]].map(value=>Math.max(0,value));spec.calloutEnding=lineEnding(annotation.startArrow||"filled");spec.interiorColor=rgb(annotation.backgroundColor||"#ffffff");spec.boxBorderColor=rgb(annotation.borderColor||color);spec.boxBorderWidth=annotation.borderWidth??2;spec.defaultAppearance={font:appearanceFontName(annotation),size:annotation.fontSize||16,color:rgb(annotation.color||"#15191f")};spec.justification=annotation.textAlign==="center"?1:annotation.textAlign==="right"?2:0;spec.textAlign=annotation.textAlign||"left";spec.verticalAlign=annotation.verticalAlign||"top";spec.textUnderline=Boolean(annotation.textUnderline);spec.intent="FreeTextCallout";return spec;}
  if (annotation.markupKind === "line" || annotation.markupKind === "arrow") {
    const spec = common(annotation, "Line", boundsRect(points, pageHeight, width + 8), color, width);
    spec.line = flatPoints([points[0], points.at(-1)], pageHeight);spec.lineEndings = annotation.markupKind === "arrow" ? [lineEnding(annotation.startArrow), lineEnding(annotation.endArrow)] : ["None", "None"];return spec;
  }
  if (annotation.markupKind === "rectangle" || annotation.markupKind === "ellipse") {
    const spec = common(annotation, annotation.markupKind === "rectangle" ? "Square" : "Circle", boundsRect(points, pageHeight, width), color, width);
    if(opacity>0)spec.interiorColor = blendWithWhite(fill, opacity);return spec;
  }
  if (annotation.markupKind === "freehand") {
    const spec = common(annotation, "Ink", boundsRect(points, pageHeight, width + 2), color, width);spec.inkList = [flatPoints(points, pageHeight)];return spec;
  }
  if (annotation.markupKind === "polygon" || annotation.markupKind === "cloud") {
    let vertices = points;
    if (annotation.markupKind === "cloud" && points.length === 2) { const [first, last] = points;vertices = [{ x: first.x, y: first.y }, { x: last.x, y: first.y }, { x: last.x, y: last.y }, { x: first.x, y: last.y }]; }
    if (vertices.length < 3) return null;
    const spec = common(annotation, "Polygon", boundsRect(vertices, pageHeight, width + 5), color, width);spec.vertices = flatPoints(vertices, pageHeight);if(opacity>0)spec.interiorColor = blendWithWhite(fill, opacity);if(annotation.markupKind === "cloud"){spec.borderEffect={style:"C",intensity:2};spec.intent="PolygonCloud";}return spec;
  }
  return null;
}

function measurementSpec(annotation, pageHeight, label) {
  const points = annotation.points || [], width = annotation.lineWidth || 1.6, color = annotation.lineColor || annotation.color || "#d04a3a", measure = measureSpec(annotation);if (!points.length) return null;
  let spec;
  if (["length", "calibration"].includes(annotation.measureKind) && points.length > 1) { spec = common(annotation, "Line", boundsRect(points, pageHeight, width + 8), color, width);spec.line = flatPoints([points[0], points[1]], pageHeight);spec.lineEndings = ["None", "None"];spec.intent = "LineDimension"; }
  else if (["polyline", "perimeter", "angle"].includes(annotation.measureKind) && points.length > 1) { spec = common(annotation, "PolyLine", boundsRect(points, pageHeight, width + 5), color, width);spec.vertices = flatPoints(points, pageHeight);spec.intent = "PolyLineDimension"; }
  else if (annotation.measureKind === "area" && points.length > 2) { spec = common(annotation, "Polygon", boundsRect(points, pageHeight, width + 5), color, width);spec.vertices = flatPoints(points, pageHeight);spec.intent = "PolygonDimension";if(annotation.areaFillEnabled!==false){spec.interiorColor=blendWithWhite(annotation.shadeColor||color,annotation.shadeOpacity??.13);} }
  else if (annotation.measureKind === "diameter" && points.length > 1) { const center={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2},radius=Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)/2;spec=common(annotation,"Circle",boxRect({x:center.x-radius,y:center.y-radius,w:radius*2,h:radius*2},pageHeight,width),color,width);spec.intent="CircleDimension"; }
  else if (annotation.measureKind === "count") { const point=points[0],radius=9;spec=common(annotation,"Circle",boxRect({x:point.x-radius,y:point.y-radius,w:radius*2,h:radius*2},pageHeight,width),color,width); }
  else return null;
  spec.subject = `${annotation.measureKind[0].toUpperCase()}${annotation.measureKind.slice(1)} Measurement`;spec.contents = label || spec.contents;spec.measure = measure;return spec;
}

function highlightSpec(annotation, pageHeight) {
  const rects = annotation.rects?.length ? annotation.rects : [annotation], points = rects.flatMap(rect => [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }]);
  const spec = common(annotation, "Highlight", boundsRect(points, pageHeight, 0), annotation.highlightColor || "#ffd84d", 0, .38);spec.subject="Highlight";spec.quadPoints=rects.flatMap(rect=>{const top=pageHeight-rect.y,bottom=pageHeight-rect.y-rect.h;return[rect.x,top,rect.x+rect.w,top,rect.x,bottom,rect.x+rect.w,bottom];});return spec;
}

function freeTextSpec(annotation, pageHeight) {
  const color=annotation.color||"#15191f",background=annotation.backgroundColor&&annotation.backgroundColor!=="transparent"?annotation.backgroundColor:null,border=(annotation.borderWidth||0)>0?(annotation.borderColor||"#15191f"):null,spec=common(annotation,"FreeText",boxRect(annotation,pageHeight),border,annotation.borderWidth||0,1);if(background)spec.interiorColor=rgb(background);spec.contents=annotation.text||"";spec.subject="Text Box";spec.defaultAppearance={font:appearanceFontName(annotation),size:annotation.fontSize||16,color:rgb(color)};spec.justification=annotation.textAlign==="center"?1:annotation.textAlign==="right"?2:0;spec.textAlign=annotation.textAlign||"left";spec.verticalAlign=annotation.verticalAlign||"top";spec.textUnderline=Boolean(annotation.textUnderline);return spec;
}

export function pdfAnnotationSpec(annotation, pageHeight, measurementLabel = "") {
  if (!annotation || annotation.deleted || annotation.visible === false) return null;
  if (annotation.type === "markup") return markupSpec(annotation, pageHeight);
  if (annotation.type === "measurement") return measurementSpec(annotation, pageHeight, measurementLabel);
  if (annotation.type === "highlight") return highlightSpec(annotation, pageHeight);
  if (annotation.type === "text") return freeTextSpec(annotation, pageHeight);
  return null;
}

export function addPdfLibAnnotation(PDFLib, page, annotation, measurementLabel = "") {
  const spec = pdfAnnotationSpec(annotation, page.getHeight(), measurementLabel);if (!spec) return false;
  const context = page.doc.context, name = value => PDFLib.PDFName.of(value), text = value => PDFLib.PDFHexString.fromText(String(value ?? ""));
  const dateValue = new Date().toISOString().replace(/[-:T]/g, "").replace(/\.\d{3}Z$/, "Z"), numberFormat = (unit, factor) => context.obj({ Type: name("NumberFormat"), U: text(unit), C: PDFLib.PDFNumber.of(factor), D: PDFLib.PDFNumber.of(2), F: name("D") });
  const data = { Type: name("Annot"), Subtype: name(spec.subtype), Rect: context.obj(spec.rect), P: page.ref, F: PDFLib.PDFNumber.of(4), NM: text(spec.id || crypto.randomUUID()), T: text(spec.title), Subj: text(spec.subject), Contents: text(spec.contents), M: PDFLib.PDFString.of(`D:${dateValue}`), CA: PDFLib.PDFNumber.of(spec.opacity ?? 1) };if(spec.color)data.C=context.obj(spec.color);
  const border = { Type: name("Border"), W: PDFLib.PDFNumber.of(spec.width || 0), S: name(spec.border?.style || "S") };if (spec.border?.dash?.length) border.D = context.obj(spec.border.dash);data.BS = context.obj(border);
  if (spec.interiorColor) data.IC = context.obj(spec.interiorColor);
  if (spec.line) data.L = context.obj(spec.line);
  if (spec.vertices) data.Vertices = context.obj(spec.vertices);
  if (spec.quadPoints) data.QuadPoints = context.obj(spec.quadPoints);
  if (spec.inkList) data.InkList = context.obj(spec.inkList);
  if (spec.lineEndings) data.LE = context.obj(spec.lineEndings.map(name));
  if(spec.calloutLine)data.CL=context.obj(spec.calloutLine);
  if(spec.calloutEnding)data.LE=name(spec.calloutEnding);
  if(spec.rectDifferences)data.RD=context.obj(spec.rectDifferences);
  if (spec.borderEffect) data.BE = context.obj({ S: name(spec.borderEffect.style), I: PDFLib.PDFNumber.of(spec.borderEffect.intensity) });
  if (spec.intent) data.IT = name(spec.intent);
  if (spec.measure) { const distance = numberFormat(spec.measure.unit, spec.measure.distanceFactor), area = numberFormat(`${spec.measure.unit}²`, spec.measure.areaFactor);data.Measure = context.obj({ Type: name("Measure"), R: text(spec.measure.ratio), X: context.obj([distance]), D: context.obj([distance]), A: context.obj([area]) }); }
  if (spec.defaultAppearance) { const { font, size, color } = spec.defaultAppearance;data.DA = PDFLib.PDFString.of(`/${font} ${size} Tf ${color.map(value => Math.round(value * 1000) / 1000).join(" ")} rg`);data.Q = PDFLib.PDFNumber.of(spec.justification || 0); }
  data.AP = context.obj({ N: annotationAppearance(PDFLib,page,spec) });
  const reference = context.register(context.obj(data)), annots = page.node.lookupMaybe(name("Annots"), PDFLib.PDFArray);if (annots) annots.push(reference);else page.node.set(name("Annots"), context.obj([reference]));return true;
}
