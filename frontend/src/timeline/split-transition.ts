import type { Transition } from './animation';
export type SplitPanel = { rect: number[]; move: number[] };
/** Mirrors split_transition.panels: top-left frame pixels on the shared two-pixel chroma grid, p=k/frameCount. */
export function splitPanels(p:number,n=2,direction:NonNullable<Transition['split_direction']>='horizontal',width=1920,height=1080,style:NonNullable<Transition['split_style']>='clean'):SplitPanel[] {
  p=Math.max(0,Math.min(1,p));const e=p*p*(3-2*p),vertical=direction==='vertical',span=vertical?height:width;
  return Array.from({length:n},(_,i)=>{const lo=2*Math.floor(i*span/n/2),hi=2*Math.floor((i+1)*span/n/2),sign=i<(n-1)/2?-1:i>(n-1)/2?1:0;
    const extra=Math.max(0,Math.abs(i-(n-1)/2)-(n%2?1:.5)),travelX=2*Math.ceil((width+extra*width/n)/2),travelY=2*Math.ceil((height+extra*height/n)/2);
    const dx=vertical?0:sign*travelX*e,dy=!sign?-height*e:vertical||direction==='diagonal'?sign*travelY*e:0;
    return {rect:vertical?[0,lo,width,hi-lo]:[lo,0,hi-lo,height],move:[2*Math.floor(dx/2+.5),2*Math.floor(dy/2+.5),!sign?1-e:1,style==='gap'?2*Math.ceil(e*Math.max(1,Math.min(width,height)*.006)/2):0]};});
}
/** Applied to the already posed outgoing/incoming textures, preserving their alpha. Geometry comes from splitPanels. */
export const SPLIT_SHADER = `
uniform vec4 splitRect[4], splitMove[4]; uniform float splitShadow;
vec4 splitPicture(vec2 at) {
  vec4 result=B(at);
  for(int i=0;i<4;i++) {
    vec4 r=splitRect[i],m=splitMove[i];if(r.z<=0.||m.z<=0.)continue;
    vec2 local=at-m.xy-r.xy;
    if(splitShadow>0.) {
      float distance=max(max(-local.x,local.x-(r.z-1.)),max(-local.y,local.y-(r.w-1.)));
      float alpha=.22*q*q*(3.-2.*q)*m.z*pow(max(0.,1.-max(0.,distance)/splitShadow),2.);
      result=vec4(0.,0.,0.,alpha)+result*(1.-alpha);
    }
    if(local.x>=(r.x>0.?m.w:0.)&&local.y>=(r.y>0.?m.w:0.)&&local.x<r.z-(r.x+r.z<frame.x?m.w:0.)&&local.y<r.w-(r.y+r.w<frame.y?m.w:0.)){vec4 panel=A(at-m.xy)*m.z;result=panel+result*(1.-panel.a);}
  }
  return result;
}`;
