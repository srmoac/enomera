/* Aplica o Liquid Glass (public/glass/) às superfícies do Enomera.
   O site e o portal montam boa parte da interface por innerHTML; este módulo
   observa o DOM e marca cada superfície com class="lg" e a variante certa.
   Formulários, resumo de compra e painéis com campos ficam em "reading". */

const RULES = [
  // [seletor, variante, opções]
  ['.motion-lens', 'clear', { refract: 'off' }],
  ['.service-option', 'clear'],
  ['.choice-group[aria-label=Modalidade]', 'regular'],
  ['.eno-glass.eno-activation-banner', 'regular'],
  ['.eno-glass', 'reading'],
  ['.eno-topbar', 'regular'],
  ['.eno-stepper', 'regular'],
  ['.eno-mobile-bar', 'regular'],
  ['.eno-pc', 'regular'],
  ['.eno-card:not(.eno-card-warn):not(.eno-card-err)', 'auto'],
  ['.portal-panel', 'auto'],
  ['.lg', 'auto'],
];
const SELECTOR = RULES.map(([s]) => s).join(',');
const FIELDS = 'input:not([type=hidden]),textarea,select';
const TINTS = ['ambo', 'minne', 'etha'];

function tintFor(el) {
  for (const t of TINTS) {
    if (el.classList.contains(`eno-card-${t}`) || el.classList.contains(`eno-pc-${t}`)) return t;
  }
  const demo = el.closest('#ambo-demo, #minne-demo, #etha-frame, #etha');
  if (demo?.id === 'ambo-demo') return 'ambo';
  if (demo?.id === 'minne-demo') return 'minne';
  if (demo) return 'etha';
  return 'enomera';
}

function mark(el) {
  const rule = RULES.find(([s]) => el.matches(s));
  if (!rule) return;
  const [, variant, opts = {}] = rule;
  el.classList.add('lg');
  if (!el.dataset.glassAuto && el.hasAttribute('data-glass')) return; // marcação já decidiu
  let v = variant;
  if (v === 'auto') v = (el.matches('form') || el.querySelector(FIELDS)) ? 'reading' : 'regular';
  if (el.dataset.glass !== v) el.dataset.glass = v;
  el.dataset.glassAuto = '1';
  if (!el.hasAttribute('data-glass-tint')) el.dataset.glassTint = tintFor(el);
  if (opts.refract && el.dataset.glassRefract !== opts.refract) el.dataset.glassRefract = opts.refract;
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches(SELECTOR)) mark(root);
  root.querySelectorAll(SELECTOR).forEach(mark);
}

let queued = new Set();
let scheduled = false;
function flush() {
  scheduled = false;
  const nodes = queued; queued = new Set();
  nodes.forEach(n => { if (n.isConnected) scan(n); });
  // Painéis "auto" mudam de variante quando ganham ou perdem campos.
  document.querySelectorAll('[data-glass-auto]').forEach(mark);
}

scan(document.body);
new MutationObserver(records => {
  for (const r of records) {
    if (r.target.closest?.('.motion-lens')) continue;
    r.addedNodes.forEach(n => n.nodeType === 1 && queued.add(n));
  }
  if (queued.size && !scheduled) { scheduled = true; queueMicrotask(flush); }
}).observe(document.body, { childList: true, subtree: true });
