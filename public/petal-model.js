// Full-page 6-scene choreography for Enomera's 5 petals + single-owner interactivity arbitration.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOutCubic = t => { t = clamp(t); return 1 - (1 - t) ** 3; };
export const easeOutQuart = t => { t = clamp(t); return 1 - (1 - t) ** 4; };
export const easeInOutCubic = t => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2; };

export const PETAL_SERVICE = ['minne', 'etha', 'ambo', null, null];
export const SERVICE_PETAL = { minne: 0, etha: 1, ambo: 2 };

export function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
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
 * Helper: smooth sweeping arc between two document-space poses using viewport-anchored
 * control points so the foreground trajectory uses left, center, right, top & bottom predictably.
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
    peakRx = 12,
    peakRy = -18,
    dockEase = easeOutCubic
  } = cfg;

  if (u <= frontEnd) {
    const raw = u / Math.max(.001, frontEnd);
    const t = easeInOutCubic(raw);
    const swell = Math.sin(raw * Math.PI);
    return {
      x: cubicBezier(from.x, c1.x, c2.x, approach.x, t),
      y: cubicBezier(from.y, c1.y, c2.y, approach.y, t),
      r: lerp(from.r, approach.r, t) + peakRot * swell,
      rx: (lerp(from.rx || 0, approach.rx || 0, t) + peakRx * swell) || 0,
      ry: (lerp(from.ry || 0, approach.ry || 0, t) + peakRy * swell) || 0,
      s: lerp(from.s, approach.s, t) + peakScale * swell,
      o: Math.min(1, lerp(from.o, approach.o, t) + .08 * swell),
      front: u >= frontStart
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
    front: false
  };
}

/**
 * Scene 1 (Abertura): staggered tension across all 5 petals on the very first short scroll.
 * Lavanda (1) leads first, Celeste (2) opens angle, Mineral (0) lifts away from lower petals (3, 4).
 */
export function sampleOpeningPose(u, i, heroPose, mobile) {
  const k = mobile ? .36 : 1;
  const delays = [.22, 0, .14, .28, .28];
  const t = easeOutCubic(clamp((u - delays[i]) / Math.max(.1, 1 - delays[i])));

  const deltas = [
    { dx: 6 * k, dy: -54 * k, dr: 4, rx: 4, ry: 4, ds: mobile ? .09 : .06, o: .92 },    // 0: Minne lifts vertically
    { dx: -86 * k, dy: -62 * k, dr: -18, rx: 8, ry: -12, ds: mobile ? .18 : .18, o: 1 }, // 1: Etha leads first
    { dx: 42 * k, dy: 14 * k, dr: 15, rx: 4, ry: 8, ds: mobile ? .07 : .04, o: .92 },    // 2: Ambo opens outward
    { dx: -30 * k, dy: 24 * k, dr: -9, rx: 0, ry: 0, ds: mobile ? -.01 : -.05, o: .82 }, // 3: Lower-left
    { dx: 30 * k, dy: 24 * k, dr: 9, rx: 0, ry: 0, ds: mobile ? -.01 : -.05, o: .82 }    // 4: Lower-right
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
 * Full-page continuous choreography across all 6 scenes:
 *   1. Abertura       [0 .. openEnd]
 *   2. Etha           [openEnd .. ethaArrive .. ethaLeave]
 *   3. Ambo           [ethaLeave .. amboArrive .. amboLeave]
 *   4. Minne          [amboLeave .. minneArrive .. minneLeave]
 *   5. Conexão/Comb.  [minneLeave .. connEnd .. comboArrive .. comboLeave]
 *   6. Fechamento     [comboLeave .. closingArrive .. docEnd]
 *
 * Strictly continuous and reversible at every scrollY in [0, docEnd].
 */
export function sampleFullJourney(scrollY, i, plan, selected = ['ambo', 'minne', 'etha']) {
  const y = Math.max(0, scrollY);
  const { mobile, w, h, marks, poses } = plan;

  // --- SCENE 1: ABERTURA (0 -> openEnd) ---
  if (y <= marks.openEnd) {
    const u = clamp(y / Math.max(1, marks.openEnd));
    return sampleOpeningPose(u, i, poses.hero[i], mobile);
  }

  // --- SCENE 2: ETHA (openEnd -> ethaArrive -> ethaLeave) ---
  if (y <= marks.ethaLeave) {
    if (y >= marks.ethaArrive) return poses.ethaRest[i];
    const u = clamp((y - marks.openEnd) / Math.max(1, marks.ethaArrive - marks.openEnd));
    const start = sampleOpeningPose(1, i, poses.hero[i], mobile);
    const end = poses.ethaRest[i];

    if (i === 1) {
      // Lavanda: wide center-crossing foreground sweep!
      // Desktop: Hero left -> sweeps across CENTER-LEFT -> curves into Etha top-left glass bezel.
      // Mobile: Hero bottom-right -> crosses FULL 390px WIDTH to LEFT edge -> docks top-left of Etha glass bezel.
      const sMid1 = lerp(marks.openEnd, marks.ethaArrive, .38);
      const sMid2 = lerp(marks.openEnd, marks.ethaArrive, .68);
      const approach = mobile
        ? { x: end.x + 12, y: end.y - 122, r: 22, rx: 5, ry: -6, s: end.s * 1.28, o: .98 }
        : { x: end.x - 42, y: end.y - 148, r: 20, rx: 6, ry: -8, s: end.s * 1.32, o: .98 };
      return sweepArc(start, end, u, {
        c1: mobile
          ? { x: w * .26, y: sMid1 + h * .28 }
          : { x: w * .34, y: sMid1 + h * .66 },
        c2: mobile
          ? { x: 24, y: sMid2 + h * .24 }
          : { x: w * .48, y: sMid2 + h * .24 },
        approach,
        frontStart: 0,
        frontEnd: .76,
        peakScale: mobile ? .34 : .64,
        peakRot: mobile ? -20 : -26,
        peakRx: mobile ? 10 : 14,
        peakRy: mobile ? -18 : -22,
        dockEase: easeOutCubic
      });
    }

    // Companion petals softly clear the center stage so Lavanda commands the sweep.
    return blendPose(start, end, u, i);
  }

  // --- SCENE 3: AMBO (ethaLeave -> amboArrive -> amboLeave) ---
  if (y <= marks.amboLeave) {
    if (y >= marks.amboArrive) return poses.amboRest[i];
    const u = clamp((y - marks.ethaLeave) / Math.max(1, marks.amboArrive - marks.ethaLeave));
    const start = poses.ethaRest[i];
    const end = poses.amboRest[i];

    if (i === 2) {
      // Celeste: long horizontal-bias arc across the page into Ambo's Modalidade selector!
      const sMid1 = lerp(marks.ethaLeave, marks.amboArrive, .36);
      const sMid2 = lerp(marks.ethaLeave, marks.amboArrive, .68);
      const approach = mobile
        ? { x: end.x + 12, y: end.y - 115, r: -44, rx: 5, ry: 8, s: end.s * 1.28, o: .98 }
        : { x: end.x - 165, y: end.y - 18, r: -46, rx: 6, ry: 10, s: end.s * 1.28, o: .98 };
      return sweepArc(start, end, u, {
        c1: mobile
          ? { x: w * .18, y: sMid1 + h * .28 }
          : { x: w * .26, y: sMid1 + h * .56 },
        c2: mobile
          ? { x: w * .84, y: sMid2 + h * .26 }
          : { x: w * .44, y: sMid2 + h * .52 },
        approach,
        frontStart: .08,
        frontEnd: .76,
        peakScale: mobile ? .32 : .62,
        peakRot: mobile ? 22 : 32,
        peakRx: mobile ? 10 : 12,
        peakRy: mobile ? 18 : 22,
        dockEase: easeOutCubic
      });
    }

    return blendPose(start, end, u, i);
  }

  // --- SCENE 4: MINNE (amboLeave -> minneArrive -> minneLeave) ---
  if (y <= marks.minneLeave) {
    if (y >= marks.minneArrive) return poses.minneRest[i];
    const u = clamp((y - marks.amboLeave) / Math.max(1, marks.minneArrive - marks.amboLeave));
    const start = poses.amboRest[i];
    const end = poses.minneRest[i];

    if (i === 0) {
      // Mineral: strong vertical descent from above with lateral S-shift & crisp easeOutQuart arrival!
      const sMid1 = lerp(marks.amboLeave, marks.minneArrive, .34);
      const sMid2 = lerp(marks.amboLeave, marks.minneArrive, .68);
      const approach = mobile
        ? { x: end.x + 10, y: end.y - 126, r: 10, rx: 4, ry: -5, s: end.s * 1.24, o: .98 }
        : { x: end.x - 20, y: end.y - 156, r: 12, rx: 6, ry: -6, s: end.s * 1.26, o: .98 };
      return sweepArc(start, end, u, {
        c1: mobile
          ? { x: w * .20, y: sMid1 + h * .52 }
          : { x: w * .38, y: sMid1 + h * .60 },
        c2: mobile
          ? { x: w * .82, y: sMid2 + h * .66 }
          : { x: w * .68, y: sMid2 + h * .74 },
        approach,
        frontStart: .08,
        frontEnd: .74,
        peakScale: mobile ? .36 : .60,
        peakRot: mobile ? -16 : -20,
        peakRx: mobile ? 12 : 16,
        peakRy: mobile ? -14 : -16,
        dockEase: easeOutQuart
      });
    }

    return blendPose(start, end, u, i);
  }

  // --- SCENE 5A: CONEXÃO HORIZONTAL (minneLeave -> connEnd) ---
  if (y <= marks.connEnd) {
    const u = clamp((y - marks.minneLeave) / Math.max(1, marks.connEnd - marks.minneLeave));
    // Smooth relay across the 3 horizontal steps: Etha -> Ambo -> Minne
    if (u <= .33) return blendPose(poses.minneRest[i], poses.conn1[i], u / .33, i);
    if (u <= .67) return blendPose(poses.conn1[i], poses.conn2[i], (u - .33) / .34, i);
    return blendPose(poses.conn2[i], poses.conn3[i], (u - .67) / .33, i);
  }

  // --- SCENE 5B: COMBINAÇÃO (connEnd -> comboArrive -> comboLeave) ---
  const comboPose = computeCombinationPose(i, plan, selected);
  if (y <= marks.comboLeave) {
    if (y >= marks.comboArrive) return comboPose;
    const u = clamp((y - marks.connEnd) / Math.max(1, marks.comboArrive - marks.connEnd));
    return blendPose(poses.conn3[i], comboPose, u, i);
  }

  // --- SCENE 6: FECHAMENTO (comboLeave -> closingArrive -> docEnd) ---
  if (y >= marks.closingArrive) return poses.closing[i];
  const u = clamp((y - marks.comboLeave) / Math.max(1, marks.closingArrive - marks.comboLeave));
  const end = poses.closing[i];
  // Converging arcs reunite the 3 product petals with the 2 institutional petals into the recognizable flower.
  const t = easeInOutCubic(u);
  const swell = Math.sin(u * Math.PI);
  const spreadDir = [0, -1, 1, -.7, .7][i];
  const liftY = [-110, -45, -45, 55, 55][i] * (mobile ? .42 : 1);
  return {
    x: lerp(comboPose.x, end.x, t) + spreadDir * (mobile ? 56 : 135) * swell,
    y: lerp(comboPose.y, end.y, t) + liftY * swell,
    r: lerp(comboPose.r, end.r, t) + spreadDir * 16 * swell,
    rx: (6 * swell) || 0,
    ry: (spreadDir * -10 * swell) || 0,
    s: lerp(comboPose.s, end.s, t) + (mobile ? .08 : .14) * swell,
    o: lerp(comboPose.o, end.o, t),
    front: false
  };
}

/**
 * Dynamic redistribution in #combinacao: selected services gather evenly along .summary.glass;
 * deselected services drift softly outward from their current pose without snapping.
 */
export function computeCombinationPose(i, plan, selected) {
  const base = plan.poses.comboBase[i];
  const service = PETAL_SERVICE[i];
  if (!service) return base;

  const { mobile, summaryRect } = plan;
  const activeServices = ['ambo', 'minne', 'etha'].filter(id => selected.includes(id));
  const activeIdx = activeServices.indexOf(service);

  if (activeIdx >= 0 && summaryRect) {
    // Match the exact card column order above .summary: Ambo (left), Minne (center), Etha (right).
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

  // Deselected service recedes calmly to the periphery.
  const outX = service === 'etha' ? (mobile ? -24 : -76) : service === 'ambo' ? (mobile ? 24 : 76) : 0;
  return {
    x: base.x + outX,
    y: base.y - (mobile ? 26 : 56),
    r: base.r + (service === 'etha' ? -22 : service === 'ambo' ? 22 : 12),
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

/**
 * Localized, grounded orientation when hovering, focusing, or interacting with a product control.
 * Never restarts the scene or teleports across the screen.
 */
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
    // Keep pull localized so moving the mouse across distant regions never drags a petal across the page.
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
