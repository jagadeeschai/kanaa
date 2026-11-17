import type { TextItem,Timeline } from './model';

export function validSource(value?:string|null):boolean{return Boolean(value?.trim() && !['Source: …','Source: ...','Type your source'].includes(value.trim()));}
export function sourceCatalog(timeline:Timeline):string[]{
  const values:string[]=[];
  for(const layer of timeline.layers){if(layer.kind!=='text' || layer.hidden || layer.id.startsWith('__source_'))continue;
    for(const item of [...layer.items].sort((a,b)=>a.start-b.start)){const value=item.graphic?.kind==='source' ? item.text:item.source;if(validSource(value) && !values.includes(value!.trim()))values.push(value!.trim());}}
  return values;
}
export function sourceRollLines(values:string[]):string[]{
  const rows=values.flatMap((value,index)=>{const letters:string[]=[];for(const char of `${index+1}. ${value}`){if(letters.length && (/^[\p{Mn}\p{Mc}\u200c\u200d]$/u.test(char) || /[\u200c\u200d]$/.test(letters[letters.length-1])))letters[letters.length-1]+=char;else letters.push(char);}const limit=/[஀-௿]/.test(value) ? 60:100;return Array.from({length:Math.ceil(letters.length/limit)},(_,i)=>letters.slice(i*limit,(i+1)*limit).join(''));});
  return rows.length ? ['Sources / ஆதாரங்கள்',...rows]:[];
}
export function sourceDuration(timeline:Timeline,base:number):number{const lines=timeline.sources_roll ? sourceRollLines(sourceCatalog(timeline)):[];return base+(lines.length ? 6+(lines.length-1)*.8:0);}
export function missingSources(timeline:Timeline):TextItem[]{return timeline.layers.flatMap((layer)=>layer.kind==='text' && !layer.hidden && !layer.id.startsWith('__source_') ? layer.items.filter((item)=>!validSource(item.source) && (['count-up','bar-chart','line-chart','pie-chart'].includes(item.graphic?.kind ?? '') || (item.graphic?.kind!=='source' && /[\d"“”«»]/.test(item.text)))):[]);}
function note(id:string,text:string,start:number,length:number,y=.95):TextItem{return {id,text,start,length,style:'plain',position:'center',size:30,color:'#ddb168',transform:{x:.5,y:.5,scale:1,opacity:1,rotation:0},graphic:{kind:'source',style:'documentary',from:[.5,y],to:[.5,y],width:.92,height:.075,line_width:.003}};}
export function decorateSources(timeline:Timeline):Timeline{
  if(!timeline.sources_roll && !timeline.layers.some((layer)=>layer.kind==='text' && layer.items.some((item)=>validSource(item.source))) && !timeline.layers.some((layer)=>layer.id.startsWith('__source_')))return timeline;
  const layers=timeline.layers.filter((layer)=>!layer.id.startsWith('__source_'));const base=layers.reduce((end,layer)=>Math.max(end,...layer.items.map((i)=>i.start+('out' in i ? (i.out-i.in)/i.speed:i.length))),0);
  const sourceItems=layers.flatMap((layer)=>layer.kind==='text' && !layer.hidden ? layer.items.filter((item)=>validSource(item.source) && item.graphic?.kind!=='source'):[]).sort((a,b)=>a.start-b.start);
  let active:{end:number;slot:number}[]=[];
  sourceItems.forEach((parent,index)=>{active=active.filter((a)=>a.end>parent.start);let slot=0;while(active.some((a)=>a.slot===slot))slot++;active.push({end:parent.start+parent.length,slot});layers.push({id:`__source_layer_${index}`,kind:'text',name:'Sources',items:[note(`__source_note_${index}`,parent.source!,parent.start,parent.length,Math.max(.12,.95-slot*.07))]});});
  if(timeline.sources_roll)sourceRollLines(sourceCatalog(timeline)).forEach((line,index)=>{const item=note(`__source_roll_${index}`,line,base+index*.8,6,.5);item.transform={x:.5,y:.5,scale:1,opacity:1,rotation:0,keyframes:{y:[{t:0,v:1.1,ease:'linear'},{t:6,v:-.1,ease:'linear'}]}};layers.push({id:`__source_roll_layer_${index}`,kind:'text',name:'Sources roll',items:[item]});});
  return {...timeline,layers};
}
