// Motion entre re-renderizações (innerHTML) — Enomera e Etha.
// Toda troca de HTML passa por aqui: antes de trocar tiramos uma foto dos elementos
// visíveis; depois de pintar o HTML novo, animamos a diferença (FLIP).
//
// Identidade: data-m-key quando existe; senão uma chave automática pelo "tipo" do
// elemento (tag, id, classes, atributos de dados) e pela posição entre irmãos do mesmo
// tipo. Assim inserir uma mensagem de erro não confunde o campo de baixo.
//
//   - posição mudou        → desliza do lugar antigo (transform aditivo, relativo ao pai)
//   - data-m-size / vidro  → a altura cresce/encolhe até a nova (sem salto)
//   - elemento novo        → entra (opacidade + 6px + leve blur)
//   - elemento que saiu    → um "fantasma" no lugar antigo sai (opacidade + escala)
//   - número               → o antigo sobe e some, o novo sobe de baixo; texto curto troca no lugar
//   - estado mudou (classe de estado, aria-*, disabled, data-m-state)
//                          → cor/borda/sombra fazem transição; .m-pop dá um pulo de mola
// Regras (Emil Kowalski / Apple): só transform, opacity, filter e cores; 160–340 ms;
// ease-out forte; mola leve só onde o objeto "assenta"; nada roda com prefers-reduced-motion.

const EASE_OUT = 'cubic-bezier(.23, 1, .32, 1)';
const EASE_MOVE = 'cubic-bezier(.32, .72, 0, 1)';
const SPRING = 'linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 20.4%, 1.041 24.6%, 1.035 28.5%, 1.004 38.3%, .997 46.7%, 1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// O que conta como "objeto" na tela.
const TRACK = [
  '[data-m-key]', 'button', 'a', 'input', 'select', 'textarea', 'label', 'h1', 'h2', 'h3', 'h4', 'p', 'li', 'img',
  'section', 'article', 'form', 'fieldset', 'dl', 'dt', 'dd', 'small', 'strong', 'output', 'table', 'tr',
  '[role="alert"]', '[role="status"]', '[role="radio"]', '[role="tab"]', '[role="switch"]',
  '.lg', '[class*="card"]', '[class*="chip"]', '[class*="badge"]', '[class*="pill"]', '[class*="banner"]',
  '[class*="toast"]', '[class*="error"]', '[class*="note"]', '[class*="row"]', '[class*="line"]', '[class*="item"]',
  '[class*="spinner"]', '[class*="mark"]', '[class*="check"]', '[class*="status"]', '[class*="total"]',
].join(',');
const SKIP = '[data-m-skip], [data-m-skip] *, script, style, template';
const STATE_ATTRS = ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-expanded', 'aria-busy', 'aria-invalid', 'aria-current', 'disabled', 'data-m-state', 'data-state', 'data-active', 'data-busy'];
const STATE_CLASS = /^(is-|has-)|active|selected|busy|loading|open|^on$|error|invalid|pressed|done|success|disabled/;
const STATE_STYLE = ['backgroundColor', 'borderColor', 'boxShadow', 'color', 'opacity'];
const FROZEN = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align',
  'background-color', 'background-image', 'border', 'border-radius', 'box-shadow', 'padding', 'display', 'gap',
  'align-items', 'justify-content', 'flex-direction', 'grid-template-columns', 'white-space', 'text-transform', 'opacity',
  'fill', 'stroke', 'width', 'height'];
const MAX_GHOSTS = 14;

const isTracked = (el) => el.matches(TRACK) && !el.matches(SKIP);
function sig(el) {
  if (el.dataset.mKey) return `#${el.dataset.mKey}`;
  const id = el.id ? `#${el.id}` : '';
  const cls = [...el.classList].filter((c) => !STATE_CLASS.test(c) && !/^(m-|lg)/.test(c)).sort().join('.');
  const data = Object.keys(el.dataset).filter((k) => !/^(m[A-Z]|state|active|busy|routeIn|glass)/.test(k)).sort()
    .map((k) => `${k}=${String(el.dataset[k]).slice(0, 24)}`).join(',');
  const name = el.getAttribute('name') || el.getAttribute('for') || (el.getAttribute('href') || '').split('?')[0];
  return `${el.tagName}${id}.${cls}[${data}]${name}`;
}
// Chave automática: cadeia de assinaturas dos ancestrais + índice entre "iguais".
function keyOf(el, root, cache) {
  if (cache.has(el)) return cache.get(el);
  let k;
  if (el.dataset.mKey) k = `k:${el.dataset.mKey}`;
  else {
    const parent = el.parentElement && el.parentElement !== root ? el.parentElement : null;
    const s = sig(el);
    let n = 0;
    for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) if (sig(sib) === s) n++;
    k = `${parent ? keyOf(parent, root, cache) : ''}>${s}~${n}`;
  }
  cache.set(el, k);
  return k;
}
const ON_CLASS = /(^|-)(active|selected|current|on|checked)$/;
function isOn(el) {
  return ['aria-pressed', 'aria-checked', 'aria-selected'].some((a) => el.getAttribute(a) === 'true')
    || (el.hasAttribute('aria-current') && el.getAttribute('aria-current') !== 'false')
    || el.dataset.mState === 'true' || [...el.classList].some((c) => ON_CLASS.test(c));
}
function stateOf(el) {
  return STATE_ATTRS.map((a) => el.getAttribute(a) ?? '').join('|') + '|' + [...el.classList].filter((c) => STATE_CLASS.test(c)).sort().join('.');
}
function ownText(el) {
  if (el.querySelector(TRACK)) return null; // só folhas de texto
  const t = el.textContent.replace(/\s+/g, ' ').trim();
  return t.length && t.length <= 60 ? t : null;
}
function frozenHTML(el, styleCache) {
  const clone = el.cloneNode(true);
  const src = [el, ...el.querySelectorAll('*')];
  if (src.length > 120) return clone.outerHTML;
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((n, i) => {
    let css = styleCache.get(n);
    if (css === undefined) {
      const cs = getComputedStyle(n);
      css = FROZEN.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';');
      styleCache.set(n, css);
    }
    dst[i].style.cssText = css;
  });
  return clone.outerHTML;
}
function trackedParent(el, root) {
  let p = el.parentElement;
  while (p && p !== root && !isTracked(p)) p = p.parentElement;
  return p && p !== root ? p : null;
}
function collect(root) {
  const cache = new Map();
  const list = [];
  const used = new Map();
  root.querySelectorAll(TRACK).forEach((el) => {
    if (el.matches(SKIP)) return;
    let key = keyOf(el, root, cache);
    // Mesma chave duas vezes (ex.: resumo do celular e do computador): numeramos.
    const n = used.get(key) || 0;
    used.set(key, n + 1);
    if (n) { key = `${key}#${n}`; cache.set(el, key); }
    list.push({ el, key });
  });
  return { list, cache };
}
const PAD = 160;
const onScreen = (r) => (r.width || r.height) && r.bottom > -PAD && r.top < innerHeight + PAD;

export function motionSnapshot(root) {
  if (!root || reduced()) return null;
  const items = new Map();
  const styleCache = new Map();
  const { list, cache } = collect(root);
  list.forEach(({ el, key }) => {
    const r = el.getBoundingClientRect();
    if (!onScreen(r)) return;
    const cs = getComputedStyle(el);
    const p = trackedParent(el, root);
    items.set(key, {
      rect: r,
      text: ownText(el),
      state: stateOf(el),
      on: isOn(el),
      style: Object.fromEntries(STATE_STYLE.map((k) => [k, cs[k]])),
      radius: cs.borderRadius,
      parent: p ? cache.get(p) : null,
      el,
    });
  });
  // Congela o HTML (com estilo computado) só de quem tem pai que fica na tela ou é de topo:
  // é quem pode virar fantasma.
  items.forEach((it) => { it.html = frozenHTML(it.el, styleCache); it.el = null; });
  return { items, scrollY: window.scrollY };
}

function ghost(html, rect, radius) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const g = tpl.content.firstElementChild;
  if (!g) return null;
  g.removeAttribute('id');
  g.removeAttribute('data-m-key');
  g.setAttribute('aria-hidden', 'true');
  g.setAttribute('inert', '');
  g.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  Object.assign(g.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    margin: '0', pointerEvents: 'none', zIndex: '2147483000', boxSizing: 'border-box', borderRadius: radius || '',
  });
  document.body.appendChild(g);
  return g;
}

export function motionPlay(root, snap, { route = false } = {}) {
  if (!snap || !root || reduced()) return;
  const scrollDy = window.scrollY - snap.scrollY;
  const { list, cache } = collect(root);
  const nowKeys = new Set(list.map((n) => n.key));
  const delta = new Map();
  let ghosts = 0;
  let entering = 0;
  const turnedOn = [];
  const turnedOff = new Map(); // parent -> rect antigo de quem apagou
  // Em troca de tela o conteúdo novo entra pela cascata de CSS; aqui só o que persiste
  // (barra, abas, seletores) anima.
  const routeBox = route ? root.querySelector('[data-route-in]') : null;

  // Mede tudo antes de animar: uma animação no pai mudaria a medida dos filhos.
  const rects = new Map(list.map(({ el }) => [el, el.getBoundingClientRect()]));
  list.forEach(({ el, key }) => {
    if (routeBox && routeBox.contains(el)) return;
    const prev = snap.items.get(key);
    const r = rects.get(el);
    if (!r.width && !r.height) return; // escondido (display: none)
    const p = trackedParent(el, root);
    const parentKey = p ? cache.get(p) : null;
    if (route && !prev) return;
    if (!prev) {
      if (!onScreen(r)) return;
      if (parentKey && !snap.items.has(parentKey) && onScreen(rects.get(p) || p.getBoundingClientRect())) return; // o pai também é novo e já entra
      el.animate([
        { opacity: 0, transform: 'translateY(6px) scale(.985)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ], { duration: 240, easing: EASE_OUT, delay: 40 + Math.min(entering++, 5) * 30, fill: 'backwards' });
      return;
    }
    const sized = el.hasAttribute('data-m-size') || el.matches('.lg');
    if (!route && sized && Math.abs(prev.rect.height - r.height) > 2) {
      el.animate([{ height: `${prev.rect.height}px`, overflow: 'hidden' }, { height: `${r.height}px`, overflow: 'hidden' }], { duration: 300, easing: EASE_MOVE });
    }
    const dx = prev.rect.left - r.left;
    const dy = prev.rect.top - r.top - scrollDy;
    delta.set(key, [dx, dy]);
    const [pdx, pdy] = (parentKey && delta.get(parentKey)) || [0, 0];
    const rdx = dx - pdx; const rdy = dy - pdy;
    if (!route && (Math.abs(rdx) > 1 || Math.abs(rdy) > 1) && Math.abs(rdy) < innerHeight) {
      const scaleW = el.hasAttribute('data-m-scale') && r.width ? prev.rect.width / r.width : 1;
      el.animate([
        { transform: `translate(${rdx}px, ${rdy}px) scaleX(${scaleW})` },
        { transform: 'translate(0px, 0px) scaleX(1)' },
      ], { duration: el.hasAttribute('data-m-scale') ? 340 : 280, easing: el.hasAttribute('data-m-scale') ? SPRING : EASE_MOVE, composite: 'add' });
    }
    if (prev.state !== stateOf(el)) {
      const on = isOn(el);
      if (on && !prev.on) turnedOn.push({ el, key, prev });
      if (!on && prev.on && el.parentElement) turnedOff.set(el.parentElement, el);
      const cs = getComputedStyle(el);
      const to = Object.fromEntries(STATE_STYLE.map((k) => [k, cs[k]]));
      if (STATE_STYLE.some((k) => to[k] !== prev.style[k])) el.animate([{ ...prev.style }, to], { duration: 240, easing: EASE_OUT });
      el.querySelectorAll('.m-pop').forEach((m) => m.animate([
        { transform: 'scale(.4) rotate(-12deg)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], { duration: 360, easing: SPRING }));
      if (el.matches('button, [role="radio"], [role="tab"], [role="switch"], [class*="card"], [class*="chip"]')) {
        el.animate([{ transform: 'scale(.975)' }, { transform: 'scale(1)' }], { duration: 320, easing: SPRING, composite: 'add' });
      }
    }
    const t = prev.text !== null && !el.matches('input, textarea, select') ? ownText(el) : null;
    if (!route && t !== null && t !== prev.text) {
      if (/\d/.test(t) && prev.rect.height <= 48 && ghosts < MAX_GHOSTS) {
        ghosts++;
        const g = ghost(prev.html, { left: prev.rect.left, top: prev.rect.top - scrollDy, width: prev.rect.width, height: prev.rect.height }, prev.radius);
        if (g) {
          Object.assign(g.style, { background: 'transparent', boxShadow: 'none', border: '0', whiteSpace: 'nowrap' });
          g.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-60%)', filter: 'blur(2px)' }], { duration: 170, easing: EASE_OUT, fill: 'forwards' }).finished.then(() => g.remove(), () => g.remove());
        }
        el.animate([
          { opacity: 0, transform: 'translateY(60%)', filter: 'blur(2px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ], { duration: 280, easing: EASE_OUT, delay: 70, fill: 'backwards' });
      } else {
        el.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 220, easing: EASE_OUT, delay: 30, fill: 'backwards' });
      }
    }
  });
  // Indicador compartilhado: quando o "ligado" passa de um irmão para outro, o fundo desliza.
  turnedOn.forEach(({ el }) => {
    const from = turnedOff.get(el.parentElement);
    if (from) slideIndicator(from, el);
  });
  if (route) return;
  snap.items.forEach((prev, key) => {
    if (nowKeys.has(key)) return;
    if (prev.parent && !nowKeys.has(prev.parent) && snap.items.has(prev.parent)) return; // o pai também saiu e já leva este junto
    if (ghosts >= MAX_GHOSTS) return;
    ghosts++;
    const g = ghost(prev.html, { left: prev.rect.left, top: prev.rect.top - scrollDy, width: prev.rect.width, height: prev.rect.height }, prev.radius);
    if (!g) return;
    g.animate([
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
      { opacity: 0, transform: 'scale(.97)', filter: 'blur(3px)' },
    ], { duration: 180, easing: EASE_OUT, fill: 'forwards' }).finished.then(() => g.remove(), () => g.remove());
  });
}

function slideIndicator(from, to) {
  const cs = getComputedStyle(to);
  const bg = cs.backgroundColor;
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return;
  const parent = to.parentElement;
  const pr = parent.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const pcs = getComputedStyle(parent);
  const restorePos = pcs.position === 'static' ? (parent.style.position = 'relative', true) : false;
  const bl = parseFloat(pcs.borderLeftWidth) || 0; const bt = parseFloat(pcs.borderTopWidth) || 0;
  const pill = document.createElement('span');
  pill.setAttribute('aria-hidden', 'true');
  Object.assign(pill.style, {
    position: 'absolute', left: `${b.left - pr.left - bl}px`, top: `${b.top - pr.top - bt}px`, width: `${b.width}px`, height: `${b.height}px`,
    background: bg, backgroundImage: cs.backgroundImage, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow,
    pointerEvents: 'none', zIndex: '0', transformOrigin: '0 0',
  });
  parent.insertBefore(pill, parent.firstChild);
  const prevZ = to.style.zIndex; const prevPos = to.style.position;
  if (getComputedStyle(to).position === 'static') to.style.position = 'relative';
  to.style.zIndex = '1';
  const dur = 320;
  to.animate([{ backgroundColor: 'transparent', boxShadow: 'none', backgroundImage: 'none' }, { backgroundColor: 'transparent', boxShadow: 'none', backgroundImage: 'none' }], { duration: dur });
  pill.animate([
    { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` },
    { transform: 'none' },
  ], { duration: dur, easing: SPRING }).finished.finally(() => {
    pill.remove(); to.style.zIndex = prevZ; to.style.position = prevPos;
    if (restorePos) parent.style.position = '';
  });
}

// Para páginas que trocam pedaços com innerHTML (site e demonstrações): dentro de um
// ancestral com data-m-auto, toda troca de innerHTML passa pelo FLIP automaticamente.
let autoInstalled = false;
export function motionAutoInnerHTML() {
  if (autoInstalled) return;
  autoInstalled = true;
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  let busy = false;
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    enumerable: desc.enumerable,
    get() { return desc.get.call(this); },
    set(v) {
      if (busy || !this.isConnected || !this.firstElementChild || this.hasAttribute('data-m-noauto') || !this.closest('[data-m-auto]') || reduced()) { desc.set.call(this, v); return; }
      busy = true;
      try {
        const snap = motionSnapshot(this);
        desc.set.call(this, v);
        motionPlay(this, snap);
      } finally { busy = false; }
    },
  });
}
