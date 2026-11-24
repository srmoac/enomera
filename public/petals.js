import {
  clamp,
  stickyDocY,
  sampleFullJourney,
  sceneProfileAt,
  createOwnerState,
  transitionOwner,
  applyIntentPose,
  SERVICE_PETAL
} from './petal-model.js';
import { createPetalPhysics } from './petal-physics.js';

export async function mountPetalJourney() {
  const response = await fetch('/assets/flower.svg');
  if (!response.ok) return;
  const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  const paths = [...doc.querySelectorAll('path')];
  if (paths.length !== 5) return;

  const ns = 'http://www.w3.org/2000/svg';
  const slots = [];
  // Per-petal subtle buoyancy personality (distinct phase & drag so they share one water surface without looping in unison)
  const petalPhase = [0.0, 1.35, 2.7, 4.1, 5.25];
  const petalDrag = [0.94, 1.06, 1.0, 1.12, 1.08];

  const petals = paths.map((path, i) => {
    const slot = document.createElement('div');
    slot.className = 'petal-slot';
    slot.dataset.petal = String(i);
    slot.setAttribute('aria-hidden', 'true');
    slot.inert = true;

    const outer = document.createElement('div');
    outer.className = 'journey-petal';
    outer.dataset.petal = String(i);

    // HTML plane holds 3D perspective & rotation so WebKit/Safari accelerates reliably.
    const plane = document.createElement('div');
    plane.className = 'journey-petal-plane';

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 470 388');
    svg.setAttribute('width', '470');
    svg.setAttribute('height', '388');
    const group = document.createElementNS(ns, 'g');
    const shape = document.importNode(path, true);
    shape.removeAttribute('id');
    group.append(shape);
    svg.append(group);
    plane.append(svg);
    outer.append(plane);
    slot.append(outer);
    document.body.append(slot);
    slots.push(slot);
    return {
      slot, outer, plane, svg,
      pose: null,
      vel: { x: 0, y: 0, r: 0 },
      z: 1
    };
  });

  const physics = createPetalPhysics({
    shapes: paths.map(p => p.getAttribute('d')),
    fills: paths.map(p => p.getAttribute('fill'))
  });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fineHover = matchMedia('(hover: hover) and (pointer: fine)');
  const portal = location.pathname.replace(/\/$/, '') === '/portal';
  document.body.classList.add('has-petal-journey');

  let plan = null;
  let frame = 0, last = 0, started = performance.now();
  let portalRevision = 0, hidden = false, snapNext = false;
  let dimensions = { w: innerWidth, h: innerHeight };
  let lastIntent = performance.now(), lastScrollTime = 0, prevScrollY = scrollY;
  // Shared gentle lake-current energy excited by scroll gestures and decaying cleanly over ~1s at rest
  let currentEnergy = 0; // signed: + scrolling down, - scrolling up
  let settleEnergy = 0;  // unsigned 0..1 buoyant settling residual after gesture stops
  let owner = createOwnerState(scrollY);
  let lastInputModality = 'pointer';
  let lastGlows = { etha: -1, ambo: -1, minne: -1 };
  let lastEthaDocked = false;

  const anchors = new Map();

  const rect = selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height };
  };

  function flower(r, opacity = 1) {
    return petals.map(() => ({
      x: r.x + 235 * r.w / 470,
      y: r.y + 335 * r.w / 470,
      r: 0,
      rx: 0,
      ry: 0,
      s: r.w / 470,
      o: opacity,
      front: false
    }));
  }

  function buildPlan() {
    const w = dimensions.w;
    const h = dimensions.h;
    const mobile = w < 700;

    const hero = anchors.get('.hero-flower');
    const ethaArticle = anchors.get('#etha');
    const amboArticle = anchors.get('#ambo');
    const minneArticle = anchors.get('#minne');
    const ethaFrameRaw = anchors.get('#etha-frame') || anchors.get('#etha .demo-wrap');
    const amboDemoRaw = anchors.get('#ambo-demo') || anchors.get('#ambo .demo-wrap');
    const minneDemoRaw = anchors.get('#minne-demo') || anchors.get('.minne');
    const connection = anchors.get('.connection');
    const combinacao = anchors.get('#combinacao');
    const summaryRect = anchors.get('.summary');
    const closingTop = anchors.get('.closing-top');
    if (!hero || !ethaArticle || !amboArticle || !minneArticle || !ethaFrameRaw || !amboDemoRaw || !minneDemoRaw || !connection || !combinacao || !summaryRect || !closingTop) {
      return null;
    }

    // Measure scroll-invariant static top & CSS sticky parameters for desktop sticky stages
    function stickyMeta(articleSel, cardRaw) {
      const artEl = document.querySelector(articleSel);
      const wrapEl = artEl?.querySelector('.demo-wrap');
      const art = anchors.get(articleSel);
      if (!artEl || !wrapEl || !art) return { card: cardRaw, sticky: null };
      const wrapCs = getComputedStyle(wrapEl);
      const isSticky = !mobile && wrapCs.position === 'sticky';
      if (!isSticky) return { card: cardRaw, sticky: null };
      const artCs = getComputedStyle(artEl);
      const padTop = parseFloat(artCs.paddingTop) || 0;
      const padBot = parseFloat(artCs.paddingBottom) || 0;
      const stickyTop = parseFloat(wrapCs.top) || 120;
      const wrapH = wrapEl.getBoundingClientRect().height;
      const staticTop = art.y + padTop;
      const trackBottom = art.y + art.h - padBot;
      return {
        card: { x: cardRaw.x, y: staticTop, w: cardRaw.w, h: cardRaw.h },
        sticky: { staticTop, trackBottom, elHeight: wrapH, stickyTop }
      };
    }

    const ethaM = stickyMeta('#etha', ethaFrameRaw);
    const amboM = stickyMeta('#ambo', amboDemoRaw);
    const minneM = stickyMeta('#minne', minneDemoRaw);
    const ethaFrame = ethaM.card;
    const amboDemo = amboM.card;
    const minneDemo = minneM.card;
    const sticky = { etha: ethaM.sticky, ambo: amboM.sticky, minne: minneM.sticky };

    const heroPoses = flower(hero, 1);

    // Calibrate scroll marks separately for desktop sticky stages (+40-75% useful sweep travel)
    // and mobile touch flicks (+23-30% useful travel) with zero empty height.
    const openEnd = mobile ? 175 : 190;

    const ethaArrive = sticky.etha
      ? Math.round(sticky.etha.staticTop - sticky.etha.stickyTop + Math.max(180, (sticky.etha.trackBottom - sticky.etha.staticTop - sticky.etha.elHeight) * .62))
      : Math.round(clamp(ethaFrame.y - h * .30, openEnd + 760, Math.max(openEnd + 800, ethaFrame.y - 110)));
    const ethaLeave = sticky.etha
      ? Math.round(Math.min(sticky.etha.trackBottom - sticky.etha.elHeight - sticky.etha.stickyTop + 40, ethaArrive + 210))
      : ethaArrive + 190;

    const amboArrive = sticky.ambo
      ? Math.round(Math.max(ethaLeave + 620, sticky.ambo.staticTop - sticky.ambo.stickyTop + Math.max(110, (sticky.ambo.trackBottom - sticky.ambo.staticTop - sticky.ambo.elHeight) * .56)))
      : Math.round(Math.max(ethaLeave + 620, amboDemo.y - h * .24));
    const amboLeave = sticky.ambo
      ? Math.round(Math.min(sticky.ambo.trackBottom - sticky.ambo.elHeight - sticky.ambo.stickyTop + 40, amboArrive + 190))
      : amboArrive + 185;

    const minneArrive = sticky.minne
      ? Math.round(Math.max(amboLeave + 580, sticky.minne.staticTop - sticky.minne.stickyTop + Math.max(110, (sticky.minne.trackBottom - sticky.minne.staticTop - sticky.minne.elHeight) * .54)))
      : Math.round(Math.max(amboLeave + 580, minneDemo.y - h * .26));
    const minneLeave = sticky.minne
      ? Math.round(Math.min(sticky.minne.trackBottom - sticky.minne.elHeight - sticky.minne.stickyTop + 40, minneArrive + 200))
      : minneArrive + 190;

    const connEnd = Math.round(Math.max(minneLeave + 300, connection.y + Math.max(1, connection.h - h)));

    const comboArrive = Math.round(Math.max(connEnd + 240, summaryRect.y - h * .46));
    const comboLeave = comboArrive + (mobile ? 240 : 220);

    const docMax = Math.max(comboLeave + 260, document.documentElement.scrollHeight - h);
    // Ensure the last petal finishes its closing turn while the full flower sits comfortably framed.
    const closingArrive = Math.round(Math.min(docMax - (mobile ? 260 : 210), Math.max(comboLeave + 240, closingTop.y - h * .34)));

    const ethaDock = mobile
      ? { x: ethaFrame.x + 42, y: ethaFrame.y + 82, r: 28, rx: 0, ry: 0, s: .36, o: .93, front: false }
      : { x: ethaFrame.x + 42, y: ethaFrame.y + 92, r: 34, rx: 0, ry: 0, s: .64, o: .93, front: false };

    const ethaRest = [
      { x: mobile ? w * .92 : ethaFrame.x + ethaFrame.w * .88, y: ethaFrame.y + (mobile ? 24 : 36), r: -14, rx: 0, ry: 0, s: mobile ? .28 : .44, o: .26, front: false },
      ethaDock,
      { x: mobile ? w * .96 : Math.min(w - 40, ethaFrame.x + ethaFrame.w + 26), y: ethaFrame.y + ethaFrame.h * .52, r: 22, rx: 0, ry: 0, s: mobile ? .32 : .50, o: .34, front: false },
      { x: mobile ? w * .12 : ethaFrame.x - 40, y: ethaFrame.y + ethaFrame.h * .92, r: -28, rx: 0, ry: 0, s: mobile ? .24 : .40, o: .20, front: false },
      { x: mobile ? w * .92 : ethaFrame.x + ethaFrame.w * .94, y: ethaFrame.y + ethaFrame.h * .94, r: 28, rx: 0, ry: 0, s: mobile ? .24 : .40, o: .20, front: false }
    ];

    const amboDock = mobile
      ? { x: amboDemo.x + 54, y: amboDemo.y + 70, r: -54, rx: 0, ry: 0, s: .40, o: .92, front: false }
      : { x: amboDemo.x + 22, y: amboDemo.y + 215, r: -68, rx: 0, ry: 0, s: .58, o: .92, front: false };

    const amboRest = [
      { x: mobile ? w * .52 : w * .52, y: amboDemo.y + (mobile ? 80 : 185), r: 6, rx: 0, ry: 0, s: mobile ? .32 : .50, o: .36, front: false },
      { x: mobile ? w * .92 : amboDemo.x + amboDemo.w + 48, y: amboDemo.y + 72, r: 24, rx: 0, ry: 0, s: mobile ? .26 : .42, o: .24, front: false },
      amboDock,
      { x: mobile ? w * .10 : amboDemo.x - 70, y: amboDemo.y + amboDemo.h * .90, r: -24, rx: 0, ry: 0, s: mobile ? .24 : .38, o: .20, front: false },
      { x: mobile ? w * .92 : amboDemo.x + amboDemo.w + 44, y: amboDemo.y + amboDemo.h * .90, r: 26, rx: 0, ry: 0, s: mobile ? .24 : .38, o: .20, front: false }
    ];

    const minneDock = mobile
      ? { x: minneDemo.x + minneDemo.w * .54, y: minneDemo.y + 44, r: 6, rx: 0, ry: 0, s: .38, o: .92, front: false }
      : { x: minneDemo.x + minneDemo.w * .45, y: minneDemo.y + 54, r: 4, rx: 0, ry: 0, s: .56, o: .92, front: false };

    const minneRest = [
      minneDock,
      { x: mobile ? w * .08 : minneDemo.x - 42, y: minneDemo.y + minneDemo.h * .76, r: -22, rx: 0, ry: 0, s: mobile ? .26 : .40, o: .24, front: false },
      { x: mobile ? w * .94 : minneDemo.x + minneDemo.w + 26, y: minneDemo.y + minneDemo.h * .52, r: 22, rx: 0, ry: 0, s: mobile ? .26 : .42, o: .26, front: false },
      { x: mobile ? w * .12 : minneDemo.x + 40, y: minneDemo.y + minneDemo.h * .96, r: -20, rx: 0, ry: 0, s: mobile ? .22 : .36, o: .20, front: false },
      { x: mobile ? w * .90 : minneDemo.x + minneDemo.w * .90, y: minneDemo.y + minneDemo.h * .96, r: 24, rx: 0, ry: 0, s: mobile ? .22 : .36, o: .20, front: false }
    ];

    const connY1 = connection.y + h * .46;
    const connY2 = connection.y + (connection.h - h) * .5 + h * .46;
    const connY3 = connection.y + Math.max(1, connection.h - h) + h * .46;
    const makeConn = (cy, leadIdx) => [0, 1, 2, 3, 4].map(idx => {
      const xs = mobile ? [.50, .20, .80, .18, .82] : [.68, .54, .82, .50, .86];
      const ys = mobile ? [.24, .28, .28, .82, .82] : [.20, .24, .24, .76, .76];
      const isLead = idx === leadIdx;
      return {
        x: w * xs[idx],
        y: cy + (ys[idx] - .5) * h * .64 + (isLead ? (mobile ? -18 : -28) : 0),
        r: isLead ? [0, -14, 14, 0, 0][idx] : [-12, -26, 26, -18, 18][idx],
        rx: 0,
        ry: 0,
        s: (mobile ? .36 : .58) * (isLead ? 1.18 : .72),
        o: isLead ? .90 : .32,
        front: false
      };
    });

    const comboBase = [
      { x: summaryRect.x + summaryRect.w * .50, y: summaryRect.y + (mobile ? 30 : 48), r: 0, rx: 0, ry: 0, s: mobile ? .36 : .56, o: .88, front: false },
      { x: summaryRect.x + summaryRect.w * .83, y: summaryRect.y + (mobile ? 30 : 48), r: 24, rx: 0, ry: 0, s: mobile ? .36 : .56, o: .88, front: false },
      { x: summaryRect.x + summaryRect.w * .17, y: summaryRect.y + (mobile ? 30 : 48), r: -24, rx: 0, ry: 0, s: mobile ? .36 : .56, o: .88, front: false },
      { x: summaryRect.x + summaryRect.w * .14, y: summaryRect.y + summaryRect.h - 24, r: -18, rx: 0, ry: 0, s: mobile ? .28 : .46, o: .36, front: false },
      { x: summaryRect.x + summaryRect.w * .86, y: summaryRect.y + summaryRect.h - 24, r: 18, rx: 0, ry: 0, s: mobile ? .28 : .46, o: .36, front: false }
    ];

    const closeW = mobile ? 148 : Math.min(400, closingTop.w * .30);
    const closeH = closeW * (388 / 470);
    const closeBox = mobile
      ? { x: (w - closeW) / 2, y: closingTop.y + closingTop.h - closeH - 8, w: closeW, h: closeH }
      : { x: closingTop.x + closingTop.w - closeW, y: closingTop.y + Math.max(0, (closingTop.h - closeH) / 2), w: closeW, h: closeH };

    return {
      mobile,
      w,
      h,
      sticky,
      summaryRect,
      docks: { etha: ethaDock, ambo: amboDock, minne: minneDock },
      marks: {
        openEnd,
        ethaArrive,
        ethaLeave,
        amboArrive,
        amboLeave,
        minneArrive,
        minneLeave,
        connEnd,
        comboArrive,
        comboLeave,
        closingArrive,
        docMax
      },
      poses: {
        hero: heroPoses,
        ethaRest,
        amboRest,
        minneRest,
        conn1: makeConn(connY1, 1),
        conn2: makeConn(connY2, 2),
        conn3: makeConn(connY3, 0),
        comboBase,
        closing: flower(closeBox, 1)
      }
    };
  }

  function measure() {
    dimensions = { w: innerWidth, h: innerHeight };
    anchors.clear();
    const keys = [
      '.hero-flower', '#etha', '#etha .demo-wrap', '#etha-frame',
      '#ambo', '#ambo .demo-wrap', '#ambo-demo',
      '#minne', '#minne .demo-wrap', '#minne-demo', '.minne',
      '.connection', '#combinacao', '#service-options', '.summary',
      '.closing-top', '.pilot', '.portal-main'
    ];
    for (const key of keys) {
      const r = rect(key);
      if (r) anchors.set(key, r);
    }
    if (portal) { schedule(); return; }
    plan = buildPlan();
    schedule();
  }

  function selection() {
    return [...document.querySelectorAll('button[data-service][aria-pressed=true]')].map(b => b.dataset.service);
  }

  function target(i, now, context, profile) {
    const y = context.scrollY;

    if (portal) {
      const mobile = dimensions.w < 700;
      const r = context.portalRect;
      if (!r) return petals[i].pose;
      const width = mobile ? 150 : Math.min(390, r.width * .40);
      const base = { x: dimensions.w - width - 20, y: Math.max(300, dimensions.h - width * .825 - 24) + y, w: width, h: width * .825 };
      const f = flower(base, .45)[i];
      const amount = portalRevision % 5;
      const p = reduced.matches
        ? f
        : { ...f, x: f.x + Math.sin(i * 1.7 + amount) * 8, y: f.y + Math.cos(i + amount) * 6, r: Math.sin(i * 1.3 + amount) * 5 };
      return { ...p, y: p.y - y };
    }

    if (!plan) return null;

    // Reduced motion: stable service positions, zero sweeping/3D, brief calm placement.
    if (reduced.matches) {
      const m = plan.marks;
      let p;
      if (y < m.ethaArrive * .45) p = plan.poses.hero[i];
      else if (y < m.amboArrive - 160) p = plan.poses.ethaRest[i];
      else if (y < m.minneArrive - 160) p = plan.poses.amboRest[i];
      else if (y < m.comboArrive - 160) p = plan.poses.minneRest[i];
      else if (y < m.closingArrive - 120) p = sampleFullJourney(m.comboArrive, i, plan, context.selected);
      else p = plan.poses.closing[i];
      return { ...p, rx: 0, ry: 0, front: false, y: p.y - y };
    }

    let p = sampleFullJourney(y, i, plan, context.selected);

    if (context.pilotOpen && y > plan.marks.closingArrive - 180) {
      p = { ...p, x: p.x + (i % 2 ? 7 : -7), r: p.r + (i - 2) * 2.2 };
    }

    if (owner.mode === 'intent' && owner.expiresAt && now >= owner.expiresAt) {
      owner = createOwnerState(y);
    }

    if (owner.mode === 'intent') {
      p = applyIntentPose(p, i, owner, plan, y);
    }

    // Scale 2 & 3: Buoyant residual lake-surface drift (~1s settling after stopping, dissipating cleanly to zero).
    // Each petal inhabits the same gentle surface with distinct phase/amplitude — never a synchronized loop.
    if (!context.reading && settleEnergy > .004 && y > 10) {
      const elapsed = (now - lastScrollTime) / 1000;
      const phase = petalPhase[i];
      const amp = settleEnergy * profile.driftScale * (plan.mobile ? .55 : 1);
      // Residual gentle arc: small lateral glide + soft rotational settle that dissipates smoothly
      const driftX = (Math.sin(elapsed * 2.1 + phase) * 7.5 + profile.currentDir * currentEnergy * 11) * amp;
      const driftY = (Math.cos(elapsed * 1.65 + phase * 1.2) * 4.2 + currentEnergy * 5.5) * amp;
      const driftR = (Math.sin(elapsed * 1.85 + phase - .55) * 3.8 + currentEnergy * 4.2) * amp;
      p = {
        ...p,
        x: p.x + driftX,
        y: p.y + driftY,
        r: p.r + driftR
      };
    }

    // Initial load serene blossom settle at y = 0.
    if (y < 16 && now - started < 1200) {
      const entrance = clamp((now - started - i * 48) / 1020);
      const energy = (1 - entrance) ** 3;
      p = {
        ...p,
        x: p.x + [-3, -18, 20, -22, 22][i] * energy,
        y: p.y + [-10, 7, 5, 13, 12][i] * energy,
        r: p.r + [-4, -8, 8, -10, 10][i] * energy
      };
    }

    return { ...p, rx: p.rx || 0, ry: p.ry || 0, front: !!p.front, y: p.y - y };
  }

  function syncDockGlow(service, petalIdx, y, glowEl, frameEl) {
    if (!glowEl || !plan?.docks?.[service]) return;
    const dock = plan.docks[service];
    const m = plan.marks;
    let level = 0;

    if (reduced.matches) {
      const windows = {
        etha: y >= m.ethaArrive * .45 && y < m.amboArrive - 160,
        ambo: y >= m.amboArrive - 160 && y < m.minneArrive - 160,
        minne: y >= m.minneArrive - 160 && y < m.comboArrive - 160
      };
      level = windows[service] ? .92 : 0;
    } else if (petals[petalIdx]?.pose) {
      const pose = petals[petalIdx].pose;
      const s = plan.sticky?.[service];
      const liveDockY = s ? dock.y + (stickyDocY(y, s.staticTop, s.trackBottom, s.elHeight, s.stickyTop) - s.staticTop) : dock.y;
      const dist = Math.hypot(pose.x - dock.x, pose.y - (liveDockY - y));
      const radius = plan.mobile ? 185 : 260;
      const prox = clamp(1 - dist / radius);
      const smoothProx = prox * prox * (3 - 2 * prox);
      const focused = owner.mode === 'intent' && owner.service === service;
      physics.setProx(petalIdx, smoothProx);
      level = focused ? Math.max(smoothProx, .52) : smoothProx;
    }

    const q = Math.round(level * 100) / 100;
    if (q !== lastGlows[service]) {
      lastGlows[service] = q;
      glowEl.style.opacity = String(q);
    }
    if (service === 'etha' && frameEl) {
      const docked = q >= .55;
      if (docked !== lastEthaDocked) {
        lastEthaDocked = docked;
        frameEl.classList.toggle('is-docked', docked);
      }
    }
  }

  const eps = { x: .14, y: .14, r: .05, rx: .06, ry: .06, s: .0014, o: .003 };

  function tick(now) {
    frame = 0;
    if (hidden || (!plan && !portal)) return;
    const snap = snapNext || reduced.matches;
    snapNext = false;
    if (!snap && document.activeElement?.matches('input,textarea,select') && now - lastScrollTime > 48) {
      last = 0;
      return;
    }

    const dt = Math.min(now - last || 16, 32);
    last = now;
    let moving = false;

    // Group all DOM reads before any style writes.
    const y = scrollY;
    const context = {
      scrollY: y,
      selected: selection(),
      reading: document.activeElement?.matches('input,textarea,select') || !!document.querySelector('dialog[open]'),
      pilotOpen: !!document.querySelector('.pilot')?.open,
      portalRect: portal ? document.querySelector('.portal-main')?.getBoundingClientRect() : null
    };
    const ethaFrameEl = document.querySelector('#etha-frame');
    const ethaGlow = ethaFrameEl?.querySelector('.etha-dock-glow');
    const amboGlow = document.querySelector('#ambo-demo .ambo-dock-glow');
    const minneGlow = document.querySelector('#minne-demo .minne-dock-glow');

    const profile = plan ? sceneProfileAt(y, plan.marks) : { name: 'portal', driftScale: .4, posTau: 120, rotTau: 170, currentDir: 1 };

    // Exponential decay of lake-current energy (~1.0s smooth buoyant settling when user stops)
    if (snap || context.reading) {
      currentEnergy = 0;
      settleEnergy = 0;
    } else {
      currentEnergy *= Math.exp(-dt / 320);
      if (Math.abs(currentEnergy) < .002) currentEnergy = 0;
      // Settle energy decays over ~1.0-1.15s (tau ~ 420ms -> <8% at 1.05s)
      const settleTau = profile.name === 'minne' ? 300 : profile.name === 'etha' ? 460 : 390;
      settleEnergy *= Math.exp(-dt / settleTau);
      if (settleEnergy < .004) settleEnergy = 0;
    }

    const goals = petals.map((_, i) => target(i, now, context, profile));

    petals.forEach((petal, i) => {
      const goal = goals[i];
      if (!goal) return;
      if (!petal.pose || snap) {
        petal.pose = { x: goal.x, y: goal.y, r: goal.r, rx: goal.rx, ry: goal.ry, s: goal.s, o: goal.o };
        petal.vel = { x: 0, y: 0, r: 0 };
      }
      const p = petal.pose;
      const v = petal.vel;

      // Buoyant two-tier damping:
      // - Center (x, y) follows the water current smoothly (posTau)
      // - Orientation (r, rx, ry) trails slightly behind (rotTau ~ 1.45x posTau) + gentle velocity-coupled yaw torque!
      //   so when changing direction, the center enters the new curve first and the tip finishes turning right after.
      const basePosTau = portal ? 115 : profile.posTau * petalDrag[i];
      const baseRotTau = portal ? 160 : profile.rotTau * petalDrag[i];
      const posRate = snap ? 1 : 1 - Math.exp(-dt / basePosTau);
      const rotRate = snap ? 1 : 1 - Math.exp(-dt / baseRotTau);

      const prevX = p.x, prevY = p.y;
      for (const key of ['x', 'y', 's', 'o']) {
        const delta = goal[key] - p[key];
        if (Math.abs(delta) > eps[key]) {
          moving = true;
          p[key] += delta * posRate;
        } else {
          p[key] = goal[key];
        }
      }

      // Compute instantaneous visual velocity for secondary rotational weight
      const vx = (p.x - prevX) / Math.max(dt, 8);
      const vy = (p.y - prevY) / Math.max(dt, 8);
      v.x = v.x * .72 + vx * .28;
      v.y = v.y * .72 + vy * .28;
      const yawTorque = snap ? 0 : clamp(v.x * 11 - v.y * 5, -13, 13) * profile.driftScale;

      const rotGoals = { r: goal.r + yawTorque, rx: goal.rx, ry: goal.ry };
      for (const key of ['r', 'rx', 'ry']) {
        const delta = rotGoals[key] - p[key];
        if (Math.abs(delta) > eps[key]) {
          moving = true;
          p[key] += delta * rotRate;
        } else {
          p[key] = rotGoals[key];
        }
      }

      const wantZ = goal.front ? 12 : 1;
      if (petal.z !== wantZ) {
        petal.z = wantZ;
        petal.slot.style.zIndex = String(wantZ);
      }

      petal.goalFront = !!goal.front;
      if (physics.active) return;
      const visible = p.y > -560 && p.y < dimensions.h + 560;
      petal.outer.style.visibility = visible ? 'visible' : 'hidden';
      petal.outer.style.transform = `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0) scale(${p.s.toFixed(4)})`;
      petal.outer.style.opacity = p.o.toFixed(3);
      petal.plane.style.transform = (!(window.EnoPerf && window.EnoPerf.lite) && (Math.abs(p.rx) > .05 || Math.abs(p.ry) > .05))
        ? `perspective(1000px) rotateZ(${p.r.toFixed(2)}deg) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg)`
        : `rotateZ(${p.r.toFixed(2)}deg)`;
    });

    if (!portal) {
      syncDockGlow('etha', 1, y, ethaGlow, ethaFrameEl);
      syncDockGlow('ambo', 2, y, amboGlow, null);
      syncDockGlow('minne', 0, y, minneGlow, null);
    }

    if (physics.active) {
      for (let i = 0; i < petals.length; i++) {
        const petal = petals[i];
        if (!petal.pose) continue;
        const visible = petal.pose.y > -560 && petal.pose.y < dimensions.h + 560;
        if (!visible) continue;
        if (physics.render(i, petal.pose, petal.vel, petal.goalFront, dt, now)) moving = true;
      }
      if (physics.renderFx(now)) moving = true;
    }

    if (moving || (!reduced.matches && (now - started < 1250 || settleEnergy > .004 || (owner.expiresAt && now < owner.expiresAt)))) {
      frame = requestAnimationFrame(tick);
    } else {
      last = 0;
    }
  }

  function schedule() {
    if (!frame && !hidden) frame = requestAnimationFrame(tick);
  }

  function intention() {
    lastIntent = performance.now();
    schedule();
  }

  function detectServiceFromElement(el) {
    if (!el || !(el instanceof Element)) return null;
    const explicit = el.closest('[data-service],[data-service-link],[data-service-example],[data-service-links]');
    if (explicit) {
      const id = explicit.dataset.service || explicit.dataset.serviceLink || explicit.dataset.serviceExample || explicit.dataset.serviceLinks;
      if (id && id in SERVICE_PETAL) return { service: id, el: explicit };
    }
    const article = el.closest('#etha,#ambo,#minne');
    if (article && article.id in SERVICE_PETAL) {
      return { service: article.id, el: el.closest('a,button,.etha-frame,.ambo,.minne') || article };
    }
    return null;
  }

  function elementDocRect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height };
  }

  function dispatchOwner(event) {
    const next = transitionOwner(owner, event);
    if (next !== owner) {
      owner = next;
      intention();
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') {
      lastInputModality = 'keyboard';
    }
  }, true);
  document.addEventListener('pointerdown', () => { lastInputModality = 'pointer'; }, { passive: true, capture: true });

  addEventListener('scroll', () => {
    const now = performance.now();
    const y = scrollY;
    const dy = y - prevScrollY;
    prevScrollY = y;
    lastScrollTime = now;

    if (!reduced.matches && Math.abs(dy) > 0) {
      const dir = Math.sign(dy);
      // Immediate reversal: if user reverses scroll direction, damp opposing inertia instantly
      // so the petal pivots cleanly from its exact visible position & angle!
      if (currentEnergy !== 0 && Math.sign(currentEnergy) !== dir) {
        currentEnergy = dir * clamp(Math.abs(dy) / 70, .18, .9);
        for (const p of petals) { p.vel.x *= .25; p.vel.y *= .25; }
      } else {
        currentEnergy = clamp(currentEnergy * .65 + (dy / 65), -1.35, 1.35);
      }
      settleEnergy = clamp(Math.max(settleEnergy, Math.min(1, Math.abs(dy) / 28 + .42)), 0, 1);
    }

    owner = transitionOwner(owner, { type: 'scroll', scrollY: y });
    intention();
  }, { passive: true });

  addEventListener('resize', () => {
    snapNext = true;
    measure();
  }, { passive: true });

  if (!portal) {
    document.addEventListener('pointerover', e => {
      if (!fineHover.matches) return;
      const targetEl = e.target.closest?.('button[data-service],[data-service-link],[data-service-example],#etha-frame,#ambo-demo,#minne-demo');
      if (!targetEl) return;
      const hit = detectServiceFromElement(targetEl);
      if (!hit) return;
      dispatchOwner({
        type: 'intent',
        service: hit.service,
        source: 'hover',
        scrollY,
        targetRect: elementDocRect(hit.el)
      });
    }, { passive: true });

    document.addEventListener('pointerout', e => {
      if (!fineHover.matches) return;
      const targetEl = e.target.closest?.('button[data-service],[data-service-link],[data-service-example],#etha-frame,#ambo-demo,#minne-demo');
      if (!targetEl) return;
      const related = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (related && related.closest('button[data-service],[data-service-link],[data-service-example],#etha-frame,#ambo-demo,#minne-demo')) return;
      dispatchOwner({ type: 'release', source: 'hover', scrollY });
    }, { passive: true });

    window.addEventListener('enomera:service-pulse', e => {
      if (reduced.matches) return;
      const service = e.detail?.service;
      if (!service || !(service in SERVICE_PETAL)) return;
      settleEnergy = Math.max(settleEnergy, .45);
      dispatchOwner({
        type: 'intent',
        service,
        source: 'pulse',
        scrollY,
        targetRect: elementDocRect(e.detail?.el),
        expiresAt: performance.now() + 680
      });
    });
  }

  document.addEventListener('focusin', e => {
    const targetEl = e.target instanceof Element ? e.target : null;
    if (targetEl?.matches('input,textarea,select')) {
      settleEnergy = 0;
      currentEnergy = 0;
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      return;
    }
    if (!portal && targetEl) {
      const hit = detectServiceFromElement(targetEl);
      const isFocusVisible = lastInputModality === 'keyboard' || targetEl.matches(':focus-visible');
      if (hit && isFocusVisible) {
        dispatchOwner({
          type: 'intent',
          service: hit.service,
          source: 'focus',
          scrollY,
          targetRect: elementDocRect(hit.el)
        });
        return;
      }
    }
    schedule();
  });

  document.addEventListener('focusout', e => {
    if (portal) return;
    const nextEl = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (!nextEl || !detectServiceFromElement(nextEl)) {
      dispatchOwner({ type: 'release', source: 'focus', scrollY });
    }
  });

  document.addEventListener('click', e => {
    if (e.target.closest?.('a[target="_blank"]')) return;
    const control = e.target.closest?.('button[data-service],[data-billing],[data-portal],[data-goto],[data-active]');
    if (!control) return;
    portalRevision++;
    settleEnergy = Math.max(settleEnergy, .55);
    requestAnimationFrame(() => {
      if (portal) measure();
      intention();
    });
  }, true);

  document.querySelector('.pilot')?.addEventListener('toggle', () => {
    measure();
    intention();
  });

  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      measure();
      schedule();
    }
  });

  reduced.addEventListener('change', () => {
    settleEnergy = 0;
    currentEnergy = 0;
    snapNext = true;
    measure();
  });

  const resize = new ResizeObserver(() => measure());
  for (const el of document.querySelectorAll('.story,.commercial,.closing,#portal')) {
    resize.observe(el);
  }

  window.__enomeraPetals = {
    snapshot() {
      const y = scrollY;
      return {
        owner: { mode: owner.mode, service: owner.service, source: owner.source, sinceScrollY: owner.sinceScrollY },
        scrollY: y,
        settleEnergy: Number(settleEnergy.toFixed(3)),
        currentEnergy: Number(currentEnergy.toFixed(3)),
        marks: plan?.marks ? { ...plan.marks } : null,
        glows: { ...lastGlows },
        petals: petals.map((p, i) => ({
          i,
          z: p.z,
          pose: p.pose ? { ...p.pose } : null
        }))
      };
    }
  };

  // Física: o cursor desvia as pétalas; no toque, encostar perto dá um sopro.
  let lastPtr = null;
  const posesNow = () => petals.map(p => p.pose);
  addEventListener('pointermove', e => {
    if (!physics.active) return;
    const t = performance.now();
    if (e.pointerType !== 'mouse') return;
    const vx = lastPtr ? (e.clientX - lastPtr.x) / Math.max(8, t - lastPtr.t) : 0;
    const vy = lastPtr ? (e.clientY - lastPtr.y) / Math.max(8, t - lastPtr.t) : 0;
    lastPtr = { x: e.clientX, y: e.clientY, t };
    if (physics.poke(e.clientX, e.clientY, vx, vy, posesNow(), .55)) schedule();
  }, { passive: true });
  addEventListener('pointerdown', e => {
    if (!physics.active || e.pointerType === 'mouse') return;
    if (physics.poke(e.clientX, e.clientY, 0, 0, posesNow(), 1.2)) schedule();
  }, { passive: true });

  physics.start(on => {
    for (const s of slots) s.hidden = on;
    snapNext = false;
    schedule();
  });

  measure();
  document.fonts.ready.then(measure);
  intention();

  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    slots.forEach(s => s.remove());
  };
}
