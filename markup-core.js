export const MARKUP_LABELS={line:"Line",arrow:"Arrow",rectangle:"Rectangle",ellipse:"Ellipse",cloud:"Cloud",polygon:"Polygon",freehand:"Freehand",flag:"Flag",callout:"Callout",legend:"Takeoff Legend",stamp:"Stamp"};

export const MARKUP_FORMAT_KEYS=["strokeColor","strokeWidth","lineType","fillColor","fillOpacity","startArrow","endArrow","fontFamily","fontChoice","fontSize","fontWeight","fontStyle","textUnderline","showFlagText","textColor","color","textAlign","verticalAlign","backgroundColor","borderWidth","borderColor","autoFit","rotation"];
export const MEASUREMENT_FORMAT_KEYS=["lineColor","lineWidth","lineType","labelColor","shadeColor","shadeOpacity","hatchPattern","areaFillEnabled","showPerimeterLength","showAreaValue"];

export function formatPainterPatch(source,target){
  const textTypes=new Set(["text","replacement"]),compatibleText=textTypes.has(source?.type)&&textTypes.has(target?.type);if(!source||!target||source.type!==target.type&&!compatibleText||!["markup","measurement","highlight","sticky-note","text","replacement"].includes(source.type))return null;
  const patch={layerId:source.layerId||null,layerName:source.layerName||"",layerVisible:source.layerId?source.layerVisible!==false:true,layerLocked:source.layerId?source.layerLocked===true:false,layerPrintable:source.layerId?source.layerPrintable!==false:true};
  if(source.type==="sticky-note")return{color:source.color||"#f6c344",...patch};
  if(source.type==="highlight")return{highlightColor:source.highlightColor||"#ffd84d",...patch};
  if(source.type==="measurement"&&(source.measureKind==="calibration"||target.measureKind==="calibration"))return null;
  const keys=textTypes.has(source.type)?["fontFamily","fontChoice","fontSize","fontWeight","fontStyle","textUnderline","textAlign","verticalAlign","color","backgroundColor","borderWidth","borderColor","autoFit","rotation"]:source.type==="markup"?MARKUP_FORMAT_KEYS:MEASUREMENT_FORMAT_KEYS;
  for(const key of keys)if(Object.hasOwn(source,key))patch[key]=structuredClone(source[key]);
  return patch;
}

export function markupBounds(points=[]){
  if(!points.length)return{x:0,y:0,w:0,h:0};
  const xs=points.map(point=>point.x),ys=points.map(point=>point.y),x=Math.min(...xs),y=Math.min(...ys);
  return{x,y,w:Math.max(1,Math.max(...xs)-x),h:Math.max(1,Math.max(...ys)-y)};
}

export function calloutConnectionPoint(annotation){
  const landing=annotation.points?.[1]||{x:annotation.x||0,y:annotation.y||0},left=annotation.x||0,top=annotation.y||0,right=left+(annotation.w||1),bottom=top+(annotation.h||1),clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const candidates=[{x:left,y:clamp(landing.y,top,bottom)},{x:right,y:clamp(landing.y,top,bottom)},{x:clamp(landing.x,left,right),y:top},{x:clamp(landing.x,left,right),y:bottom}];
  return candidates.sort((a,b)=>Math.hypot(a.x-landing.x,a.y-landing.y)-Math.hypot(b.x-landing.x,b.y-landing.y))[0];
}

export function calloutBounds(annotation){
  const connection=calloutConnectionPoint(annotation),box=[{x:annotation.x,y:annotation.y},{x:annotation.x+annotation.w,y:annotation.y+annotation.h}];
  return markupBounds([...(annotation.points||[]),connection,...box]);
}

export function defaultCalloutGeometry(head,landing,pageSize,size={width:180,height:80}){
  const gap=32,width=Math.min(size.width,pageSize.width),height=Math.min(size.height,pageSize.height),placeRight=landing.x>=head.x;
  let x=placeRight?landing.x+gap:landing.x-gap-width,y=landing.y-height/2;
  x=Math.max(0,Math.min(pageSize.width-width,x));y=Math.max(0,Math.min(pageSize.height-height,y));
  return{points:[head,landing],x,y,w:width,h:height};
}

export function calloutBoxMove(annotation,dx,dy){return{x:annotation.x+dx,y:annotation.y+dy,landing:{x:annotation.points[1].x+dx,y:annotation.points[1].y+dy}};}

export function makeMarkup(kind,points,page,pageId,id){
  const flag=kind==="flag",callout=kind==="callout",legend=kind==="legend",stamp=kind==="stamp";
  return{id,type:"markup",markupKind:kind,subject:MARKUP_LABELS[kind]||"Markup",comment:"",status:"None",page,pageId,points,rotation:0,strokeColor:flag?"#a96f76":legend?"#173f65":"#d04a3a",strokeWidth:flag?1:legend?1:2,lineType:"solid",fillColor:flag?"#b87d83":legend?"#ffffff":stamp?"#d04a3a":"#fff2a8",fillOpacity:flag||legend?1:stamp?.12:["rectangle","ellipse","cloud","polygon"].includes(kind)?.18:0,startArrow:callout?"filled":"none",endArrow:kind==="arrow"?"filled":"none",...(flag?{text:"",showFlagText:true,textColor:"#ffffff",fontFamily:"Arial, Helvetica, sans-serif",fontChoice:"Arial, Helvetica, sans-serif",fontSize:14,fontWeight:"600",fontStyle:"normal",textUnderline:false,textAlign:"center",verticalAlign:"middle"}:{}),...(callout?{text:"Callout",color:"#15191f",backgroundColor:"#ffffff",borderWidth:2,borderColor:"#d04a3a",autoFit:false,fontFamily:"Arial, Helvetica, sans-serif",fontChoice:"Arial, Helvetica, sans-serif",fontSize:16,fontWeight:"400",fontStyle:"normal",textUnderline:false,textAlign:"left",verticalAlign:"top"}:{}),...(legend?{legendTitle:"Takeoff Summary",legendGroupBy:"type",legendScope:"document",textColor:"#15191f",fontFamily:"Arial, Helvetica, sans-serif",fontChoice:"Arial, Helvetica, sans-serif",fontSize:9,fontWeight:"400"}:{}),...(stamp?{stampKind:"text",stampName:"Custom",text:"STAMP",imageDataUrl:"",imageMimeType:"",aspectRatio:3.2,textColor:"#b33427",fontFamily:"Arial, Helvetica, sans-serif",fontChoice:"Arial, Helvetica, sans-serif",fontSize:24,fontWeight:"700",fontStyle:"normal",textUnderline:false,textAlign:"center",verticalAlign:"middle"}:{}),...markupBounds(points)};
}

export function flagPolygonPoints(bounds){
  const notch=Math.min(bounds.w*.28,bounds.h*.55);
  return[{x:bounds.x+notch,y:bounds.y},{x:bounds.x+bounds.w,y:bounds.y},{x:bounds.x+bounds.w,y:bounds.y+bounds.h},{x:bounds.x+notch,y:bounds.y+bounds.h},{x:bounds.x,y:bounds.y+bounds.h/2}];
}

export function defaultFlagPoints(anchor,pageSize,size={width:160,height:34}){
  const width=Math.min(size.width,pageSize.width),height=Math.min(size.height,pageSize.height),x=Math.max(0,Math.min(pageSize.width-width,anchor.x-width/2)),y=Math.max(0,Math.min(pageSize.height-height,anchor.y-height/2));
  return[{x,y},{x:x+width,y:y+height}];
}

export function cloudPath(bounds,coordinateSystem="screen"){
  const{x,y,w,h}=bounds,r=Math.max(3,Math.min(10,Math.min(w,h)/5)),step=Math.max(8,r*2.1),top=coordinateSystem==="pdf"?y+h:y,bottom=coordinateSystem==="pdf"?y:y+h,topOut=coordinateSystem==="pdf"?top+r:top-r,bottomOut=coordinateSystem==="pdf"?bottom-r:bottom+r,commands=[`M ${x} ${top}`];
  for(let start=x;start<x+w-.001;start+=step){const end=Math.min(x+w,start+step),quarter=(end-start)/4;commands.push(`C ${start+quarter} ${topOut} ${end-quarter} ${topOut} ${end} ${top}`);}
  for(let start=top;coordinateSystem==="pdf"?start>bottom+.001:start<bottom-.001;start+=coordinateSystem==="pdf"?-step:step){const end=coordinateSystem==="pdf"?Math.max(bottom,start-step):Math.min(bottom,start+step),quarter=(end-start)/4;commands.push(`C ${x+w+r} ${start+quarter} ${x+w+r} ${end-quarter} ${x+w} ${end}`);}
  for(let start=x+w;start>x+.001;start-=step){const end=Math.max(x,start-step),quarter=(start-end)/4;commands.push(`C ${start-quarter} ${bottomOut} ${end+quarter} ${bottomOut} ${end} ${bottom}`);}
  for(let start=bottom;coordinateSystem==="pdf"?start<top-.001:start>top+.001;start+=coordinateSystem==="pdf"?step:-step){const end=coordinateSystem==="pdf"?Math.min(top,start+step):Math.max(top,start-step),quarter=(end-start)/4;commands.push(`C ${x-r} ${start+quarter} ${x-r} ${end-quarter} ${x} ${end}`);}
  return`${commands.join(" ")} Z`;
}

export function arrowheadGeometry(tip,adjacent,size=12){const angle=Math.atan2(tip.y-adjacent.y,tip.x-adjacent.x),back={x:Math.cos(angle)*size,y:Math.sin(angle)*size},side={x:Math.cos(angle+Math.PI/2)*size*.48,y:Math.sin(angle+Math.PI/2)*size*.48};return{tip,left:{x:tip.x-back.x+side.x,y:tip.y-back.y+side.y},right:{x:tip.x-back.x-side.x,y:tip.y-back.y-side.y},center:{x:tip.x-back.x*.55,y:tip.y-back.y*.55}};}

function copyPlacementDelta(bounds,pageSize,anchor,offset){if(Number.isFinite(anchor?.x)&&Number.isFinite(anchor?.y)){const maxX=Math.max(0,pageSize.width-bounds.w),maxY=Math.max(0,pageSize.height-bounds.h),targetX=Math.max(0,Math.min(maxX,anchor.x-bounds.w/2)),targetY=Math.max(0,Math.min(maxY,anchor.y-bounds.h/2));return{dx:targetX-bounds.x,dy:targetY-bounds.y};}const roomRight=pageSize.width-bounds.x-bounds.w,roomBottom=pageSize.height-bounds.y-bounds.h;return{dx:roomRight>=offset?offset:bounds.x>=offset?-offset:Math.max(-bounds.x,roomRight),dy:roomBottom>=offset?offset:bounds.y>=offset?-offset:Math.max(-bounds.y,roomBottom)};}
export function copyPageItem(source,{id,page,pageId,pageSize,anchor=null,offset=12}){const boxedItem=(source?.type==="highlight"&&!source.rects?.length||source?.type==="sticky-note"||source?.type==="text")&&Number.isFinite(source.x)&&Number.isFinite(source.y)&&source.w>0&&source.h>0;if(boxedItem){const{dx,dy}=copyPlacementDelta(source,pageSize,anchor,offset),copy=JSON.parse(JSON.stringify(source)),now=new Date().toISOString();return Object.assign(copy,{id,page,pageId,x:source.x+dx,y:source.y+dy,...(source.type==="sticky-note"?{createdDate:now,modifiedDate:now}:{})});}if(!["markup","measurement"].includes(source?.type)||source.measureKind==="calibration"||!source.points?.length)return null;const bounds=source.markupKind==="callout"?calloutBounds(source):markupBounds(source.points),{dx,dy}=copyPlacementDelta(bounds,pageSize,anchor,offset),copy=JSON.parse(JSON.stringify(source));copy.id=id;copy.page=page;copy.pageId=pageId;copy.points=source.points.map(point=>({x:point.x+dx,y:point.y+dy}));if(source.markupKind==="callout"){copy.x+=dx;copy.y+=dy;return copy;}return Object.assign(copy,markupBounds(copy.points));}

export function markupListRows(annotations=[],pages=[],valueForItem=item=>item.displayValue||""){
  const pageById=new Map(pages.map((page,index)=>[page.id,index+1]));
  return annotations.filter(item=>["markup","highlight","text","replacement","measurement","sticky-note"].includes(item.type)&&!item.deleted).map(item=>({
    id:item.id,visible:item.visible!==false,page:pageById.get(item.pageId)||item.page||1,layer:item.layerName||"No layer",type:item.type==="markup"?(MARKUP_LABELS[item.markupKind]||"Markup"):item.type==="measurement"?`${item.measureKind} measure`:item.type==="sticky-note"?"Sticky Note":item.type,subject:item.subject||item.text?.slice(0,40)||MARKUP_LABELS[item.markupKind]||item.type,value:item.type==="sticky-note"?item.text||"":item.type==="markup"&&["flag","callout","stamp"].includes(item.markupKind)?item.text||item.subject||"":item.type==="markup"&&item.markupKind==="legend"?item.legendTitle||"Takeoff Summary":valueForItem(item),comment:item.comment||"",status:item.status||"None",author:item.author||"",created:item.createdDate||"",modified:item.modifiedDate||""
  })).sort((first,last)=>first.page-last.page);
}

export function rowsToCsv(rows=[]){
  const cell=value=>`"${String(value??"").replaceAll('"','""')}"`;
  return[["Visible","Page","Layer","Type","Subject","Value","Author","Status","Comment","Created","Modified"],...rows.map(row=>[row.visible!==false?"Yes":"No",row.page,row.layer||"No layer",row.type,row.subject,row.value,row.author,row.status,row.comment,row.created,row.modified])].map(row=>row.map(cell).join(",")).join("\r\n");
}

export function sortMarkupRows(rows=[],key="page",direction="asc"){
  const multiplier=direction==="desc"?-1:1,collator=new Intl.Collator(undefined,{numeric:true,sensitivity:"base"});
  return rows.map((row,index)=>({row,index})).sort((first,last)=>{const a=first.row[key]??"",b=last.row[key]??"";if(a===""&&b!=="")return 1;if(b===""&&a!=="")return-1;const result=typeof a==="number"&&typeof b==="number"?a-b:collator.compare(String(a),String(b));return result?result*multiplier:first.index-last.index;}).map(entry=>entry.row);
}

export function groupMarkupRows(rows=[],key=""){
  if(!key)return[{value:"",rows:[...rows]}];const groups=new Map();for(const row of rows){const value=String(row[key]??"")||"(Blank)";if(!groups.has(value))groups.set(value,[]);groups.get(value).push(row);}return[...groups].map(([value,items])=>({value,rows:items}));
}
