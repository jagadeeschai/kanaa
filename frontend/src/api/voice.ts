import type { Timeline } from '../timeline/model';
export type Voice = {name:string;language:string;family:string|null;price_per_million:number|null;sentence_captions:boolean};
export type VoiceQuote = {quote:string;usd:number;preview_usd:number;sentences:number;cached_sentences:number;sentence_captions:boolean;pricing_url:string};
export type VoiceLine = {asset_id:string;text:string;duration:number;caption_timing:string};
export async function voiceRequest<T>(path:string,body?:unknown,method?:string):Promise<T> {
  const response=await fetch(`/api/voice/${path}`,{method:method ?? (body ? 'POST':'GET'),headers:body ? {'Content-Type':'application/json'}:undefined,body:body ? JSON.stringify(body):undefined});
  if(!response.ok) { const error=await response.json().catch(()=>({})); throw new Error(typeof error.detail==='string' ? error.detail:'The voice request could not be completed.'); }
  return response.json() as Promise<T>;
}
