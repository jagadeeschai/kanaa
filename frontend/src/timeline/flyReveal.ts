import type { TextItem } from './model';
export const FLY_PRESETS = new Set(['fly-reveal', 'fly-through-3d']);
export function flyState(text: TextItem, local: number): [number, number] | null {
  const first=text.enter?.duration??0, last=text.exit?.duration??0;
  const excess=Math.max(1,(first+last)/text.length), a=first/excess,b=last/excess;
  let q: number;
  if(text.enter && FLY_PRESETS.has(text.enter.preset) && local<a) q=local/a;
  else if(text.exit && FLY_PRESETS.has(text.exit.preset) && local>text.length-b) q=(text.length-local)/b;
  else return null;
  const smooth=(a:number,b:number)=>{const p=Math.max(0,Math.min(1,(q-a)/(b-a)));return p*p*(3-2*p);};
  return [smooth(.68,1),smooth(.76,1)];
}
