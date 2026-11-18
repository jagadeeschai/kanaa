import { useEffect,useState } from 'react';
import { t } from '../i18n';
import type { Transition } from '../timeline/animation';
import { splitPanels } from '../timeline/split-transition';
import { SplitOptions } from './SplitOptions';
import type { CutPicture } from './TransitionPopover';
import { ValueSlider } from './controls';
export default function SplitTransitionDialog({value,before,after,locked,longest,onChange,onClose}:{value:Transition;before:CutPicture;after:CutPicture;locked:boolean;longest:number;onChange:(v:Transition)=>void;onClose:()=>void}) {
  const [p,setP]=useState(0);
  useEffect(()=>{let id=0;const start=performance.now();const tick=(now:number)=>{setP(Math.max(0,Math.min(1,((now-start)/1000%(value.duration+1)-.4)/value.duration)));id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[value.duration]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[onClose]);
  const W=1920,H=1080,panels=splitPanels(p,value.split_panels??2,value.split_direction??'horizontal',W,H,value.split_style??'clean');
  const picture=(item:CutPicture)=>item?<image href={item.image} x={-item.tile*W} width={item.tiles*W} height={H} preserveAspectRatio="none"/>:<rect width={W} height={H} fill="#25354a"/>;
  return <div className="ed-modal" onPointerDown={(e)=>{if(e.target===e.currentTarget)onClose();}}><div className="ed-card small" role="dialog" aria-modal="true" aria-label={t('Split transition')} style={{width:'min(420px, calc(100vw - 24px))',maxHeight:'90vh',overflowY:'auto'}}>
    <h2>{t('Split transition')}</h2><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Looping transition preview')} style={{width:'100%',background:'#000',borderRadius:8,marginBottom:12}}>
      {picture(after)}{panels.map(({rect:r,move:m},i)=>{const left=r[0]>0?m[3]:0,top=r[1]>0?m[3]:0,right=r[0]+r[2]<W?m[3]:0,bottom=r[1]+r[3]<H?m[3]:0;return <svg key={i} x={r[0]+m[0]+left} y={r[1]+m[1]+top} width={Math.max(0,r[2]-left-right)} height={Math.max(0,r[3]-top-bottom)} viewBox={`${r[0]+left} ${r[1]+top} ${Math.max(1,r[2]-left-right)} ${Math.max(1,r[3]-top-bottom)}`} opacity={m[2]} overflow="hidden" style={{filter:value.split_style==='shadow'?'drop-shadow(0 0 10px #0008)':undefined}}>{picture(before)}</svg>;})}
    </svg><SplitOptions value={value} disabled={locked} onChange={onChange}/><ValueSlider label={t('Length')} value={value.duration} min={.2} max={Math.max(.2,Math.min(2,longest))} step={.05} decimals={2} defaultValue={.6} unit="s" onChange={(duration)=>onChange({...value,duration})}/><button className="ed-button" onClick={onClose}>{t('Done')}</button>
  </div></div>;
}
