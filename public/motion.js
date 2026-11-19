// Native scroll and WAAPI share the existing architecture; no gesture interception.
import { mountPetalJourney } from './petals.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const animations = new WeakMap();

function tween(el, frames, duration = 240, delay = 0) {
  if (!el || reduce.matches) return null;
  const old = animations.get(el);
  old?.cancel();
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim()
    || getComputedStyle(document.documentElement).getPropertyValue('--ease').trim()
    || 'cubic-bezier(.22,1,.36,1)';
  const a = el.animate(frames, { duration, delay, easing, fill: delay ? 'backwards' : 'none' });
  animations.set(el, a);
  a.finished.catch(() => {});
  return a;
}

await mountPetalJourney();

function updateScroll() { updateSiteIndicator(); }
addEventListener('scroll', updateScroll, { passive: true });

// Persistent Liquid Glass lens glides smoothly across position AND real option width/height.
function lens(group, selector) {
  if (!group) return;
  const active = group.querySelector(selector);
  if (!active) return;
  let marker = group.querySelector(':scope > .motion-lens');
  const entering = !marker;
  if (!marker) {
    marker = document.createElement('span');
    marker.className = 'motion-lens';
    marker.setAttribute('aria-hidden', 'true');
    marker.style.transition = 'none';
    group.prepend(marker);
  }
  const g = group.getBoundingClientRect();
  const r = active.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  const x = r.left - g.left + group.scrollLeft;
  const y = r.top - g.top + group.scrollTop;
  marker.style.width = `${r.width}px`;
  marker.style.height = `${r.height}px`;
  marker.style.borderRadius = group.id === 'nav-links' ? '20px' : getComputedStyle(active).borderRadius;
  marker.style.transform = `translate3d(${x}px,${y}px,0)`;
  if (entering) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (marker.isConnected) marker.style.transition = '';
    }));
  }
}

function updateSiteIndicator() {
  const nav = document.querySelector('#nav-links');
  if (!nav || innerWidth < 701) return;
  let id = 'produtos';
  for (const [sel, key] of [['#como-funciona', 'como-funciona'], ['#combinacao', 'combinacao']]) {
    if (document.querySelector(sel)?.getBoundingClientRect().top < innerHeight * .45) id = key;
  }
  const target = nav.querySelector(`a[href="/#${id}"]`);
  if (target) {
    nav.querySelectorAll('a').forEach(a => a.toggleAttribute('data-current', a === target));
    lens(nav, '[data-current]');
  }
}

function refresh() {
  lens(document.querySelector('.billing-toggle'), '[aria-pressed="true"]');
  lens(document.querySelector('.mini-sidebar'), '[aria-pressed="true"]');
  lens(document.querySelector('.minne-list'), '[aria-pressed="true"]');
  lens(document.querySelector('.portal-side nav'), '[aria-current="page"]:not([hidden])');
  lens(document.querySelector('[aria-label="Modalidade"]'), '[aria-pressed="true"]');
}

const observer = new MutationObserver(records => {
  if (records.every(r => r.target.closest?.('.motion-lens'))) return;
  refresh();
});
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current'] });
refresh();
updateScroll();
addEventListener('resize', () => { refresh(); updateScroll(); }, { passive: true });
document.fonts.ready.then(() => { refresh(); updateScroll(); });

// Tactile press feedback across mouse AND touch (Safari iOS / pointer release symmetry).
document.addEventListener('pointerdown', e => {
  const b = e.target.closest?.('button,.button');
  if (b && !b.disabled) b.classList.add('is-pressed');
}, { passive: true });
function releasePressed() {
  document.querySelectorAll('.is-pressed').forEach(el => el.classList.remove('is-pressed'));
}
addEventListener('pointerup', releasePressed, { passive: true });
addEventListener('pointercancel', releasePressed, { passive: true });
addEventListener('blur', releasePressed, { passive: true });

// Coordinated panel, FLIP summary, directional step, and Minne detail transitions (pointer + keyboard).
let summaryAnim = null;
document.addEventListener('click', e => {
  const trigger = e.target.closest?.('[data-service],[data-billing],[data-ambo],[data-mini],[data-portal],[data-goto]');
  if (!trigger) return;

  // 1. Combination summary FLIP rows + smooth height bridge.
  if (trigger.matches('[data-service],[data-billing]')) {
    const summary = document.querySelector('.summary');
    const list = document.querySelector('#billing-summary');
    if (!summary || !list) return;
    const oldH = summary.getBoundingClientRect().height;
    const oldRows = new Map([...list.querySelectorAll('.billing-row')].map(n => [n.dataset.service, n.getBoundingClientRect()]));

    requestAnimationFrame(() => {
      const newH = summary.getBoundingClientRect().height;
      if (!reduce.matches && Math.abs(oldH - newH) > 2) {
        summaryAnim?.cancel();
        summary.style.overflow = 'hidden';
        summaryAnim = summary.animate(
          [{ height: `${oldH}px` }, { height: `${newH}px` }],
          { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' }
        );
        summaryAnim.onfinish = () => { summary.style.overflow = ''; summary.style.height = ''; summaryAnim = null; };
        summaryAnim.oncancel = () => { summary.style.overflow = ''; summary.style.height = ''; };
      }

      const newRows = [...list.querySelectorAll('.billing-row')];
      newRows.forEach((row, idx) => {
        const prev = oldRows.get(row.dataset.service);
        const now = row.getBoundingClientRect();
        if (prev && Math.abs(prev.top - now.top) > 1) {
          tween(row, [{ transform: `translate3d(0,${prev.top - now.top}px,0)` }, { transform: 'none' }], 260);
        } else if (!prev) {
          tween(row, [{ opacity: 0, transform: 'translate3d(-10px,0,0)' }, { opacity: 1, transform: 'none' }], 240, idx * 24);
        } else if (trigger.matches('[data-billing]')) {
          tween(row, [{ opacity: .55, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], 210, idx * 28);
        }
      });
      refresh();
    });
    return;
  }

  // 2. Ambo directional step transition, Minne tab transition, and Portal view entrance.
  const dir = trigger.dataset.ambo === 'back' ? -1 : 1;
  const region = trigger.closest('.ambo') || document.querySelector('#portal-content') || document.querySelector('#mini-content');
  const existing = new Set(region?.children);

  requestAnimationFrame(() => {
    const current = region?.isConnected ? region : document.querySelector('#portal-content');
    if (!current) return;
    let stagger = 0;
    for (const child of current.children) {
      if (existing.has(child) || child.matches('.motion-lens,.ambo-dock-glow,.minne-dock-glow')) continue;
      const frames = trigger.matches('[data-ambo]')
        ? [{ opacity: 0, transform: `translate3d(${dir * 14}px,0,0)` }, { opacity: 1, transform: 'none' }]
        : [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }];
      tween(child, frames, 220, stagger);
      stagger = Math.min(stagger + 22, 90);
    }
    refresh();
  });
}, true);

// Coordinated Minne detail update when picking an appointment row.
window.addEventListener('enomera:minne-detail-updated', e => {
  const detail = e.detail?.el;
  if (!detail) return;
  tween(detail, [{ opacity: .42, transform: 'translate3d(10px,0,0)' }, { opacity: 1, transform: 'none' }], 220);
  refresh();
});

// Native details semantics, with reversible measured disclosure motion.
for (const details of document.querySelectorAll('details.pilot')) {
  const summary = details.querySelector('summary');
  const content = document.createElement('div');
  content.className = 'disclosure-content';
  while (summary.nextSibling) content.append(summary.nextSibling);
  details.append(content);
  let running = null, wanted = details.open;
  summary.addEventListener('click', e => {
    e.preventDefault();
    wanted = !wanted;
    const from = details.getBoundingClientRect().height;
    running?.cancel();
    details.open = true;
    const to = wanted
      ? details.scrollHeight
      : summary.getBoundingClientRect().height + parseFloat(getComputedStyle(details).paddingTop) + parseFloat(getComputedStyle(details).paddingBottom) + 2;
    if (reduce.matches) {
      details.open = wanted;
      details.style.height = '';
      return;
    }
    details.style.overflow = 'hidden';
    running = details.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: wanted ? 240 : 180, easing: 'cubic-bezier(.22,1,.36,1)' }
    );
    running.onfinish = () => { details.open = wanted; details.style.overflow = ''; running = null; };
  });
}

// Existing menu owns visibility; this layer adds focus management and reversible motion.
const toggle = document.querySelector('.menu-toggle'), nav = document.querySelector('#nav-links');
let opener = null;
function menuState() {
  const open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  nav.inert = innerWidth < 701 && !open;
  if (open) {
    opener = document.activeElement;
    requestAnimationFrame(() => {
      if (toggle.getAttribute('aria-expanded') === 'true') nav.querySelector('a')?.focus({ preventScroll: true });
    });
  } else {
    const byLink = toggle.dataset.closeReason === 'link';
    delete toggle.dataset.closeReason;
    if (!byLink && opener && nav.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    opener = null;
  }
}
new MutationObserver(menuState).observe(toggle, { attributes: true, attributeFilter: ['aria-expanded'] });
menuState();
addEventListener('resize', menuState);
document.addEventListener('keydown', e => {
  if (innerWidth > 700 || toggle.getAttribute('aria-expanded') !== 'true' || e.key !== 'Tab') return;
  const links = [toggle, ...nav.querySelectorAll('a')];
  const index = links.indexOf(document.activeElement);
  if (e.shiftKey && index === 0) { e.preventDefault(); links.at(-1).focus(); }
  else if (!e.shiftKey && index === links.length - 1) { e.preventDefault(); toggle.focus(); }
});
nav.addEventListener('transitionend', e => {
  if (e.propertyName === 'transform' && toggle.getAttribute('aria-expanded') === 'true' && document.activeElement === toggle) {
    nav.querySelector('a')?.focus({ preventScroll: true });
  }
});
