import {clamp,blendPose,sampleJourney,selectionPose} from './petal-model.js';

export async function mountPetalJourney(){
  const response=await fetch('/assets/flower.svg');if(!response.ok)return;
  const doc=new DOMParser().parseFromString(await response.text(),'image/svg+xml');
  const paths=[...doc.querySelectorAll('path')];if(paths.length!==5)return;
  const ns='http://www.w3.org/2000/svg',layer=document.createElement('div');
  layer.className='petal-journey';layer.setAttribute('aria-hidden','true');layer.inert=true;
  const petals=paths.map((path,i)=>{const outer=document.createElement('div');outer.className='journey-petal';outer.dataset.petal=String(i);const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 470 388');svg.setAttribute('width','470');svg.setAttribute('height','388');const pivot=document.createElementNS(ns,'g');const local=document.createElementNS(ns,'g');const shape=document.importNode(path,true);shape.removeAttribute('id');local.append(shape);pivot.append(local);svg.append(pivot);outer.append(svg);layer.append(outer);return {outer,svg,pivot,pose:null};});
  document.body.append(layer);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const portal=location.pathname.replace(/\/$/,'')==='/portal';
  document.body.classList.add('has-petal-journey');
  let stops=[],frame=0,last=0,started=performance.now(),settleUntil=0,portalRevision=0,hidden=false;
  let dimensions={w:innerWidth,h:innerHeight},lastIntent=performance.now();
  const anchors=new Map();
  const rect=(selector)=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left,y:r.top+scrollY,w:r.width,h:r.height};};
  function flower(r,opacity=1){return petals.map(()=>({x:r.x+235*r.w/470,y:r.y+335*r.w/470,r:0,s:r.w/470,o:opacity}));}
  function spread(r,kind){const mobile=dimensions.w<700;const scale=mobile?.42:.70;const offsets={etha:[[.56,.15,-28],[.87,.06,28],[1.02,.35,-18],[.90,.95,48],[.59,.87,-38]],ambo:[[.18,.15,-12],[.92,.30,24],[.82,.66,-22],[.32,.97,35],[1.02,.94,-32]],minne:[[.90,.10,8],[.55,.18,-28],[1.02,.48,26],[.60,.94,-22],[.89,.95,32]],open:[[.58,.24,-35],[.84,.13,-15],[.95,.55,32],[.62,.86,-48],[.82,.90,40]],meet:[[.70,.28,-18],[.85,.42,-10],[.76,.60,18],[.83,.78,-15],[.68,.91,25]],continuity:[[.82,.17,0],[.91,.36,12],[.85,.56,22],[.94,.76,32],[.83,.95,42]]}[kind];
    return offsets.map(([x,y,angle],i)=>({x:r.x+r.w*x,y:r.y+r.h*y,r:angle,s:scale*(i===0?.94:1),o:mobile?.38:.48}));}
  function measure(){dimensions={w:innerWidth,h:innerHeight};anchors.clear();for(const key of ['.hero-flower','#etha','#ambo','#minne','.connection','#combinacao','.closing-top','.pilot','.portal-main']){const r=rect(key);if(r)anchors.set(key,r);}if(portal){schedule();return;}
    const h=dimensions.h,hero=anchors.get('.hero-flower'),closing=anchors.get('.closing-top');if(!hero||!closing)return;
    const read=selector=>{const r=anchors.get(selector);return Math.max(0,r.y+Math.min(r.h*.45,h*.55)-h*.5);};
    stops=[{at:0,poses:flower(hero)}];
    for(const [sel,kind] of [['#etha','etha'],['#ambo','ambo'],['#minne','minne']]){const r=anchors.get(sel),at=read(sel);stops.push({at:Math.max(stops.at(-1).at+1,at-100),poses:spread(r,kind)},{at:Math.max(stops.at(-1).at+2,at+100),poses:spread(r,kind)});}
    const connection=anchors.get('.connection'),travel=Math.max(1,connection.h-h);
    for(const [t,kind] of [[0,'open'],[.5,'meet'],[1,'continuity']]){const at=connection.y+travel*t;stops.push({at,poses:spread({x:24,y:at+h*.2,w:dimensions.w-48,h:h*.62},kind)});}
    const combination=anchors.get('#combinacao');const cAt=read('#combinacao');stops.push({at:cAt,poses:spread(combination,'meet')},{at:cAt+140,poses:spread(combination,'meet')});
    const mobile=dimensions.w<700;const width=mobile?100:Math.min(400,closing.w*.30);const end={x:mobile?dimensions.w-width-24:closing.x+closing.w-width,y:mobile?closing.y+closing.h-80:closing.y+Math.max(0,(closing.h-width*.825)/2),w:width,h:width*.825};
    const endAt=Math.max(stops.at(-1).at+1,closing.y-h*.25);stops.push({at:endAt,poses:flower(end)},{at:Math.max(endAt+1,document.documentElement.scrollHeight-h),poses:flower(end)});
    stops.sort((a,b)=>a.at-b.at);schedule();}
  function selection(){return [...document.querySelectorAll('[data-service][aria-pressed=true]')].map(b=>b.dataset.service);}
  function target(i,now){let p;
    if(portal){const mobile=dimensions.w<700;const main=document.querySelector('.portal-main');if(!main)return petals[i].pose;const r=main.getBoundingClientRect(),width=mobile?160:Math.min(400,r.width*.42);const base={x:dimensions.w-width-20,y:Math.max(300,dimensions.h-width*.825-24)+scrollY,w:width,h:width*.825};p=flower(base,.45)[i];const amount=portalRevision%5;p={...p,x:p.x+Math.sin(i*1.7+amount)*8,y:p.y+Math.cos(i+amount)*6,r:Math.sin(i*1.3+amount)*5};
    }else{p=sampleJourney(stops,scrollY,i);const c=anchors.get('#combinacao'),end=anchors.get('.closing-top');if(c&&end){const weight=clamp((scrollY-(c.y-dimensions.h*.6))/180)*clamp((end.y-dimensions.h*.3-scrollY)/220);const changed=selectionPose(p,i,selection());p=blendPose(p,changed,weight,i);}
      const pilot=document.querySelector('.pilot');if(pilot?.open&&scrollY>(end?.y||Infinity)-dimensions.h*.6)p={...p,x:p.x+(i%2?6:-6),r:p.r+(i-2)*2};
    }
    if(!p)return null;
    const reading=document.activeElement?.matches('input,textarea,select')||document.querySelector('dialog[open]');
    // Finite settling gesture: no perpetual animation while reading or offscreen.
    const idle=!reduced.matches&&!reading&&now<settleUntil&&now-lastIntent>160;
    const remaining=clamp((settleUntil-now)/1800);if(idle){p={...p,r:p.r+Math.sin((now-started)/1400+i*1.8)*.9*remaining,y:p.y+Math.sin((now-started)/1700+i*1.3)*1.5*remaining};}
    if(!portal&&!reduced.matches){const entrance=clamp((now-started-i*45)/1100);const energy=(1-entrance)**3;p={...p,x:p.x+[-3,-20,22,-25,26][i]*energy,y:p.y+[-12,8,5,15,14][i]*energy,r:p.r+[-4,-9,9,-12,12][i]*energy};}
    if(reduced.matches)p={...p,x:dimensions.w-62,y:scrollY+dimensions.h-38,r:0,s:.19*(p.s<.6?.85:1),o:.30};
    p={...p,y:p.y-scrollY};return p;}
  function tick(now){frame=0;if(hidden||!stops.length&&!portal)return;const dt=Math.min(now-last||16,32);last=now;let moving=false;
    petals.forEach((petal,i)=>{const goal=target(i,now);if(!goal)return;if(!petal.pose)petal.pose={...goal};const p=petal.pose;const rate=reduced.matches?1:1-Math.exp(-dt/(portal?115:85+i*9));for(const key of ['x','y','r','s','o']){const delta=goal[key]-p[key];if(Math.abs(delta)>.015)moving=true;p[key]+=delta*rate;}
      // Clamp the rendering layer, not the document: decorative overflow never scrolls.
      const visible=p.y>-400&&p.y<dimensions.h+400;petal.outer.style.visibility=visible?'visible':'hidden';petal.outer.style.transform=`translate3d(${p.x}px,${p.y}px,0) scale(${p.s})`;petal.outer.style.opacity=p.o;petal.pivot.style.transform=`rotate(${p.r}deg)`;
    });
    if(moving||!reduced.matches&&(now-started<1450||now<settleUntil))frame=requestAnimationFrame(tick);else last=0;}
  function schedule(){if(!frame&&!hidden)frame=requestAnimationFrame(tick);}
  function intention(){lastIntent=performance.now();settleUntil=lastIntent+(portal?700:2300);schedule();}
  addEventListener('scroll',intention,{passive:true});addEventListener('resize',measure,{passive:true});
  document.addEventListener('click',e=>{if(e.target.closest('[data-service],[data-portal],[data-goto],[data-active]')){portalRevision++;requestAnimationFrame(()=>{if(portal)measure();intention();});}},true);
  document.querySelector('.pilot')?.addEventListener('toggle',()=>{measure();intention();});
  document.addEventListener('focusin',()=>{settleUntil=0;schedule();});
  document.addEventListener('visibilitychange',()=>{hidden=document.hidden;if(hidden){cancelAnimationFrame(frame);frame=0;}else{measure();schedule();}});
  reduced.addEventListener('change',()=>{settleUntil=0;schedule();});
  const resize=new ResizeObserver(()=>measure());for(const el of document.querySelectorAll('.story,.commercial,.closing,#portal'))resize.observe(el);
  measure();document.fonts.ready.then(measure);intention();
  return ()=>{cancelAnimationFrame(frame);resize.disconnect();layer.remove();};
}



