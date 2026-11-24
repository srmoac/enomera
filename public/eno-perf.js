/* eno-perf.js · modo leve automático para aparelhos fracos (Enomera, Ambo, Minne, Etha)
   -----------------------------------------------------------------------------
   Carregar no <head>, síncrono e antes dos outros scripts. Junto: eno-perf.css.

   Marca <html data-perf="full|lite">. Aparelho bom fica com o visual completo.
   Vai para o leve quando:
     1. o aparelho se declara fraco (memória ≤ 4 GB, ou ≤ 4 núcleos fora da Apple,
        ou economia de dados ligada), ou
     2. o uso real mostra que ele não acompanha: quadros longos repetidos
        (Long Animation Frames no Chromium; ritmo de quadros durante toque e
        rolagem em todos os navegadores).
        A decisão fica guardada neste aparelho por 14 dias.
   Forçar para teste: ?perf=lite ou ?perf=full (fica guardado); ?perf=auto volta.

   O que muda no leve (o resto continua igual):
     - sem desfoque de fundo (backdrop-filter) e sem refração SVG; o vidro vira
       superfície translúcida mais densa, com o mesmo bisel e a mesma luz;
     - animações mantêm movimento, escala e opacidade, mas sem desfoque animado
       (filter: blur), que é o passo mais caro de cada quadro;
     - a luz do vidro não acompanha a rolagem;
     - motion-auto/motion-flip pulam os fantasmas e as transições de cor (leem
       window.EnoPerf.lite).
*/
(() => {
  if (window.EnoPerf) return;
  const root = document.documentElement;
  const KEY = 'eno-perf-v1';
  const DAY = 864e5;
  const now = Date.now();
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const write = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch {} };

  let q = null;
  try { q = new URLSearchParams(location.search).get('perf'); } catch {}
  if (q === 'auto') write(null);
  else if (q === 'lite' || q === 'full') write({ tier: q, forced: true, at: now });

  const nav = navigator;
  const mem = nav.deviceMemory || 0;
  const cores = nav.hardwareConcurrency || 0;
  const conn = nav.connection;
  // Safari não informa memória e arredonda núcleos: Apple só entra no leve pela medição.
  const apple = /iPhone|iPad|Macintosh/.test(nav.userAgent) && !nav.deviceMemory;
  const declaredWeak = (mem > 0 && mem <= 4) || (!apple && cores > 0 && cores <= 4)
    || Boolean(conn && conn.saveData);

  const saved = read();
  let tier = 'full';
  let reason = 'aparelho';
  if (saved && (saved.forced || now - saved.at < 14 * DAY)) { tier = saved.tier; reason = saved.forced ? 'forçado' : 'medido'; }
  else if (declaredWeak) { tier = 'lite'; reason = 'declarado'; }

  const listeners = new Set();
  const api = window.EnoPerf = {
    get tier() { return tier; },
    get lite() { return tier === 'lite'; },
    get reason() { return reason; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setLite(why) { if (tier !== 'lite') { tier = 'lite'; reason = why || 'medido'; write({ tier, at: Date.now(), why: reason }); apply(); } },
  };

  /* ---- CSS: tira desfoque de @keyframes e liga os fallbacks sem backdrop-filter ---- */
  const LITE = ':root[data-perf="lite"]';
  const done = new WeakSet();
  const prefix = (sel) => sel.split(',').map((s) => {
    s = s.trim();
    if (/^(:root|html)\b/.test(s)) return s.replace(/^(:root|html)/, LITE);
    return `${LITE} ${s}`;
  }).join(', ');
  function liteSheet(sheet) {
    if (done.has(sheet)) return;
    let rules;
    try { rules = sheet.cssRules; } catch { return; } // folha de outra origem (Google Fonts)
    if (!rules) return;
    done.add(sheet);
    const extra = [];
    const walk = (list) => {
      for (const r of list) {
        if (r.type === 7 /* KEYFRAMES */) {
          for (const kf of r.cssRules) if (kf.style && /blur/.test(kf.style.filter || '')) kf.style.removeProperty('filter');
        } else if (r.type === 12 /* SUPPORTS */ && /not/.test(r.conditionText) && /backdrop-filter/.test(r.conditionText)) {
          for (const inner of r.cssRules) if (inner.type === 1 && !/\.lg\b/.test(inner.selectorText)) extra.push(`${prefix(inner.selectorText)} { ${inner.style.cssText} }`);
        } else if (r.cssRules && r.type !== 7) {
          walk(r.cssRules);
        }
      }
    };
    try { walk(rules); } catch {}
    for (const css of extra) { try { sheet.insertRule(css, sheet.cssRules.length); } catch {} }
  }
  const liteAllSheets = () => { for (const s of document.styleSheets) liteSheet(s); };
  let headWatch = null;
  function watchSheets() {
    liteAllSheets();
    if (headWatch) return;
    headWatch = new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeName === 'STYLE') liteAllSheets();
        else if (n.nodeName === 'LINK' && /stylesheet/.test(n.rel)) { if (n.sheet) liteAllSheets(); n.addEventListener('load', liteAllSheets, { once: true }); }
      }
    });
    headWatch.observe(document.head || root, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liteAllSheets, { once: true });
    addEventListener('load', liteAllSheets, { once: true });
  }

  /* ---- WAAPI: no leve, keyframes perdem filter/backdropFilter (vale para motion-auto,
         motion-flip, eno-gestures e a biblioteca motion, que usam element.animate) ---- */
  const animate = Element.prototype.animate;
  const strip = (k) => {
    if (Array.isArray(k)) return k.map((f) => { if (!f || !('filter' in f || 'backdropFilter' in f)) return f; const { filter, backdropFilter, ...rest } = f; return rest; });
    if (k && typeof k === 'object' && ('filter' in k || 'backdropFilter' in k)) { const { filter, backdropFilter, ...rest } = k; return rest; }
    return k;
  };
  Element.prototype.animate = function (keyframes, options) {
    return animate.call(this, tier === 'lite' ? strip(keyframes) : keyframes, options);
  };

  function apply() {
    root.dataset.perf = tier;
    if (tier === 'lite') {
      root.dataset.lgRefraction = 'off';
      watchSheets();
      try { window.__enomeraLiquidGlass && window.__enomeraLiquidGlass.refresh(); } catch {}
    }
    listeners.forEach((fn) => { try { fn(tier); } catch {} });
    try { dispatchEvent(new CustomEvent('eno-perf', { detail: { tier, reason } })); } catch {}
  }
  apply();

  /* ---- Vigia: o aparelho acompanha no uso real? ---- */
  if (tier === 'lite' || (saved && saved.forced)) return;
  const GRACE = 2500;          // a carga inicial (hidratação) não conta, salvo se for absurda
  const WINDOW = 8000;
  const t0 = performance.now();
  let recent = [];             // [instante, duração] dos quadros longos depois da carga
  let loadBlocking = 0;
  const judge = (start, dur) => {
    if (tier === 'lite') return;
    if (start < t0 + GRACE) {
      loadBlocking += Math.max(0, dur - 50);
      if (loadBlocking > 1600) api.setLite('carga lenta');
      return;
    }
    recent.push([start, dur]);
    recent = recent.filter(([t]) => t > start - WINDOW);
    const heavy = recent.filter(([, d]) => d >= 100).length;
    const blocking = recent.reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
    if (heavy >= 4 || blocking >= 700) api.setLite('quadros longos');
  };
  let usedLoaf = false;
  try {
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
      usedLoaf = true;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => judge(e.startTime, e.duration)))
        .observe({ type: 'long-animation-frame', buffered: true });
    }
  } catch {}
  // Todos os navegadores: mede o ritmo de quadros só enquanto há toque/rolagem (não gasta
  // bateria parado). Pega o engasgo que não é JS (desfoque, pintura), que o LoAF não vê.
  let until = 0, last = 0, raf = 0, slow = 0, total = 0;
  const tick = (t) => {
    if (last) { const d = t - last; total++; if (d > 50) slow++; if (d > 90 && !usedLoaf) judge(t, d); }
    last = t;
    if (total >= 90 && slow / total > 0.3) api.setLite('quadros lentos');
    if (t < until && tier !== 'lite') raf = requestAnimationFrame(tick); else { raf = 0; last = 0; }
  };
  const wake = () => { if (tier === 'lite') return; until = performance.now() + 1500; if (!raf) raf = requestAnimationFrame(tick); };
  ['pointerdown', 'touchmove', 'wheel', 'scroll', 'keydown'].forEach((e) => addEventListener(e, wake, { passive: true, capture: true }));
})();
