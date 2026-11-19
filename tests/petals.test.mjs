import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blendPose,
  sampleJourney,
  selectionPose,
  sampleEthaLeadPose,
  sampleEthaSupportPose,
  createOwnerState,
  transitionOwner,
  applyIntentPose
} from '../public/petal-model.js';

const a = { x: 40, y: 90, r: 0, s: 1, o: 1 };
const b = { x: 330, y: 480, r: 30, s: .6, o: .5 };

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
    for (const y of [0, 100, 300, 500, 700, 800]) {
      assert.deepEqual(sampleJourney(stops, y, i), sampleJourney(stops, y, i));
    }
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

test('Etha lead petal spans Origem, foreground Travessia, and docked Chegada continuously and reversibly', () => {
  for (const mobile of [false, true]) {
    const geom = mobile
      ? { mobile: true, w: 390, h: 844, arriveAt: 1000, hero: { x: 321, y: 702, s: .191 }, dock: { x: 332, y: 1372, r: 24, s: .42 } }
      : { mobile: false, w: 1440, h: 900, arriveAt: 940, hero: { x: 1135, y: 610, s: 1 }, dock: { x: 730, y: 1253, r: 34, s: .64 } };

    const p0 = sampleEthaLeadPose(0, geom);
    const pShort = sampleEthaLeadPose(.08, geom);
    const pMid = sampleEthaLeadPose(.50, geom);
    const pEnd = sampleEthaLeadPose(1, geom);

    // Origem starts at exact hero flower, reacts on short scroll.
    assert.equal(p0.x, geom.hero.x);
    assert.equal(p0.y, geom.hero.y);
    assert.equal(p0.front, false);
    assert.ok(Math.hypot(pShort.x - p0.x, pShort.y - p0.y) > 8, 'short scroll should distinguish petal immediately');

    // Travessia enters foreground and grows in perspective.
    assert.equal(pMid.front, true);
    assert.ok(pMid.s > p0.s, 'mid-traversal should grow in perspective');
    assert.ok(Math.abs(pMid.ry) > 5, 'mid-traversal should carry 3D tilt');

    // Chegada docks precisely at Etha glass bezel behind glass (front: false).
    assert.equal(pEnd.front, false);
    assert.ok(Math.hypot(pEnd.x - geom.dock.x, pEnd.y - geom.dock.y) < .01);
    assert.equal(pEnd.r, geom.dock.r);
    assert.equal(pEnd.rx, 0);
    assert.equal(pEnd.ry, 0);

    // Continuity across stage boundaries (0.22 and 0.78) for seamless reversal.
    for (const knot of [.22, .78]) {
      const before = sampleEthaLeadPose(knot - .0001, geom);
      const after = sampleEthaLeadPose(knot + .0001, geom);
      assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1.5, `discontinuity at u=${knot}`);
      assert.ok(Math.abs(before.s - after.s) < .02, `scale jump at u=${knot}`);
    }

    // Companion petals start intact at hero and soften smoothly during Etha scene.
    const sup0 = sampleEthaSupportPose(0, 0, { x: geom.hero.x, y: geom.hero.y, r: 0, s: geom.hero.s, o: 1 }, { x: 900, y: 1200, r: -18, s: .55, o: .28 }, mobile);
    const sup1 = sampleEthaSupportPose(1, 0, { x: geom.hero.x, y: geom.hero.y, r: 0, s: geom.hero.s, o: 1 }, { x: 900, y: 1200, r: -18, s: .55, o: .28 }, mobile);
    assert.equal(sup0.o, 1);
    assert.ok(sup1.o < .4);
  }
});

test('single-owner state machine gives priority to focus/hover/tap and cleanly returns to scroll without oscillation', () => {
  let owner = createOwnerState(460);
  assert.equal(owner.mode, 'scroll');

  // Mid-scroll keyboard focus on Ambo takes ownership.
  owner = transitionOwner(owner, { type: 'intent', service: 'ambo', source: 'focus', scrollY: 460, targetRect: { x: 700, y: 1800, w: 360, h: 480 } });
  assert.equal(owner.mode, 'intent');
  assert.equal(owner.service, 'ambo');
  assert.equal(owner.source, 'focus');

  // Stray hover does NOT steal ownership from keyboard focus.
  owner = transitionOwner(owner, { type: 'intent', service: 'etha', source: 'hover', scrollY: 460, targetRect: null });
  assert.equal(owner.service, 'ambo');
  assert.equal(owner.source, 'focus');

  // Micro jitter <=12px preserves focus intent; real scroll resumption (>12px) returns cleanly to scroll.
  owner = transitionOwner(owner, { type: 'scroll', scrollY: 468 });
  assert.equal(owner.mode, 'intent');
  owner = transitionOwner(owner, { type: 'scroll', scrollY: 490 });
  assert.equal(owner.mode, 'scroll');
  assert.equal(owner.service, null);

  // Intent pose subtly draws matching petal and softens non-matching petals.
  const focusedEtha = transitionOwner(createOwnerState(800), { type: 'intent', service: 'etha', source: 'focus', scrollY: 800, targetRect: { x: 688, y: 1160, w: 688, h: 480 } });
  const geom = { mobile: false, h: 900, dock: { x: 730, y: 1253, r: 34, s: .64 } };
  const baseLead = { x: 820, y: 1150, r: 20, rx: 0, ry: 0, s: .64, o: .85 };
  const leadWithIntent = applyIntentPose(baseLead, 1, focusedEtha, geom, 800);
  const compWithIntent = applyIntentPose(baseLead, 2, focusedEtha, geom, 800);
  assert.ok(leadWithIntent.x < baseLead.x, 'Etha petal should draw closer to Etha dock');
  assert.ok(leadWithIntent.o >= .94);
  assert.ok(compWithIntent.o < baseLead.o);
});
