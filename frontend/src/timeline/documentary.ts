import type { AudioLayer,Timeline } from './model';

/** Mirrored by documentary_audio.decorate. Derived whooshes follow graphics as they move, without duplicating clips. */
export function documentarySounds(timeline:Timeline):Timeline {
  const config=timeline.documentary_sound;if(!config?.enabled)return timeline;
  const layers=timeline.layers.filter((layer)=>!layer.id.startsWith('__doc_sound_'));
  const times=[...new Set(layers.flatMap((layer)=>layer.kind==='text' && !layer.hidden ? layer.items.filter((item)=>item.graphic && (item.graphic.kind==='chapter-card' || item.graphic.width*item.graphic.height>=.18)).map((item)=>item.start):[]))].sort((a,b)=>a-b);
  const extra:AudioLayer[]=times.map((at,index)=>({id:`__doc_sound_layer_${index}`,kind:'audio',name:'Documentary sounds',items:[{id:`__doc_sound_item_${index}`,asset_id:config.asset_id,start:Math.max(0,at-config.peak),in:Math.max(0,config.peak-at),out:config.duration,speed:1,volume:.18,muted:false,duck:false,name:'Soft documentary whoosh',fade_in:.03,fade_out:.15}]}));
  return {...timeline,layers:[...layers,...extra]};
}
