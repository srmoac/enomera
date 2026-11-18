// Document-space anchors and a shared identity for the five official brand paths.
export const clamp = (x, a=0, b=1) => Math.min(b, Math.max(a,x));
export const smooth = t => {t=clamp(t);return t*t*(3-2*t);};
export function blendPose(a,b,t,i=0){
  // A quadratic arc vanishes at both ends; every petal has its own bend.
  const u=smooth(t),arc=4*u*(1-u),bend=[-28,40,-35,52,-46][i];
  return {x:a.x+(b.x-a.x)*u+arc*bend,y:a.y+(b.y-a.y)*u+arc*[24,-35,42,-22,31][i],r:a.r+(b.r-a.r)*u,s:a.s+(b.s-a.s)*u,o:a.o+(b.o-a.o)*u};
}
export function sampleJourney(stops,y,i){
  if(y<=stops[0].at)return stops[0].poses[i];
  for(let n=1;n<stops.length;n++)if(y<=stops[n].at){const a=stops[n-1],b=stops[n];const t=(y-a.at)/Math.max(1,b.at-a.at);return blendPose(a.poses[i],b.poses[i],t,i);}
  return stops.at(-1).poses[i];
}
export function selectionPose(p,i,selected){
  const service=['minne','etha','ambo',null,null][i];
  if(!service)return p;
  return selected.includes(service)?p:{...p,x:p.x+(i%2?26:-26),y:p.y+22,r:p.r+(i%2?22:-22),s:p.s*.78,o:p.o*.62};
}
