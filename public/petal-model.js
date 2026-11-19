// Document-space anchors, expressive Etha choreography, and single-owner arbitration.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOutCubic = t => { t = clamp(t); return 1 - (1 - t) ** 3; };
export const easeInOutCubic = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2; };

export const PETAL_SERVICE = ['minne', 'etha', 'ambo', null, null];
export const SERVICE_PETAL = { minne: 0, etha: 1, ambo: 2 };

export function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function blendPose(a, b, t, i = 0) {
  // A quadratic arc vanishes at both ends; every petal has its own bend.
  const u = smooth(t), arc = 4 * u * (1 - u), bend = [-28, 40, -35, 52, -46][i];
  const out = {
    x: a.x + (b.x - a.x) * u + arc * bend,
    y: a.y + (b.y - a.y) * u + arc * [24, -35, 42, -22, 31][i],
    r: a.r + (b.r - a.r) * u,
    s: a.s + (b.s - a.s) * u,
    o: a.o + (b.o - a.o) * u
  };
  if ('rx' in a || 'rx' in b) out.rx = (a.rx || 0) + ((b.rx || 0) - (a.rx || 0)) * u;
  if ('ry' in a || 'ry' in b) out.ry = (a.ry || 0) + ((b.ry || 0) - (a.ry || 0)) * u;
  if ('front' in a || 'front' in b) out.front = u < .5 ? !!a.front : !!b.front;
  return out;
}

export function sampleJourney(stops, y, i) {
  if (y <= stops[0].at) return stops[0].poses[i];
  for (let n = 1; n < stops.length; n++) {
    if (y <= stops[n].at) {
      const a = stops[n - 1], b = stops[n];
      const t = (y - a.at) / Math.max(1, b.at - a.at);
      return blendPose(a.poses[i], b.poses[i], t, i);
    }
  }
  return stops.at(-1).poses[i];
}

export function selectionPose(p, i, selected) {
  const service = PETAL_SERVICE[i];
  if (!service) return p;
  return selected.includes(service)
    ? p
    : { ...p, x: p.x + (i % 2 ? 26 : -26), y: p.y + 22, r: p.r + (i % 2 ? 22 : -22), s: p.s * .78, o: p.o * .62 };
}

/**
 * Pure 4-moment choreography for Petal 1 (Left Lavender #C7BDF4 -> Etha).
 * u in [0, 1] maps scrollY from 0 (hero) to ethaArriveAt (Etha docked).
 * All returned coordinates are in document space; continuous and reversible for any u.
 */
export function sampleEthaLeadPose(u, geom) {
  const progress = clamp(u, 0, 1);
  const { mobile, w, h, arriveAt, hero, dock } = geom;

  // Keyframe P0 (u = 0): exact resting spot inside hero flower.
  const p0 = { x: hero.x, y: hero.y, r: 0, rx: 0, ry: 0, s: hero.s, o: 1 };

  // Keyframe P1 (u = 0.22): immediate highlight & lift out of the flower on first short scroll.
  const p1 = mobile
    ? { x: hero.x - 26, y: hero.y - 28, r: -14, rx: 6, ry: -9, s: Math.max(hero.s * 1.78, .35), o: 1 }
    : { x: hero.x - 68, y: hero.y - 52, r: -15, rx: 7, ry: -11, s: hero.s * 1.15, o: 1 };

  // Approach knot P2 (u = 0.78): poised in open air right above the Etha glass corner
  // so foreground -> behind-glass z-index handoff is visually invisible.
  const p2 = mobile
    ? { x: dock.x + 18, y: dock.y - 118, r: 16, rx: 5, ry: -6, s: dock.s * 1.24, o: .98 }
    : { x: dock.x + 56, y: dock.y - 144, r: 22, rx: 5, ry: -7, s: dock.s * 1.26, o: .98 };

  // Docked knot P3 (u = 1.00): nestled precisely at Etha's Liquid Glass corner beside the lavender pill.
  const p3 = { x: dock.x, y: dock.y, r: dock.r, rx: 0, ry: 0, s: dock.s, o: .93 };

  // Moment 1: Origem (0.00 -> 0.22)
  if (progress <= .22) {
    const t = easeOutCubic(progress / .22);
    return {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      r: p0.r + (p1.r - p0.r) * t,
      rx: p0.rx + (p1.rx - p0.rx) * t,
      ry: p0.ry + (p1.ry - p0.ry) * t,
      s: p0.s + (p1.s - p0.s) * t,
      o: 1,
      front: progress >= .12
    };
  }

  // Moment 2: Travessia (0.22 -> 0.78) — wide sweeping foreground arc in perspective.
  if (progress <= .78) {
    const raw = (progress - .22) / .56;
    const t = easeInOutCubic(raw);
    const swell = Math.sin(raw * Math.PI); // peaks at mid-traversal

    // Control points anchored relative to the viewport at mid-scroll so the sweep
    // stays clear of left-aligned headlines/CTAs while boldly brushing the right foreground edge.
    const midScroll1 = arriveAt * .42;
    const midScroll2 = arriveAt * .68;
    const c1 = mobile
      ? { x: w + 68, y: midScroll1 + h * .34 }
      : { x: w + 86, y: midScroll1 + h * .74 };
    const c2 = mobile
      ? { x: w + 42, y: midScroll2 + h * .56 }
      : { x: Math.max(dock.x + 280, w * .74), y: midScroll2 + h * .24 };

    const baseScale = p1.s + (p2.s - p1.s) * t;
    const perspectiveGrow = mobile ? .17 * swell : .46 * swell;

    return {
      x: cubicBezier(p1.x, c1.x, c2.x, p2.x, t),
      y: cubicBezier(p1.y, c1.y, c2.y, p2.y, t),
      r: p1.r + (p2.r - p1.r) * t + (mobile ? 12 : 16) * swell,
      rx: p1.rx + (p2.rx - p1.rx) * t + (mobile ? 9 : 11) * swell,
      ry: p1.ry + (p2.ry - p1.ry) * t - (mobile ? 10 : 13) * swell,
      s: baseScale + perspectiveGrow,
      o: .98 + .02 * swell,
      front: true
    };
  }

  // Moment 3: Chegada (0.78 -> 1.00) — gentle deceleration into the Etha Liquid Glass bezel.
  const t = easeOutCubic((progress - .78) / .22);
  const arcX = Math.sin(t * Math.PI) * (mobile ? 12 : -18);
  return {
    x: p2.x + (p3.x - p2.x) * t + arcX,
    y: p2.y + (p3.y - p2.y) * t,
    r: p2.r + (p3.r - p2.r) * t,
    rx: p2.rx * (1 - t) || 0,
    ry: p2.ry * (1 - t) || 0,
    s: p2.s + (p3.s - p2.s) * t,
    o: p2.o + (p3.o - p2.o) * t,
    front: false
  };
}

/**
 * Companion petals (i = 0, 2, 3, 4) yield softly during Origem -> Travessia so
 * Petal 1 (Etha lavender) leads the eye unmistakably, then settle into quiet peripheral balance.
 */
export function sampleEthaSupportPose(u, i, heroPose, restPose, mobile) {
  const progress = clamp(u, 0, 1);
  // Early gentle opening so the whole flower stays legible at u=0 and parts gracefully as Etha leaves.
  const openT = easeOutCubic(clamp(progress / .28));
  const openDx = [10, 0, 36, -14, 24][i] * (mobile ? .32 : 1);
  const openDy = [-18, 0, 16, 20, 24][i] * (mobile ? .32 : 1);
  const openRot = [4, 0, 10, -6, 8][i];

  const opened = {
    x: heroPose.x + openDx,
    y: heroPose.y + openDy,
    r: openRot,
    rx: 0,
    ry: 0,
    s: heroPose.s * (mobile ? .92 : .88),
    o: mobile ? .52 : .58,
    front: false
  };

  if (progress <= .24) {
    return {
      x: heroPose.x + (opened.x - heroPose.x) * openT,
      y: heroPose.y + (opened.y - heroPose.y) * openT,
      r: heroPose.r + (opened.r - heroPose.r) * openT,
      rx: 0,
      ry: 0,
      s: heroPose.s + (opened.s - heroPose.s) * openT,
      o: heroPose.o + (opened.o - heroPose.o) * openT,
      front: false
    };
  }

  const travelT = smooth((progress - .24) / .76);
  const blended = blendPose(opened, restPose, travelT, i);
  blended.rx = 0;
  blended.ry = 0;
  blended.front = false;
  return blended;
}

// --- Single-owner arbitration state machine ---
const SOURCE_PRIORITY = { scroll: 0, hover: 1, tap: 2, focus: 3 };

export function createOwnerState(scrollY = 0) {
  return { mode: 'scroll', service: null, source: 'scroll', sinceScrollY: scrollY, targetRect: null };
}

export function transitionOwner(owner, event) {
  if (!event) return owner;
  if (event.type === 'clear') return createOwnerState(event.scrollY ?? owner.sinceScrollY);

  if (event.type === 'scroll') {
    const y = event.scrollY ?? 0;
    if (owner.mode === 'intent' && Math.abs(y - owner.sinceScrollY) > 12) {
      return createOwnerState(y);
    }
    return owner.mode === 'scroll' ? { ...owner, sinceScrollY: y } : owner;
  }

  if (event.type === 'release') {
    if (owner.mode === 'intent' && owner.source === event.source) {
      return createOwnerState(event.scrollY ?? owner.sinceScrollY);
    }
    return owner;
  }

  if (event.type === 'intent') {
    const incomingPriority = SOURCE_PRIORITY[event.source] ?? 1;
    const currentPriority = owner.mode === 'intent' ? (SOURCE_PRIORITY[owner.source] ?? 0) : 0;
    // Lower-priority hover never steals ownership from active keyboard focus.
    if (owner.mode === 'intent' && incomingPriority < currentPriority) return owner;
    return {
      mode: 'intent',
      service: event.service,
      source: event.source,
      sinceScrollY: event.scrollY ?? owner.sinceScrollY,
      targetRect: event.targetRect || null
    };
  }

  return owner;
}

/**
 * Localized, attentive response when a user explicitly hovers, focuses, or selects a service.
 * Never teleports wildly; orients and gently draws the matching petal toward the active item.
 */
export function applyIntentPose(basePose, i, owner, geom, scrollY) {
  if (!owner || owner.mode !== 'intent' || !owner.service) return basePose;
  const targetIdx = SERVICE_PETAL[owner.service];
  if (targetIdx === undefined) return basePose;

  if (i !== targetIdx) {
    return { ...basePose, o: Math.max(.18, basePose.o * .76) };
  }

  // If targeting Etha while near Etha or hero, draw cleanly toward Etha's glass dock / target.
  const tRect = owner.targetRect;
  const mobile = !!geom?.mobile;
  const maxPullX = mobile ? 56 : 110;
  const maxPullY = mobile ? 48 : 88;

  let goalX = basePose.x;
  let goalY = basePose.y;
  if (owner.service === 'etha' && geom?.dock && Math.abs((geom.dock.y - scrollY) - (basePose.y - scrollY)) < (geom.h || 900) * .95) {
    // Draw directly toward Etha's real lavender dock edge when Etha is in view!
    const pull = owner.source === 'focus' ? .72 : .55;
    goalX = basePose.x + clamp(geom.dock.x - basePose.x, -maxPullX, maxPullX) * pull;
    goalY = basePose.y + clamp(geom.dock.y - basePose.y, -maxPullY, maxPullY) * pull;
  } else if (tRect) {
    const anchorX = tRect.x + tRect.w * (owner.service === 'ambo' ? .82 : .24);
    const anchorY = tRect.y + Math.min(tRect.h * .36, 120);
    goalX = basePose.x + clamp((anchorX - basePose.x) * .42, -maxPullX, maxPullX);
    goalY = basePose.y + clamp((anchorY - basePose.y) * .42, -maxPullY, maxPullY);
  }

  const dx = goalX - basePose.x;
  const dy = goalY - basePose.y;
  const orientShift = clamp(dx * .12 - dy * .06, -16, 16);

  return {
    ...basePose,
    x: goalX,
    y: goalY,
    r: basePose.r + orientShift,
    rx: (basePose.rx || 0) + 3,
    ry: (basePose.ry || 0) + clamp(dx * -.08, -8, 8),
    s: basePose.s * 1.07,
    o: Math.min(1, Math.max(.94, basePose.o + .18))
  };
}
