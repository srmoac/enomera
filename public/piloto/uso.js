/*
 * Enomera · registro de uso do piloto (um arquivo, sem dependências, servido pela Core).
 * Uso: <script src="https://<core>/piloto/uso.js" data-produto="ambo|minne|etha|site|enomera" defer></script>
 *
 * Registra INTERAÇÕES, nunca conteúdo: telas, cliques (posição relativa e nome do botão/link),
 * tempo ativo, rolagem, erros de JavaScript, chamadas à Core que falharam e tempos de carregamento.
 * Não lê o valor de nenhum campo. Textos passam por filtro que tira e-mails, números e nomes próprios.
 * Elementos com data-uso-privado (ou dentro dele) não têm texto registrado.
 * Só conta para alguém quando o aparelho pertence a um participante convidado; sem isso, apagado em 24 h.
 * Quem não é convidado só é medido depois de permitir no aviso de privacidade (/eno-consent.js).
 */
(function () {
  // Endereços da Enomera que podem receber a chave do participante (nunca um *.vercel.app qualquer).
  var ENO_HOSTS = /^(?:localhost|127\.0\.0\.1|(?:enomera(?:-painel|-desenvolvimento)?|enomera-sites(?:-desenvolvimento)?|(?:ambo|minne|etha)-enomera(?:-desenvolvimento)?|etha-enomera-sites(?:-desenvolvimento)?|(?:agendamento|consultorio)-enomera-desenvolvimento|helenaduartepsi)\.vercel\.app)$/;
  'use strict';
  if (window.__enomeraUso) return;
  var script = document.currentScript || document.querySelector('script[src*="/piloto/uso.js"]');
  var PRODUCT = (script && script.getAttribute('data-produto')) || 'enomera';
  var CORE = (function () { try { return new URL(script.src).origin; } catch (e) { return location.origin; } })();
  var ENDPOINT = CORE + '/api/v1/pilot/events';
  var LS = (function () { try { var k = '__eno_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch (e) { return null; } })();
  // Consentimento (LGPD): quem não é convidado do piloto só é medido se permitir no aviso de privacidade.
  // Sem permissão, nada é gravado no aparelho; os eventos ficam só na memória da página e só seguem
  // se a pessoa entrar com uma conta de convidado (que já consentiu no cadastro). Senão, são descartados.
  var MEM = {};
  var ALLOWED = false;
  var rawGet = function (k) { try { return LS ? LS.getItem(k) : null; } catch (e) { return null; } };
  var get = function (k) { return Object.prototype.hasOwnProperty.call(MEM, k) ? MEM[k] : rawGet(k); };
  var set = function (k, v) {
    if (!ALLOWED && /^eno_uso_/.test(k) && k !== 'eno_uso_off' && k !== 'eno_uso_pu') { MEM[k] = v; return; }
    try { if (LS) LS.setItem(k, v); } catch (e) {}
  };
  var USO_KEYS = ['eno_uso_d', 'eno_uso_s', 'eno_uso_sa', 'eno_uso_sh'];
  function persistMemory() { USO_KEYS.forEach(function (k) { if (MEM[k] != null) { try { if (LS) LS.setItem(k, MEM[k]); } catch (e) {} delete MEM[k]; } }); }
  function forgetDevice() { USO_KEYS.forEach(function (k) { try { if (LS) LS.removeItem(k); } catch (e) {} }); }
  function consentChoice() {
    try { if (window.EnoConsent) return window.EnoConsent.get(); } catch (e) {}
    try { var o = JSON.parse(rawGet('eno_consent_v1') || 'null'); return o ? !!o.a : null; } catch (e) { return null; }
  }
  if (get('eno_uso_off') === '1') { window.__enomeraUso = { off: true }; return; }
  ALLOWED = consentChoice() === true || !!rawGet('eno_uso_pu');
  if (!ALLOWED) {
    // Identificadores gravados antes do aviso existir: guarda na memória e apaga do aparelho.
    USO_KEYS.forEach(function (k) { var v = rawGet(k); if (v != null) MEM[k] = v; });
    forgetDevice();
  }
  // Aviso de privacidade: componente único servido pela Core.
  if (!window.EnoConsent && !document.querySelector('script[src*="eno-consent.js"]')) {
    try {
      var cs = document.createElement('script');
      cs.src = (function () { try { return new URL('/eno-consent.js', script.src).toString(); } catch (e) { return '/eno-consent.js'; } })();
      cs.defer = true; (document.head || document.documentElement).appendChild(cs);
    } catch (e) {}
  }

  function rid(n) { var a = new Uint8Array(n || 12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(36)).slice(-2); }).join('').slice(0, 22); }
  var DEVICE = get('eno_uso_d'); if (!DEVICE || !/^[A-Za-z0-9_-]{8,48}$/.test(DEVICE)) { DEVICE = 'd' + rid(14); set('eno_uso_d', DEVICE); }
  // Sessão de uso: nova depois de 30 min sem atividade.
  var SESSION = get('eno_uso_s'); var lastAct = Number(get('eno_uso_sa') || 0);
  if (!SESSION || Date.now() - lastAct > 30 * 60e3) { SESSION = 's' + rid(12); set('eno_uso_s', SESSION); }
  set('eno_uso_sa', String(Date.now()));
  var SH = get('eno_uso_sh') || null;
  var PU = get('eno_uso_pu') || null;
  var form = function () { var w = window.innerWidth; return w < 700 ? 'celular' : w < 1024 ? 'tablet' : 'computador'; };

  // Chave do participante vinda de outro produto do ecossistema (?eno_pu=), retirada da barra de endereço.
  try {
    var u0 = new URL(location.href); var pu0 = u0.searchParams.get('eno_pu');
    if (pu0 && /^[A-Za-z0-9_-]{8,64}$/.test(pu0)) {
      PU = pu0; set('eno_uso_pu', pu0); u0.searchParams.delete('eno_pu');
      setTimeout(function () { try { history.replaceState(history.state, '', u0.pathname + u0.search + u0.hash); } catch (e) {} }, 1200);
    }
  } catch (e) {}

  // ── filtro de dados pessoais ──
  function scrub(s, max) {
    return String(s == null ? '' : s)
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '‹e-mail›')
      .replace(/\d[\d\s.()/-]{5,}\d/g, '‹número›')
      .replace(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+(?:d[aeo]s?|e)\s+|\s+)[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)*/g, '‹nome›')
      .replace(/\s+/g, ' ').trim().slice(0, max || 60);
  }
  var KEEP_PARAMS = ['etapa', 'aba', 'tab', 'view', 'step', 'modo', 'secao'];
  function normPath(p) {
    return p.split('/').map(function (seg, i, all) {
      if (!seg) return seg;
      var prev = all[i - 1] || '';
      if (/^(public|sites|site|patients|pacientes|requests|appointments|notes|imports|items|orders|reschedules|files|convite|p|pro)$/.test(prev)) return ':id';
      if (/\d{3,}|^[0-9a-f-]{16,}$|^[A-Za-z0-9_-]{20,}$/.test(seg)) return ':id';
      return seg;
    }).join('/');
  }
  function screenName() {
    var forced = document.querySelector('[data-uso-tela]');
    if (forced) return scrub(forced.getAttribute('data-uso-tela'), 80);
    var params = new URLSearchParams(location.search); var keep = [];
    KEEP_PARAMS.forEach(function (k) { if (params.get(k)) keep.push(k + '=' + scrub(params.get(k), 20)); });
    var name = normPath(location.pathname) + (keep.length ? '?' + keep.join('&') : '');
    // Item de navegação ativo (aba, etapa) dá nome à tela em apps que não mudam o endereço.
    var cur = document.querySelector('[aria-current="page"]:not(a[href^="http"]), [aria-current="step"], [role="tab"][aria-selected="true"], nav [aria-pressed="true"]');
    var curText = cur && !cur.closest('[data-uso-privado]') ? scrub(cur.getAttribute('aria-label') || cur.textContent, 28) : '';
    return (name + (curText ? ' · ' + curText : '')).slice(0, 150);
  }

  // ── fila e envio ──
  var queue = []; var trackOn = true; var flushTimer = null;
  function push(type, data) {
    if (!trackOn) return;
    var ev = { t: Date.now(), type: type, sc: currentScreen || screenName() };
    for (var k in data) if (data[k] !== undefined) ev[k] = data[k];
    queue.push(ev);
    if (queue.length >= 40) flush(); else if (!flushTimer) flushTimer = setTimeout(flush, 8000);
  }
  function payload(events) { var b = { d: DEVICE, p: PRODUCT, s: SESSION, f: form(), e: events }; if (SH) b.sh = SH; if (PU) b.pu = PU; if (!ALLOWED) b.nc = 1; return JSON.stringify(b); }
  function allow() {
    if (ALLOWED) return; ALLOWED = true; persistMemory();
    if (queue.length) flush();
  }
  function flush(useBeacon) {
    clearTimeout(flushTimer); flushTimer = null;
    if (!queue.length || !trackOn) return;
    // Sem permissão e sem conta: nada sai do aparelho. Guarda pouco na memória, caso a pessoa entre como convidada.
    if (!ALLOWED && !SH) { if (queue.length > 200) queue.splice(0, queue.length - 200); return; }
    var events = queue.splice(0, 100); var body = payload(events);
    if (useBeacon && navigator.sendBeacon) { try { if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return; } catch (e) {} }
    try {
      origFetch(ENDPOINT, { method: 'POST', body: body, keepalive: body.length < 60000, credentials: CORE === location.origin ? 'same-origin' : 'omit', headers: { 'Content-Type': 'text/plain' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (r) {
          if (!r) return;
          if (r.track === false) { trackOn = false; queue = []; if (r.reason === 'admin' || r.reason === 'withdrawn') set('eno_uso_off', '1'); }
          if (r.ref && r.ref !== PU) { PU = r.ref; set('eno_uso_pu', r.ref); }
          if (r.ref) allow();
        }).catch(function () {});
    } catch (e) {}
    if (queue.length) flushTimer = setTimeout(flush, 1500);
  }

  // ── telas e tempo ativo ──
  var currentScreen = ''; var screenStart = 0; var activeMs = 0; var lastActivity = Date.now(); var maxScroll = 0;
  function scrollPct() { var h = document.documentElement.scrollHeight - innerHeight; return h > 40 ? Math.min(100, Math.round((scrollY / h) * 100)) : 100; }
  function closeScreen(reason) {
    if (!currentScreen) return;
    if (activeMs > 400) push('time', { sc: currentScreen, n: Math.round(activeMs), m: { scroll: maxScroll, motivo: reason || '' } });
    activeMs = 0;
  }
  function checkScreen() {
    var name = screenName();
    if (name === currentScreen) return;
    closeScreen('troca');
    var from = currentScreen; currentScreen = name; screenStart = Date.now(); maxScroll = scrollPct();
    push('view', { sc: name, m: { de: from || (document.referrer ? scrub(new URL(document.referrer, location.href).host, 60) : '') } });
  }
  ['pushState', 'replaceState'].forEach(function (fn) {
    var orig = history[fn]; if (!orig) return;
    history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(checkScreen, 60); return r; };
  });
  addEventListener('popstate', function () { setTimeout(checkScreen, 60); });
  addEventListener('hashchange', function () { setTimeout(checkScreen, 60); });
  var mo = null; var moTimer = null;
  var lastMut = 0;
  try { mo = new MutationObserver(function () { lastMut = Date.now(); clearTimeout(moTimer); moTimer = setTimeout(checkScreen, 350); }); } catch (e) {}

  var TICK = 2000;
  setInterval(function () {
    if (document.visibilityState === 'visible' && Date.now() - lastActivity < 30000) { activeMs += TICK; set('eno_uso_sa', String(Date.now())); }
    var sp = scrollPct(); if (sp > maxScroll) maxScroll = sp;
  }, TICK);
  setInterval(function () { closeScreen('pulso'); }, 30000);
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel', 'pointermove'].forEach(function (t) {
    addEventListener(t, function () { lastActivity = Date.now(); }, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { closeScreen('saiu'); push('leave', { n: Math.round(Date.now() - screenStart) }); flush(true); }
    else { lastActivity = Date.now(); }
  });
  addEventListener('pagehide', function () { closeScreen('fechou'); flush(true); });

  // ── cliques ──
  var INTERACTIVE = 'a,button,[role=button],[role=tab],[role=link],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],input,select,textarea,label,summary,[data-uso],[onclick]';
  function zoneOf(el) { var z = el.closest('header,nav,main,aside,footer,dialog,[role=dialog],form,section[id],[data-uso-zona]'); if (!z) return ''; return z.getAttribute('data-uso-zona') || (z.id ? z.tagName.toLowerCase() + '#' + scrub(z.id, 24) : z.tagName.toLowerCase()); }
  function describe(el) {
    if (!el || el.nodeType !== 1) return '';
    var priv = el.closest('[data-uso-privado]');
    var tag = el.tagName.toLowerCase(); var role = el.getAttribute('role');
    var label = el.getAttribute('data-uso') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (!label && /^(input|select|textarea)$/.test(tag)) label = 'campo ' + (el.getAttribute('name') || el.id || el.type || tag);
    if (!label && !priv) label = el.innerText || el.textContent || el.getAttribute('alt') || '';
    if (!label && el.querySelector) { var img = el.querySelector('[aria-label],img[alt],svg title'); if (img) label = img.getAttribute('aria-label') || img.getAttribute('alt') || img.textContent; }
    var kind = role || (tag === 'a' ? 'link' : tag === 'button' ? 'botão' : tag);
    label = scrub(label, 48) || (el.id ? '#' + scrub(el.id, 30) : (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0].slice(0, 30) : '(sem nome)'));
    var z = zoneOf(el);
    return (kind + ': ' + label + (z ? ' @' + z : '')).slice(0, 150);
  }
  var recent = [];
  document.addEventListener('click', function (e) {
    try {
      var raw = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
      if (!raw) return;
      var el = raw.closest(INTERACTIVE);
      var dead = !el && getComputedStyle(raw).cursor !== 'pointer';
      var target = el || raw;
      var now = Date.now(); var x = e.clientX; var y = e.clientY;
      recent = recent.filter(function (r) { return now - r.t < 800; }); recent.push({ t: now, x: x, y: y });
      var rage = recent.filter(function (r) { return Math.abs(r.x - x) < 32 && Math.abs(r.y - y) < 32; }).length >= 3;
      var docH = Math.max(document.documentElement.scrollHeight, innerHeight);
      var m = { vw: innerWidth, dh: Math.round(docH), sy: Math.round(scrollY) };
      if (rage) m.rage = true; if (dead) m.dead = true;
      // Link para outro produto do ecossistema: leva a chave do participante. Só para endereços da Enomera (lista fixa).
      var a = target.closest && target.closest('a[href]');
      if (a && PU) { try { var h = new URL(a.href, location.href); if (h.origin !== location.origin && ENO_HOSTS.test(h.hostname)) { h.searchParams.set('eno_pu', PU); a.href = h.toString(); m.ir = scrub(h.host, 60); } } catch (err) {} }
      var ev = { tg: describe(target), x: Math.round((x / innerWidth) * 1000), y: Math.round(((y + scrollY) / docH) * 1000), m: m };
      // Toque sem efeito: fora de qualquer controle e a página não reagiu em 700 ms.
      if (dead) { var sc0 = currentScreen; setTimeout(function () { if (lastMut >= now || currentScreen !== sc0) delete m.dead; push('click', ev); }, 700); }
      else push('click', ev);
    } catch (err) {}
  }, true);

  // Campos: só que foram usados e se o formulário foi enviado. Nunca o valor.
  document.addEventListener('change', function (e) { var el = e.target; if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) push('field', { tg: describe(el), m: { tipo: el.type || el.tagName.toLowerCase() } }); }, true);
  document.addEventListener('submit', function (e) { var f = e.target; push('submit', { tg: 'form: ' + scrub(f.getAttribute('aria-label') || f.id || f.getAttribute('name') || '', 40) + ' @' + zoneOf(f) }); }, true);
  document.addEventListener('invalid', function (e) { push('field', { tg: describe(e.target), m: { invalido: true } }); }, true);

  // ── erros e depuração ──
  var seenErr = {};
  function errOnce(type, msg, meta) { var k = type + msg; seenErr[k] = (seenErr[k] || 0) + 1; if (seenErr[k] > 5) return; push(type, { tg: scrub(msg, 150), m: meta }); }
  function stackOf(err) { return err && err.stack ? String(err.stack).split('\n').slice(0, 5).join(' | ').replace(/https?:\/\/[^\s)]+\/([^/\s)]+)/g, '$1') : ''; }
  addEventListener('error', function (e) {
    if (e.target && e.target !== window && e.target.tagName) { errOnce('error', 'recurso não carregou: ' + e.target.tagName.toLowerCase(), { src: scrub(String(e.target.src || e.target.href || '').split('?')[0].split('/').pop(), 60) }); return; }
    errOnce('error', e.message || 'erro', { src: scrub(String(e.filename || '').split('/').pop(), 60) + ':' + e.lineno + ':' + e.colno, stack: stackOf(e.error) });
  }, true);
  addEventListener('unhandledrejection', function (e) { var r = e.reason; errOnce('error', 'promessa rejeitada: ' + (r && r.message ? r.message : String(r)), { stack: stackOf(r) }); });
  var cErr = console.error;
  console.error = function () {
    try { var msg = Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : typeof a === 'string' ? a : ''; }).join(' '); if (msg) errOnce('console', msg, {}); } catch (e) {}
    return cErr.apply(console, arguments);
  };

  // ── chamadas à Core: endpoint, status, tempo; e a sessão (só o hash) para saber quem é ──
  function apiPath(url) {
    try { var u = new URL(url, location.href); if (u.pathname.indexOf('/api/') === -1) return null; return normPath(u.pathname.replace(/\/+$/, '')); } catch (e) { return null; }
  }
  function sha256(text) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
  }
  function noteAuth(h) {
    var v = ''; try { v = h && (typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization)) || ''; } catch (e) {}
    if (!/^Bearer\s+\S{16,}/.test(v)) return;
    var tok = v.replace(/^Bearer\s+/, '').trim();
    sha256(tok).then(function (hx) { if (hx && hx !== SH) { SH = hx; set('eno_uso_sh', hx); } });
  }
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var path = apiPath(url);
      if (!path || path.indexOf('/api/v1/pilot/') === 0) return origFetch(input, init);
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      noteAuth((init && init.headers) || (input && input.headers));
      var t0 = performance.now();
      return origFetch(input, init).then(function (res) {
        var ms = Math.round(performance.now() - t0); var meta = { status: res.status, ms: ms };
        if (res.status >= 400) {
          res.clone().json().then(function (b) { meta.code = scrub(b && b.code, 40); push('api', { tg: method + ' ' + path, n: ms, m: meta }); }).catch(function () { push('api', { tg: method + ' ' + path, n: ms, m: meta }); });
        } else push('api', { tg: method + ' ' + path, n: ms, m: meta });
        return res;
      }, function (err) {
        push('api', { tg: method + ' ' + path, n: Math.round(performance.now() - t0), m: { status: 0, code: 'REDE', erro: scrub(err && err.message, 60) } });
        throw err;
      });
    };
  }

  // ── carregamento ──
  addEventListener('load', function () {
    setTimeout(function () {
      try {
        var nav = performance.getEntriesByType('navigation')[0];
        if (nav) push('load', { n: Math.round(nav.loadEventEnd || nav.domComplete || 0), m: { dcl: Math.round(nav.domContentLoadedEventEnd || 0), ttfb: Math.round(nav.responseStart || 0) } });
      } catch (e) {}
    }, 0);
  });
  try {
    new PerformanceObserver(function (list) { var es = list.getEntries(); var last = es[es.length - 1]; if (last) lcp = Math.round(last.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  var lcp = 0; setTimeout(function () { if (lcp) push('load', { tg: 'lcp', n: lcp }); }, 6000);

  function start() {
    checkScreen();
    if (mo) mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected', 'data-uso-tela'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // Escolha no aviso de privacidade, a qualquer momento.
  addEventListener('enoconsent', function (e) {
    var ok = !!(e && e.detail && e.detail.analytics);
    if (ok) { trackOn = true; allow(); return; }
    if (rawGet('eno_uso_pu')) return; // convidado: vale o consentimento do cadastro (retirada pelo painel ou e-mail)
    ALLOWED = false; queue = [];
    USO_KEYS.forEach(function (k) { var v = rawGet(k); if (v != null) MEM[k] = v; });
    forgetDevice();
  });

  window.__enomeraUso = {
    produto: PRODUCT,
    marcar: function (nome, dados) { push('mark', { tg: scrub(nome, 80), m: dados || {} }); },
    enviar: function () { flush(); },
  };
})();
