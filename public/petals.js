import {
  clamp,
  sampleFullJourney,
  createOwnerState,
  transitionOwner,
  applyIntentPose,
  SERVICE_PETAL
} from './petal-model.js';

export async function mountPetalJourney() {
  const response = await fetch('/assets/flower.svg');
  if (!response.ok) return;
  const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  const paths = [...doc.querySelectorAll('path')];
  if (paths.length !== 5) return;

  const ns = 'http://www.w3.org/2000/svg';
  const slots = [];
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
    return { slot, outer, plane, svg, pose: null, z: 1 };
  });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fineHover = matchMedia('(hover: hover) and (pointer: fine)');
  const portal = location.pathname.replace(/\/$/, '') === '/portal';
  document.body.classList.add('has-petal-journey');

  let plan = null;
  let frame = 0, last = 0, started = performance.now(), settleUntil = 0;
  let portalRevision = 0, hidden = false, snapNext = false;
  let dimensions = { w: innerWidth, h: innerHeight };
  let lastIntent = performance.now(), lastScroll = 0;
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
    const ethaFrame = anchors.get('#etha-frame') || anchors.get('#etha .demo-wrap');
    const amboDemo = anchors.get('#ambo-demo') || anchors.get('#ambo .demo-wrap');
    const minneDemo = anchors.get('#minne-demo') || anchors.get('.minne');
    const connection = anchors.get('.connection');
    const combinacao = anchors.get('#combinacao');
    const summaryRect = anchors.get('.summary');
    const closingTop = anchors.get('.closing-top');
    if (!hero || !ethaFrame || !amboDemo || !minneDemo || !connection || !combinacao || !summaryRect || !closingTop) {
      return null;
    }

    const heroPoses = flower(hero, 1);

    // --- Scroll marks calibrated to real section geometry & generous reading pauses ---
    const openEnd = mobile ? 170 : 190;

    const ethaArrive = mobile
      ? Math.round(clamp(ethaFrame.y - h * .34, openEnd + 540, Math.max(openEnd + 560, ethaFrame.y - 120)))
      : Math.round(clamp(ethaFrame.y - h * .24, openEnd + 520, Math.max(openEnd + 540, ethaFrame.y - 110)));
    const ethaLeave = ethaArrive + (mobile ? 210 : 250);

    const amboArrive = mobile
      ? Math.round(Math.max(ethaLeave + 460, amboDemo.y - h * .26))
      : Math.round(Math.max(ethaLeave + 360, amboDemo.y - h * .22));
    const amboLeave = amboArrive + (mobile ? 200 : 230);

    const minneArrive = mobile
      ? Math.round(Math.max(amboLeave + 460, minneDemo.y - h * .28))
      : Math.round(Math.max(amboLeave + 340, minneDemo.y - h * .24));
    const minneLeave = minneArrive + (mobile ? 200 : 240);

    const connEnd = Math.round(Math.max(minneLeave + 300, connection.y + Math.max(1, connection.h - h)));

    const comboArrive = Math.round(Math.max(connEnd + 240, summaryRect.y - h * .46));
    const comboLeave = comboArrive + (mobile ? 260 : 240);

    const docMax = Math.max(comboLeave + 260, document.documentElement.scrollHeight - h);
    const closingArrive = Math.round(Math.min(docMax - 40, Math.max(comboLeave + 240, closingTop.y - h * .30)));

    // --- Exact geometric rest poses for each scene ---
    const ethaDock = mobile
      ? { x: ethaFrame.x + 42, y: ethaFrame.y + 82, r: 28, rx: 0, ry: 0, s: .36, o: .93, front: false }
      : { x: ethaFrame.x + 42, y: ethaFrame.y + 92, r: 34, rx: 0, ry: 0, s: .64, o: .93, front: false };

    const ethaRest = [
      // 0: Minne waits calmly upper-right
      { x: mobile ? w * .92 : ethaFrame.x + ethaFrame.w * .88, y: ethaFrame.y + (mobile ? 24 : 36), r: -14, rx: 0, ry: 0, s: mobile ? .28 : .44, o: .26, front: false },
      // 1: Etha docked precisely behind top-left Liquid Glass corner
      ethaDock,
      // 2: Ambo poised gently on right flank ready to launch next!
      { x: mobile ? w * .96 : Math.min(w - 40, ethaFrame.x + ethaFrame.w + 26), y: ethaFrame.y + ethaFrame.h * .52, r: 22, rx: 0, ry: 0, s: mobile ? .32 : .50, o: .34, front: false },
      // 3 & 4: Institutional petals quiet in lower periphery
      { x: mobile ? w * .12 : ethaFrame.x - 40, y: ethaFrame.y + ethaFrame.h * .92, r: -28, rx: 0, ry: 0, s: mobile ? .24 : .40, o: .20, front: false },
      { x: mobile ? w * .92 : ethaFrame.x + ethaFrame.w * .94, y: ethaFrame.y + ethaFrame.h * .94, r: 28, rx: 0, ry: 0, s: mobile ? .24 : .40, o: .20, front: false }
    ];

    const amboDock = mobile
      ? { x: amboDemo.x + 54, y: amboDemo.y + 70, r: -54, rx: 0, ry: 0, s: .40, o: .92, front: false }
      : { x: amboDemo.x + 22, y: amboDemo.y + 215, r: -68, rx: 0, ry: 0, s: .58, o: .92, front: false };

    const amboRest = [
      // 0: Minne poised high center-top inside visible horizon ready for vertical descent!
      { x: mobile ? w * .52 : w * .52, y: amboDemo.y + (mobile ? 80 : 185), r: 6, rx: 0, ry: 0, s: mobile ? .32 : .50, o: .36, front: false },
      // 1: Etha softly recedes above/right
      { x: mobile ? w * .92 : amboDemo.x + amboDemo.w + 48, y: amboDemo.y + 72, r: 24, rx: 0, ry: 0, s: mobile ? .26 : .42, o: .24, front: false },
      // 2: Ambo docked aligned with Modalidade / CTA glass edge
      amboDock,
      // 3 & 4: Institutional balance
      { x: mobile ? w * .10 : amboDemo.x - 70, y: amboDemo.y + amboDemo.h * .90, r: -24, rx: 0, ry: 0, s: mobile ? .24 : .38, o: .20, front: false },
      { x: mobile ? w * .92 : amboDemo.x + amboDemo.w + 44, y: amboDemo.y + amboDemo.h * .90, r: 26, rx: 0, ry: 0, s: mobile ? .24 : .38, o: .20, front: false }
    ];

    const minneDock = mobile
      ? { x: minneDemo.x + minneDemo.w * .54, y: minneDemo.y + 44, r: 6, rx: 0, ry: 0, s: .38, o: .92, front: false }
      : { x: minneDemo.x + minneDemo.w * .45, y: minneDemo.y + 54, r: 4, rx: 0, ry: 0, s: .56, o: .92, front: false };

    const minneRest = [
      // 0: Minne docked atop agenda -> detail panel seam
      minneDock,
      // 1: Etha quiet left-lower periphery
      { x: mobile ? w * .08 : minneDemo.x - 42, y: minneDemo.y + minneDemo.h * .76, r: -22, rx: 0, ry: 0, s: mobile ? .26 : .40, o: .24, front: false },
      // 2: Ambo quiet right periphery
      { x: mobile ? w * .94 : minneDemo.x + minneDemo.w + 26, y: minneDemo.y + minneDemo.h * .52, r: 22, rx: 0, ry: 0, s: mobile ? .26 : .42, o: .26, front: false },
      // 3 & 4: Institutional
      { x: mobile ? w * .12 : minneDemo.x + 40, y: minneDemo.y + minneDemo.h * .96, r: -20, rx: 0, ry: 0, s: mobile ? .22 : .36, o: .20, front: false },
      { x: mobile ? w * .90 : minneDemo.x + minneDemo.w * .90, y: minneDemo.y + minneDemo.h * .96, r: 24, rx: 0, ry: 0, s: mobile ? .22 : .36, o: .20, front: false }
    ];

    // Connection horizontal relay poses (Etha -> Ambo -> Minne)
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

    // Closing flower: full recognizable 5-petal Enomera symbol on BOTH desktop AND mobile!
    const closeW = mobile ? 148 : Math.min(400, closingTop.w * .30);
    const closeH = closeW * (388 / 470);
    const closeBox = mobile
      ? { x: (w - closeW) / 2, y: closingTop.y + closingTop.h - closeH - 8, w: closeW, h: closeH }
      : { x: closingTop.x + closingTop.w - closeW, y: closingTop.y + Math.max(0, (closingTop.h - closeH) / 2), w: closeW, h: closeH };

    return {
      mobile,
      w,
      h,
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

  function target(i, now, context) {
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

    // Reduced motion: static whole flower at hero & closing, static docked service petals at each product.
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

    // Expire transient service pulse smoothly after its short local nod.
    if (owner.mode === 'intent' && owner.expiresAt && now >= owner.expiresAt) {
      owner = createOwnerState(y);
    }

    if (owner.mode === 'intent') {
      p = applyIntentPose(p, i, owner, plan, y);
    }

    // Gentle finite settling breath that stops completely during reading/typing.
    const idle = !context.reading && now < settleUntil && now - lastIntent > 180;
    const remaining = clamp((settleUntil - now) / 1600);
    if (idle) {
      p = {
        ...p,
        r: p.r + Math.sin((now - started) / 1400 + i * 1.8) * .7 * remaining,
        y: p.y + Math.sin((now - started) / 1700 + i * 1.3) * 1.1 * remaining
      };
    }

    // Initial load blossom settle at y = 0.
    if (y < 16 && now - started < 1150) {
      const entrance = clamp((now - started - i * 45) / 980);
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
      const dist = Math.hypot(pose.x - dock.x, pose.y - (dock.y - y));
      const radius = plan.mobile ? 185 : 260;
      const prox = clamp(1 - dist / radius);
      const smoothProx = prox * prox * (3 - 2 * prox);
      const focused = owner.mode === 'intent' && owner.service === service;
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

  const eps = { x: .18, y: .18, r: .06, rx: .08, ry: .08, s: .0018, o: .003 };

  function tick(now) {
    frame = 0;
    if (hidden || (!plan && !portal)) return;
    const snap = snapNext || reduced.matches;
    snapNext = false;
    if (!snap && document.activeElement?.matches('input,textarea,select') && now - lastScroll > 48) {
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

    const goals = petals.map((_, i) => target(i, now, context));

    petals.forEach((petal, i) => {
      const goal = goals[i];
      if (!goal) return;
      if (!petal.pose || snap) {
        petal.pose = { x: goal.x, y: goal.y, r: goal.r, rx: goal.rx, ry: goal.ry, s: goal.s, o: goal.o };
      }
      const p = petal.pose;
      // Active foreground protagonist responds crisply; companion & resting petals settle smoothly.
      const tau = portal ? 110 : (goal.front ? 66 : 86 + i * 6);
      const rate = snap ? 1 : 1 - Math.exp(-dt / tau);

      for (const key of ['x', 'y', 'r', 'rx', 'ry', 's', 'o']) {
        const delta = goal[key] - p[key];
        if (Math.abs(delta) > eps[key]) {
          moving = true;
          p[key] += delta * rate;
        } else {
          p[key] = goal[key];
        }
      }

      const wantZ = goal.front ? 12 : 1;
      if (petal.z !== wantZ) {
        petal.z = wantZ;
        petal.slot.style.zIndex = String(wantZ);
      }

      const visible = p.y > -560 && p.y < dimensions.h + 560;
      petal.outer.style.visibility = visible ? 'visible' : 'hidden';
      petal.outer.style.transform = `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0) scale(${p.s.toFixed(4)})`;
      petal.outer.style.opacity = p.o.toFixed(3);
      petal.plane.style.transform = (Math.abs(p.rx) > .05 || Math.abs(p.ry) > .05)
        ? `perspective(1000px) rotateZ(${p.r.toFixed(2)}deg) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg)`
        : `rotateZ(${p.r.toFixed(2)}deg)`;
    });

    if (!portal) {
      syncDockGlow('etha', 1, y, ethaGlow, ethaFrameEl);
      syncDockGlow('ambo', 2, y, amboGlow, null);
      syncDockGlow('minne', 0, y, minneGlow, null);
    }

    if (moving || (!reduced.matches && (now - started < 1200 || now < settleUntil || (owner.expiresAt && now < owner.expiresAt)))) {
      frame = requestAnimationFrame(tick);
    } else {
      last = 0;
    }
  }

  function schedule() {
    if (!frame && !hidden) frame = requestAnimationFrame(tick);
  }

  function intention(keepSettle = true) {
    lastIntent = performance.now();
    if (keepSettle) {
      settleUntil = document.activeElement?.matches('input,textarea,select')
        ? 0
        : lastIntent + (portal ? 650 : 1600);
    }
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
      intention(false);
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') {
      lastInputModality = 'keyboard';
    }
  }, true);
  document.addEventListener('pointerdown', () => { lastInputModality = 'pointer'; }, { passive: true, capture: true });

  addEventListener('scroll', () => {
    lastScroll = performance.now();
    owner = transitionOwner(owner, { type: 'scroll', scrollY });
    intention(true);
  }, { passive: true });

  addEventListener('resize', () => {
    snapNext = true;
    measure();
  }, { passive: true });

  // Desktop hover: localized attentive orientation without restarting the scene.
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

    // Subtle localized pulse when interacting with Ambo/Minne controls (then returns calmly to rest).
    window.addEventListener('enomera:service-pulse', e => {
      if (reduced.matches) return;
      const service = e.detail?.service;
      if (!service || !(service in SERVICE_PETAL)) return;
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

  // Keyboard focus: immediate native :focus-visible + localized petal orientation.
  document.addEventListener('focusin', e => {
    settleUntil = 0;
    const targetEl = e.target instanceof Element ? e.target : null;
    if (targetEl?.matches('input,textarea,select')) {
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

  // In-page service clicks trigger redistribution; external links are NEVER intercepted.
  document.addEventListener('click', e => {
    if (e.target.closest?.('a[target="_blank"]')) return;
    const control = e.target.closest?.('button[data-service],[data-billing],[data-portal],[data-goto],[data-active]');
    if (!control) return;
    portalRevision++;
    requestAnimationFrame(() => {
      if (portal) measure();
      intention(true);
    });
  }, true);

  document.querySelector('.pilot')?.addEventListener('toggle', () => {
    measure();
    intention(true);
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
    settleUntil = 0;
    snapNext = true;
    schedule();
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

  measure();
  document.fonts.ready.then(measure);
  intention(true);

  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    slots.forEach(s => s.remove());
  };
}
