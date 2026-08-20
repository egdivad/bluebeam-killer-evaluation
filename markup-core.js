export const MARKUP_LABELS={line:"Line",arrow:"Arrow",rectangle:"Rectangle",ellipse:"Ellipse",cloud:"Cloud",polygon:"Polygon",freehand:"Freehand",flag:"Flag"};

const MARKUP_FORMAT_KEYS=["strokeColor","strokeWidth","lineType","fillColor","fillOpacity","startArrow","endArrow","fontFamily","fontChoice","fontSize","fontWeight","fontStyle","textUnderline","showFlagText","textColor","textAlign","verticalAlign"];
const MEASUREMENT_FORMAT_KEYS=["lineColor","lineWidth","lineType","labelColor","shadeColor","shadeOpacity","hatchPattern","areaFillEnabled","showPerimeterLength"];

export function formatPainterPatch(source,target){
  if(!source||!target||source.type!==target.type||!["markup","measurement"].includes(source.type))return null;
  if(source.type==="measurement"&&(source.measureKind==="calibration"||target.measureKind==="calibration"))return null;
  const keys=source.type==="markup"?MARKUP_FORMAT_KEYS:MEASUREMENT_FORMAT_KEYS,patch={};
  for(const key of keys)if(Object.hasOwn(source,key))patch[key]=structuredClone(source[key]);
  return patch;
}

export function markupBounds(points=[]){
  if(!points.length)return{x:0,y:0,w:0,h:0};
  const xs=points.map(point=>point.x),ys=points.map(point=>point.y),x=Math.min(...xs),y=Math.min(...ys);
  return{x,y,w:Math.max(1,Math.max(...xs)-x),h:Math.max(1,Math.max(...ys)-y)};
}

export function makeMarkup(kind,points,page,pageId,id){
  const flag=kind==="flag";
  return{id,type:"markup",markupKind:kind,subject:MARKUP_LABELS[kind]||"Markup",comment:"",status:"None",page,pageId,points,strokeColor:flag?"#a96f76":"#d04a3a",strokeWidth:flag?1:2,lineType:"solid",fillColor:flag?"#b87d83":"#fff2a8",fillOpacity:flag?1:["rectangle","ellipse","cloud","polygon"].includes(kind)?.18:0,startArrow:"none",endArrow:kind==="arrow"?"filled":"none",...(flag?{text:"Flag",showFlagText:false,textColor:"#ffffff",fontFamily:"Arial, Helvetica, sans-serif",fontChoice:"Arial, Helvetica, sans-serif",fontSize:14,fontWeight:"600",fontStyle:"normal",textUnderline:false,textAlign:"center",verticalAlign:"middle"}:{}),...markupBounds(points)};
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

export function copyPageItem(source,{id,page,pageId,pageSize,offset=12}){if(!["markup","measurement"].includes(source?.type)||source.measureKind==="calibration"||!source.points?.length)return null;const bounds=markupBounds(source.points),roomRight=pageSize.width-bounds.x-bounds.w,roomBottom=pageSize.height-bounds.y-bounds.h,dx=roomRight>=offset?offset:bounds.x>=offset?-offset:Math.max(-bounds.x,roomRight),dy=roomBottom>=offset?offset:bounds.y>=offset?-offset:Math.max(-bounds.y,roomBottom),copy=JSON.parse(JSON.stringify(source));copy.id=id;copy.page=page;copy.pageId=pageId;copy.points=source.points.map(point=>({x:point.x+dx,y:point.y+dy}));return Object.assign(copy,markupBounds(copy.points));}

export function markupListRows(annotations=[],pages=[],valueForItem=item=>item.displayValue||""){
  const pageById=new Map(pages.map((page,index)=>[page.id,index+1]));
  return annotations.filter(item=>["markup","highlight","text","replacement","measurement"].includes(item.type)&&!item.deleted).map(item=>({
    id:item.id,visible:item.visible!==false,page:pageById.get(item.pageId)||item.page||1,type:item.type==="markup"?(MARKUP_LABELS[item.markupKind]||"Markup"):item.type==="measurement"?`${item.measureKind} measure`:item.type,subject:item.subject||item.text?.slice(0,40)||MARKUP_LABELS[item.markupKind]||item.type,value:item.type==="markup"&&item.markupKind==="flag"?item.text||"":valueForItem(item),comment:item.comment||"",status:item.status||"None"
  })).sort((first,last)=>first.page-last.page);
}

export function rowsToCsv(rows=[]){
  const cell=value=>`"${String(value??"").replaceAll('"','""')}"`;
  return[["Visible","Page","Type","Subject","Value","Status","Comment"],...rows.map(row=>[row.visible!==false?"Yes":"No",row.page,row.type,row.subject,row.value,row.status,row.comment])].map(row=>row.map(cell).join(",")).join("\r\n");
}

export function sortMarkupRows(rows=[],key="page",direction="asc"){
  const multiplier=direction==="desc"?-1:1,collator=new Intl.Collator(undefined,{numeric:true,sensitivity:"base"});
  return rows.map((row,index)=>({row,index})).sort((first,last)=>{const a=first.row[key]??"",b=last.row[key]??"";if(a===""&&b!=="")return 1;if(b===""&&a!=="")return-1;const result=typeof a==="number"&&typeof b==="number"?a-b:collator.compare(String(a),String(b));return result?result*multiplier:first.index-last.index;}).map(entry=>entry.row);
}

export function groupMarkupRows(rows=[],key=""){
  if(!key)return[{value:"",rows:[...rows]}];const groups=new Map();for(const row of rows){const value=String(row[key]??"")||"(Blank)";if(!groups.has(value))groups.set(value,[]);groups.get(value).push(row);}return[...groups].map(([value,items])=>({value,rows:items}));
}
