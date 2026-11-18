import { t } from '../i18n';
import type { Transition } from '../timeline/animation';
export function SplitOptions({value,onChange,disabled=false}:{value:Transition;onChange:(next:Transition)=>void;disabled?:boolean}) {
  const rows=[['Panels','split_panels',2,[[2,'2'],[3,'3'],[4,'4']]],['Direction','split_direction','horizontal',[['horizontal','Apart sideways'],['vertical','Apart up and down'],['diagonal','Diagonal']]],['Style','split_style','clean',[['clean','Clean'],['gap','With a gap'],['shadow','Soft edge shadow']]]] as const;
  return <div className="split-options" style={{minWidth:0}}>{rows.map(([label,key,fallback,choices])=><div key={key} role="group" aria-label={t(label)} style={{marginBottom:10}}><span>{t(label)}</span><div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:5}}>{choices.map(([id,name])=><button key={id} className={`ed-button ${(value[key]??fallback)===id?'on':''}`} aria-pressed={(value[key]??fallback)===id} disabled={disabled} onClick={()=>onChange({...value,[key]:id})} style={{whiteSpace:'normal',maxWidth:'100%'}}>{t(name)}</button>)}</div></div>)}</div>;
}
