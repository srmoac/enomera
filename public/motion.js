// Native scroll and WAAPI share the existing architecture; no gesture interception.
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const animations=new WeakMap();
function tween(el,frames,duration=240){const old=animations.get(el);old?.cancel();if(reduce.matches)return;const easing=getComputedStyle(document.documentElement).getPropertyValue('--ease').trim()||'ease-out';const a=el.animate(frames,{duration,easing});animations.set(el,a);a.finished.catch(()=>{});}
import {mountPetalJourney} from './petals.js';
await mountPetalJourney();
function updateScroll(){updateSiteIndicator();}
addEventListener('scroll',updateScroll,{passive:true});
// A persistent lens moves between single-selection controls. Labels never move.
function lens(group,selector){
  if(!group)return;const active=group.querySelector(selector);if(!active)return;
  let marker=group.querySelector(':scope > .motion-lens');const entering=!marker;
  if(!marker){marker=document.createElement('span');marker.className='motion-lens';marker.setAttribute('aria-hidden','true');marker.style.transition='none';group.prepend(marker);}
  const g=group.getBoundingClientRect(),r=active.getBoundingClientRect();
  const x=r.left-g.left+group.scrollLeft,y=r.top-g.top+group.scrollTop;
  marker.style.width=`${r.width}px`;marker.style.height=`${r.height}px`;
  marker.style.borderRadius=group.id==='nav-links'?'20px':getComputedStyle(active).borderRadius;
  marker.style.transform=`translate(${x}px,${y}px)`;
  if(entering)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(marker.isConnected)marker.style.transition='';}));
}
function updateSiteIndicator(){const nav=document.querySelector('#nav-links');if(!nav||innerWidth<701)return;let id='produtos';for(const [sel,key] of [['#como-funciona','como-funciona'],['#combinacao','combinacao']])if(document.querySelector(sel)?.getBoundingClientRect().top<innerHeight*.45)id=key;const target=nav.querySelector(`a[href="/#${id}"]`);if(target){nav.querySelectorAll('a').forEach(a=>a.toggleAttribute('data-current',a===target));lens(nav,'[data-current]');}}
function refresh(){lens(document.querySelector('.billing-toggle'),'[aria-pressed="true"]');lens(document.querySelector('.mini-sidebar'),'[aria-pressed="true"]');lens(document.querySelector('.portal-side nav'),'[aria-current="page"]:not([hidden])');lens(document.querySelector('[aria-label="Modalidade"]'),'[aria-pressed="true"]');}
const observer=new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('.motion-lens')))return;refresh();});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-pressed','aria-current']});refresh();updateScroll();addEventListener('resize',()=>{refresh();updateScroll();});
// Only new content enters. Controls and persistent rows stay still.
let pointerAction=false;
document.addEventListener('pointerdown',()=>{pointerAction=true;},{passive:true});
document.addEventListener('keydown',()=>{pointerAction=false;},true);
document.addEventListener('click',e=>{
  const trigger=e.target.closest('[data-ambo],[data-mini],[data-portal],[data-goto]');
  if(!trigger||!pointerAction)return;
  const region=trigger.closest('.ambo')||document.querySelector('#portal-content')||document.querySelector('#mini-content');
  const children=new Set(region?.children);
  requestAnimationFrame(()=>{
    const current=region?.isConnected?region:document.querySelector('#portal-content');
    if(!current)return;
    for(const child of current.children)if(!children.has(child)&&!child.matches('button,a,input,select,textarea,.motion-lens'))tween(child,[{opacity:.65,transform:'translateY(4px)'},{opacity:1,transform:'none'}],180);
    refresh();
  });
},true);
// Native details semantics, with reversible measured disclosure motion.
for(const details of document.querySelectorAll('details.pilot')){
  const summary=details.querySelector('summary');
  const content=document.createElement('div');content.className='disclosure-content';
  while(summary.nextSibling)content.append(summary.nextSibling);
  details.append(content);let running=null,wanted=details.open;
  summary.addEventListener('click',e=>{
    e.preventDefault();wanted=!wanted;
    const from=details.getBoundingClientRect().height;
    running?.cancel();details.open=true;
    const to=wanted?details.scrollHeight:summary.getBoundingClientRect().height+parseFloat(getComputedStyle(details).paddingTop)+parseFloat(getComputedStyle(details).paddingBottom)+2;
    if(reduce.matches||e.detail===0){details.open=wanted;details.style.height='';return;}
    details.style.overflow='hidden';
    running=details.animate([{height:`${from}px`},{height:`${to}px`}],{duration:wanted?220:160,easing:'cubic-bezier(.23,1,.32,1)'});
    running.onfinish=()=>{details.open=wanted;details.style.overflow='';running=null;};
  });
}
// Existing menu owns visibility; this layer adds focus management and reversible motion.
const toggle=document.querySelector('.menu-toggle'),nav=document.querySelector('#nav-links');let opener=null;
function menuState(){const open=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-label',open?'Fechar menu':'Abrir menu');nav.inert=innerWidth<701&&!open;if(open){opener=document.activeElement;requestAnimationFrame(()=>{if(toggle.getAttribute('aria-expanded')==='true')nav.querySelector('a')?.focus({preventScroll:true});});}else{const byLink=toggle.dataset.closeReason==='link';delete toggle.dataset.closeReason;if(!byLink&&opener&&nav.contains(document.activeElement))toggle.focus({preventScroll:true});opener=null;}}
new MutationObserver(menuState).observe(toggle,{attributes:true,attributeFilter:['aria-expanded']});menuState();addEventListener('resize',menuState);
document.addEventListener('keydown',e=>{if(innerWidth>700||toggle.getAttribute('aria-expanded')!=='true'||e.key!=='Tab')return;const links=[toggle,...nav.querySelectorAll('a')];const index=links.indexOf(document.activeElement);if(e.shiftKey&&index===0){e.preventDefault();links.at(-1).focus();}else if(!e.shiftKey&&index===links.length-1){e.preventDefault();toggle.focus();}});



nav.addEventListener('transitionend',e=>{if(e.propertyName==='transform'&&toggle.getAttribute('aria-expanded')==='true'&&document.activeElement===toggle)nav.querySelector('a')?.focus({preventScroll:true});});

