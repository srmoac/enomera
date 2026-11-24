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
  const tipIdx = local.reduce((best, v, k) => (v.a > local[best].a ? k : best), 0);
  return { local, base, ux, uy, L: far, tipIdx };
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
      flutter: 0, phase: i * 1.37, side: false, prox: 0,
      // perfuração: 0 fora, 1 pressionando a membrana, 2 dentro; q = quanto já atravessou (mola)
      layerFront: false, bbox: null, state: 0, t0: 0, q: 0, vq: 0, pressK: 0, evPop: false, evOut: false, mem: null, slit: null, fill: fills[i], i
    };
  });

  // Recortes por pétala: depois de furar, o trecho dentro do cartão é desenhado atrás do vidro (camada
  // de trás, recortada pelo contorno do cartão) e o trecho de fora continua na frente.
  for (const it of items) {
    const cin = mk(back.defs, 'clipPath', { id: `pp-in-${it.i}` });
    it.clipIn = mk(cin, 'rect', {});
    const cout = mk(front.defs, 'clipPath', { id: `pp-out-${it.i}` });
    it.clipOut = mk(cout, 'path', { 'clip-rule': 'evenodd' });
    it.clipped = false;
  }
  // Fenda e ondas no vidro (sempre na camada da frente, acima do cartão).
  const fx = mk(front.svg, 'g', { class: 'pp-fx' });
  // Membrana: o vidro do cartão é puxado para fora no furo (cone de tensão, rugas que irradiam).
  // Covinha da membrana: só sombra suave (côncava), nada de brilho branco em volta.
  const tentGrad = mk(front.defs, 'radialGradient', { id: 'pp-tent', fx: '.42', fy: '.38' });
  [['0', '#1f2a5e', '.3'], ['.3', '#1f2a5e', '.13'], ['.7', '#1f2a5e', '.03'], ['1', '#1f2a5e', '0']]
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
      // empurrão da borda, um mapa por lado de entrada: máximo num ponto a 0,6 raio do centro (onde fica
      // a borda do cartão), some em ~1/3 de raio para fora (não mexe no que está fora do cartão) e devagar
      // para dentro. (u, v) = coordenadas com v apontando para dentro do cartão.
      ...Object.fromEntries([['t', 0, 1], ['b', 0, -1], ['l', 1, 0], ['r', -1, 0]].map(([k, nx, ny]) => [k, mkMap((dx, dy) => {
        const v = dx * nx + dy * ny, u = -dx * ny + dy * nx;
        const v0 = -.6, fu = Math.abs(u) < .9 ? (1 - (u / .9) ** 2) ** 2 : 0;
        const t = v < v0 ? (v0 - v) / .36 : (v - v0) / 1.5;
        const f = t < 1 ? (1 - t * t) ** 2 * fu : 0;
        return [enc(f), enc(f), 128];
      })]))
    };
  })();
  const lenses = [0, 1, 2].map(k => {
    if (!warpMaps) return null;
    const id = `pp-warp-${k}`;
    const filter = mk(front.defs, 'filter', { id, x: 0, y: 0, width: 200, height: 200, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    const im1 = mk(filter, 'feImage', { x: 0, y: 0, width: 200, height: 200, preserveAspectRatio: 'none', result: 'pm', href: warpMaps.pinch });
    const im2 = mk(filter, 'feImage', { x: 0, y: 0, width: 200, height: 200, preserveAspectRatio: 'none', result: 'dm', href: warpMaps.t });
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
  const slit = [0, 1, 2].map(() => ({
    glow: mk(fx, 'path', { fill: 'none', stroke: '#fff', 'stroke-opacity': '0', 'stroke-width': '9', 'stroke-linecap': 'round' }),
    shadow: mk(fx, 'path', { fill: 'none', stroke: '#2a3570', 'stroke-opacity': '0', 'stroke-width': '2.2', 'stroke-linecap': 'round' }),
    light: mk(fx, 'path', { fill: 'none', stroke: '#fff', 'stroke-opacity': '0', 'stroke-width': '1.4', 'stroke-linecap': 'round' })
  }));
  const ripplePool = [0, 1, 2, 3, 4, 5].map(() => mk(fx, 'ellipse', { fill: 'none', stroke: '#1f2a5e', 'stroke-width': '1', opacity: '0' }));
  const ripples = [];
  // Onda de ativação: depois do furo, uma onda na cor da pétala parte do ponto de entrada e cruza o
  // cartão inteiro (como a onda que percorre o óvulo a partir de onde o espermatozoide entrou).
  const waves = [0, 1, 2].map(k => {
    const cp = mk(front.defs, 'clipPath', { id: `pp-clip-${k}` });
    const rect = mk(cp, 'rect', {});
    const gr = mk(front.defs, 'radialGradient', { id: `pp-wave-${k}` });
    const stops = [['0', '0'], ['.5', '0'], ['.84', '1'], ['1', '0']].map(([o, a]) => mk(gr, 'stop', { offset: o, 'stop-opacity': a }));
    const g = mk(fx, 'g', { 'clip-path': `url(#pp-clip-${k})` });
    const circ = mk(g, 'circle', { fill: `url(#pp-wave-${k})`, opacity: '0' });
    circ.style.mixBlendMode = 'multiply';
    return { rect, stops, circ, start: 0, on: false, x: 0, y: 0, R: 0 };
  });

  let active = false;
  const want = () => !forcedOff && !reduced.matches && !(window.EnoPerf && window.EnoPerf.lite);
  let onToggle = () => {};

  function setActive(v) {
    if (v === active) return;
    active = v;
    back.slot.hidden = !v;
    front.slot.hidden = !v;
    document.documentElement.toggleAttribute('data-petal-physics', v);
    if (!v) for (const [el, c] of cardState) { el.style.transform = ''; el.style.transformOrigin = ''; c.tf = ''; }
    onToggle(v);
  }

  let cardEls = null;
  const cards = () => {
    if (!cardEls) cardEls = ['#etha-frame', '#ambo-demo', '#minne-demo'].map(s => document.querySelector(s)).filter(Boolean);
    return cardEls;
  };

  // pétala → cartão do produto dela (0 Minne, 1 Etha, 2 Ambo)
  const CARD_SEL = ['#minne-demo', '#etha-frame', '#ambo-demo'];
  const cardCache = [];
  const cardOf = i => (i in CARD_SEL ? (cardCache[i] ??= document.querySelector(CARD_SEL[i])) : null);

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

    // --- furar a membrana (a borda do cartão), no tempo, como agulha em membrana mole ---
    // (1) a ponta da base encosta na borda; (2) a borda afunda e segura a pétala, que comprime e se
    // debate, freando porque a resistência cresce com a profundidade; (3) instabilidade: fura de uma
    // vez, a pétala estica, afina e dispara para dentro; (4) a borda volta, passa do ponto e fecha em
    // volta. O que está dentro do cartão passa a ficar atrás do vidro; o que está fora, na frente.
    const prox = it.prox;
    const card = cardOf(i);
    // Camada enquanto não fura: perto do próprio cartão a pétala vem para a frente. A troca só acontece
    // quando ela não está sobre nenhum cartão (ninguém vê o salto); se não der, fica atrás, como antes.
    if (it.state === 0) {
      const desired = !!front_ || prox > .02;
      if (desired !== it.layerFront) {
        const bb = it.bbox;
        const over = bb && cards().some(el => {
          const r = el.getBoundingClientRect();
          return bb.x1 > r.left && bb.x0 < r.right && bb.y1 > r.top && bb.y0 < r.bottom;
        });
        if (!over || front_) it.layerFront = desired;
      }
    }
    const rc = card && (it.state || (it.layerFront && prox > .02)) ? card.getBoundingClientRect() : null;

    const PRESS_MS = 300, DENT = 18;
    const pressT = it.state === 1 ? clamp((now - it.t0) / PRESS_MS) : 0;
    if (it.state === 1) it.pressK = 1 - (1 - pressT) ** 2.4;       // avança rápido e freia
    else it.pressK *= Math.exp(-h / .08);
    const qT = it.state === 2 ? 1 : 0;
    if (it.state === 2) {
      it.vq += (300 * (1 - it.q) - 23 * it.vq) * h;                // dispara, com leve passada do ponto
      it.q += it.vq * h;
    } else { it.q = 0; it.vq = 0; }
    const q01 = clamp(it.q);

    // comprimir (pressionando) e esticar (passando): eixo e largura em sentidos opostos
    const sq = it.state === 1 ? it.pressK : 0;
    const st = clamp(Math.abs(it.vq) / 7);
    const axK = 1 - .12 * sq + .16 * st, latK = 1 + .1 * sq - .2 * st;
    // esforço: a pétala se debate de lado enquanto empurra (umas 3 investidas)
    const wig = it.state === 1 ? Math.sin((now - it.t0) * .001 * 2 * Math.PI * 9) * .07 * Math.sin(Math.PI * pressT) : 0;
    const bxE = it.bx + wig;

    const s = pose.s;
    const L = g.L * s;
    const rx = (pose.rx || 0) * DEG, ry = (pose.ry || 0) * DEG;
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const bxo = (g.base.x - PIVOT.x) * s, byo = (g.base.y - PIVOT.y) * s;
    const ux = g.ux, uy = g.uy;
    const PX = pose.x + it.ox, PY = pose.y + it.oy;
    // ponto (a ao longo do eixo, l lateral) → tela, sem o recuo da membrana
    let neckA = -9, neckK = 0;
    const proj = (a, l) => {
      const A = a * L * axK;
      let Ll = (l * latK + bxE * a * a * .55) * L;
      if (neckK) Ll *= 1 - neckK * Math.exp(-((a - neckA) ** 2) / .012); // pescoço: aperta onde cruza a borda
      const Z = (it.bz * a * a * .62 + .3 * l * l + it.flutter * a * Math.sin(it.phase - a * 5.2)) * L;
      const x = bxo + A * ux - Ll * uy, y = byo + A * uy + Ll * ux;
      const x1 = x * cy + Z * sy, z1 = -x * sy + Z * cy;
      const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
      const w = F / Math.max(200, F - z2);
      return { x: PX + (x1 * cr - y2 * sr) * w, y: PY + (x1 * sr + y2 * cr) * w };
    };
    const B0 = proj(0, 0), T0 = proj(1, 0);

    // profundidade (para dentro) de um ponto em relação à borda de entrada
    const E = it.edge;
    const depthOf = pt => !rc || !E ? -1 : E === 't' ? pt.y - rc.top : E === 'b' ? rc.bottom - pt.y : E === 'l' ? pt.x - rc.left : rc.right - pt.x;
    const insideRc = pt => rc && pt.x > rc.left && pt.x < rc.right && pt.y > rc.top && pt.y < rc.bottom;

    if (it.state === 0 && rc && it.layerFront && prox > .02 && insideRc(B0)) {
      // encostou: a borda mais próxima é por onde ela entra
      const d = { t: B0.y - rc.top, b: rc.bottom - B0.y, l: B0.x - rc.left, r: rc.right - B0.x };
      it.edge = Object.keys(d).reduce((m, k) => (d[k] < d[m] ? k : m), 't');
      it.state = 1; it.t0 = now; it.outDone = false;
    } else if (it.state === 1) {
      if (!insideRc(B0)) it.state = 0;
      else if (now - it.t0 >= PRESS_MS) { it.state = 2; it.evPop = true; it.holdPop = it.hold || 0; }
    } else if (it.state === 2) {
      const bb = it.bbox;
      if (!rc || (bb && !(bb.x1 > rc.left && bb.x0 < rc.right && bb.y1 > rc.top && bb.y0 < rc.bottom))) it.state = 0;
      else if (!insideRc(B0) && !it.outDone) { it.outDone = true; it.evOut = true; }
    }

    // a membrana segura a pétala: enquanto pressiona ela só entra o quanto a borda afundou
    const n = it.edge === 't' ? [0, 1] : it.edge === 'b' ? [0, -1] : it.edge === 'l' ? [1, 0] : [-1, 0];
    let hold = 0;
    if (it.state === 1) hold = Math.max(0, depthOf(B0) - DENT * it.pressK);
    else if (it.state === 2) hold = (it.holdPop || 0) * (1 - it.q);
    it.hold = hold;
    const HX = -n[0] * hold, HY = -n[1] * hold;

    // pescoço onde o eixo cruza a borda (só depois de furar)
    if (it.state === 2 && rc) {
      const dB = depthOf(B0) - hold, dT = depthOf(T0) - hold;
      if (dB > 0 && dT < 0) { neckA = dB / (dB - dT); neckK = .34 * Math.max(st, .45) * q01; }
    }

    const pts = new Array(g.local.length);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k2 = 0; k2 < g.local.length; k2++) {
      const pt = proj(g.local[k2].a, g.local[k2].l);
      pt.x += HX; pt.y += HY;
      if (pt.x < x0) x0 = pt.x; if (pt.x > x1) x1 = pt.x; if (pt.y < y0) y0 = pt.y; if (pt.y > y1) y1 = pt.y;
      pts[k2] = pt;
    }
    it.bbox = { x0, y0, x1, y1 };
    const tipP = pts[g.tipIdx], baseP = pts[0];
    const bend = Math.abs(it.bz) + Math.abs(bxE) * .6 + it.flutter * 2;
    const grad = {
      x1: baseP.x, y1: baseP.y, x2: tipP.x, y2: tipP.y,
      light: clamp(.06 + bend * .55, 0, .42),
      dark: clamp(bend * .22 + sq * .1, 0, .24)
    };

    const d = toD(pts);
    if (it.state === 2 && rc) {
      // dentro do cartão: atrás do vidro; fora: na frente
      const rad = (it.rad ??= parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0);
      const { left: l, top: t, width: w, height: hh } = rc;
      for (const [k3, v] of [['x', l], ['y', t], ['width', w], ['height', hh], ['rx', rad]]) it.clipIn.setAttribute(k3, v.toFixed(1));
      const r2 = Math.min(rad, w / 2, hh / 2);
      it.clipOut.setAttribute('d', `M-9999-9999H19999V19999H-9999ZM${(l + r2).toFixed(1)} ${t.toFixed(1)}h${(w - 2 * r2).toFixed(1)}a${r2} ${r2} 0 0 1 ${r2} ${r2}v${(hh - 2 * r2).toFixed(1)}a${r2} ${r2} 0 0 1 ${-r2} ${r2}h${(-(w - 2 * r2)).toFixed(1)}a${r2} ${r2} 0 0 1 ${-r2} ${-r2}v${(-(hh - 2 * r2)).toFixed(1)}a${r2} ${r2} 0 0 1 ${r2} ${-r2}Z`);
      if (!it.clipped) {
        it.clipped = true;
        it.back.grp.setAttribute('clip-path', `url(#pp-in-${i})`);
        it.front.grp.setAttribute('clip-path', `url(#pp-out-${i})`);
      }
      setSide(it.front, d, pose.o, grad);
      setSide(it.back, d, pose.o, grad);
    } else {
      if (it.clipped) {
        it.clipped = false;
        it.back.grp.removeAttribute('clip-path');
        it.front.grp.removeAttribute('clip-path');
      }
      setSide(it.layerFront ? it.front : it.back, d, pose.o, grad);
      setSide(it.layerFront ? it.back : it.front, '', 0, grad);
    }

    // o que a membrana do cartão sente: ponto de contato na borda, direção e quanto afunda
    it.cardEl = card;
    it.mem = null;
    if (rc && it.state === 1) {
      const dep = DENT * it.pressK;
      const cxp = clamp(B0.x, rc.left, rc.right), cyp = clamp(B0.y, rc.top, rc.bottom);
      // ponto da borda sob a base
      const ex = it.edge === 'l' ? rc.left : it.edge === 'r' ? rc.right : cxp;
      const ey = it.edge === 't' ? rc.top : it.edge === 'b' ? rc.bottom : cyp;
      it.mem = { mx: ex, my: ey, nx: n[0], ny: n[1], target: it.pressK * pose.o, dent: DENT, len: L * .2, dep };
    }

    return Math.abs(it.vbz) > .01 || Math.abs(it.vbx) > .01 || Math.abs(it.bz - tz) > .004 || Math.abs(it.bx - tx) > .004
      || Math.abs(it.ox) > .2 || Math.abs(it.oy) > .2 || it.flutter > .002
      || it.state === 1 || Math.abs(it.vq) > .01 || Math.abs(it.q - qT) > .003 || it.pressK > .01;
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
      if (!c) { c = { P: 0, vP: 0, lz: 0, vlz: 0, spot: null, tf: '', rad: null }; cardState.set(el, c); }
      const it = items.find(q => q.cardEl === el);
      const m = it ? it.mem : null;
      const wave = waves[ti];

      // Membrana: P > 0 a borda afunda sob a pétala, P < 0 estufa para fora. A mola é pouco amortecida:
      // ao furar, a borda volta num tranco, passa do ponto e assenta em volta da pétala.
      const targetP = m ? m.target : 0;
      if (m) c.spot = { mx: m.mx, my: m.my, nx: m.nx, ny: m.ny, dent: m.dent, len: m.len };
      if (it && it.evPop) {
        it.evPop = false;
        if (c.spot) {
          c.vP -= 7 + Math.abs(c.P) * 9;
          c.vlz += 5;
          // onda de ativação a partir do ponto de entrada
          const r = el.getBoundingClientRect();
          wave.on = true; wave.start = now; wave.x = c.spot.mx; wave.y = c.spot.my;
          wave.R = Math.max(Math.hypot(wave.x - r.left, wave.y - r.top), Math.hypot(wave.x - r.right, wave.y - r.top),
            Math.hypot(wave.x - r.left, wave.y - r.bottom), Math.hypot(wave.x - r.right, wave.y - r.bottom));
          wave.stops.forEach(sx => sx.setAttribute('stop-color', it.fill));
          if (c.rad == null) c.rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        }
      }
      if (it && it.evOut) { it.evOut = false; if (c.spot) c.vP -= 3; } // ao sair, a borda é puxada e solta

      if (m) {
        const r = el.getBoundingClientRect();
        c.u = (m.mx - r.left) / r.width; c.v = (m.my - r.top) / r.height;
      }
      const tLz = -targetP * 1.2; // pressionar empurra aquele lado do cartão para longe da tela
      const KP = 240, CP = 11;
      c.vP += (KP * (targetP - c.P) - CP * c.vP) * dt; c.P += c.vP * dt;
      const K = 160, C = 12;
      c.vlz += (K * (tLz - c.lz) - C * c.vlz) * dt; c.lz += c.vlz * dt;

      const moving = Math.abs(c.vP) > .02 || Math.abs(c.P - targetP) > .004 || Math.abs(c.vlz) > .05 || Math.abs(c.lz - tLz) > .01;
      if (moving) busy = true;

      // cartão: só transforma enquanto há movimento perceptível (parado fica 2D e nítido)
      let tf = '';
      if (Math.abs(c.lz) > .02) {
        const u = c.u ?? .5, v = c.v ?? .5;
        const ry = -(u - .5) * 2 * c.lz, rx = (v - .5) * 2 * c.lz;
        tf = `perspective(1400px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
        el.style.transformOrigin = `${(100 - u * 100).toFixed(1)}% ${(100 - v * 100).toFixed(1)}%`;
      }
      if (tf !== c.tf) { c.tf = tf; el.style.transform = tf; if (!tf) el.style.transformOrigin = ''; }

      const tent = tents[ti], lens = lenses[ti];
      ti++;
      const sp = c.spot;
      const depth = Math.max(0, c.P);
      if (sp && depth > .01) {
        // sombra dentro da covinha, logo abaixo da borda afundada
        const R = 16 + depth * 16;
        tent.setAttribute('cx', (sp.mx + sp.nx * depth * sp.dent * .9).toFixed(1));
        tent.setAttribute('cy', (sp.my + sp.ny * depth * sp.dent * .9).toFixed(1));
        tent.setAttribute('rx', R.toFixed(1)); tent.setAttribute('ry', R.toFixed(1));
        tent.setAttribute('opacity', clamp(depth * 1.1, 0, .9).toFixed(3));
      } else tent.setAttribute('opacity', '0');

      if (lens) {
        // lente: empurra a borda e o conteúdo vizinho na direção da pétala (ou de volta, no repique)
        const px = sp ? clamp(c.P, -.5, 1.15) * sp.dent : 0;
        const want = sp && (lens.on ? Math.abs(px) > .8 : Math.abs(px) > 1.6);
        if (want) {
          const D = 180;
          if (D !== lens.D) {
            lens.D = D;
            for (const nn of [lens.filter, lens.im1, lens.im2]) { nn.setAttribute('width', D); nn.setAttribute('height', D); }
            lens.div.style.width = lens.div.style.height = D + 'px';
          }
          if (!lens.on) { lens.on = true; lens.div.hidden = false; }
          // a borda fica a 0,6 raio do centro da lente; o mapa do lado certo empurra na direção de dentro
          const key = sp.ny > 0 ? 't' : sp.ny < 0 ? 'b' : sp.nx > 0 ? 'l' : 'r';
          if (lens.key !== key) { lens.key = key; lens.im2.setAttribute('href', warpMaps[key]); }
          const ccx = sp.mx + sp.nx * D * .3, ccy = sp.my + sp.ny * D * .3;
          lens.div.style.transform = `translate3d(${(ccx - D / 2).toFixed(1)}px,${(ccy - D / 2).toFixed(1)}px,0)`;
          lens.pinch.setAttribute('scale', '0');
          lens.dragX.setAttribute('scale', (-2 * px * sp.nx).toFixed(1));
          lens.dragY.setAttribute('scale', (-2 * px * sp.ny).toFixed(1));
          busy = true;
        } else if (lens.on) { lens.on = false; lens.div.hidden = true; }
      }

      if (wave.on) {
        const e = (now - wave.start) / 1100;
        if (e >= 1) { wave.on = false; wave.circ.setAttribute('opacity', '0'); }
        else {
          busy = true;
          const r = el.getBoundingClientRect();
          wave.rect.setAttribute('x', r.left.toFixed(1)); wave.rect.setAttribute('y', r.top.toFixed(1));
          wave.rect.setAttribute('width', r.width.toFixed(1)); wave.rect.setAttribute('height', r.height.toFixed(1));
          wave.rect.setAttribute('rx', c.rad || 0);
          wave.circ.setAttribute('cx', wave.x.toFixed(1)); wave.circ.setAttribute('cy', wave.y.toFixed(1));
          wave.circ.setAttribute('r', (16 + (wave.R * 1.12) * (1 - (1 - e) ** 2.6)).toFixed(1));
          wave.circ.setAttribute('opacity', (.6 * Math.min(1, e * 8) * (1 - e) ** 1.6).toFixed(3));
        }
      }
      if (!m && !moving) c.spot = null;
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
      s.glow.setAttribute('stroke-opacity', '0');
      s.light.setAttribute('d', `M${(a.x - ex).toFixed(1)} ${(a.y - ey + 1.6).toFixed(1)}L${(b.x + ex).toFixed(1)} ${(b.y + ey + 1.6).toFixed(1)}`);
      s.shadow.setAttribute('stroke-opacity', (o * .22).toFixed(3));
      s.light.setAttribute('stroke-opacity', (o * .35).toFixed(3));
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
      const rx = r.len * .4 + 46 * grow * r.strength;
      el.setAttribute('cx', r.x.toFixed(1));
      el.setAttribute('cy', r.y.toFixed(1));
      el.setAttribute('rx', rx.toFixed(1));
      el.setAttribute('ry', (rx * .62).toFixed(1));
      el.setAttribute('transform', `rotate(${(r.ang / DEG).toFixed(1)} ${r.x.toFixed(1)} ${r.y.toFixed(1)})`);
      el.setAttribute('opacity', (.16 * r.strength * (1 - e) ** 2).toFixed(3));
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
