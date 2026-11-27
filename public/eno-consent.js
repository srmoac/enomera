/*
 * Enomera · aviso de privacidade e cookies (componente único, 25/11/2026)
 *
 * Um arquivo, sem dependências, servido pela Core em /eno-consent.js.
 * Os produtos não precisam carregar nada: o /piloto/uso.js já carrega este arquivo.
 * Também dá para carregar direto: <script src="/eno-consent.js" defer></script>
 *
 * O que decide: só a MEDIÇÃO DE USO opcional (registro de uso do piloto para quem não é convidado).
 * O que é necessário para funcionar (sessão de login, rascunhos, preferências de tela) não depende de aceite
 * e está descrito em /privacidade#cookies.
 *
 * API:
 *   EnoConsent.get()      → true (permitiu), false (recusou) ou null (ainda não escolheu)
 *   EnoConsent.open()     → reabre o aviso (para um link "Preferências de privacidade")
 *   EnoConsent.on(fn)     → chama fn(valor) a cada escolha
 *   Qualquer elemento com [data-eno-consent] reabre o aviso ao ser clicado.
 *
 * Regras de UX/motion (padrao-ux-motion.md): cartão pequeno de vidro, sem cobrir a tela,
 * Recusar e Permitir com o mesmo tamanho e no mesmo nível, entrada 320 ms ease-out, saída 65%,
 * prefers-reduced-motion só faz fade, alvo mínimo 44 px, foco visível, Esc fecha sem decidir.
 */
(function () {
  'use strict';
  if (window.EnoConsent) return;

  var KEY = 'eno_consent_v1';
  var VERSION = '2026-11-25';
  var script = document.currentScript || document.querySelector('script[src*="eno-consent.js"]');
  var CORE = (function () { try { return new URL(script.src).origin; } catch (e) { return location.origin; } })();
  var MORE = (script && script.getAttribute('data-saiba-mais')) || (CORE + '/privacidade#cookies');

  var store = (function () { try { var k = '__eno_c'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch (e) { return null; } })();
  var memory = null; // sem localStorage (aba anônima, bloqueio): a escolha vale só nesta página
  function read() {
    if (!store) return memory;
    try { var raw = store.getItem(KEY); if (!raw) return null; var o = JSON.parse(raw); return o && o.v === VERSION ? o : null; } catch (e) { return null; }
  }
  function write(value) {
    var o = { v: VERSION, a: !!value, at: new Date().toISOString() };
    memory = o;
    try { if (store) store.setItem(KEY, JSON.stringify(o)); } catch (e) {}
    return o;
  }
  // Quem entrou no piloto por convite já consentiu no cadastro (versão piloto-uso): não pergunta de novo.
  function isInvitedParticipant() { try { return !!(store && store.getItem('eno_uso_pu')); } catch (e) { return false; } }

  var listeners = [];
  function emit(v) {
    listeners.slice().forEach(function (fn) { try { fn(v); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent('enoconsent', { detail: { analytics: v } })); } catch (e) {}
  }

  var CSS = '' +
    '.eno-consent{position:fixed;z-index:2147483001;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px) + var(--eno-toast-offset,0px));' +
    'width:min(440px,calc(100vw - 24px));transform:translateX(-50%);box-sizing:border-box;padding:10px 10px 10px 14px;border-radius:20px;display:flex;align-items:center;gap:10px;' +
    'font:500 13px/1.35 Manrope,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--eno-fb-ink,#1C2240);' +
    'background:linear-gradient(135deg,rgb(var(--eno-fb-glass,247 249 255)/.86),rgb(var(--eno-fb-glass,247 249 255)/.72));' +
    '-webkit-backdrop-filter:blur(22px) saturate(1.8);backdrop-filter:blur(22px) saturate(1.8);border:1px solid rgb(255 255 255/.6);' +
    'box-shadow:inset 0 1px 0 rgb(255 255 255/.7),0 14px 40px -12px rgb(var(--eno-fb-shadow,54 76 140)/.32),0 2px 6px rgb(var(--eno-fb-shadow,54 76 140)/.08);' +
    'animation:enoConsentIn var(--eno-t-step,320ms) var(--eno-ease-out,cubic-bezier(.23,1,.32,1)) both}' +
    '@media (min-width:760px){.eno-consent{left:auto;right:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:none;animation-name:enoConsentInDesk}}' +
    '.eno-consent[data-leaving]{animation:enoConsentOut var(--eno-t-step-out,200ms) var(--eno-ease-out,cubic-bezier(.23,1,.32,1)) both;pointer-events:none}' +
    '@media (min-width:760px){.eno-consent[data-leaving]{animation-name:enoConsentOutDesk}}' +
    '.eno-consent h2{margin:0 0 4px;font-family:inherit;font-size:15px;font-weight:700;line-height:1.3;letter-spacing:-.005em;color:inherit}' +
    '.eno-consent p{margin:0;flex:1 1 auto;min-width:0;color:var(--eno-fb-ink,#1C2240)}.eno-consent-actions{display:flex;gap:6px;flex:none}' +
    '@media (min-width:760px){.eno-consent{width:min(560px,calc(100vw - 48px));font-size:14px}}' +
    '.eno-consent a{color:var(--eno-fb-accent,#3B4FB8);font-weight:600;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px;' +
    'display:inline-flex;align-items:center;min-height:24px;padding:10px 2px;margin:-10px -2px;border-radius:6px}' +
    '.eno-consent .eno-consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}' +
    '.eno-consent button{appearance:none;-webkit-appearance:none;min-height:var(--eno-btn-md,44px);border-radius:14px;padding:0 12px;cursor:pointer;' +
    'font-family:inherit;font-size:14px;font-weight:600;line-height:1;color:var(--eno-fb-ink,#1C2240);background:rgb(255 255 255/.55);border:1px solid rgb(var(--eno-fb-shadow,54 76 140)/.18);' +
    'transition:transform var(--eno-t-press,120ms) var(--eno-ease-out,cubic-bezier(.23,1,.32,1)),background-color var(--eno-t-fast,160ms) var(--eno-ease-out,cubic-bezier(.23,1,.32,1)),box-shadow var(--eno-t-fast,160ms) var(--eno-ease-out,cubic-bezier(.23,1,.32,1));' +
    'touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
    '.eno-consent button[data-eno-ok]{color:#fff;background:var(--eno-fb-accent,#3B4FB8);border-color:transparent}' +
    '@media (hover:hover){.eno-consent button:hover{background:rgb(255 255 255/.8)}.eno-consent button[data-eno-ok]:hover{background:var(--eno-fb-accent,#3B4FB8);box-shadow:0 6px 18px -6px var(--eno-fb-accent,#3B4FB8)}}' +
    '.eno-consent button:active{transform:scale(var(--eno-press-scale,.98))}' +
    '.eno-consent button:focus-visible,.eno-consent a:focus-visible{outline:2px solid var(--eno-fb-accent,#3B4FB8);outline-offset:2px}' +
    '@keyframes enoConsentIn{from{opacity:0;transform:translate(-50%,12px) scale(.98)}to{opacity:1;transform:translate(-50%,0) scale(1)}}' +
    '@keyframes enoConsentOut{to{opacity:0;transform:translate(-50%,8px) scale(.98)}}' +
    '@keyframes enoConsentInDesk{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}' +
    '@keyframes enoConsentOutDesk{to{opacity:0;transform:translateY(8px) scale(.98)}}' +
    '@media (prefers-reduced-motion:reduce){.eno-consent,.eno-consent[data-leaving]{animation-name:enoConsentFade!important;transform:translateX(-50%)}.eno-consent button{transition:none}}' +
    '@media (prefers-reduced-motion:reduce) and (min-width:760px){.eno-consent,.eno-consent[data-leaving]{transform:none}}' +
    '@keyframes enoConsentFade{from{opacity:0}}' +
    '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.eno-consent{background:rgb(var(--eno-fb-glass,247 249 255)/.98)}}' +
    '@media (prefers-reduced-transparency:reduce){.eno-consent{background:rgb(var(--eno-fb-glass,247 249 255)/.98);-webkit-backdrop-filter:none;backdrop-filter:none}}' +
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .eno-consent{border-color:rgb(255 255 255/.12);color:var(--eno-fb-ink,#EEF1FC)}' +
    ':root:not([data-theme="light"]) .eno-consent p{color:var(--eno-fb-muted,#A9B1CE)}:root:not([data-theme="light"]) .eno-consent button:not([data-eno-ok]){background:rgb(255 255 255/.08);color:inherit;border-color:rgb(255 255 255/.14)}}' +
    '@media print{.eno-consent{display:none}}';

  var el = null; var lastFocus = null;
  function injectCss() {
    if (document.getElementById('eno-consent-css')) return;
    var s = document.createElement('style'); s.id = 'eno-consent-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function close(choice) {
    if (!el) return;
    var node = el; el = null;
    if (choice !== undefined) { write(choice); emit(choice); }
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.setAttribute('data-leaving', '');
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, reduce ? 0 : 220);
    if (lastFocus && document.contains(lastFocus) && typeof lastFocus.focus === 'function') { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  }
  function show(fromUser) {
    if (el || !document.body) return;
    injectCss();
    lastFocus = fromUser ? document.activeElement : null;
    el = document.createElement('section');
    el.className = 'eno-consent';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Aviso de privacidade');
    el.setAttribute('data-uso-privado', '');
    el.innerHTML =
      '<p>Podemos medir o uso do site, sem guardar o que você escreve? ' +
      '<a href="' + MORE.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">Saiba mais</a></p>' +
      '<div class="eno-consent-actions"><button type="button" data-eno-no>Recusar</button><button type="button" data-eno-ok>Permitir</button></div>';
    el.querySelector('[data-eno-no]').addEventListener('click', function () { close(false); });
    el.querySelector('[data-eno-ok]').addEventListener('click', function () { close(true); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    document.body.appendChild(el);
    if (fromUser) { try { el.querySelector('[data-eno-no]').focus({ preventScroll: true }); } catch (e) {} }
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-eno-consent]');
    if (!t) return; e.preventDefault(); show(true);
  });

  window.EnoConsent = {
    version: VERSION,
    get: function () { var o = read(); if (o) return o.a; return isInvitedParticipant() ? true : null; },
    open: function () { show(true); },
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
  };

  function boot() {
    if (read() || isInvitedParticipant()) return;
    // Espera a página assentar: o aviso não disputa a primeira impressão nem o carregamento.
    setTimeout(function () { if (!read()) show(false); }, 900);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
