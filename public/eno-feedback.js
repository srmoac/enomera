/* Enomera · padrão de feedback em vidro (22 nov 2026). Sem dependências; funciona em página
   estática, módulo ou React (carregar uma vez com <script src="/eno-feedback.js" defer>).

   window.EnoFeedback.toast({ tone, title, text, action, duration })   → { dismiss() }
     tone: 'ok' (padrão) | 'info' | 'warn' | 'err'
     action: { label: 'Desfazer', onClick() }  → fica 6 s, com barra de tempo
     duration: ms; padrão 4000 (ok/info/warn), 6000 com ação, 0 (não some) para 'err'
   window.EnoFeedback.undo(title, onUndo, { text, onCommit })        → toast com Desfazer;
     onCommit roda quando o tempo acaba sem desfazer.
   window.EnoFeedback.done(button, 'Salvo')  → o botão mostra ✓ Salvo por 1,6 s e volta.
   window.EnoFeedback.flash(element)         → realce curto no item que mudou.
   window.EnoFeedback.password(input, { userInputs: () => [nome, email] }) → força + regras ao vivo.

   Regras de uso (resumo de padrao-ux-motion.md §14):
   1. Resultado visível onde a pessoa agiu → estado inline (done/flash), sem toast.
   2. Resultado fora da tela, ou item que some → toast curto; ação reversível → Desfazer, nunca "tem certeza?".
   3. Erro que a pessoa precisa corrigir → texto inline ao lado do campo. Toast de erro só para falha de fundo.
   4. Diálogo de confirmação só para irreversível e caro (apagar conta, revogar todas as sessões). */
(function () {
  if (window.EnoFeedback) return;
  var reduce = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var MAX = 3;
  var region = null;
  var live = [];

  var ICONS = {
    ok: '<path d="M5 12.5l4.2 4L19 7"/>',
    info: '<path d="M12 11v6M12 7.2v.1"/>',
    warn: '<path d="M12 6.5v7M12 17.3v.1"/>',
    err: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>'
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function ensureRegion() {
    if (region && document.body.contains(region)) return region;
    region = document.createElement('section');
    region.className = 'eno-toasts';
    region.setAttribute('aria-label', 'Avisos');
    region.setAttribute('role', 'region');
    document.body.appendChild(region);
    return region;
  }

  // FLIP: mede antes, muda o DOM, anima a diferença (os antigos sobem/descem juntos).
  function flip(change) {
    var r = ensureRegion();
    var kids = Array.prototype.slice.call(r.children);
    var before = new Map(kids.map(function (k) { return [k, k.getBoundingClientRect().top]; }));
    change();
    if (reduce()) return;
    Array.prototype.forEach.call(r.children, function (k) {
      if (!before.has(k) || k.hasAttribute('data-leaving')) return;
      var dy = before.get(k) - k.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      k.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' });
    });
  }

  function toast(opts) {
    if (typeof opts === 'string') opts = { title: opts };
    opts = opts || {};
    var tone = opts.tone || 'ok';
    var hasAction = !!(opts.action && opts.action.label);
    var duration = opts.duration != null ? opts.duration : (tone === 'err' ? 0 : hasAction ? 6000 : 4000);
    var el = document.createElement('div');
    el.className = 'eno-toast';
    el.setAttribute('data-tone', tone);
    el.setAttribute('role', tone === 'err' ? 'alert' : 'status');
    el.setAttribute('aria-live', tone === 'err' ? 'assertive' : 'polite');
    el.innerHTML =
      '<span class="eno-toast-ic" aria-hidden="true"><svg viewBox="0 0 24 24">' + ICONS[tone] + '</svg></span>' +
      '<p class="eno-toast-tx" style="margin:0">' + (opts.title ? '<b>' + esc(opts.title) + '</b>' : '') + (opts.text ? (opts.title ? ' <span>' + esc(opts.text) + '</span>' : esc(opts.text)) : '') + '</p>' +
      (hasAction ? '<button type="button" class="eno-toast-act">' + esc(opts.action.label) + '</button>'
                 : '<button type="button" class="eno-toast-x" aria-label="Fechar aviso"><svg viewBox="0 0 14 14"><path d="M2 2l10 10M12 2L2 12"/></svg></button>') +
      (hasAction && duration ? '<span class="eno-toast-time" aria-hidden="true"></span>' : '');

    var timer = null, started = 0, left = duration, closed = false, bar = null;
    var handle = { el: el, dismiss: function (why) { close(why || 'manual'); } };
    function close(why) {
      if (closed) return; closed = true; clearTimeout(timer);
      if (bar) bar.cancel();
      live = live.filter(function (h) { return h !== handle; });
      if (why === 'timeout' && opts.onTimeout) { try { opts.onTimeout(); } catch (e) {} }
      if (opts.onClose) { try { opts.onClose(why); } catch (e) {} }
      el.setAttribute('data-leaving', '');
      var done = function () { flip(function () { el.remove(); }); };
      if (reduce()) setTimeout(done, 120); else setTimeout(done, 160);
    }
    function run() {
      if (!duration || closed) return;
      started = Date.now();
      timer = setTimeout(function () { close('timeout'); }, left);
      if (bar) bar.play();
    }
    function pause() {
      if (!duration || closed || !timer) return;
      clearTimeout(timer); timer = null; left -= Date.now() - started; if (bar) bar.pause();
    }
    el.addEventListener('mouseenter', pause); el.addEventListener('mouseleave', run);
    el.addEventListener('focusin', pause); el.addEventListener('focusout', run);
    var act = el.querySelector('.eno-toast-act');
    if (act) act.addEventListener('click', function () { try { opts.action.onClick && opts.action.onClick(); } finally { close('action'); } });
    var x = el.querySelector('.eno-toast-x');
    if (x) x.addEventListener('click', function () { close('manual'); });

    // Arrastar para o lado ou para baixo dispensa.
    var sx = 0, sy = 0, drag = false;
    el.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) return; drag = true; sx = e.clientX; sy = e.clientY; pause(); el.setPointerCapture && el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', function (e) { if (!drag) return; var dx = e.clientX - sx, dy = Math.max(0, e.clientY - sy); el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; el.style.opacity = String(Math.max(.2, 1 - (Math.abs(dx) + dy) / 220)); });
    function end(e) {
      if (!drag) return; drag = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 70 || dy > 40) { el.style.transition = 'transform 160ms cubic-bezier(.23,1,.32,1), opacity 160ms linear'; el.style.transform = 'translate(' + (dx > 0 ? 1 : dx < 0 ? -1 : 0) * 420 + 'px,' + (Math.abs(dx) > 70 ? 0 : 60) + 'px)'; el.style.opacity = '0'; closed = false; setTimeout(function () { close('swipe'); }, 140); }
      else { el.style.transition = 'transform 220ms cubic-bezier(.32,.72,0,1), opacity 120ms linear'; el.style.transform = ''; el.style.opacity = ''; setTimeout(function () { el.style.transition = ''; }, 240); run(); }
    }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);

    flip(function () { ensureRegion().appendChild(el); });
    var tb = el.querySelector('.eno-toast-time');
    if (tb && el.animate && !reduce()) { bar = tb.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: duration, easing: 'linear', fill: 'forwards' }); bar.pause(); }
    live.push(handle);
    while (live.length > MAX) live[0].dismiss('overflow');
    run();
    return handle;
  }

  function undo(title, onUndo, extra) {
    extra = extra || {};
    return toast({ tone: 'ok', title: title, text: extra.text, duration: extra.duration, action: { label: extra.label || 'Desfazer', onClick: onUndo }, onTimeout: extra.onCommit });
  }

  function done(btn, label, ms) {
    if (!btn || btn.hasAttribute('data-eno-done')) return;
    var prevHTML = btn.innerHTML, w = btn.offsetWidth;
    btn.setAttribute('data-eno-done', '');
    btn.style.minWidth = w + 'px';
    btn.innerHTML = '<span class="eno-done-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4L19 7"/></svg>' + esc(label || 'Feito') + '</span>';
    setTimeout(function () {
      btn.innerHTML = '<span class="eno-done-label">' + prevHTML + '</span>';
      btn.removeAttribute('data-eno-done');
      setTimeout(function () { if (!btn.hasAttribute('data-eno-done')) { btn.innerHTML = prevHTML; btn.style.minWidth = ''; } }, 240);
    }, ms || 1600);
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove('eno-flash'); void el.offsetWidth; el.classList.add('eno-flash');
    setTimeout(function () { el.classList.remove('eno-flash'); }, 640);
  }

  // ---------- Senha ----------
  var COMMON = ['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1', 'senha123', 'senha1234', 'qwerty123', 'qwertyui', 'abcdefgh', 'abc12345', 'iloveyou', 'enomera1', 'enomera123', 'mudar123', 'brasil123', 'admin123', 'aa123456'];
  var LABELS = ['Digite uma senha', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.3 6.8C3.9 8.5 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 4.1-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  function assess(pw, userInputs) {
    var low = pw.toLowerCase();
    var personal = (userInputs || []).map(function (s) { return String(s || '').toLowerCase().split(/[@\s.]+/); })
      .reduce(function (a, b) { return a.concat(b); }, []).filter(function (s) { return s.length >= 4; });
    var rules = {
      len: pw.length >= 8,
      mix: /[a-zà-ÿ]/i.test(pw) && /\d/.test(pw),
      extra: /[A-ZÀ-Þ]/.test(pw) || /[^A-Za-z0-9À-ÿ]/.test(pw),
      own: pw.length > 0 && COMMON.indexOf(low) < 0 && !/^(.)\1+$/.test(pw) && !personal.some(function (p) { return low.indexOf(p) >= 0; })
    };
    var level = 0;
    if (pw.length) {
      if (!rules.len) level = 1;
      else {
        level = 1 + (rules.mix ? 1 : 0) + (rules.extra ? 1 : 0) + (pw.length >= 12 ? 1 : 0);
        if (!rules.own) level = 1;
        level = Math.min(4, Math.max(level, 1));
        if (level === 4 && !(rules.mix && rules.extra)) level = 3;
      }
    }
    return { rules: rules, level: level, valid: rules.len && rules.own };
  }

  function password(input, opts) {
    if (!input || input.__enoPw) return input && input.__enoPw;
    opts = opts || {};
    var getUser = typeof opts.userInputs === 'function' ? opts.userInputs : function () { return opts.userInputs || []; };
    var host = input.parentElement; host.classList.add('eno-pw-host');
    var badge = document.createElement('span'); badge.className = 'eno-pw-badge'; badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4L19 7"/></svg>';
    host.appendChild(badge);
    var toggle = host.querySelector('button');
    var place = function () { badge.style.right = toggle ? ((toggle.offsetWidth || 92) + 10) + 'px' : '14px'; };
    if (toggle && opts.eyeToggle !== false) {
      toggle.classList.add('eno-pw-eye');
      var paint = function () { var shown = input.type === 'text'; toggle.innerHTML = (shown ? EYE_OFF : EYE) + '<span>' + (shown ? 'Ocultar' : 'Mostrar') + '</span>'; toggle.setAttribute('aria-label', shown ? 'Ocultar senha' : 'Mostrar senha'); toggle.setAttribute('aria-pressed', String(shown)); };
      paint();
      toggle.addEventListener('click', function () { setTimeout(function () { paint(); place(); }, 0); });
    }
    place();
    if (window.ResizeObserver && toggle) new ResizeObserver(place).observe(toggle);

    var box = document.createElement('div');
    box.className = 'eno-pw'; box.setAttribute('data-level', '0');
    box.id = (input.id || 'pw') + '-forca';
    box.innerHTML =
      '<div class="eno-pw-meter" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="eno-pw-label">' + LABELS[0] + '</span></div>' +
      '<ul class="eno-pw-rules" aria-label="Requisitos da senha">' +
        '<li data-r="len"><span class="dot"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.2 4.7-5"/></svg></span>8 caracteres ou mais</li>' +
        '<li data-r="mix"><span class="dot"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.2 4.7-5"/></svg></span>Letras e números</li>' +
        '<li data-r="extra"><span class="dot"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.2 4.7-5"/></svg></span>Uma maiúscula ou símbolo</li>' +
        '<li data-r="own"><span class="dot"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.2 4.7-5"/></svg></span>Sem seu nome, e-mail ou sequência</li>' +
      '</ul>' +
      '<p class="eno-pw-caps" hidden>⇪ Caps Lock está ligado</p>' +
      '<p class="eno-sr-only" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"></p>';
    var hintAfter = opts.after || host;
    hintAfter.parentNode.insertBefore(box, hintAfter.nextSibling);
    if (opts.replaceHint) opts.replaceHint.hidden = true;
    var desc = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    desc.push(box.id); input.setAttribute('aria-describedby', desc.join(' '));

    var bars = box.querySelectorAll('.eno-pw-meter i');
    var label = box.querySelector('.eno-pw-label');
    var sr = box.querySelector('[aria-live]');
    var caps = box.querySelector('.eno-pw-caps');
    var lastLevel = -1, srTimer = null, state = assess('', []);
    function update(showNeeds) {
      state = assess(input.value, getUser());
      Array.prototype.forEach.call(bars, function (b, i) { b.classList.toggle('on', i < state.level); });
      box.setAttribute('data-level', String(state.level));
      label.textContent = state.level ? LABELS[state.level] : LABELS[0];
      Object.keys(state.rules).forEach(function (k) {
        var li = box.querySelector('[data-r="' + k + '"]');
        var ok = input.value.length > 0 && state.rules[k];
        li.classList.toggle('ok', ok);
        li.classList.toggle('need', !!showNeeds && !ok && (k === 'len' || k === 'own'));
      });
      host.classList.toggle('is-valid', state.valid && state.level >= 2);
      input.classList.toggle('eno-pw-valid', state.valid && state.level >= 2);
      if (state.level !== lastLevel) {
        lastLevel = state.level; clearTimeout(srTimer);
        srTimer = setTimeout(function () { sr.textContent = input.value ? 'Força da senha: ' + LABELS[state.level] + (state.valid ? '' : '. Ainda não atende aos requisitos.') : ''; }, 700);
      }
      return state;
    }
    input.addEventListener('input', function () { update(false); });
    input.addEventListener('keyup', function (e) { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); });
    input.addEventListener('blur', function () { caps.hidden = true; });
    update(false);
    var api = { check: function () { return update(true); }, get valid() { return state.valid; }, refresh: function () { return update(false); } };
    input.__enoPw = api;
    return api;
  }

  window.EnoFeedback = { toast: toast, undo: undo, done: done, flash: flash, password: password, assessPassword: assess };
})();
