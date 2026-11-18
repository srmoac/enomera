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
  let stops=[],frame=0,last=0,started=performance.now(),settleUntil=0,portalRevision=0,hidden=false,snapNext=false;
  let dimensions={w:innerWidth,h:innerHeight},lastIntent=performance.now(),lastScroll=0;
  const anchors=new Map();
  const rect=(selector)=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.left,y:r.top+scrollY,w:r.width,h:r.height};};
  function flower(r,opacity=1){return petals.map(()=>({x:r.x+235*r.w/470,y:r.y+335*r.w/470,r:0,s:r.w/470,o:opacity}));}
  function spread(r,kind){const mobile=dimensions.w<700;const scale=mobile?.34:.62;
    const desktopOffsets={
      etha:[[.34,.22,-24],[.82,.10,26],[.98,.40,-18],[.88,.94,44],[.42,.88,-34]],
      ambo:[[.32,.20,-14],[.88,.28,24],[.78,.66,-22],[.40,.95,32],[.98,.92,-30]],
      minne:[[.88,.12,10],[.36,.22,-24],[.98,.48,26],[.44,.92,-20],[.86,.95,32]],
      open:[[.18,.35,-28],[.42,.22,-12],[.66,.48,26],[.82,.72,-32],[.94,.82,34]],
      meet:[[.26,.30,-16],[.48,.42,-8],[.68,.55,16],[.84,.68,-14],[.95,.80,22]],
      continuity:[[.32,.26,0],[.54,.38,10],[.72,.52,20],[.86,.68,28],[.96,.84,36]]
    };
    const mobileOffsets={
      etha:[[1.04,.48,-16],[1.02,.60,26],[1.04,.74,-10],[1.06,.86,34],[1.04,.96,-18]],
      ambo:[[1.04,.46,-10],[1.02,.58,24],[1.04,.72,-12],[1.06,.86,32],[1.04,.96,-16]],
      minne:[[1.04,.46,8],[1.02,.60,-14],[1.04,.74,20],[1.06,.86,-12],[1.04,.96,24]],
      open:[[.86,.35,-20],[.94,.25,-8],[.98,.52,20],[.90,.74,-22],[.96,.88,24]],
      meet:[[.86,.35,-12],[.94,.44,-8],[.98,.58,14],[.90,.74,-10],[.96,.88,18]],
      continuity:[[.86,.32,0],[.94,.44,10],[.98,.58,16],[.90,.74,22],[.96,.88,26]]
    };
    const offsets=(mobile?mobileOffsets:desktopOffsets)[kind];
    const poses=offsets.map(([x,y,angle],i)=>({x:r.x+r.w*x,y:r.y+r.h*y,r:angle,s:scale*(i===0?.94:1),o:mobile?.36:.48}));
    const lead={etha:1,ambo:2,minne:0}[kind];
    if(lead!==undefined){
      const destination=rect({etha:'#etha .helena',ambo:'#ambo-demo',minne:'#mini-content'}[kind])||r;
      poses[lead]={x:destination.x+destination.w*(mobile?.86:.80),y:destination.y+Math.min(destination.h*.42,150),r:{etha:-24,ambo:22,minne:8}[kind],s:mobile?.31:.48,o:.82};
      for(let i=0;i<5;i++)if(i!==lead)poses[i].o=mobile?.23:.34;
    }
    return poses;}
  function measure(){dimensions={w:innerWidth,h:innerHeight};anchors.clear();for(const key of ['.hero-flower','#etha','#etha .demo-wrap','#ambo','#ambo .demo-wrap','#minne','#minne .demo-wrap','.connection','#combinacao','#service-options','.closing-top','.pilot','.portal-main']){const r=rect(key);if(r)anchors.set(key,r);}if(portal){schedule();return;}
    const h=dimensions.h,mobile=dimensions.w<700,hero=anchors.get('.hero-flower'),closing=anchors.get('.closing-top');if(!hero||!closing)return;
    const read=selector=>{const r=anchors.get(selector);return Math.max(0,r.y+Math.min(r.h*.45,h*.55)-h*.5);};
    stops=[{at:0,poses:flower(hero)},{at:180,poses:flower(hero).map((p,i)=>({...p,x:p.x+[-8,-36,38,-12,18][i],y:p.y+[-26,8,14,12,20][i],r:[-3,-10,12,-4,5][i]}))}];
    for(const [sel,kind] of [['#etha','etha'],['#ambo','ambo'],['#minne','minne']]){const demo=anchors.get(sel+' .demo-wrap')||anchors.get(sel),at=read(demo?sel+' .demo-wrap':sel);stops.push({at:Math.max(stops.at(-1).at+1,at-90),poses:spread(demo,kind)},{at:Math.max(stops.at(-1).at+2,at+90),poses:spread(demo,kind)});}
    const connection=anchors.get('.connection'),travel=Math.max(1,connection.h-h);
    for(const [t,kind] of [[0,'open'],[.5,'meet'],[1,'continuity']]){const at=connection.y+travel*t;const zone=mobile?{x:36,y:at+h*.88,w:dimensions.w-64,h:h*.10}:{x:dimensions.w*.54,y:at+h*.84,w:dimensions.w*.42,h:h*.13};stops.push({at,poses:spread(zone,kind)});}
    const combination=anchors.get('#combinacao'),serviceCards=anchors.get('#service-options')||combination;const cAt=read('#combinacao');const cZone=mobile?{x:serviceCards.x+serviceCards.w*.75,y:serviceCards.y+60,w:serviceCards.w*.28,h:Math.max(280,combination.y+combination.h-serviceCards.y-100)}:{x:serviceCards.x+serviceCards.w*.44,y:serviceCards.y+40,w:serviceCards.w*.56,h:Math.max(280,combination.y+combination.h-serviceCards.y-100)};stops.push({at:cAt,poses:spread(cZone,'meet')},{at:cAt+140,poses:spread(cZone,'meet')});
    const width=mobile?100:Math.min(400,closing.w*.30),pilotRect=anchors.get('.pilot');const end={x:mobile?dimensions.w-width-24:closing.x+closing.w-width,y:mobile?(pilotRect?pilotRect.y+12:closing.y+closing.h+16):closing.y+Math.max(0,(closing.h-width*.825)/2),w:width,h:width*.825};
    const endAt=Math.max(stops.at(-1).at+1,closing.y-h*.25);stops.push({at:endAt,poses:flower(end)},{at:Math.max(endAt+1,document.documentElement.scrollHeight-h),poses:flower(end)});
    stops.sort((a,b)=>a.at-b.at);schedule();}
  function selection(){return [...document.querySelectorAll('[data-service][aria-pressed=true]')].map(b=>b.dataset.service);}
  function target(i,now,context){let p;
    if(portal){const mobile=dimensions.w<700;const main=document.querySelector('.portal-main');if(!main)return petals[i].pose;const r=context.portalRect,width=mobile?160:Math.min(400,r.width*.42);const base={x:dimensions.w-width-20,y:Math.max(300,dimensions.h-width*.825-24)+scrollY,w:width,h:width*.825};p=flower(base,.45)[i];const amount=portalRevision%5;p={...p,x:p.x+Math.sin(i*1.7+amount)*8,y:p.y+Math.cos(i+amount)*6,r:Math.sin(i*1.3+amount)*5};
    }else{p=sampleJourney(stops,scrollY,i);const c=anchors.get('#combinacao'),end=anchors.get('.closing-top');if(c&&end){const weight=clamp((scrollY-(c.y-dimensions.h*.6))/180)*clamp((end.y-dimensions.h*.3-scrollY)/220);const changed=selectionPose(p,i,context.selected);p=blendPose(p,changed,weight,i);}
      if(context.pilotOpen&&scrollY>(end?.y||Infinity)-dimensions.h*.6)p={...p,x:p.x+(i%2?6:-6),r:p.r+(i-2)*2};
    }
    if(!p)return null;
    const reading=context.reading;
    // Finite settling gesture: no perpetual animation while reading or offscreen.
    const idle=!reduced.matches&&!reading&&now<settleUntil&&now-lastIntent>160;
    const remaining=clamp((settleUntil-now)/1800);if(idle){p={...p,r:p.r+Math.sin((now-started)/1400+i*1.8)*.9*remaining,y:p.y+Math.sin((now-started)/1700+i*1.3)*1.5*remaining};}
    if(!portal&&!reduced.matches){const entrance=clamp((now-started-i*45)/1100);const energy=(1-entrance)**3;p={...p,x:p.x+[-3,-20,22,-25,26][i]*energy,y:p.y+[-12,8,5,15,14][i]*energy,r:p.r+[-4,-9,9,-12,12][i]*energy};}
    if(reduced.matches)p={...p,x:dimensions.w-62,y:scrollY+dimensions.h-38,r:0,s:.19*(p.s<.6?.85:1),o:.30};
    p={...p,y:p.y-scrollY};return p;}
  const eps={x:.2,y:.2,r:.08,s:.002,o:.003};
  function tick(now){frame=0;if(hidden||!stops.length&&!portal)return;const snap=snapNext||reduced.matches;snapNext=false;if(!snap&&document.activeElement?.matches('input,textarea,select')&&now-lastScroll>48){last=0;return;}const dt=Math.min(now-last||16,32);last=now;let moving=false;
    const context={selected:selection(),reading:document.activeElement?.matches('input,textarea,select')||document.querySelector('dialog[open]'),pilotOpen:document.querySelector('.pilot')?.open,portalRect:portal?document.querySelector('.portal-main')?.getBoundingClientRect():null};
    petals.forEach((petal,i)=>{const goal=target(i,now,context);if(!goal)return;if(!petal.pose||snap)petal.pose={...goal};const p=petal.pose;const rate=snap?1:1-Math.exp(-dt/(portal?115:85+i*9));for(const key of ['x','y','r','s','o']){const delta=goal[key]-p[key];if(Math.abs(delta)>eps[key]){moving=true;p[key]+=delta*rate;}else p[key]=goal[key];}
      // Clamp the rendering layer, not the document: decorative overflow never scrolls.
      const visible=p.y>-400&&p.y<dimensions.h+400;petal.outer.style.visibility=visible?'visible':'hidden';petal.outer.style.transform=`translate3d(${p.x}px,${p.y}px,0) scale(${p.s})`;petal.outer.style.opacity=p.o;petal.pivot.style.transform=`rotate(${p.r}deg)`;
    });
    if(moving||!reduced.matches&&(now-started<1450||now<settleUntil))frame=requestAnimationFrame(tick);else last=0;}
  function schedule(){if(!frame&&!hidden)frame=requestAnimationFrame(tick);}
  function intention(){lastIntent=performance.now();settleUntil=document.activeElement?.matches('input,textarea,select')?0:lastIntent+(portal?700:2300);schedule();}
  addEventListener('scroll',()=>{lastScroll=performance.now();intention();},{passive:true});addEventListener('resize',()=>{snapNext=true;measure();},{passive:true});
  document.addEventListener('click',e=>{if(e.target.closest('[data-service],[data-portal],[data-goto],[data-active]')){portalRevision++;requestAnimationFrame(()=>{if(portal)measure();intention();});}},true);
  document.querySelector('.pilot')?.addEventListener('toggle',()=>{measure();intention();});
  document.addEventListener('focusin',()=>{settleUntil=0;if(document.activeElement?.matches('input,textarea,select')){cancelAnimationFrame(frame);frame=0;last=0;}else schedule();});
  document.addEventListener('visibilitychange',()=>{hidden=document.hidden;if(hidden){cancelAnimationFrame(frame);frame=0;}else{measure();schedule();}});
  reduced.addEventListener('change',()=>{settleUntil=0;schedule();});
  const resize=new ResizeObserver(()=>measure());for(const el of document.querySelectorAll('.story,.commercial,.closing,#portal'))resize.observe(el);
  measure();document.fonts.ready.then(measure);intention();
  return ()=>{cancelAnimationFrame(frame);resize.disconnect();layer.remove();};
}



