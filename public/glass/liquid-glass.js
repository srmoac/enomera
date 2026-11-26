/* Liquid Glass · refração real e luz reativa para os elementos .lg
   -----------------------------------------------------------------------------
   Opcional. Sem este arquivo o CSS entrega o vidro de compatibilidade.

   O que faz:
   1. Refração (só Chromium): para cada .lg gera um mapa de deslocamento com o
      formato do próprio elemento (bisel convexo calculado pela distância à borda
      arredondada) e o aplica ao fundo com feDisplacementMap dentro de
      backdrop-filter. Safari, iOS e Firefox não aplicam filtros SVG em
      backdrop-filter, então ali nada é ligado e o CSS segue valendo.
   2. Luz: o ângulo do brilho especular acompanha o ponteiro (desktop) e a
      posição do elemento na tela durante a rolagem (toque).

   API:
     import { initLiquidGlass } from './liquid-glass.js';
     const glass = initLiquidGlass();        // observa o documento inteiro
     glass.refresh();                        // depois de trocar tamanho ou raio por script
     glass.destroy();

   Controle pela página: <html data-lg-refraction="off"> desliga a refração,
   <html data-lg-refraction="on"> força (para teste).
*/

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_MAP_SIDE = 320;       // o campo é suave: o mapa pode ser menor que o elemento
const MAX_AREA = 900 * 700;     // acima disso o custo de composição não compensa
const mapCache = new Map();

export function supportsRefraction() {
  const forced = document.documentElement.dataset.lgRefraction;
  if (forced === 'off') return false;
  if (!('CSS' in window) || !CSS.supports('backdrop-filter', 'url(#a)')) return false;
  if (forced === 'on') return true;
  // WebKit e Gecko aceitam a sintaxe mas não desenham o filtro: só Chromium entra.
  const brands = navigator.userAgentData && navigator.userAgentData.brands;
  const chromium = brands ? brands.some(b => /Chromium/i.test(b.brand)) : /Chrome\/\d+/.test(navigator.userAgent) && !/\b(iPhone|iPad|CriOS)\b/.test(navigator.userAgent);
  if (!chromium) return false;
  if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
  return true;
}

function allowsTransparency() {
  if (document.documentElement.dataset.lgForce === 'solid') return false;
  return !matchMedia('(prefers-reduced-transparency: reduce)').matches
    && !matchMedia('(prefers-contrast: more)').matches
    && !matchMedia('(forced-colors: active)').matches;
}

/* Mapa de deslocamento: R = eixo x, G = eixo y, 128 = neutro.
   Dentro do bisel o fundo é amostrado mais para dentro do elemento, com perfil
   quadrático (máximo na aresta, zero no fim do bisel), como uma borda convexa.
   O perfil circular, mais fiel à física, cria uma cáustica dura sobre texto. */
function buildMap(w, h, radius, bezel) {
  const key = `${w}x${h}r${radius}b${bezel}`;
  if (mapCache.has(key)) return mapCache.get(key);
  const s = Math.min(1, MAX_MAP_SIDE / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * s));
  const ch = Math.max(2, Math.round(h * s));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const hw = w / 2, hh = h / 2;
  const r = Math.min(radius, hw, hh);
  const bz = Math.max(1, Math.min(bezel, hw, hh));
  for (let j = 0; j < ch; j++) {
    const y = (j + .5) * (h / ch) - hh;
    const ay = Math.abs(y) - (hh - r);
    const sy = y < 0 ? -1 : 1;
    for (let i = 0; i < cw; i++) {
      const x = (i + .5) * (w / cw) - hw;
      const ax = Math.abs(x) - (hw - r);
      const sx = x < 0 ? -1 : 1;
      let dist, nx, ny;
      if (ax > 0 && ay > 0) {
        const len = Math.hypot(ax, ay) || 1;
        dist = r - len; nx = sx * ax / len; ny = sy * ay / len;
      } else if (ax > ay) {
        dist = r - ax; nx = sx; ny = 0;
      } else {
        dist = r - ay; nx = 0; ny = sy;
      }
      // dist: distância até a aresta, positiva para dentro (0 na aresta)
      const t = Math.min(1, Math.max(0, 1 - dist / bz));
      const m = t * t;
      const o = (j * cw + i) * 4;
      d[o] = Math.round(128 - nx * m * 127);
      d[o + 1] = Math.round(128 - ny * m * 127);
      d[o + 2] = 128;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  if (mapCache.size > 60) mapCache.delete(mapCache.keys().next().value);
  mapCache.set(key, url);
  return url;
}

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

function buildFilter(filter, w, h, mapUrl, scale, dispersion) {
  filter.replaceChildren();
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) filter.setAttribute(k, v);
  const image = el('feImage', { x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' });
  image.setAttribute('href', mapUrl);
  filter.append(image);
  const displace = (s, result) => el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: s, xChannelSelector: 'R', yChannelSelector: 'G', result });
  if (!(dispersion > 0)) {
    filter.append(displace(scale, 'out'));
    return;
  }
  // Dispersão: cada canal dobra um pouco diferente, o que dá a franja colorida da borda.
  const channels = [
    ['r', scale * (1 + dispersion), '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
    ['g', scale, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
    ['b', scale * (1 - dispersion), '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
  ];
  for (const [id, s, values] of channels) {
    filter.append(displace(s, `d${id}`));
    filter.append(el('feColorMatrix', { in: `d${id}`, type: 'matrix', values, result: id }));
  }
  filter.append(el('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }));
  filter.append(el('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }));
}

let uid = 0;

export function initLiquidGlass(root = document, { selector = '.lg', light = true } = {}) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const state = new Map();
  let defs = null;
  let refract = supportsRefraction() && allowsTransparency();

  function ensureDefs() {
    if (defs) return defs;
    const svg = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' });
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.dataset.lgDefs = '';
    defs = el('defs', {});
    svg.append(defs);
    document.body.append(svg);
    return defs;
  }

  function update(node) {
    const st = state.get(node);
    if (!st) return;
    const w = Math.round(node.offsetWidth), h = Math.round(node.offsetHeight);
    const cs = getComputedStyle(node);
    const off = node.dataset.glassRefract === 'off';
    if (!refract || off || w < 8 || h < 8 || w * h > MAX_AREA) {
      node.style.removeProperty('--lg-refract');
      if (st.filter) { st.filter.remove(); st.filter = null; st.key = ''; }
      return;
    }
    const radius = Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
    const bezel = Math.round(parseFloat(cs.getPropertyValue('--lg-bezel')) || 14);
    // --lg-refraction vai de 0 a 1. Em 1 a aresta amostra o fundo meio bisel para dentro,
    // o máximo antes de o mapa dobrar a imagem sobre si mesma (o que embaralha texto).
    // feDisplacementMap desloca até scale / 2, por isso scale = força x bisel.
    const strength = Math.max(0, Math.min(1, parseFloat(cs.getPropertyValue('--lg-refraction')) || 0));
    const scale = Math.round(strength * Math.min(bezel, w / 2, h / 2) * 10) / 10;
    const dispersion = parseFloat(cs.getPropertyValue('--lg-dispersion')) || 0;
    const key = [w, h, radius, bezel, scale, dispersion].join('|');
    if (key === st.key) return;
    st.key = key;
    if (!scale) { node.style.removeProperty('--lg-refract'); return; }
    if (!st.filter) {
      st.filter = el('filter', { id: `lg-refract-${++uid}` });
      ensureDefs().append(st.filter);
    }
    buildFilter(st.filter, w, h, buildMap(w, h, radius, bezel), scale, dispersion);
    node.style.setProperty('--lg-refract', `url(#${st.filter.id})`);
  }

  const resize = new ResizeObserver(entries => { for (const e of entries) schedule(e.target); });
  const visible = new Set();
  const inView = new IntersectionObserver(entries => {
    for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
    queueLight();
  }, { rootMargin: '80px' });

  const pending = new Set();
  let frame = 0;
  function schedule(node) {
    pending.add(node);
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      for (const n of pending) update(n);
      pending.clear();
    });
  }

  function adopt(node) {
    if (state.has(node)) return;
    state.set(node, { filter: null, key: '' });
    resize.observe(node);
    inView.observe(node);
  }
  function drop(node) {
    const st = state.get(node);
    if (!st) return;
    if (st.filter) st.filter.remove();
    node.style.removeProperty('--lg-refract');
    node.style.removeProperty('--lg-angle');
    resize.unobserve(node); inView.unobserve(node); visible.delete(node);
    state.delete(node);
  }
  function scan(scope) {
    if (scope.nodeType !== 1 && scope.nodeType !== 9) return;
    if (scope.matches && scope.matches(selector)) adopt(scope);
    scope.querySelectorAll(selector).forEach(adopt);
  }

  const mutations = new MutationObserver(list => {
    for (const m of list) {
      m.addedNodes.forEach(scan);
      m.removedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (state.has(n)) drop(n);
        n.querySelectorAll(selector).forEach(drop);
      });
    }
  });

  // Luz: ângulo do brilho por elemento. Ponteiro quando existe, rolagem sempre.
  let pointer = null, lightFrame = 0;
  function queueLight() {
    if (!light || reduceMotion.matches || lightFrame) return;
    if (window.EnoPerf && window.EnoPerf.lite) return; // modo leve: luz parada (eno-perf.js)
    lightFrame = requestAnimationFrame(() => {
      lightFrame = 0;
      const vh = innerHeight || 1;
      for (const node of visible) {
        const r = node.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let angle;
        if (pointer) {
          // a luz vem do lado do ponteiro
          angle = Math.atan2(cy - pointer.y, cx - pointer.x) * 180 / Math.PI + 90;
          angle = 135 + Math.max(-70, Math.min(70, shortest(angle - 135))) * .6;
        } else {
          angle = 112 + 46 * Math.max(0, Math.min(1, cy / vh));
        }
        node.style.setProperty('--lg-angle', `${angle.toFixed(1)}deg`);
      }
    });
  }
  const shortest = a => ((a + 540) % 360) - 180;
  const onPointer = e => { if (e.pointerType === 'mouse') { pointer = { x: e.clientX, y: e.clientY }; queueLight(); } };
  const onLeave = () => { pointer = null; queueLight(); };
  const onScroll = () => queueLight();

  function refresh() {
    refract = supportsRefraction() && allowsTransparency();
    for (const node of state.keys()) { state.get(node).key = ''; schedule(node); }
    queueLight();
  }

  scan(root === document ? document.documentElement : root);
  mutations.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
  addEventListener('pointermove', onPointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  addEventListener('scroll', onScroll, { passive: true, capture: true });
  const queries = ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)'].map(q => matchMedia(q));
  queries.forEach(q => q.addEventListener && q.addEventListener('change', refresh));
  for (const node of state.keys()) schedule(node);

  return {
    refresh,
    get refraction() { return refract; },
    destroy() {
      mutations.disconnect(); resize.disconnect(); inView.disconnect();
      removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      removeEventListener('scroll', onScroll, { capture: true });
      queries.forEach(q => q.removeEventListener && q.removeEventListener('change', refresh));
      [...state.keys()].forEach(drop);
      if (defs) defs.parentNode.remove();
    },
  };
}
