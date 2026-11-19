// Full-page 6-scene lake-current choreography for Enomera's 5 petals + single-owner arbitration.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOutCubic = t => { t = clamp(t); return 1 - (1 - t) ** 3; };
export const easeOutQuart = t => { t = clamp(t); return 1 - (1 - t) ** 4; };
export const easeInOutCubic = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2; };

export const PETAL_SERVICE = ['minne', 'etha', 'ambo', null, null];
export const SERVICE_PETAL = { minne: 0, etha: 1, ambo: 2 };

/**
 * Contemplative progress warp: brisk response on initial gesture (slope 1 + k),
 * ~22-26% slower visual speed right through the mid-traversal curve (slope 1 - k),
 * strictly monotonic & reversible without adding document height.
 */
export function contemplativeWarp(t, slowMid = .24) {
  const u = clamp(t, 0, 1);
  return clamp(u + slowMid * Math.sin(2 * Math.PI * u) / (2 * Math.PI), 0, 1);
}

export function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function cubicBezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Pure mirror of CSS `position: sticky` vertical positioning so docked petals stay
 * sub-pixel locked to sticky Liquid Glass panels at any scrollY without forced reflows.
 */
export function stickyDocY(scrollY, staticTop, trackBottom, elHeight, stickyTop) {
  if (stickyTop == null) return staticTop;
  const maxTop = Math.max(staticTop, trackBottom - elHeight);
  return clamp(scrollY + stickyTop, staticTop, maxTop);
}

function shiftPoseY(pose, dy) {
  return dy ? { ...pose, y: pose.y + dy } : pose;
}

function stickyShiftFor(plan, service, y) {
  const s = plan?.sticky?.[service];
  if (!s) return 0;
  return stickyDocY(y, s.staticTop, s.trackBottom, s.elHeight, s.stickyTop) - s.staticTop;
}

export function blendPose(a, b, t, i = 0) {
  const u = smooth(t), arc = 4 * u * (1 - u), bend = [-28, 40, -35, 52, -46][i];
  const out = {
    x: a.x + (b.x - a.x) * u + arc * bend,
    y: a.y + (b.y - a.y) * u + arc * [24, -35, 42, -22, 31][i],
    r: a.r + (b.r - a.r) * u,
    s: a.s + (b.s - a.s) * u,
    o: a.o + (b.o - a.o) * u
  };
  if ('rx' in a || 'rx' in b) out.rx = lerp(a.rx || 0, b.rx || 0, u) || 0;
  if ('ry' in a || 'ry' in b) out.ry = lerp(a.ry || 0, b.ry || 0, u) || 0;
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
 * Lake-current sweep arc:
 * - Uses contemplativeWarp so the mid-curve (left third!) lingers ~22-26% slower while keeping
 *   an immediate response on the first scroll gesture.
 * - Exposes curve-tangent lateral drift vector (nx, ny) so the buoyant physics layer can
 *   apply organic lateral current slip and trailing secondary rotation without oscillation.
 */
function sweepArc(from, to, rawU, cfg) {
  const u = clamp(rawU, 0, 1);
  const {
    c1, c2,
    approach,
    frontStart = .06,
    frontEnd = .76,
    peakScale = .46,
    peakRot = 18,
    peakRx = 10,
    peakRy = -16,
    slowMid = .24,
    driftAmp = 18,
    dockEase = easeOutCubic
  } = cfg;

  if (u <= frontEnd) {
    const raw = u / Math.max(.001, frontEnd);
    const t = contemplativeWarp(raw, slowMid);
    const swell = Math.sin(raw * Math.PI);
    const tx = cubicBezierTangent(from.x, c1.x, c2.x, approach.x, t);
    const ty = cubicBezierTangent(from.y, c1.y, c2.y, approach.y, t);
    const tLen = Math.hypot(tx, ty) || 1;
    // Unit normal perpendicular to curve for subtle lateral lake drift
    const nx = -ty / tLen;
    const ny = tx / tLen;
    const lateral = Math.sin(raw * Math.PI * 1.15) * driftAmp * swell;

    return {
      x: cubicBezier(from.x, c1.x, c2.x, approach.x, t) + nx * lateral,
      y: cubicBezier(from.y, c1.y, c2.y, approach.y, t) + ny * lateral * .45,
      r: lerp(from.r, approach.r, t) + peakRot * swell,
      rx: (lerp(from.rx || 0, approach.rx || 0, t) + peakRx * swell) || 0,
      ry: (lerp(from.ry || 0, approach.ry || 0, t) + peakRy * swell) || 0,
      s: lerp(from.s, approach.s, t) + peakScale * swell,
      o: Math.min(1, lerp(from.o, approach.o, t) + .08 * swell),
      front: u >= frontStart,
      nx,
      ny
    };
  }

  const t = dockEase((u - frontEnd) / Math.max(.001, 1 - frontEnd));
  return {
    x: lerp(approach.x, to.x, t),
    y: lerp(approach.y, to.y, t),
    r: lerp(approach.r, to.r, t),
    rx: ((approach.rx || 0) * (1 - t)) || 0,
    ry: ((approach.ry || 0) * (1 - t)) || 0,
    s: lerp(approach.s, to.s, t),
    o: lerp(approach.o, to.o, t),
    front: false,
    nx: 0,
    ny: 0
  };
}

/**
 * Scene 1 (Abertura): staggered tension across all 5 petals on the very first short scroll.
 */
export function sampleOpeningPose(u, i, heroPose, mobile) {
  const k = mobile ? .36 : 1;
  const delays = [.22, 0, .14, .28, .28];
  const t = easeOutCubic(clamp((u - delays[i]) / Math.max(.1, 1 - delays[i])));

  const deltas = [
    { dx: 6 * k, dy: -52 * k, dr: 4, rx: 4, ry: 4, ds: mobile ? .09 : .06, o: .92 },
    { dx: -92 * k, dy: -58 * k, dr: -19, rx: 7, ry: -11, ds: mobile ? .18 : .18, o: 1 },
    { dx: 42 * k, dy: 14 * k, dr: 15, rx: 4, ry: 8, ds: mobile ? .07 : .04, o: .92 },
    { dx: -30 * k, dy: 24 * k, dr: -9, rx: 0, ry: 0, ds: mobile ? -.01 : -.05, o: .82 },
    { dx: 30 * k, dy: 24 * k, dr: 9, rx: 0, ry: 0, ds: mobile ? -.01 : -.05, o: .82 }
  ][i];

  return {
    x: heroPose.x + deltas.dx * t,
    y: heroPose.y + deltas.dy * t,
    r: heroPose.r + deltas.dr * t,
    rx: (deltas.rx * t) || 0,
    ry: (deltas.ry * t) || 0,
    s: heroPose.s + deltas.ds * t,
    o: lerp(1, deltas.o, t),
    front: i === 1 && u >= .36
  };
}

/**
 * Identify predominant scene and floating personality at a given scrollY:
 * - Etha: most contemplative, deepest buoyant drift & trailing turn
 * - Ambo: long shallow horizontal current, balanced settle
 * - Minne: calmer, steadier settle so the eye moves cleanly to clinical details
 * - Closing: staggered serene arrival
 */
export function sceneProfileAt(scrollY, marks) {
  const y = Math.max(0, scrollY);
  if (y <= marks.openEnd) return { name: 'abertura', driftScale: .75, posTau: 115, rotTau: 165, currentDir: -1 };
  if (y <= marks.ethaLeave) return { name: 'etha', driftScale: 1.15, posTau: 162, rotTau: 238, currentDir: -1 };
  if (y <= marks.amboLeave) return { name: 'ambo', driftScale: .92, posTau: 142, rotTau: 205, currentDir: 1 };
  if (y <= marks.minneLeave) return { name: 'minne', driftScale: .62, posTau: 118, rotTau: 168, currentDir: -.6 };
  if (y <= marks.comboLeave) return { name: 'combinacao', driftScale: .70, posTau: 128, rotTau: 185, currentDir: .4 };
  return { name: 'fechamento', driftScale: .85, posTau: 152, rotTau: 225, currentDir: .3 };
}

/**
 * Full-page continuous choreography across all 6 scenes:
 *   1. Abertura       [0 .. openEnd]
 *   2. Etha           [openEnd .. ethaArrive .. ethaLeave]
 *   3. Ambo           [ethaLeave .. amboArrive .. amboLeave]
 *   4. Minne          [amboLeave .. minneArrive .. minneLeave]
 *   5. Conexão/Comb.  [minneLeave .. connEnd .. comboArrive .. comboLeave]
 *   6. Fechamento     [comboLeave .. closingArrive .. docEnd]
 */
export function sampleFullJourney(scrollY, i, plan, selected = ['ambo', 'minne', 'etha']) {
  const y = Math.max(0, scrollY);
  const { mobile, w, h, marks, poses } = plan;

  // --- SCENE 1: ABERTURA ---
  if (y <= marks.openEnd) {
    const u = clamp(y / Math.max(1, marks.openEnd));
    return sampleOpeningPose(u, i, poses.hero[i], mobile);
  }

  // --- SCENE 2: ETHA (Lavanda — most contemplative, lingering arc in the LEFT THIRD!) ---
  if (y <= marks.ethaLeave) {
    const ethaDy = stickyShiftFor(plan, 'etha', y);
    const ethaEnd = shiftPoseY(poses.ethaRest[i], ethaDy);
    if (y >= marks.ethaArrive) return ethaEnd;
    const u = clamp((y - marks.openEnd) / Math.max(1, marks.ethaArrive - marks.openEnd));
    const start = sampleOpeningPose(1, i, poses.hero[i], mobile);

    if (i === 1) {
      const sMid1 = lerp(marks.openEnd, marks.ethaArrive, .36);
      const sMid2 = lerp(marks.openEnd, marks.ethaArrive, .66);
      const approach = mobile
        ? { x: ethaEnd.x + 18, y: ethaEnd.y - 118, r: 18, rx: 4, ry: -6, s: ethaEnd.s * 1.24, o: .98 }
        : { x: ethaEnd.x - 110, y: ethaEnd.y - 138, r: 16, rx: 5, ry: -7, s: ethaEnd.s * 1.28, o: .98 };
      return sweepArc(start, ethaEnd, u, {
        c1: mobile
          ? { x: w * .34, y: sMid1 + h * .20 }
          : { x: w * .24, y: sMid1 + h * .40 },
        c2: mobile
          ? { x: w * .20, y: sMid2 + h * .22 }
          : { x: w * .18, y: sMid2 + h * .42 },
        approach,
        frontStart: mobile ? 1.1 : 0,
        frontEnd: .78,
        peakScale: mobile ? .34 : .58,
        peakRot: mobile ? -22 : -30,
        peakRx: mobile ? 9 : 13,
        peakRy: mobile ? -16 : -21,
        slowMid: .28,
        driftAmp: mobile ? 14 : 28,
        dockEase: easeOutCubic
      });
    }

    return blendPose(start, ethaEnd, u, i);
  }

  // --- SCENE 3: AMBO (Celeste — long shallow horizontal current into left half & back to Modalidade) ---
  if (y <= marks.amboLeave) {
    const ethaLeaveDy = stickyShiftFor(plan, 'etha', marks.ethaLeave);
    const amboDy = stickyShiftFor(plan, 'ambo', y);
    const amboEnd = shiftPoseY(poses.amboRest[i], amboDy);
    if (y >= marks.amboArrive) return amboEnd;
    const u = clamp((y - marks.ethaLeave) / Math.max(1, marks.amboArrive - marks.ethaLeave));
    const start = shiftPoseY(poses.ethaRest[i], ethaLeaveDy);

    if (i === 2) {
      const sMid1 = lerp(marks.ethaLeave, marks.amboArrive, .36);
      const sMid2 = lerp(marks.ethaLeave, marks.amboArrive, .68);
      const approach = mobile
        ? { x: amboEnd.x + 16, y: amboEnd.y - 110, r: -44, rx: 4, ry: 7, s: amboEnd.s * 1.24, o: .98 }
        : { x: amboEnd.x - 190, y: amboEnd.y - 14, r: -46, rx: 5, ry: 9, s: amboEnd.s * 1.24, o: .98 };
      return sweepArc(start, amboEnd, u, {
        c1: mobile
          ? { x: w * .18, y: sMid1 + h * .28 }
          : { x: w * .19, y: sMid1 + h * .52 },
        c2: mobile
          ? { x: w * .80, y: sMid2 + h * .27 }
          : { x: w * .38, y: sMid2 + h * .50 },
        approach,
        frontStart: mobile ? 1.1 : .08,
        frontEnd: .76,
        peakScale: mobile ? .30 : .56,
        peakRot: mobile ? 20 : 28,
        peakRx: mobile ? 9 : 11,
        peakRy: mobile ? 16 : 20,
        slowMid: .22,
        driftAmp: mobile ? 12 : 22,
        dockEase: easeOutCubic
      });
    }

    return blendPose(start, amboEnd, u, i);
  }

  // --- SCENE 4: MINNE (Mineral — open S-curve from above: left curve first, then right into agenda) ---
  if (y <= marks.minneLeave) {
    const amboLeaveDy = stickyShiftFor(plan, 'ambo', marks.amboLeave);
    const minneDy = stickyShiftFor(plan, 'minne', y);
    const minneEnd = shiftPoseY(poses.minneRest[i], minneDy);
    if (y >= marks.minneArrive) return minneEnd;
    const u = clamp((y - marks.amboLeave) / Math.max(1, marks.minneArrive - marks.amboLeave));
    const start = shiftPoseY(poses.amboRest[i], amboLeaveDy);

    if (i === 0) {
      const sMid1 = lerp(marks.amboLeave, marks.minneArrive, .34);
      const sMid2 = lerp(marks.amboLeave, marks.minneArrive, .68);
      const approach = mobile
        ? { x: minneEnd.x + 10, y: minneEnd.y - 122, r: 8, rx: 3, ry: -4, s: minneEnd.s * 1.20, o: .98 }
        : { x: minneEnd.x - 16, y: minneEnd.y - 148, r: 9, rx: 4, ry: -5, s: minneEnd.s * 1.22, o: .98 };
      return sweepArc(start, minneEnd, u, {
        c1: mobile
          ? { x: w * .18, y: sMid1 + h * .46 }
          : { x: w * .22, y: sMid1 + h * .54 },
        c2: mobile
          ? { x: w * .82, y: sMid2 + h * .60 }
          : { x: w * .68, y: sMid2 + h * .70 },
        approach,
        frontStart: mobile ? 1.1 : .08,
        frontEnd: .72,
        peakScale: mobile ? .32 : .54,
        peakRot: mobile ? -16 : -22,
        peakRx: mobile ? 10 : 14,
        peakRy: mobile ? -12 : -15,
        slowMid: .20,
        driftAmp: mobile ? 10 : 18,
        dockEase: easeOutQuart
      });
    }

    return blendPose(start, minneEnd, u, i);
  }

  // --- SCENE 5A: CONEXÃO HORIZONTAL ---
  if (y <= marks.connEnd) {
    const minneLeaveDy = stickyShiftFor(plan, 'minne', marks.minneLeave);
    const minneStart = shiftPoseY(poses.minneRest[i], minneLeaveDy);
    const u = clamp((y - marks.minneLeave) / Math.max(1, marks.connEnd - marks.minneLeave));
    if (u <= .33) return blendPose(minneStart, poses.conn1[i], u / .33, i);
    if (u <= .67) return blendPose(poses.conn1[i], poses.conn2[i], (u - .33) / .34, i);
    return blendPose(poses.conn2[i], poses.conn3[i], (u - .67) / .33, i);
  }

  // --- SCENE 5B: COMBINAÇÃO ---
  const comboPose = computeCombinationPose(i, plan, selected);
  if (y <= marks.comboLeave) {
    if (y >= marks.comboArrive) return comboPose;
    const u = clamp((y - marks.connEnd) / Math.max(1, marks.comboArrive - marks.connEnd));
    return blendPose(poses.conn3[i], comboPose, u, i);
  }

  // --- SCENE 6: FECHAMENTO (Staggered serene reunion into the full 5-petal flower) ---
  if (y >= marks.closingArrive) return poses.closing[i];
  const rawU = clamp((y - marks.comboLeave) / Math.max(1, marks.closingArrive - marks.comboLeave));
  // Lower institutional petals (3, 4) anchor the base first; Ambo (2) and Minne (0) arrive next;
  // Etha (1, Lavanda) finishes the final gentle turn into complete flower formation!
  const arriveStarts = [.10, .16, .06, 0, 0][i];
  const arriveEnds = [.92, 1.0, .86, .78, .80][i];
  const localU = clamp((rawU - arriveStarts) / Math.max(.1, arriveEnds - arriveStarts), 0, 1);

  const end = poses.closing[i];
  const t = easeOutCubic(localU);
  const swell = Math.sin(localU * Math.PI);
  const spreadDir = [0, -1, 1, -.7, .7][i];
  const liftY = [-105, -52, -48, 52, 52][i] * (mobile ? .42 : 1);
  // Subtle final orientation turn as the last petal settles into place
  const finalTurn = (1 - easeOutQuart(localU)) * [10, -18, 16, -8, 8][i] * Math.min(1, localU * 4);
  return {
    x: lerp(comboPose.x, end.x, t) + spreadDir * (mobile ? 52 : 128) * swell,
    y: lerp(comboPose.y, end.y, t) + liftY * swell,
    r: lerp(comboPose.r, end.r, t) + finalTurn,
    rx: (5 * swell) || 0,
    ry: (spreadDir * -9 * swell) || 0,
    s: lerp(comboPose.s, end.s, t) + (mobile ? .07 : .12) * swell,
    o: lerp(comboPose.o, end.o, t),
    front: false
  };
}

/**
 * Dynamic redistribution in #combinacao aligned to card order: Ambo (left), Minne (center), Etha (right).
 */
export function computeCombinationPose(i, plan, selected) {
  const base = plan.poses.comboBase[i];
  const service = PETAL_SERVICE[i];
  if (!service) return base;

  const { mobile, summaryRect } = plan;
  const activeServices = ['ambo', 'minne', 'etha'].filter(id => selected.includes(id));
  const activeIdx = activeServices.indexOf(service);

  if (activeIdx >= 0 && summaryRect) {
    const count = activeServices.length;
    const frac = count === 1 ? .50 : count === 2 ? (activeIdx === 0 ? .28 : .72) : [.17, .50, .83][activeIdx];
    const angle = service === 'ambo' ? -24 : service === 'etha' ? 24 : 0;
    return {
      x: summaryRect.x + summaryRect.w * frac,
      y: summaryRect.y + (mobile ? 30 : 48),
      r: angle,
      rx: 0,
      ry: 0,
      s: mobile ? .36 : .56,
      o: .90,
      front: false
    };
  }

  const outX = service === 'etha' ? (mobile ? 24 : 76) : service === 'ambo' ? (mobile ? -24 : -76) : 0;
  return {
    x: base.x + outX,
    y: base.y - (mobile ? 26 : 56),
    r: base.r + (service === 'etha' ? 22 : service === 'ambo' ? -22 : 12),
    rx: 0,
    ry: 0,
    s: base.s * .72,
    o: .28,
    front: false
  };
}

// --- Single-owner arbitration state machine ---
const SOURCE_PRIORITY = { scroll: 0, hover: 1, pulse: 2, tap: 2, focus: 3 };

export function createOwnerState(scrollY = 0) {
  return { mode: 'scroll', service: null, source: 'scroll', sinceScrollY: scrollY, targetRect: null, expiresAt: 0 };
}

export function transitionOwner(owner, event) {
  if (!event) return owner;
  if (event.type === 'clear') return createOwnerState(event.scrollY ?? owner.sinceScrollY);

  if (event.type === 'scroll') {
    const y = event.scrollY ?? 0;
    if (owner.mode === 'intent' && Math.abs(y - owner.sinceScrollY) > 14) {
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
    if (owner.mode === 'intent' && incomingPriority < currentPriority) return owner;
    return {
      mode: 'intent',
      service: event.service,
      source: event.source,
      sinceScrollY: event.scrollY ?? owner.sinceScrollY,
      targetRect: event.targetRect || null,
      expiresAt: event.expiresAt || 0
    };
  }

  return owner;
}

export function applyIntentPose(basePose, i, owner, plan, scrollY) {
  if (!owner || owner.mode !== 'intent' || !owner.service) return basePose;
  const targetIdx = SERVICE_PETAL[owner.service];
  if (targetIdx === undefined) return basePose;

  if (i !== targetIdx) {
    return { ...basePose, o: Math.max(.20, basePose.o * .82) };
  }

  const mobile = !!plan?.mobile;
  const maxPullX = mobile ? 42 : 76;
  const maxPullY = mobile ? 36 : 62;
  const tRect = owner.targetRect;

  let dx = 0, dy = 0;
  if (tRect) {
    const anchorX = tRect.x + tRect.w * (owner.service === 'ambo' ? .24 : owner.service === 'minne' ? .46 : .18);
    const anchorY = tRect.y + Math.min(tRect.h * .35, 110);
    const distVp = Math.hypot(anchorX - basePose.x, (anchorY - scrollY) - (basePose.y - scrollY));
    if (distVp < (plan?.h || 900) * 1.15) {
      const strength = owner.source === 'pulse' ? .34 : owner.source === 'focus' ? .42 : .28;
      dx = clamp((anchorX - basePose.x) * strength, -maxPullX, maxPullX);
      dy = clamp((anchorY - basePose.y) * strength, -maxPullY, maxPullY);
    }
  }

  const orientShift = clamp(dx * .12 - dy * .06, -12, 12);
  return {
    ...basePose,
    x: basePose.x + dx,
    y: basePose.y + dy,
    r: basePose.r + orientShift,
    rx: (basePose.rx || 0) + 3,
    ry: (basePose.ry || 0) + clamp(dx * -.08, -7, 7),
    s: basePose.s * (owner.source === 'pulse' ? 1.05 : 1.06),
    o: Math.min(1, Math.max(.94, basePose.o + .14))
  };
}
