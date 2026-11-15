import type { TextItem, TitleDepth } from './model';
export const MATERIAL_LOOKS: { id: NonNullable<TitleDepth['material']>; label: string; depth: TitleDepth }[] = [
  { id: 'gold', label: 'Gold', depth: { amount: .22, color: '#80511c', light: .7, material: 'gold', bevel: .7, shine: .8 } },
  { id: 'chrome', label: 'Chrome / silver', depth: { amount: .18, color: '#465467', light: .8, material: 'chrome', bevel: .8, shine: 1 } },
  { id: 'stone', label: 'Stone / carved', depth: { amount: .25, color: '#45413a', light: .35, material: 'stone', bevel: .25, shine: 0 } },
  { id: 'neon', label: 'Neon glow', depth: { amount: .06, color: '#207d9e', light: .8, material: 'neon', bevel: .5, shine: .25 } },
  { id: 'glass', label: 'Glass', depth: { amount: .12, color: '#a6cfdf', light: .8, material: 'glass', bevel: 1, shine: .9 } },
];
export function sweepAt(text: TextItem, local: number) {
  if (!text.depth?.sweep) return -2;
  const first = text.enter?.duration ?? 0, last = text.exit?.duration ?? 0;
  const entrance = first / Math.max(1, (first + last) / text.length);
  const q = (local - entrance) / .9;
  return q >= 0 && q <= 1 ? -.3 + 1.6 * q : -2;
}
// Same material_face maths as title_material.py. raw sampling occurs before letter/picture tricks.
export const MATERIAL_FRAGMENT = `
uniform vec4 material; // kind, bevel, shine, sweep position
vec4 face(vec2 at, vec4 c) {
  if (material.x < .5 || shade.a > .5) return c;
  float x = (at.x-letters.x)/max(1.,letters.z-letters.x);
  float y = (at.y-letters.y)/max(1.,letters.w-letters.y);
  float radius = max(1.,(letters.w-letters.y)*.025*material.y);
  float avg = (texture(tex,(at+vec2(radius,0.))/frame).a + texture(tex,(at-vec2(radius,0.))/frame).a + texture(tex,(at+vec2(0.,radius))/frame).a + texture(tex,(at-vec2(0.,radius))/frame).a)/4.;
  float edge = clamp(c.a-avg,0.,1.)*material.y;
  vec3 low=vec3(.32,.12,.025), high=vec3(1.,.83,.36);
  if (material.x > 1.5 && material.x < 2.5) {low=vec3(.12,.18,.27);high=vec3(.91,.97,1.);}
  if (material.x > 2.5 && material.x < 3.5) {low=vec3(.27,.25,.23);high=vec3(.68,.65,.59);}
  if (material.x > 3.5 && material.x < 4.5) {low=vec3(.12,.5,.65);high=vec3(.35,.95,1.);}
  if (material.x > 4.5) {low=vec3(.38,.65,.76);high=vec3(.87,.98,1.);}
  float band=.5+.5*cos((y*2.6-.35)*3.14159265359);
  float shine=exp(-pow((y-.3)/.055,2.))*material.z;
  float moving=material.w > -1. ? exp(-pow((x+(y-.5)*.35-material.w)/.045,2.)) : 0.;
  vec3 rgb=min(vec3(c.a),mix(low,high,band)*c.a+c.a*(shine*.55+moving*.8)+edge*.8);
  if(material.x>4.5){float a=c.a*.38+edge*.6;return vec4(min(vec3(a),rgb*.38+edge*.6),a);}
  if(material.x>2.5 && material.x<4.5){
    float radius=max(1.,(letters.w-letters.y)*.045); float halo=0.;
    if(material.x>3.5){
      halo=(texture(tex,(at+vec2(radius,0.))/frame).a+texture(tex,(at+vec2(-radius,0.))/frame).a+texture(tex,(at+vec2(0.,radius))/frame).a+texture(tex,(at+vec2(0.,-radius))/frame).a+texture(tex,(at+vec2(radius,radius))/frame).a+texture(tex,(at+vec2(-radius,radius))/frame).a+texture(tex,(at+vec2(radius,-radius))/frame).a+texture(tex,(at+vec2(-radius,-radius))/frame).a)*.55/8.;
    } else {halo=(texture(tex,(at+vec2(-radius,-radius))/frame).a+texture(tex,(at+vec2(0.,-radius))/frame).a+texture(tex,(at+vec2(radius,-radius))/frame).a)*.3/3.;}
    vec3 tint=material.x>3.5?vec3(.12,.7,1.):vec3(0.);
    return vec4(rgb+halo*tint*(1.-c.a),c.a+halo*(1.-c.a));
  }
  return vec4(rgb,c.a);
}`;
