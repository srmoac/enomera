import {
  clamp,
  blendPose,
  sampleJourney,
  selectionPose,
  sampleEthaLeadPose,
  sampleEthaSupportPose,
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

  const ethaFrameEl = document.querySelector('#etha-frame');
  const ethaGlowEl = ethaFrameEl?.querySelector('.etha-dock-glow') || null;

  let stops = [];
  let ethaGeom = null;
  let ethaRestPoses = null;
  let frame = 0, last = 0, started = performance.now(), settleUntil = 0;
  let portalRevision = 0, hidden = false, snapNext = false;
  let dimensions = { w: innerWidth, h: innerHeight };
  let lastIntent = performance.now(), lastScroll = 0;
  let owner = createOwnerState(scrollY);
  let lastDockOpacity = -1;
  let lastDockedClass = false;
  let lastInputModality = 'pointer';

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

  function computeEthaDock(mobile) {
    const frameRect = anchors.get('#etha-frame') || anchors.get('#etha .demo-wrap');
    if (!frameRect) return null;
    if (mobile) {
      // Top-right corner of the Etha Liquid Glass bezel, right beside the lavender 'etha' pill.
      return {
        x: frameRect.x + frameRect.w - 34,
        y: frameRect.y + 62,
        r: 24,
        s: .42
      };
    }
    // Top-left corner of the Etha Liquid Glass bezel, right behind the lavender 'etha' pill.
    return {
      x: frameRect.x + 42,
      y: frameRect.y + 92,
      r: 34,
      s: .64
    };
  }

  function spread(r, kind) {
    const mobile = dimensions.w < 700;
    const scale = mobile ? .34 : .60;
    const desktopOffsets = {
      etha: [[.84, .06, -18], [.08, .12, 34], [1.02, .44, -14], [.94, .96, 38], [.46, .98, -28]],
      ambo: [[.32, .20, -14], [.88, .28, 24], [.78, .66, -22], [.40, .95, 32], [.98, .92, -30]],
      minne: [[.88, .12, 10], [.36, .22, -24], [.98, .48, 26], [.44, .92, -20], [.86, .95, 32]],
      open: [[.18, .35, -28], [.42, .22, -12], [.66, .48, 26], [.82, .72, -32], [.94, .82, 34]],
      meet: [[.26, .30, -16], [.48, .42, -8], [.68, .55, 16], [.84, .68, -14], [.95, .80, 22]],
      continuity: [[.32, .26, 0], [.54, .38, 10], [.72, .52, 20], [.86, .68, 28], [.96, .84, 36]]
    };
    const mobileOffsets = {
      etha: [[1.08, .48, -16], [.92, .14, 24], [1.08, .72, -10], [1.08, .88, 30], [1.06, .98, -18]],
      ambo: [[1.04, .46, -10], [1.02, .58, 24], [1.04, .72, -12], [1.06, .86, 32], [1.04, .96, -16]],
      minne: [[1.04, .46, 8], [1.02, .60, -14], [1.04, .74, 20], [1.06, .86, -12], [1.04, .96, 24]],
      open: [[.86, .35, -20], [.94, .25, -8], [.98, .52, 20], [.90, .74, -22], [.96, .88, 24]],
      meet: [[.86, .35, -12], [.94, .44, -8], [.98, .58, 14], [.90, .74, -10], [.96, .88, 18]],
      continuity: [[.86, .32, 0], [.94, .44, 10], [.98, .58, 16], [.90, .74, 22], [.96, .88, 26]]
    };
    const offsets = (mobile ? mobileOffsets : desktopOffsets)[kind];
    const poses = offsets.map(([x, y, angle], i) => ({
      x: r.x + r.w * x,
      y: r.y + r.h * y,
      r: angle,
      rx: 0,
      ry: 0,
      s: scale * (i === 0 ? .90 : .94),
      o: mobile ? .28 : .36,
      front: false
    }));

    const lead = SERVICE_PETAL[kind];
    if (lead !== undefined) {
      if (kind === 'etha') {
        const dock = computeEthaDock(mobile);
        if (dock) {
          poses[1] = { x: dock.x, y: dock.y, r: dock.r, rx: 0, ry: 0, s: dock.s, o: .93, front: false };
        }
        for (let i = 0; i < 5; i++) if (i !== 1) poses[i].o = mobile ? .20 : .28;
      } else {
        const destination = rect({ ambo: '#ambo-demo', minne: '#mini-content' }[kind]) || r;
        poses[lead] = {
          x: destination.x + destination.w * (mobile ? .86 : .80),
          y: destination.y + Math.min(destination.h * .42, 150),
          r: { ambo: 22, minne: 8 }[kind],
          rx: 0,
          ry: 0,
          s: mobile ? .31 : .48,
          o: .82,
          front: false
        };
        for (let i = 0; i < 5; i++) if (i !== lead) poses[i].o = mobile ? .23 : .34;
      }
    }
    return poses;
  }

  function measure() {
    dimensions = { w: innerWidth, h: innerHeight };
    anchors.clear();
    const keys = [
      '.hero-flower', '#etha', '#etha .demo-wrap', '#etha-frame', '#etha-dock-anchor',
      '#ambo', '#ambo .demo-wrap', '#minne', '#minne .demo-wrap',
      '.connection', '#combinacao', '#service-options', '.closing-top', '.pilot', '.portal-main'
    ];
    for (const key of keys) {
      const r = rect(key);
      if (r) anchors.set(key, r);
    }
    if (portal) { schedule(); return; }

    const h = dimensions.h;
    const mobile = dimensions.w < 700;
    const hero = anchors.get('.hero-flower');
    const closing = anchors.get('.closing-top');
    const ethaFrame = anchors.get('#etha-frame') || anchors.get('#etha .demo-wrap');
    if (!hero || !closing || !ethaFrame) return;

    const read = selector => {
      const r = anchors.get(selector);
      return Math.max(0, r.y + Math.min(r.h * .45, h * .55) - h * .5);
    };

    const heroPoses = flower(hero);
    const ethaDock = computeEthaDock(mobile);

    // Calibrate arrival distance so Origem begins on the first gesture, Travessia spans
    // ~2.5-3 comfortable scroll steps, and Repouso gives clear reading time at Etha.
    const ethaArriveAt = mobile
      ? Math.round(clamp(ethaFrame.y - h * .34, 720, Math.max(760, ethaFrame.y - 120)))
      : Math.round(clamp(ethaFrame.y - h * .24, 680, Math.max(720, ethaFrame.y - 110)));
    const ethaLeaveAt = ethaArriveAt + (mobile ? 220 : 250);

    ethaGeom = {
      mobile,
      w: dimensions.w,
      h,
      arriveAt: ethaArriveAt,
      leaveAt: ethaLeaveAt,
      hero: heroPoses[1],
      heroPoses,
      dock: ethaDock
    };

    const ethaZone = anchors.get('#etha .demo-wrap') || anchors.get('#etha');
    ethaRestPoses = spread(ethaZone, 'etha');

    // Stops from Etha rest plateau onward (Ambo, Minne, Connection, Combination, Closing).
    stops = [
      { at: 0, poses: heroPoses },
      { at: ethaArriveAt, poses: ethaRestPoses },
      { at: ethaLeaveAt, poses: ethaRestPoses }
    ];

    for (const [sel, kind] of [['#ambo', 'ambo'], ['#minne', 'minne']]) {
      const demo = anchors.get(sel + ' .demo-wrap') || anchors.get(sel);
      const at = read(demo ? sel + ' .demo-wrap' : sel);
      stops.push(
        { at: Math.max(stops.at(-1).at + 1, at - 90), poses: spread(demo, kind) },
        { at: Math.max(stops.at(-1).at + 2, at + 90), poses: spread(demo, kind) }
      );
    }

    const connection = anchors.get('.connection');
    const travel = Math.max(1, connection.h - h);
    for (const [t, kind] of [[0, 'open'], [.5, 'meet'], [1, 'continuity']]) {
      const at = connection.y + travel * t;
      const zone = mobile
        ? { x: 36, y: at + h * .88, w: dimensions.w - 64, h: h * .10 }
        : { x: dimensions.w * .54, y: at + h * .84, w: dimensions.w * .42, h: h * .13 };
      stops.push({ at, poses: spread(zone, kind) });
    }

    const combination = anchors.get('#combinacao');
    const serviceCards = anchors.get('#service-options') || combination;
    const cAt = read('#combinacao');
    const cZone = mobile
      ? { x: serviceCards.x + serviceCards.w * .75, y: serviceCards.y + 60, w: serviceCards.w * .28, h: Math.max(280, combination.y + combination.h - serviceCards.y - 100) }
      : { x: serviceCards.x + serviceCards.w * .44, y: serviceCards.y + 40, w: serviceCards.w * .56, h: Math.max(280, combination.y + combination.h - serviceCards.y - 100) };
    stops.push({ at: cAt, poses: spread(cZone, 'meet') }, { at: cAt + 140, poses: spread(cZone, 'meet') });

    const width = mobile ? 100 : Math.min(400, closing.w * .30);
    const pilotRect = anchors.get('.pilot');
    const end = {
      x: mobile ? dimensions.w - width - 24 : closing.x + closing.w - width,
      y: mobile ? (pilotRect ? pilotRect.y + 12 : closing.y + closing.h + 16) : closing.y + Math.max(0, (closing.h - width * .825) / 2),
      w: width,
      h: width * .825
    };
    const endAt = Math.max(stops.at(-1).at + 1, closing.y - h * .25);
    stops.push(
      { at: endAt, poses: flower(end) },
      { at: Math.max(endAt + 1, document.documentElement.scrollHeight - h), poses: flower(end) }
    );
    stops.sort((a, b) => a.at - b.at);
    schedule();
  }

  function selection() {
    return [...document.querySelectorAll('[data-service][aria-pressed=true]')].map(b => b.dataset.service);
  }

  function scrollPose(i, y, context) {
    if (portal) {
      const mobile = dimensions.w < 700;
      const r = context.portalRect;
      if (!r) return petals[i].pose;
      const width = mobile ? 160 : Math.min(400, r.width * .42);
      const base = { x: dimensions.w - width - 20, y: Math.max(300, dimensions.h - width * .825 - 24) + y, w: width, h: width * .825 };
      const p = flower(base, .45)[i];
      const amount = portalRevision % 5;
      return { ...p, x: p.x + Math.sin(i * 1.7 + amount) * 8, y: p.y + Math.cos(i + amount) * 6, r: Math.sin(i * 1.3 + amount) * 5 };
    }

    // Hero -> Etha 4-moment expressive scene (Origem, Travessia, Chegada, Repouso).
    if (ethaGeom && y <= ethaGeom.arriveAt) {
      const u = clamp(y / Math.max(1, ethaGeom.arriveAt), 0, 1);
      if (i === 1) return sampleEthaLeadPose(u, ethaGeom);
      return sampleEthaSupportPose(u, i, ethaGeom.heroPoses[i], ethaRestPoses[i], ethaGeom.mobile);
    }

    // Etha reading plateau & downstream journey.
    let p = sampleJourney(stops, y, i);
    const c = anchors.get('#combinacao'), end = anchors.get('.closing-top');
    if (c && end) {
      const weight = clamp((y - (c.y - dimensions.h * .6)) / 180) * clamp((end.y - dimensions.h * .3 - y) / 220);
      const changed = selectionPose(p, i, context.selected);
      p = blendPose(p, changed, weight, i);
    }
    if (context.pilotOpen && y > (end?.y || Infinity) - dimensions.h * .6) {
      p = { ...p, x: p.x + (i % 2 ? 6 : -6), r: p.r + (i - 2) * 2 };
    }
    return p;
  }

  function target(i, now, context) {
    const y = context.scrollY;
    let p = scrollPose(i, y, context);
    if (!p) return null;

    // Reduced motion: static whole flower in hero, static docked lavender petal at Etha.
    if (reduced.matches) {
      if (!portal && ethaGeom) {
        if (y < ethaGeom.arriveAt * .45) {
          p = { ...ethaGeom.heroPoses[i], rx: 0, ry: 0, front: false };
        } else if (i === 1 && ethaGeom.dock) {
          p = { x: ethaGeom.dock.x, y: ethaGeom.dock.y, r: ethaGeom.dock.r, rx: 0, ry: 0, s: ethaGeom.dock.s, o: .92, front: false };
        } else {
          p = { ...p, rx: 0, ry: 0, front: false, o: Math.min(p.o, .34) };
        }
      } else {
        p = { ...p, x: dimensions.w - 62, y: y + dimensions.h - 38, r: 0, rx: 0, ry: 0, s: .19 * (p.s < .6 ? .85 : 1), o: .30, front: false };
      }
      return { ...p, y: p.y - y };
    }

    // Apply explicit user intent (desktop hover/focus or mobile in-page service control).
    if (!portal && owner.mode === 'intent') {
      p = applyIntentPose(p, i, owner, ethaGeom, y);
    }

    // Subtle finite settling breath only while not reading/typing.
    const idle = !context.reading && now < settleUntil && now - lastIntent > 160;
    const remaining = clamp((settleUntil - now) / 1800);
    if (idle) {
      p = {
        ...p,
        r: p.r + Math.sin((now - started) / 1400 + i * 1.8) * .8 * remaining,
        y: p.y + Math.sin((now - started) / 1700 + i * 1.3) * 1.3 * remaining
      };
    }

    // Crisp hero entrance settling only at scrollY == 0 on initial load.
    if (!portal && y < 16 && now - started < 1200) {
      const entrance = clamp((now - started - i * 45) / 1000);
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

  function updateEthaDockGlow(y) {
    if (!ethaGlowEl || !ethaGeom?.dock) return;
    let dockLevel = 0;
    if (reduced.matches) {
      dockLevel = y >= ethaGeom.arriveAt * .45 && y <= ethaGeom.leaveAt + 420 ? .92 : 0;
    } else if (petals[1]?.pose) {
      const pose = petals[1].pose;
      const dockVpX = ethaGeom.dock.x;
      const dockVpY = ethaGeom.dock.y - y;
      const dist = Math.hypot(pose.x - dockVpX, pose.y - dockVpY);
      const radius = ethaGeom.mobile ? 170 : 240;
      const proximity = clamp(1 - dist / radius);
      const inEthaWindow = y > ethaGeom.arriveAt * .55 && y < ethaGeom.leaveAt + 460;
      const ethaFocused = owner.mode === 'intent' && owner.service === 'etha';
      dockLevel = (inEthaWindow || ethaFocused) ? proximity * proximity * (3 - 2 * proximity) : 0;
      if (ethaFocused) dockLevel = Math.max(dockLevel, .55);
    }

    const quantized = Math.round(dockLevel * 100) / 100;
    if (quantized !== lastDockOpacity) {
      lastDockOpacity = quantized;
      ethaGlowEl.style.opacity = String(quantized);
    }
    const dockedNow = quantized >= .58;
    if (dockedNow !== lastDockedClass) {
      lastDockedClass = dockedNow;
      ethaFrameEl.classList.toggle('is-docked', dockedNow);
    }
  }

  const eps = { x: .18, y: .18, r: .06, rx: .08, ry: .08, s: .0018, o: .003 };

  function tick(now) {
    frame = 0;
    if (hidden || (!stops.length && !portal)) return;
    const snap = snapNext || reduced.matches;
    snapNext = false;
    if (!snap && document.activeElement?.matches('input,textarea,select') && now - lastScroll > 48) {
      last = 0;
      return;
    }

    const dt = Math.min(now - last || 16, 32);
    last = now;
    let moving = false;

    // Group DOM reads before any style writes.
    const y = scrollY;
    const context = {
      scrollY: y,
      selected: selection(),
      reading: document.activeElement?.matches('input,textarea,select') || !!document.querySelector('dialog[open]'),
      pilotOpen: !!document.querySelector('.pilot')?.open,
      portalRect: portal ? document.querySelector('.portal-main')?.getBoundingClientRect() : null
    };

    const goals = petals.map((_, i) => target(i, now, context));

    petals.forEach((petal, i) => {
      const goal = goals[i];
      if (!goal) return;
      if (!petal.pose || snap) {
        petal.pose = { x: goal.x, y: goal.y, r: goal.r, rx: goal.rx, ry: goal.ry, s: goal.s, o: goal.o };
      }
      const p = petal.pose;
      // Lead Etha petal tracks scroll & explicit intent crisply; companions follow with subtle stagger.
      const tau = portal ? 110 : (i === 1 ? 68 : 88 + i * 7);
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

      const visible = p.y > -480 && p.y < dimensions.h + 480;
      petal.outer.style.visibility = visible ? 'visible' : 'hidden';
      petal.outer.style.transform = `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0) scale(${p.s.toFixed(4)})`;
      petal.outer.style.opacity = p.o.toFixed(3);
      petal.plane.style.transform = (Math.abs(p.rx) > .05 || Math.abs(p.ry) > .05)
        ? `perspective(1000px) rotateZ(${p.r.toFixed(2)}deg) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg)`
        : `rotateZ(${p.r.toFixed(2)}deg)`;
    });

    updateEthaDockGlow(y);

    if (moving || (!reduced.matches && (now - started < 1250 || now < settleUntil))) {
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
        : lastIntent + (portal ? 650 : 1800);
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
    if (article && article.id in SERVICE_PETAL) return { service: article.id, el: el.closest('a,button,.etha-frame,.ambo,.minne') || article };
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

  // Input modality tracking so focus intent activates cleanly on keyboard navigation.
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') {
      lastInputModality = 'keyboard';
    }
  }, true);
  document.addEventListener('pointerdown', () => { lastInputModality = 'pointer'; }, { passive: true, capture: true });

  // Scroll owns the narrative; moving >12px cleanly releases any prior hover/focus/tap intent.
  addEventListener('scroll', () => {
    lastScroll = performance.now();
    owner = transitionOwner(owner, { type: 'scroll', scrollY });
    intention(true);
  }, { passive: true });

  addEventListener('resize', () => {
    snapNext = true;
    measure();
  }, { passive: true });

  // Desktop hover: localized attentive response on service cards/sections/links.
  if (!portal) {
    const serviceRegions = document.querySelectorAll('#etha, #ambo, #minne');
    for (const region of serviceRegions) {
      region.addEventListener('pointerenter', () => {
        if (!fineHover.matches) return;
        dispatchOwner({
          type: 'intent',
          service: region.id,
          source: 'hover',
          scrollY,
          targetRect: elementDocRect(region.querySelector('.etha-frame,.ambo,.minne') || region)
        });
      });
      region.addEventListener('pointerleave', () => {
        if (!fineHover.matches) return;
        dispatchOwner({ type: 'release', source: 'hover', scrollY });
      });
    }

    document.addEventListener('pointerover', e => {
      if (!fineHover.matches) return;
      const card = e.target.closest?.('[data-service], [data-service-link], [data-service-example]');
      if (!card) return;
      const hit = detectServiceFromElement(card);
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
      const card = e.target.closest?.('[data-service], [data-service-link], [data-service-example]');
      if (!card) return;
      const related = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (related && related.closest('#etha,#ambo,#minne,[data-service]')) return;
      dispatchOwner({ type: 'release', source: 'hover', scrollY });
    }, { passive: true });
  }

  // Keyboard focus: immediate native :focus-visible + localized petal response.
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

  // In-page service controls (including mobile tap): drive composition without EVER intercepting external links.
  document.addEventListener('click', e => {
    const externalLink = e.target.closest?.('a[target="_blank"]');
    if (externalLink) return; // First tap immediately opens product on mobile & desktop.

    const inPageControl = e.target.closest?.('[data-service],[data-ambo],[data-mode],[data-day],[data-mini],[data-portal],[data-goto],[data-active]');
    if (!inPageControl) return;
    portalRevision++;

    if (!portal) {
      const hit = detectServiceFromElement(inPageControl);
      if (hit) {
        dispatchOwner({
          type: 'intent',
          service: hit.service,
          source: 'tap',
          scrollY,
          targetRect: elementDocRect(hit.el)
        });
      }
    }

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

  // Read-only telemetry for automated motion & state-machine verification.
  window.__enomeraPetals = {
    snapshot() {
      const y = scrollY;
      const arriveAt = ethaGeom?.arriveAt || 1;
      return {
        owner: { mode: owner.mode, service: owner.service, source: owner.source, sinceScrollY: owner.sinceScrollY },
        scrollY: y,
        ethaArriveAt: ethaGeom?.arriveAt ?? null,
        ethaLeaveAt: ethaGeom?.leaveAt ?? null,
        ethaProgress: clamp(y / arriveAt, 0, 1),
        dockOpacity: lastDockOpacity,
        docked: lastDockedClass,
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
