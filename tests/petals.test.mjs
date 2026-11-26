import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blendPose,
  sampleJourney,
  selectionPose,
  contemplativeWarp,
  stickyDocY,
  sampleOpeningPose,
  sampleFullJourney,
  sceneProfileAt,
  computeCombinationPose,
  createOwnerState,
  transitionOwner,
  applyIntentPose
} from '../public/petal-model.js';

const a = { x: 40, y: 90, r: 0, s: 1, o: 1 };
const b = { x: 330, y: 480, r: 30, s: .6, o: .5 };

function mockPlan(mobile) {
  const w = mobile ? 390 : 1440;
  const h = mobile ? 844 : 900;
  const hero = { x: mobile ? 321 : 1135, y: mobile ? 702 : 610, r: 0, rx: 0, ry: 0, s: mobile ? .191 : 1, o: 1, front: false };
  const closing = { x: mobile ? 195 : 1176, y: mobile ? 7480 : 6490, r: 0, rx: 0, ry: 0, s: mobile ? .315 : .83, o: 1, front: false };
  const mk5 = (x, y, s) => Array.from({ length: 5 }, (_, i) => ({ x: x + i * 20, y: y + i * 10, r: i * 5, rx: 0, ry: 0, s, o: .5, front: false }));
  const ethaRest = mk5(mobile ? 42 : 730, mobile ? 1372 : 1253, mobile ? .42 : .64);
  ethaRest[1] = { x: mobile ? 42 : 730, y: mobile ? 1372 : 1253, r: mobile ? 28 : 34, rx: 0, ry: 0, s: mobile ? .42 : .64, o: .93, front: false };
  const amboRest = mk5(mobile ? 54 : 874, mobile ? 2289 : 2035, mobile ? .40 : .58);
  amboRest[2] = { x: mobile ? 54 : 874, y: mobile ? 2289 : 2035, r: mobile ? -54 : -68, rx: 0, ry: 0, s: mobile ? .40 : .58, o: .92, front: false };
  const minneRest = mk5(mobile ? 210 : 998, mobile ? 3158 : 2487, mobile ? .38 : .56);
  minneRest[0] = { x: mobile ? 210 : 998, y: mobile ? 3158 : 2487, r: mobile ? 6 : 4, rx: 0, ry: 0, s: mobile ? .38 : .56, o: .92, front: false };

  return {
    mobile,
    w,
    h,
    summaryRect: { x: mobile ? 24 : 64, y: mobile ? 6520 : 5760, w: mobile ? 342 : 1312, h: mobile ? 695 : 407 },
    marks: {
      openEnd: mobile ? 170 : 190,
      ethaArrive: mobile ? 1010 : 945,
      ethaLeave: mobile ? 1220 : 1195,
      amboArrive: mobile ? 1980 : 1620,
      amboLeave: mobile ? 2180 : 1850,
      minneArrive: mobile ? 2860 : 2240,
      minneLeave: mobile ? 3060 : 2480,
      connEnd: mobile ? 4700 : 4240,
      comboArrive: mobile ? 6100 : 5350,
      comboLeave: mobile ? 6360 : 5590,
      closingArrive: mobile ? 7050 : 6050,
      docMax: mobile ? 7280 : 6225
    },
    poses: {
      hero: Array.from({ length: 5 }, () => ({ ...hero })),
      ethaRest,
      amboRest,
      minneRest,
      conn1: mk5(w * .5, 3600, .45),
      conn2: mk5(w * .5, 4000, .45),
      conn3: mk5(w * .5, 4400, .45),
      comboBase: mk5(w * .5, 5800, mobile ? .36 : .56),
      closing: Array.from({ length: 5 }, () => ({ ...closing }))
    }
  };
}

test('curves preserve both exact poses and remain reversible at section boundaries', () => {
  const stops = [
    { at: 0, poses: Array(5).fill(a) },
    { at: 500, poses: Array(5).fill(b) },
    { at: 800, poses: Array(5).fill(a) }
  ];
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(blendPose(a, b, 0, i), a);
    assert.deepEqual(blendPose(a, b, 1, i), b);
    assert.deepEqual(sampleJourney(stops, 500, i), b);
    const left = sampleJourney(stops, 499.99, i);
    const right = sampleJourney(stops, 500.01, i);
    assert.ok(Math.hypot(left.x - right.x, left.y - right.y) < .01);
  }
  assert.notDeepEqual(blendPose(a, b, .5, 0), blendPose(a, b, .5, 1));
});

test('all seven combinations and empty choice have finite independent petal states', () => {
  for (let mask = 0; mask < 8; mask++) {
    const selected = ['etha', 'ambo', 'minne'].filter((_, i) => mask & (1 << i));
    for (let i = 0; i < 5; i++) {
      const p = selectionPose(a, i, selected);
      assert.ok(Object.values(p).every(Number.isFinite));
      const associated = ['minne', 'etha', 'ambo', null, null][i];
      if (!associated || selected.includes(associated)) assert.deepEqual(p, a);
      else assert.ok(p.s < a.s);
    }
  }
});

test('full 6-scene choreography crosses full width on mobile & desktop, gives each service protagonist foreground presence, and reunites the flower at closing', () => {
  for (const mobile of [false, true]) {
    const plan = mockPlan(mobile);
    const m = plan.marks;

    // Scene 1: Opening starts intact and creates staggered tension on short scroll (Lavanda leads first)
    const open0 = [0, 1, 2, 3, 4].map(i => sampleOpeningPose(0, i, plan.poses.hero[i], mobile));
    assert.equal(open0[1].x, plan.poses.hero[1].x);
    const openEarly = [0, 1, 2, 3, 4].map(i => sampleOpeningPose(.16, i, plan.poses.hero[i], mobile));
    assert.ok(Math.hypot(openEarly[1].x - open0[1].x, openEarly[1].y - open0[1].y) > 4, 'Lavanda must lead on first gesture');
    assert.equal(openEarly[3].x, open0[3].x, 'Lower petals start later than Lavanda');

    // Scene 2 (Etha): Lavanda (1) sweeps deeply in the LEFT THIRD on desktop & across width on mobile!
    const ethaMidY = (m.openEnd + m.ethaArrive) * .54;
    const ethaMid = sampleFullJourney(ethaMidY, 1, plan);
    const ethaDock = sampleFullJourney(m.ethaArrive, 1, plan);
    assert.equal(ethaMid.front, !mobile, 'desktop passes foreground; mobile stays behind headings for full legibility');
    assert.ok(ethaMid.s > plan.poses.hero[1].s, 'Lavanda grows in perspective');
    assert.ok(ethaMid.x < plan.w * .42, `Lavanda must linger in the left region (got x=${Math.round(ethaMid.x)} of ${plan.w})`);
    assert.equal(ethaDock.front, false);

    // Contemplative warp slows visual velocity ~20%+ in the middle while responding briskly at start
    const startDelta = contemplativeWarp(.10, .26) - contemplativeWarp(0, .26);
    const midDelta = contemplativeWarp(.55, .26) - contemplativeWarp(.45, .26);
    assert.ok(midDelta < startDelta * .82, 'mid-traversal must be >=18% slower than initial gesture');

    // Scene profiles distinguish Etha (most contemplative) vs Minne (steadier clinical rest)
    assert.ok(sceneProfileAt(ethaMidY, m).posTau > sceneProfileAt(m.minneArrive, m).posTau);
    assert.ok(sceneProfileAt(ethaMidY, m).rotTau > sceneProfileAt(ethaMidY, m).posTau, 'rotation trails center');

    // Scene 3 (Ambo): Celeste (2) takes broad horizontal arc and docks behind Ambo glass
    const amboMidY = (m.ethaLeave + m.amboArrive) * .48;
    const amboMid = sampleFullJourney(amboMidY, 2, plan);
    const amboDock = sampleFullJourney(m.amboArrive, 2, plan);
    assert.equal(amboMid.front, !mobile);
    assert.ok(amboMid.x < plan.w * .62, 'Celeste sweeps across center/left before docking');
    assert.equal(amboDock.front, false);

    // Scene 4 (Minne): Mineral (0) descends in open S-curve and docks atop Minne glass
    const minneMidY = (m.amboLeave + m.minneArrive) * .46;
    const minneMid = sampleFullJourney(minneMidY, 0, plan);
    const minneDock = sampleFullJourney(m.minneArrive, 0, plan);
    assert.equal(minneMid.front, !mobile);
    assert.equal(minneDock.front, false);

    // Scene 5 (Combinação): active services redistribute dynamically along .summary
    const cAll = computeCombinationPose(1, plan, ['etha', 'ambo', 'minne']);
    const cOne = computeCombinationPose(1, plan, ['etha']);
    const cOff = computeCombinationPose(1, plan, ['ambo']);
    assert.notEqual(cAll.x, cOne.x, 'Single selected service centers on summary');
    assert.ok(cOff.o < .35, 'Deselected service softens cleanly');

    // Scene 6 (Fechamento): all 5 petals reunite at the exact closing flower pivot
    const closePoses = [0, 1, 2, 3, 4].map(i => sampleFullJourney(m.closingArrive, i, plan));
    for (let i = 0; i < 5; i++) {
      assert.equal(closePoses[i].x, plan.poses.closing[i].x);
      assert.equal(closePoses[i].y, plan.poses.closing[i].y);
      assert.equal(closePoses[i].o, 1);
    }

    // Continuity at every scene boundary for seamless reversal
    for (const knot of [m.openEnd, m.ethaArrive, m.ethaLeave, m.amboArrive, m.amboLeave, m.minneArrive, m.minneLeave, m.connEnd, m.comboArrive, m.comboLeave, m.closingArrive]) {
      for (let i = 0; i < 5; i++) {
        const left = sampleFullJourney(knot - .01, i, plan);
        const right = sampleFullJourney(knot + .01, i, plan);
        assert.ok(Math.hypot(left.x - right.x, left.y - right.y) < 3, `discontinuity at y=${knot}, petal=${i}, mobile=${mobile}`);
      }
    }
  }
});

test('single-owner state machine gives priority to focus/pulse/hover and hands back to scroll smoothly', () => {
  let owner = createOwnerState(460);
  owner = transitionOwner(owner, { type: 'intent', service: 'ambo', source: 'focus', scrollY: 460, targetRect: { x: 700, y: 1800, w: 360, h: 480 } });
  assert.equal(owner.mode, 'intent');
  assert.equal(owner.service, 'ambo');
  // Hover cannot steal from focus
  owner = transitionOwner(owner, { type: 'intent', service: 'etha', source: 'hover', scrollY: 460, targetRect: null });
  assert.equal(owner.service, 'ambo');
  // Scrolling >14px cleanly returns to scroll
  owner = transitionOwner(owner, { type: 'scroll', scrollY: 490 });
  assert.equal(owner.mode, 'scroll');

  const focused = transitionOwner(createOwnerState(900), { type: 'intent', service: 'minne', source: 'pulse', scrollY: 900, targetRect: { x: 688, y: 1100, w: 688, h: 400 } });
  const base = { x: 960, y: 1180, r: 4, rx: 0, ry: 0, s: .56, o: .86 };
  const nudged = applyIntentPose(base, 0, focused, { mobile: false, h: 900 }, 900);
  assert.ok(nudged.s > base.s);
});

test('stickyDocY tracks CSS position:sticky cleanly before, during, and after the sticky range', () => {
  // Static top 1180, track bottom 2260, element height 540 -> maxTop = 1720, stickyTop = 122
  assert.equal(stickyDocY(800, 1180, 2260, 540, 122), 1180);  // before sticky engages
  assert.equal(stickyDocY(1200, 1180, 2260, 540, 122), 1322); // stuck at viewport y=122
  assert.equal(stickyDocY(1800, 1180, 2260, 540, 122), 1720); // released cleanly at track bottom
  assert.equal(stickyDocY(1200, 1180, 2260, 540, null), 1180); // non-sticky mobile/reduced fallback
});
