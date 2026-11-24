// Pétalas com física: dobra fluida por arrasto (molas), tremor na ponta, empurrão do cursor/toque
// e travessia real das páginas. Cada pétala é cortada pelo plano da página (z = 0): a parte da frente
// é desenhada acima dos cartões e a de trás abaixo deles (vista através do vidro). Onde a pétala
// atravessa um cartão aparece a fenda com brilho e uma onda que se espalha no vidro.
// Desliga sozinho no modo leve (EnoPerf.lite) e com movimento reduzido: volta o desenho plano.

import { supportsRefraction } from './glass/liquid-glass.js';

const NS = 'http://www.w3.org/2000/svg';
const PIVOT = { x: 235, y: 335 };
const SAMPLES = 84;
const F = 1000; // perspectiva, igual à anterior (perspective(1000px))
const DEG = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

function samplePath(d) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  document.body.append(svg);
  const len = path.getTotalLength();
  const pts = [];
  for (let k = 0; k < SAMPLES; k++) {
    const q = path.getPointAtLength(len * k / SAMPLES);
    pts.push({ x: q.x, y: q.y });
  }
  svg.remove();
  // Base = início do traçado (todas as pétalas começam no centro da flor); ponta = ponto mais distante.
  const base = pts[0];
  let tip = base, far = 0;
  for (const q of pts) {
    const dd = Math.hypot(q.x - base.x, q.y - base.y);
    if (dd > far) { far = dd; tip = q; }
  }
  const ux = (tip.x - base.x) / far, uy = (tip.y - base.y) / far;
  // Coordenadas no eixo da pétala: a = ao longo (0 base → 1 ponta), l = lateral.
  const local = pts.map(q => {
    const dx = q.x - base.x, dy = q.y - base.y;
    return { a: (dx * ux + dy * uy) / far, l: (-dx * uy + dy * ux) / far };
  });
  return { local, base, ux, uy, L: far };
}

export function createPetalPhysics({ shapes, fills }) {
  const geo = shapes.map(samplePath);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const url = new URLSearchParams(location.search).get('petalas');
  const forcedOff = url === 'classico';

  const layer = (cls, z) => {
    const slot = document.createElement('div');
    slot.className = `petal-slot petal-phys ${cls}`;
    slot.setAttribute('aria-hidden', 'true');
    slot.inert = true;
    slot.style.zIndex = String(z);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'petal-phys-svg');
    const defs = document.createElementNS(NS, 'defs');
    svg.append(defs);
    slot.append(svg);
    document.body.append(slot);
    return { slot, svg, defs };
  };
  const back = layer('petal-phys-back', 1);
  const front = layer('petal-phys-front', 12);

  const mk = (parent, tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    parent.append(el);
    return el;
  };

  const sheenFor = (L, i, side) => {
    const g = mk(L.defs, 'linearGradient', { id: `pp-sheen-${side}-${i}`, gradientUnits: 'userSpaceOnUse' });
    const s0 = mk(g, 'stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' });
    const s1 = mk(g, 'stop', { offset: '.62', 'stop-color': '#fff', 'stop-opacity': '0' });
    const s2 = mk(g, 'stop', { offset: '1', 'stop-color': '#2b3a78', 'stop-opacity': '0' });
    return { g, s1, s2 };
  };

  const items = geo.map((g, i) => {
    const mkSide = (L, side) => {
      const grp = mk(L.svg, 'g', { class: 'pp-petal' });
      const body = mk(grp, 'path', { fill: fills[i] });
      const sheen = sheenFor(L, i, side);
      const gloss = mk(grp, 'path', { fill: `url(#pp-sheen-${side}-${i})` });
      return { grp, body, gloss, sheen, shown: true, op: '' };
    };
    return {
      g,
      back: mkSide(back, 'b'),
      front: mkSide(front, 'f'),
      // molas da dobra (bz = curvatura para fora da página, bx = dobra lateral) e do empurrão
      bz: 0, vbz: 0, bx: 0, vbx: 0, ox: 0, oy: 0, vox: 0, voy: 0,
      flutter: 0, phase: i * 1.37, crossing: false, side: false, prox: 0
    };
  });

  // Fenda e ondas no vidro (sempre na camada da frente, acima do cartão).
  const fx = mk(front.svg, 'g', { class: 'pp-fx' });
  // Membrana: o vidro do cartão é puxado para fora no furo (cone de tensão, rugas que irradiam).
  const tentGrad = mk(front.defs, 'radialGradient', { id: 'pp-tent' });
  [['0', '#fff', '.0'], ['.32', '#fff', '.45'], ['.6', '#fff', '.1'], ['.8', '#25306a', '.08'], ['1', '#25306a', '0']]
    .forEach(([o, c, a]) => mk(tentGrad, 'stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));
  front.svg.insertBefore(fx, front.svg.firstChild.nextSibling); // por baixo da parte da frente da pétala
  const tents = [0, 1, 2].map(() => mk(fx, 'ellipse', { fill: 'url(#pp-tent)', opacity: '0' }));
  // Lente de deformação (só Chromium): um círculo com backdrop-filter de deslocamento sobre o furo.
  // Ela puxa o conteúdo do cartão para dentro do furo (pinça) e arrasta na direção da tensão.
  const canWarp = url !== 'semlente' && (() => { try { return supportsRefraction(); } catch { return false; } })();
  const warpMaps = (() => {
    if (!canWarp) return null;
    const N = 256, mkMap = fn => {
      const cv = document.createElement('canvas'); cv.width = cv.height = N;
      const g2 = cv.getContext('2d'), im = g2.createImageData(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x + .5 - N / 2) / (N / 2), dy = (y + .5 - N / 2) / (N / 2), r = Math.hypot(dx, dy);
        const [R, G, B] = fn(dx, dy, r);
        const k = (y * N + x) * 4;
        im.data[k] = R; im.data[k + 1] = G; im.data[k + 2] = B; im.data[k + 3] = 255;
      }
      g2.putImageData(im, 0, 0);
      return cv.toDataURL();
    };
    const enc = v => Math.round(128 + 127 * clamp(v, -1, 1));
    return {
      // pinça: zero no centro e na borda, puxa para o centro
      pinch: mkMap((dx, dy, r) => { const f = r < 1 ? (1 - r) ** 2 * 2.7 : 0; return [enc(dx * f), enc(dy * f), 128]; }),
      // arrasto: máximo no centro, some suave na borda
      drag: mkMap((dx, dy, r) => { const f = r < 1 ? (1 - r * r) ** 2 : 0; return [enc(f), enc(f), 128]; })
    };
  })();
  const lenses = [0, 1, 2].map(k => {
    if (!warpMaps) return null;
    const id = `pp-warp-${k}`;
    const filter = mk(front.defs, 'filter', { id, x: 0, y: 0, width: 200, height: 200, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    const im1 = mk(filter, 'feImage', { x: 0, y: 0, width: 200, height: 200, preserveAspectRatio: 'none', result: 'pm', href: warpMaps.pinch });
    const im2 = mk(filter, 'feImage', { x: 0, y: 0, width: 200, height: 200, preserveAspectRatio: 'none', result: 'dm', href: warpMaps.drag });
    const pinch = mk(filter, 'feDisplacementMap', { in: 'SourceGraphic', in2: 'pm', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: 'p1' });
    const dragX = mk(filter, 'feDisplacementMap', { in: 'p1', in2: 'dm', scale: 0, xChannelSelector: 'R', yChannelSelector: 'B', result: 'p2' });
    const dragY = mk(filter, 'feDisplacementMap', { in: 'p2', in2: 'dm', scale: 0, xChannelSelector: 'B', yChannelSelector: 'G' });
    const div = document.createElement('div');
    div.className = 'pp-lens';
    div.hidden = true;
    div.style.backdropFilter = div.style.webkitBackdropFilter = `url(#${id})`;
    front.slot.insertBefore(div, front.svg);
    return { div, filter, im1, im2, pinch, dragX, dragY, D: 0, on: false };
  });
  const wrinkles = [0, 1, 2].map(() => [0, 1, 2, 3, 4, 5, 6].map(k => mk(fx, 'path', {
    fill: 'none', stroke: k % 2 ? '#25306a' : '#fff', 'stroke-width': k % 2 ? '1' : '1.4', 'stroke-linecap': 'round', opacity: '0'
  })));
  const slit = [0, 1, 2].map(() => ({
    glow: mk(fx, 'path', { fill: 'none', stroke: '#fff', 'stroke-opacity': '0', 'stroke-width': '9', 'stroke-linecap': 'round' }),
    shadow: mk(fx, 'path', { fill: 'none', stroke: '#2a3570', 'stroke-opacity': '0', 'stroke-width': '2.2', 'stroke-linecap': 'round' }),
    light: mk(fx, 'path', { fill: 'none', stroke: '#fff', 'stroke-opacity': '0', 'stroke-width': '1.4', 'stroke-linecap': 'round' })
  }));
  const ripplePool = [0, 1, 2, 3, 4, 5].map(() => mk(fx, 'ellipse', { fill: 'none', stroke: '#fff', 'stroke-width': '1.3', opacity: '0' }));
  const ripples = [];

  let active = false;
  const want = () => !forcedOff && !reduced.matches && !(window.EnoPerf && window.EnoPerf.lite);
  let onToggle = () => {};

  function setActive(v) {
    if (v === active) return;
    active = v;
    back.slot.hidden = !v;
    front.slot.hidden = !v;
    document.documentElement.toggleAttribute('data-petal-physics', v);
    if (!v) for (const [el, c] of cardState) { el.style.transform = ''; el.style.transformOrigin = ''; c.tf = ''; c.anchor = null; }
    onToggle(v);
  }

  let cardEls = null;
  const cards = () => {
    if (!cardEls) cardEls = ['#etha-frame', '#ambo-demo', '#minne-demo'].map(s => document.querySelector(s)).filter(Boolean);
    return cardEls;
  };

  // Recorte de polígono pelo plano z = 0 (Sutherland–Hodgman), lado sgn (+1 frente, -1 trás).
  function clipZ(pts, sgn, hits) {
    const out = [];
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const A = pts[k], B = pts[(k + 1) % n];
      const ia = A.z * sgn >= 0, ib = B.z * sgn >= 0;
      if (ia) out.push(A);
      if (ia !== ib) {
        const t = A.z / (A.z - B.z);
        const P = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z: 0 };
        out.push(P);
        if (hits && sgn > 0) hits.push(P);
      }
    }
    return out;
  }

  const toD = pts => {
    if (pts.length < 3) return '';
    let s = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let k = 1; k < pts.length; k++) s += `L${pts[k].x.toFixed(1)} ${pts[k].y.toFixed(1)}`;
    return s + 'Z';
  };

  function setSide(side, d, opacity, grad) {
    if (!d) {
      if (side.shown) { side.grp.style.display = 'none'; side.shown = false; }
      return;
    }
    if (!side.shown) { side.grp.style.display = ''; side.shown = true; }
    side.body.setAttribute('d', d);
    side.gloss.setAttribute('d', d);
    const op = opacity.toFixed(3);
    if (op !== side.op) { side.op = op; side.grp.style.opacity = op; }
    const s = side.sheen;
    s.g.setAttribute('x1', grad.x1.toFixed(1));
    s.g.setAttribute('y1', grad.y1.toFixed(1));
    s.g.setAttribute('x2', grad.x2.toFixed(1));
    s.g.setAttribute('y2', grad.y2.toFixed(1));
    s.s1.setAttribute('stop-opacity', grad.light.toFixed(3));
    s.s2.setAttribute('stop-opacity', grad.dark.toFixed(3));
  }

  // Integra molas e desenha. pose em coordenadas da tela; vel em px/ms (já suavizada).
  function render(i, pose, vel, front_, dt, now) {
    const it = items[i];
    const { g } = it;
    const h = Math.min(dt, 32) / 1000;

    // --- física da dobra: o ar empurra a ponta contra o movimento ---
    const cr = Math.cos(pose.r * DEG), sr = Math.sin(pose.r * DEG);
    // velocidade no referencial da pétala (eixo dela, ainda em pixels de tela)
    const vlx = (vel.x * cr + vel.y * sr), vly = (-vel.x * sr + vel.y * cr);
    const along = vlx * g.ux + vly * g.uy, lat = -vlx * g.uy + vly * g.ux;
    const speed = Math.hypot(vel.x, vel.y);
    const tz = clamp(speed * .3 + Math.abs(along) * .08, 0, .55) * (along > 0 ? -.7 : 1);
    const tx = clamp(-lat * .2, -.32, .32);
    const k = 70, c = 6.4; // sub-amortecido de leve: assenta em ~0,8 s com uma ondulação suave
    it.vbz += (k * (tz - it.bz) - c * it.vbz) * h;
    it.vbx += (k * (tx - it.bx) - c * it.vbx) * h;
    it.bz += it.vbz * h;
    it.bx += it.vbx * h;
    // empurrão (cursor/toque) volta com mola criticamente amortecida
    const ko = 46, co = 2 * Math.sqrt(ko);
    it.vox += (-ko * it.ox - co * it.vox) * h;
    it.voy += (-ko * it.oy - co * it.voy) * h;
    it.ox += it.vox * h;
    it.oy += it.voy * h;
    it.flutter = Math.max(it.flutter * Math.exp(-h / .5), clamp(speed * .05, 0, .07));
    it.phase += h * (7 + speed * 6);

    // --- atravessar a página ---
    const prox = it.prox;
    if (prox < .05) it.side = !!front_; // de que lado ela chega
    const p = smooth(prox);
    const theta = 54 * DEG * smooth(clamp(prox * 1.4));
    const cross = mix(it.side ? 1.18 : -.18, .4, p); // fração do eixo onde corta o plano
    const sT = Math.sin(theta), cT = Math.cos(theta);
    const piercing = prox > .02;

    const s = pose.s * (1 - .1 * p); // encolhe um pouco ao entrar
    const L = g.L * s;
    const rx = (pose.rx || 0) * DEG, ry = (pose.ry || 0) * DEG;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const bxo = (g.base.x - PIVOT.x) * s, byo = (g.base.y - PIVOT.y) * s;
    const ux = g.ux, uy = g.uy;
    const X0 = pose.x + it.ox, Y0 = pose.y + it.oy;

    const pts = new Array(g.local.length);
    let tipP = null, midP = null;
    for (let q = 0; q < g.local.length; q++) {
      const { a, l } = g.local[q];
      // dobra: curvatura ao longo do eixo + leve concha lateral + tremor que corre até a ponta
      let A = a * L;
      let Ll = (l + it.bx * a * a * .55) * L;
      let Z = (it.bz * a * a * .62 + .3 * l * l + it.flutter * a * Math.sin(it.phase - a * 5.2)) * L;
      // afinar: a lateral estreita perto do corte, como quem passa de lado por uma fresta
      if (piercing) {
        const near = Math.exp(-((a - cross) ** 2) / .03);
        Ll *= 1 - .28 * p * near;
        // gira em torno da base: a ponta entra na página
        const A2 = A * cT + Z * sT;
        Z = -A * sT + Z * cT + L * sT * cross;
        A = A2;
      }
      // de volta ao plano da flor
      let x = bxo + A * ux - Ll * uy;
      let y = byo + A * uy + Ll * ux;
      let z = Z;
      // rotateY, rotateX, rotateZ (mesma ordem do CSS anterior)
      let x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      let y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      let x3 = x1 * cr - y2 * sr, y3 = x1 * sr + y2 * cr;
      const w = F / Math.max(200, F - z2);
      const P = { x: X0 + x3 * w, y: Y0 + y3 * w, z: piercing ? z2 : (front_ ? 1 : -1) };
      pts[q] = P;
    }
    // gradiente da base à ponta para a luz da dobra
    const tipIdx = g.local.reduce((best, v, q) => (v.a > g.local[best].a ? q : best), 0);
    tipP = pts[tipIdx];
    midP = pts[0];
    const bend = Math.abs(it.bz) + Math.abs(it.bx) * .6 + it.flutter * 2;
    const grad = {
      x1: midP.x, y1: midP.y, x2: tipP.x, y2: tipP.y,
      light: clamp(.06 + bend * .55 + p * .1, 0, .42),
      dark: clamp(bend * .22 + p * .14, 0, .22)
    };

    let hits = null;
    if (piercing) {
      hits = [];
      const fr = clipZ(pts, 1, hits);
      const bk = clipZ(pts, -1, null);
      setSide(it.front, toD(fr), pose.o, grad);
      setSide(it.back, toD(bk), pose.o, grad);
    } else {
      const d = toD(pts);
      setSide(front_ ? it.front : it.back, d, pose.o, grad);
      setSide(front_ ? it.back : it.front, '', 0, grad);
    }

    // fenda: só quando o corte cai dentro de um cartão
    let slitInfo = null;
    if (hits && hits.length >= 2) {
      let a = hits[0], b = hits[1], best = 0;
      for (let m = 0; m < hits.length; m++) for (let n = m + 1; n < hits.length; n++) {
        const dd = (hits[m].x - hits[n].x) ** 2 + (hits[m].y - hits[n].y) ** 2;
        if (dd > best) { best = dd; a = hits[m]; b = hits[n]; }
      }
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const card = cards().find(el => {
        const r = el.getBoundingClientRect();
        return mx > r.left + 4 && mx < r.right - 4 && my > r.top + 4 && my < r.bottom - 4;
      });
      if (card) slitInfo = { a, b, mx, my, len: Math.sqrt(best), ang: Math.atan2(b.y - a.y, b.x - a.x), card, w: L * .3 };
    }
    const nowCrossing = !!slitInfo;
    if (nowCrossing && !it.crossing) ripple(slitInfo, now, 1);
    // um cutucão forte enquanto atravessa também ondula o vidro
    if (nowCrossing && Math.abs(it.vbz) > 2.4 && now - (it.lastPokeRipple || 0) > 500) {
      it.lastPokeRipple = now;
      ripple(slitInfo, now, .6);
    }
    it.crossing = nowCrossing;
    it.slit = slitInfo && { ...slitInfo, o: pose.o * smooth(clamp((prox - .08) / .3)) };

    return Math.abs(it.vbz) > .01 || Math.abs(it.vbx) > .01 || Math.abs(it.bz - tz) > .004 || Math.abs(it.bx - tx) > .004
      || Math.abs(it.ox) > .2 || Math.abs(it.oy) > .2 || it.flutter > .002;
  }

  function ripple(info, now, strength) {
    ripples.push({ x: info.mx, y: info.my, ang: info.ang, len: info.len, start: now, strength });
    if (ripples.length > ripplePool.length) ripples.shift();
  }

  // Depois de todas as pétalas: fendas e ondas.
  // Física do cartão: cada cartão é uma membrana presa ao furo. Quando a pétala se move em relação ao
  // cartão, o ponto do furo é puxado (tensão), o cartão inclina na direção do puxão e o canto levanta
  // em direção à tela; ao entrar ela afunda o vidro, ao sair ele solta e balança até assentar.
  const cardState = new Map();
  let lastFx = 0;
  function cardFx(now) {
    const dt = Math.min(32, now - (lastFx || now - 16)) / 1000;
    lastFx = now;
    let busy = false;
    let ti = 0;
    for (const el of cards()) {
      let c = cardState.get(el);
      if (!c) { c = { tx: 0, ty: 0, vx: 0, vy: 0, lz: 0, vlz: 0, anchor: null, T: { x: 0, y: 0 }, tf: '' }; cardState.set(el, c); }
      const it = items.find(q => q.slit && q.slit.card === el);
      const wrap = el.offsetParent || el.parentElement;
      const wr = wrap.getBoundingClientRect();
      const r0 = { left: wr.left + el.offsetLeft, top: wr.top + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      let tTx = 0, tTy = 0, tLz = 0;
      if (it) {
        const sl = it.slit;
        const u = (sl.mx - r0.left) / r0.w, v = (sl.my - r0.top) / r0.h;
        if (!c.anchor) {
          c.anchor = { u, v };
          c.vlz -= 34 * sl.o; // a ponta afunda o vidro ao entrar
        }
        // o furo "aprende" a nova posição devagar: só o movimento rápido vira tensão
        const k = 1 - Math.exp(-dt / .45);
        c.anchor.u += (u - c.anchor.u) * k;
        c.anchor.v += (v - c.anchor.v) * k;
        const ax = r0.left + c.anchor.u * r0.w, ay = r0.top + c.anchor.v * r0.h;
        c.T = { x: sl.mx - ax, y: sl.my - ay };
        const tl = Math.hypot(c.T.x, c.T.y);
        const cap = tl > 26 ? 26 / tl : 1;
        tTx = c.T.x * .42 * cap;
        tTy = c.T.y * .42 * cap;
        tLz = sl.o * Math.min(2.6, tl * .09); // a base da pétala na frente puxa o vidro para fora
        c.u = c.anchor.u; c.v = c.anchor.v;
        c.pull = sl.o;
      } else if (c.anchor) {
        // soltou: o vidro volta de uma vez e balança
        c.vx -= c.T.x * 9; c.vy -= c.T.y * 9;
        c.vlz += 26 * (c.pull || 1);
        c.anchor = null;
        c.pull = 0;
      }
      const K = 140, C = 9.5; // pouco amortecido: assenta com 2 ou 3 balanços
      c.vx += (K * (tTx - c.tx) - C * c.vx) * dt;
      c.vy += (K * (tTy - c.ty) - C * c.vy) * dt;
      c.vlz += (K * (tLz - c.lz) - C * c.vlz) * dt;
      c.tx += c.vx * dt; c.ty += c.vy * dt; c.lz += c.vlz * dt;
      const settled = Math.abs(c.tx) < .12 && Math.abs(c.ty) < .12 && Math.abs(c.lz) < .02 && Math.abs(c.vlz) < .08 && Math.abs(c.vx) < .08 && Math.abs(c.vy) < .08;
      let tf = '';
      if (!settled) {
        busy = true;
        const u = c.u ?? .5, v = c.v ?? .5;
        const ry = -(u - .5) * 2 * c.lz, rx = (v - .5) * 2 * c.lz;
        tf = `perspective(1400px) translate3d(${c.tx.toFixed(2)}px,${c.ty.toFixed(2)}px,0) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
        el.style.transformOrigin = `${(100 - u * 100).toFixed(1)}% ${(100 - v * 100).toFixed(1)}%`;
      } else if (!c.anchor) {
        c.vx = c.vy = c.vlz = 0; c.tx = c.ty = c.lz = 0;
      }
      if (tf !== c.tf) { c.tf = tf; el.style.transform = tf; if (!tf) el.style.transformOrigin = ''; }

      // cone de tensão e rugas desenhados sobre o furo
      const tent = tents[ti], wr7 = wrinkles[ti];
      ti++;
      if (it) {
        const sl = it.slit;
        const tl = Math.hypot(c.T.x, c.T.y);
        const ang = tl > .5 ? Math.atan2(c.T.y, c.T.x) : sl.ang + Math.PI / 2;
        const R = sl.len * .5 + 14 + Math.min(40, tl * 1.4) + Math.max(0, -c.lz) * 5;
        const cx = sl.mx - Math.cos(ang) * tl * .5, cy = sl.my - Math.sin(ang) * tl * .5;
        tent.setAttribute('cx', cx.toFixed(1)); tent.setAttribute('cy', cy.toFixed(1));
        tent.setAttribute('rx', (R * (1 + tl * .012)).toFixed(1)); tent.setAttribute('ry', (R * .78).toFixed(1));
        tent.setAttribute('transform', `rotate(${(ang / DEG).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
        tent.setAttribute('opacity', (sl.o * clamp(.3 + tl * .035 + Math.abs(c.lz) * .12, 0, .8)).toFixed(3));
        const tension = clamp(.12 + tl / 22 + Math.abs(c.lz) * .15, 0, 1) * sl.o;
        wr7.forEach((w, k) => {
          // rugas saem do furo e se curvam para o lado oposto ao puxão
          const a = ang + Math.PI + (k - 3) * .42;
          const r1 = sl.len * .3 + 4, r2 = r1 + (10 + Math.min(34, tl * 1.5)) * (1 - Math.abs(k - 3) * .14);
          const bend = (k - 3) * 3;
          const x1 = sl.mx + Math.cos(a) * r1, y1 = sl.my + Math.sin(a) * r1;
          const x2 = sl.mx + Math.cos(a) * r2, y2 = sl.my + Math.sin(a) * r2;
          const qx = (x1 + x2) / 2 - Math.sin(a) * bend, qy = (y1 + y2) / 2 + Math.cos(a) * bend;
          w.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
          w.setAttribute('opacity', (tension * (k % 2 ? .22 : .5)).toFixed(3));
        });
      } else {
        tent.setAttribute('opacity', '0');
        wr7.forEach(w => w.setAttribute('opacity', '0'));
      }
      const lens = lenses[ti - 1];
      if (lens) {
        const strength = it ? it.slit.o : 0;
        const sl = it ? it.slit : c.lens;
        const tl = Math.hypot(c.T.x, c.T.y);
        // pinça: quase nada parado; cresce com a tensão, ao afundar e no balanço
        const pinch = sl ? Math.min(90, strength * (8 + Math.min(56, tl * 2.4)) + Math.max(0, -c.lz) * 12 + Math.abs(c.vlz) * .3) : 0;
        const dx = clamp(-(c.T.x * strength) * .9 - c.vx * .015, -36, 36);
        const dy = clamp(-(c.T.y * strength) * .9 - c.vy * .015, -36, 36);
        const amount = pinch + Math.abs(dx) + Math.abs(dy);
        // histerese: entra acima de 16, sai abaixo de 9 (parada, o filtro não roda)
        const want = sl && (lens.on ? amount > 9 : amount > 16);
        if (want) {
          c.lens = { mx: sl.mx, my: sl.my, len: sl.len };
          const D = Math.round(clamp(sl.len * 1.7 + 110, 150, 300) / 10) * 10;
          if (D !== lens.D) {
            lens.D = D;
            for (const n of [lens.filter, lens.im1, lens.im2]) { n.setAttribute('width', D); n.setAttribute('height', D); }
            lens.div.style.width = lens.div.style.height = D + 'px';
          }
          if (!lens.on) { lens.on = true; lens.div.hidden = false; }
          lens.div.style.transform = `translate3d(${(sl.mx - D / 2).toFixed(1)}px,${(sl.my - D / 2).toFixed(1)}px,0)`;
          lens.pinch.setAttribute('scale', pinch.toFixed(1));
          lens.dragX.setAttribute('scale', dx.toFixed(1));
          lens.dragY.setAttribute('scale', dy.toFixed(1));
          if (!it) busy = true;
        } else if (lens.on) {
          lens.on = false; lens.div.hidden = true;
        }
        if (!it && !want) c.lens = null;
      }
    }
    return busy;
  }

  function renderFx(now) {
    const cardBusy = cardFx(now);
    let n = 0;
    for (const it of items) {
      if (!it.slit || n >= slit.length) continue;
      const { a, b, ang, o } = it.slit;
      const s = slit[n++];
      // a fenda fica um pouco além da largura da pétala, como o vidro cedendo
      const ex = Math.cos(ang) * 3, ey = Math.sin(ang) * 3;
      const d = `M${(a.x - ex).toFixed(1)} ${(a.y - ey).toFixed(1)}L${(b.x + ex).toFixed(1)} ${(b.y + ey).toFixed(1)}`;
      s.shadow.setAttribute('d', d);
      s.glow.setAttribute('d', d);
      s.glow.setAttribute('stroke-opacity', (o * .22).toFixed(3));
      s.light.setAttribute('d', `M${(a.x - ex).toFixed(1)} ${(a.y - ey + 1.6).toFixed(1)}L${(b.x + ex).toFixed(1)} ${(b.y + ey + 1.6).toFixed(1)}`);
      s.shadow.setAttribute('stroke-opacity', (o * .16).toFixed(3));
      s.light.setAttribute('stroke-opacity', (o * .6).toFixed(3));
    }
    for (; n < slit.length; n++) {
      slit[n].shadow.setAttribute('stroke-opacity', '0');
      slit[n].glow.setAttribute('stroke-opacity', '0');
      slit[n].light.setAttribute('stroke-opacity', '0');
    }
    let alive = false;
    ripplePool.forEach((el, m) => {
      const r = ripples[m];
      if (!r) { el.setAttribute('opacity', '0'); return; }
      const e = clamp((now - r.start) / 1150);
      if (e >= 1) { el.setAttribute('opacity', '0'); return; }
      alive = true;
      const grow = 1 - (1 - e) ** 3;
      const rx = r.len * .55 + 64 * grow * r.strength;
      el.setAttribute('cx', r.x.toFixed(1));
      el.setAttribute('cy', r.y.toFixed(1));
      el.setAttribute('rx', rx.toFixed(1));
      el.setAttribute('ry', (rx * .34).toFixed(1));
      el.setAttribute('transform', `rotate(${(r.ang / DEG).toFixed(1)} ${r.x.toFixed(1)} ${r.y.toFixed(1)})`);
      el.setAttribute('opacity', (.55 * r.strength * (1 - e) ** 2).toFixed(3));
    });
    while (ripples.length && now - ripples[0].start > 1150) ripples.shift();
    return alive || cardBusy;
  }

  // Cursor (mouse) passa perto: a pétala desvia e dobra. Toque: um sopro onde o dedo encosta.
  function poke(x, y, vx, vy, poses, strength = 1) {
    let any = false;
    items.forEach((it, i) => {
      const pose = poses[i];
      if (!pose || pose.o < .15) return;
      const s = pose.s;
      const cr = Math.cos(pose.r * DEG), sr = Math.sin(pose.r * DEG);
      const gx = (it.g.base.x - PIVOT.x + it.g.ux * it.g.L * .5) * s;
      const gy = (it.g.base.y - PIVOT.y + it.g.uy * it.g.L * .5) * s;
      const cx = pose.x + it.ox + gx * cr - gy * sr, cy = pose.y + it.oy + gx * sr + gy * cr;
      const dx = cx - x, dy = cy - y;
      const dist = Math.hypot(dx, dy);
      const R = it.g.L * s * .55 + 46;
      if (dist > R) return;
      const f = (1 - dist / R) ** 2 * strength;
      const sp = clamp(Math.hypot(vx, vy), 0, 2.5);
      it.vox += (dx / (dist || 1)) * f * (140 + sp * 160);
      it.voy += (dy / (dist || 1)) * f * (140 + sp * 160);
      it.vbz += f * (3 + sp * 3);
      it.vbx += f * Math.sign(-(vx * dy - vy * dx) || 1) * (1.6 + sp * 2);
      it.flutter = Math.min(.09, it.flutter + f * .05);
      any = true;
    });
    return any;
  }

  function sync() { setActive(want()); }
  reduced.addEventListener('change', sync);
  if (window.EnoPerf && window.EnoPerf.onChange) window.EnoPerf.onChange(sync);

  return {
    get active() { return active; },
    start(cb) { onToggle = cb; back.slot.hidden = true; front.slot.hidden = true; sync(); },
    render,
    renderFx,
    poke,
    setProx(i, v) { items[i].prox = v; },
    fine
  };
}
