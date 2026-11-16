import type { ExplainerGraphic, GraphicKind } from './model';

/** Kind chips keep the chosen colour and provide any content the new kind requires. */
export function withGraphicKind(graphic: ExplainerGraphic, kind: GraphicKind): ExplainerGraphic {
  const next = { ...graphic, kind };
  if (kind === 'step-list' && !next.steps) Object.assign(next, { steps: ['திட்டமிடுங்கள்', 'உருவாக்குங்கள்', 'பகிருங்கள்'], step_times: null, width: .78, height: .78 });
  if (kind === 'timeline-bar' && !next.points) Object.assign(next, { points: [{ date:'1947',label:'விடுதலை' }, {date:'இன்று',label:'புதிய தொடக்கம்'}], width:.84,height:.64 });
  if (kind === 'icon' && graphic.kind !== 'icon') Object.assign(next,{icon:'pin',icon_badge:true,width:.14,height:.25});
  if (['bar-chart','line-chart','pie-chart'].includes(kind)) {
    const limit=kind === 'pie-chart' ? 6 : kind === 'bar-chart' ? 8 : 12;
    const rows=next.data?.filter((row)=>kind !== 'pie-chart' || row.value > 0).slice(0,limit);
    next.data=rows?.length ? rows : [{label:'கல்வி',value:42},{label:'சுகாதாரம்',value:31},{label:'போக்குவரத்து',value:27}];
    if ((next.highlight_index ?? -1) >= next.data.length) next.highlight_index=null;
  }
  return next;
}
