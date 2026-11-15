import type { Template } from './templates.ts';
import { mainLayer, type Timeline } from './model.ts';
import { timelineBeats } from './beats.ts';
const gold = { amount: .22, color: '#80511c', light: .7, material: 'gold' as const, bevel: .7, shine: .8, sweep: true };
const look = { text: 'Your title', style: 'plain' as const, position: 'center' as const, color: '#ffffff', size: 72, depth: gold, exit: {preset:'fade' as const,duration:.5} };
export const CINEMATIC_TEMPLATES: Template[] = [
 {id:'cinematic-opener',label:'Cinematic opener',look:{...look,enter:{preset:'fly-reveal',duration:2}},extra:{effects:['volumetric-rays','beam-sparkle-dust']}},
 {id:'golden-title-card',label:'Golden title card',look:{...look,enter:{preset:'fade',duration:.8}},extra:{effects:['frame-light-sweep','optical-flare-warm']}},
 {id:'verse-change',label:'Verse change',look:{...look,text:'Next verse',size:48,enter:{preset:'fade',duration:.4}},extra:{effects:['bloom-hit'],transition:true}},
];
/** A verse-change button lands on the nearest existing scene join. */
export function cinematicJoinTime(timeline:Timeline,at:number):number {
 const starts=mainLayer(timeline).items.map(c=>c.start).filter(t=>t>0);
 return starts.sort((a,b)=>Math.abs(a-at)-Math.abs(b-at))[0] ?? at;
}
/** Put the wipe on the scene at the insertion time, preserving other joins. */
export function cinematicJoin(timeline:Timeline,at:number):Timeline {
 const main=mainLayer(timeline); if(main.locked)return timeline;
 const candidates=main.items.filter(c=>c.start>0 && Math.abs(c.start-at)<.5).sort((a,b)=>Math.abs(a.start-at)-Math.abs(b.start-at));
 const chosen=candidates[0];if(!chosen)return timeline;
 return {...timeline,layers:timeline.layers.map(layer=>layer===main?{...main,items:main.items.map(c=>c===chosen?{...c,transition_in:{kind:'light-wipe' as const,duration:.6}}:c)}:layer)};
}

/** Companion overlays are requested once each, in order, using the editor's existing job waiter. */
export async function addTemplateEffects(template: Template, start: number, length: number, add: (id: string, start: number, length: number) => Promise<void>, timeline?: Timeline, beats?: (asset: string) => Promise<{beats: number[]}>) {
 const effects = template.extra?.effects ?? (template.extra?.effect ? [template.extra.effect] : []);
 let hit = start;
 if (template.extra?.transition && timeline && beats) {
  const song = timeline.layers.flatMap(layer => layer.kind === 'audio' && !layer.muted && !layer.hidden ? layer.items : []).find(sound => sound.start <= start && start < sound.start + (sound.out-sound.in)/sound.speed);
  if (song?.asset_id) {
   try {
    const found = timelineBeats(song, (await beats(song.asset_id)).beats).filter(t => Math.abs(t-start) <= .4).sort((a,b) => Math.abs(a-start)-Math.abs(b-start))[0];
    if (found != null) hit = Math.max(0, found - 1/30); // Bloom reaches full strength on the detected beat.
   } catch { /* With no beat analysis, keep the bloom on the scene join. */ }
  }
 }
 for (const effect of effects) await add(effect, effect === 'bloom-hit' ? hit : start, effect === 'bloom-hit' ? .6 : length);
}
export function cinematicJoinFor(template: Template, timeline: Timeline, at: number): Timeline {
 return template.extra?.transition ? cinematicJoin(timeline, at) : timeline;
}
