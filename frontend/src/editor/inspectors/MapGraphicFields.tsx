import { useEffect,useRef,useState } from 'react';
import { t } from '../../i18n';
import type { TextItem } from '../../timeline/model';
import { More } from '../layout';
import { Chips } from './parts';
export function MapGraphicFields({text,onChange}:{text:TextItem;onChange:(changes:Partial<TextItem>,group?:string)=>void}) {
  const graphic=text.graphic!,canonical=(graphic.map_places ?? []).map((p)=>`${p.name}, ${p.lat}, ${p.lon}`).join('\n');
  const [draft,setDraft]=useState(canonical),[error,setError]=useState(''),saved=useRef(canonical);
  useEffect(()=>{if(canonical!==saved.current){setDraft(canonical);saved.current=canonical;}},[canonical]);
  return <><label>{t('Map places')}<textarea className="ed-text" aria-label={t('Map places')} lang="ta" rows={5} placeholder={t('name, latitude, longitude')} value={draft} onChange={(event)=>{
    const value=event.target.value;setDraft(value);const lines=value.split('\n').filter((line)=>line.trim());const points=lines.map((line)=>{const [name,lat,lon,...rest]=line.split(',');return {name:name?.trim(),lat:Number(lat),lon:Number(lon),bad:!lat?.trim() || !lon?.trim() || rest.length>0};});
    if(points.length<1 || points.length>8 || points.some((p)=>p.bad || !p.name || p.name.length>120 || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat)>85 || Math.abs(p.lon)>180)){setError('Add 1–8 places as name, latitude, longitude.');return;}
    setError('');const map_places=points.map(({name,lat,lon})=>({name,lat,lon}));saved.current=map_places.map((p)=>`${p.name}, ${p.lat}, ${p.lon}`).join('\n');onChange({graphic:{...graphic,map_places}},`map-places-${text.id}`);
  }}/></label>{error && <p className="ed-error">{t(error)}</p>}<Chips label="Region" value={graphic.map_region ?? 'india'} options={[{id:'world' as const,label:'World'},{id:'india' as const,label:'India'},{id:'tamil-nadu' as const,label:'Tamil Nadu'}]} onPick={(map_region)=>onChange({graphic:{...graphic,map_region}})}/>
  <More><label className="ed-check"><input type="checkbox" checked={graphic.map_zoom ?? true} onChange={(event)=>onChange({graphic:{...graphic,map_zoom:event.target.checked}})}/>{t('Zoom into region')}</label><label className="ed-check"><input type="checkbox" checked={graphic.map_route ?? true} onChange={(event)=>onChange({graphic:{...graphic,map_route:event.target.checked}})}/>{t('Draw route between places')}</label></More></>;
}
