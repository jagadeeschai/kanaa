import { t } from '../../i18n';
import type { GraphicIcon, TextItem } from '../../timeline/model';
import { useEditor } from '../state/EditorContext';
import { ValueSlider } from '../controls';
import { More } from '../layout';
import { Chips } from './parts';

const ICONS: {id:GraphicIcon;label:string}[]=[{id:'pin',label:'Pin'},{id:'warning',label:'Warning'},{id:'tick',label:'Tick'},{id:'cross',label:'Cross'},{id:'question',label:'Question'},{id:'star',label:'Star'},{id:'heart',label:'Heart'},{id:'trend-up',label:'Trend up'},{id:'trend-down',label:'Trend down'}];
export function IconGraphicFields({text,onChange}:{text:TextItem;onChange:(changes:Partial<TextItem>,group?:string)=>void}) {
  const graphic=text.graphic!, {timeline:{format}}=useEditor();
  return <><Chips label="Icon" options={ICONS} value={graphic.icon ?? 'pin'} onPick={(icon)=>onChange({graphic:{...graphic,icon}})}/>
    <ValueSlider label="Size" value={graphic.height} min={.06} max={.75} step={.01} defaultValue={.22} unit="%" factor={100} onChange={(height,group)=>onChange({graphic:{...graphic,height,width:Math.max(.03,height*format.height/format.width)}},group)}/>
    <More><label className="ed-check"><input type="checkbox" checked={graphic.icon_badge ?? false} onChange={(event)=>onChange({graphic:{...graphic,icon_badge:event.target.checked}})}/>{t('Round badge')}</label></More>
  </>;
}
