/* Enomera · Gestos (24 nov 2026). Um arquivo, igual em todos os produtos; só a cor muda (--eg-c).
   Completa o "deslize para confirmar" (eno-slide.js) com mais três peças:

   1. EnoHaptic: vibração curta em cada marco do gesto. Android usa navigator.vibrate. No iPhone,
      o Safari 17.4 a 26.4 dá um toque háptico ao alternar <input type="checkbox" switch>; usamos
      um interruptor escondido para isso (a Apple fechou essa porta no iOS 26.5; lá não vibra e nada quebra).

   2. Segurar para confirmar: <button data-hold="Segure para encerrar"> (opcional data-hold-ms).
      O botão continua o mesmo; apertar e segurar enche o botão da esquerda para a direita;
      soltar antes do fim esvazia com mola e mostra a dica; ao completar, vibra e dispara o clique
      normal do botão (o código de cada produto não muda). Teclado: segurar Enter ou Espaço.
      Leitor de tela (clique sem aperto) passa direto, para não prender quem não consegue segurar.
      Uso: ações frequentes que fecham algo de vez (concluir registro, encerrar sessões).

   3. Arrastar o item na lista (só toque): no item, data-swipe-r="Confirmar" + data-swipe-r-click="seletor"
      (e/ou data-swipe-l / data-swipe-l-click; tom em data-swipe-r-tone / -l-tone: ok, warn, danger, accent).
      O conteúdo acompanha o dedo, uma pílula colorida cresce da borda com o nome da ação; passou do
      ponto, a pílula acende e vibra; soltar ali desliza o item e clica o botão indicado (que segue
      visível: o gesto é atalho, nunca o único caminho). Antes do ponto, volta com mola.
      Na primeira vez em cada aparelho, o primeiro item "espia" 28 px para ensinar o gesto.
      Uso: triagem em lista (confirmar pedido, aceitar remarcação, arquivar, remover).

   Movimento reduzido: sem mola nem espiada; o gesto continua funcionando. */
(function () {
  if (window.EnoGestures) return;
  var reduce = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; };

  /* ---------------------------------------------------------------- Háptico */
  var iosSwitch = null;
  function iosTap() {
    try {
      if (!iosSwitch) {
        var label = document.createElement('label');
        label.setAttribute('aria-hidden', 'true');
        label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
        var input = document.createElement('input');
        input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
        label.appendChild(input); document.body.appendChild(label); iosSwitch = label;
      }
      iosSwitch.click();
    } catch (e) {}
  }
  var canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function buzz(pattern, taps) {
    if (canVibrate) { try { navigator.vibrate(pattern); } catch (e) {} return; }
    if (isIOS) { iosTap(); if (taps > 1) setTimeout(iosTap, 90); }
  }
  var EnoHaptic = {
    tick: function () { buzz(8, 1); },
    success: function () { buzz([12, 40, 18], 2); },
    error: function () { buzz([30, 50, 30], 2); },
  };

  /* Mola criticamente amortecida, usada nas voltas. */
  var SPRING = 'linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 20.4%, 1.041 24.6%, 1.035 28.5%, 1.004 38.3%, .997 46.7%, 1)';
  function springTween(from, to, dur, onFrame, done) {
    if (reduce() || from === to) { onFrame(to); if (done) done(); return function () {}; }
    var t0 = performance.now(), raf = 0, stop = false;
    // Curva de mola sub-amortecida simples (um leve passar e voltar), 60 qps.
    function ease(p) { return 1 - Math.exp(-6.5 * p) * Math.cos(7.5 * p); }
    function step(now) {
      if (stop) return;
      var p = Math.min(1, (now - t0) / dur);
      onFrame(p >= 1 ? to : from + (to - from) * ease(p));
      if (p < 1) raf = requestAnimationFrame(step); else if (done) done();
    }
    raf = requestAnimationFrame(step);
    return function () { stop = true; cancelAnimationFrame(raf); };
  }
  function outTween(from, to, dur, onFrame, done) {
    if (reduce()) { onFrame(to); if (done) done(); return; }
    var t0 = performance.now();
    function ease(p) { return 1 - Math.pow(1 - p, 3); }
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      onFrame(from + (to - from) * ease(p));
      if (p < 1) requestAnimationFrame(step); else if (done) done();
    })(t0);
  }

  /* ---------------------------------------------------------------- Dica em vidro */
  var tipEl = null, tipTimer = 0;
  function tip(anchor, text) {
    if (!text) return;
    if (!tipEl) {
      tipEl = document.createElement('div'); tipEl.className = 'eg-tip'; tipEl.setAttribute('role', 'status');
      document.body.appendChild(tipEl);
    }
    var r = anchor.getBoundingClientRect();
    tipEl.textContent = text;
    tipEl.style.left = Math.round(r.left + r.width / 2) + 'px';
    tipEl.style.top = Math.round(r.top - 10) + 'px';
    tipEl.classList.remove('is-on'); void tipEl.offsetWidth; tipEl.classList.add('is-on');
    clearTimeout(tipTimer); tipTimer = setTimeout(function () { tipEl && tipEl.classList.remove('is-on'); }, 1600);
  }

  /* ---------------------------------------------------------------- Segurar para confirmar */
  function attachHold(btn) {
    if (btn.__eh) return; btn.__eh = true;
    btn.setAttribute('data-eh', '');
    var fill = document.createElement('span'); fill.className = 'eh-fill'; fill.setAttribute('aria-hidden', 'true');
    btn.insertBefore(fill, btn.firstChild);
    var hint = btn.getAttribute('data-hold') || 'Segure para confirmar';
    if (!btn.hasAttribute('aria-description')) btn.setAttribute('aria-description', hint + '.');
    var anim = null, pressed = false, allow = false, armedByPress = false, startedAt = 0;

    function ms() { return Math.max(300, Number(btn.getAttribute('data-hold-ms')) || 800); }
    function start() {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || pressed) return;
      pressed = true; armedByPress = true; startedAt = performance.now();
      btn.setAttribute('data-eh-holding', '');
      EnoHaptic.tick();
      if (anim) anim.cancel();
      if (reduce()) { anim = null; startedAt = performance.now(); setTimeout(function () { if (pressed) finish(); }, ms()); return; }
      anim = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms(), easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
      anim.onfinish = function () { if (pressed) finish(); };
    }
    function cancel(showTip) {
      if (!pressed) return;
      pressed = false; btn.removeAttribute('data-eh-holding');
      var held = performance.now() - startedAt;
      if (anim) {
        var cur = anim.effect && anim.effect.getComputedTiming ? (anim.effect.getComputedTiming().progress || 0) : 0;
        anim.cancel();
        anim = reduce() ? null : fill.animate([{ transform: 'scaleX(' + cur + ')' }, { transform: 'scaleX(0)' }], { duration: 520, easing: SPRING });
      }
      if (showTip || held < ms()) {
        tip(btn, hint);
        if (!reduce()) btn.animate([{ translate: '0 0' }, { translate: '-3px 0' }, { translate: '3px 0' }, { translate: '0 0' }], { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' });
      }
    }
    // O clique nativo que vem logo depois de soltar nunca passa (nem depois de completar).
    function released() { setTimeout(function () { armedByPress = false; }, 0); }
    function finish() {
      pressed = false; btn.removeAttribute('data-eh-holding'); btn.setAttribute('data-eh-held', '');
      EnoHaptic.success();
      if (!reduce()) btn.animate([{ scale: '1' }, { scale: '1.03' }, { scale: '1' }], { duration: 360, easing: SPRING });
      allow = true;
      try { btn.click(); } finally { allow = false; }
      setTimeout(function () {
        btn.removeAttribute('data-eh-held');
        if (anim) { anim.cancel(); anim = null; }
      }, 420);
    }

    btn.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      try { btn.setPointerCapture(e.pointerId); } catch (x) {}
      start();
    });
    btn.addEventListener('pointerup', function () { cancel(false); released(); });
    btn.addEventListener('pointercancel', function () { cancel(false); released(); });
    btn.addEventListener('lostpointercapture', function () { cancel(false); });
    btn.addEventListener('contextmenu', function (e) { if (pressed) e.preventDefault(); });
    btn.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); }
      else if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
    });
    btn.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cancel(false); released(); } });
    // O clique só passa ao completar o gesto, ou quando vem de leitor de tela (sem aperto nenhum).
    btn.addEventListener('click', function (e) {
      if (allow) return;
      if (armedByPress || pressed) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    }, true);
  }

  /* ---------------------------------------------------------------- Arrastar o item */
  var HINT_KEY = 'eno-swipe-hint';
  var hinted = false;
  function attachSwipe(row) {
    if (row.__esw) return; row.__esw = true;
    row.setAttribute('data-esw', ''); row.style.touchAction = 'pan-y';
    var pill = null, x = 0, startX = 0, startY = 0, mode = '', pid = null, armed = false, stopTween = null, swallowClick = false, w = 0;
    function side(s) {
      var label = row.getAttribute('data-swipe-' + s);
      if (!label) return null;
      return { label: label, click: row.getAttribute('data-swipe-' + s + '-click'), tone: row.getAttribute('data-swipe-' + s + '-tone') || (s === 'r' ? 'ok' : 'danger') };
    }
    function threshold() { return Math.min(140, Math.max(84, w * 0.34)); }
    function paint(v) {
      x = v;
      var s = v > 0 ? side('r') : v < 0 ? side('l') : null;
      if (v && !row.hasAttribute('data-esw-on')) row.setAttribute('data-esw-on', '');
      row.style.setProperty('--esw-x', v + 'px');
      row.style.setProperty('--esw-w', Math.abs(v) + 'px');
      row.dataset.swipeDir = v > 0 ? 'r' : v < 0 ? 'l' : '';
      if (s) {
        if (!pill || !pill.isConnected) {
          pill = document.createElement('span'); pill.className = 'esw-pill'; pill.setAttribute('aria-hidden', 'true');
          pill.innerHTML = '<span class="esw-ico"></span><span class="esw-txt"></span>';
          row.appendChild(pill);
        }
        pill.dataset.dir = v > 0 ? 'r' : 'l'; pill.dataset.tone = s.tone;
        pill.lastChild.textContent = s.label;
        pill.style.setProperty('--esw-p', String(Math.min(1, Math.abs(v) / threshold())));
      }
    }
    function dropPill() { if (pill && pill.parentNode) pill.parentNode.removeChild(pill); pill = null; row.style.removeProperty('--esw-x'); row.style.removeProperty('--esw-w'); }
    function setArmed(on) {
      if (on === armed) return;
      armed = on; if (on) row.setAttribute('data-esw-armed', ''); else row.removeAttribute('data-esw-armed');
      if (on) EnoHaptic.tick();
    }
    function settle() {
      row.removeAttribute('data-esw-drag');
      if (stopTween) stopTween();
      stopTween = springTween(x, 0, 560, paint, function () { row.removeAttribute('data-esw-on'); setArmed(false); dropPill(); });
    }
    function commit() {
      var s = side(x > 0 ? 'r' : 'l');
      var target = s && s.click ? row.querySelector(s.click) : null;
      if (!target || target.disabled) { settle(); return; }
      row.removeAttribute('data-esw-drag');
      var to = (x > 0 ? 1 : -1) * w;
      EnoHaptic.success();
      outTween(x, to, 200, paint, function () {
        try { target.click(); } catch (e) {}
        // Se o item continuar na tela (ação com Desfazer, erro ou só mudou de estado), volta para o lugar.
        setTimeout(function () {
          if (!row.isConnected) return;
          
          stopTween = springTween(x, 0, 620, paint, function () { row.removeAttribute('data-esw-on'); setArmed(false); dropPill(); });
        }, 260);
      });
    }

    row.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], .es, [data-swipe-ignore]')) return;
      if (stopTween) stopTween();
      mode = 'wait'; pid = e.pointerId; startX = e.clientX - x; startY = e.clientY; w = row.clientWidth || 320;
    });
    row.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid || !mode) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (mode === 'wait') {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { mode = ''; return; }
        if (Math.abs(dx) < 10) return;
        if ((dx > 0 && !side('r')) || (dx < 0 && !side('l'))) { mode = ''; return; }
        mode = 'drag'; swallowClick = true;
        try { row.setPointerCapture(pid); } catch (x2) {}
        row.setAttribute('data-esw-on', ''); row.setAttribute('data-esw-drag', '');
      }
      if (mode !== 'drag') return;
      e.preventDefault();
      var allowed = dx > 0 ? side('r') : side('l');
      var v = allowed ? dx : dx * 0.12;
      var lim = w * 0.92;
      if (Math.abs(v) > lim) v = Math.sign(v) * (lim + (Math.abs(v) - lim) * 0.15);
      paint(v);
      setArmed(Boolean(allowed) && Math.abs(v) >= threshold());
    });
    function end(e) {
      if (e.pointerId !== pid) return;
      var was = mode; mode = ''; pid = null;
      if (was !== 'drag') return;
      if (armed) commit(); else settle();
      setTimeout(function () { swallowClick = false; }, 60);
    }
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
    row.addEventListener('click', function (e) { if (swallowClick) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

    // Espiada: só uma vez por aparelho, no primeiro item com gesto que aparecer na tela.
    if (!hinted && matchMedia('(pointer: coarse)').matches && !reduce()) {
      var seen = 0; try { seen = Number(localStorage.getItem(HINT_KEY)) || 0; } catch (e) {}
      if (seen < 1) {
        hinted = true;
        var io = new IntersectionObserver(function (entries) {
          if (!entries[0].isIntersecting) return;
          io.disconnect();
          setTimeout(function () {
            if (!row.isConnected || mode) return;
            w = row.clientWidth || 320;
            var dir = side('r') ? 1 : -1;
            row.setAttribute('data-esw-on', '');
            var peekDone = function () { if (!mode) { row.removeAttribute('data-esw-on'); dropPill(); } };
            outTween(0, 28 * dir, 260, function (v) { if (!mode) paint(v); }, function () {
              setTimeout(function () { if (mode) return; stopTween = springTween(x, 0, 620, function (v) { if (!mode) paint(v); }, peekDone); }, 380);
            });
            try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
          }, 700);
        }, { threshold: 0.9 });
        io.observe(row);
      }
    }
  }

  /* ---------------------------------------------------------------- Ligar sozinho */
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('[data-hold]')) attachHold(root);
    if (root.matches && root.matches('[data-swipe-r],[data-swipe-l]')) attachSwipe(root);
    root.querySelectorAll('[data-hold]').forEach(attachHold);
    root.querySelectorAll('[data-swipe-r],[data-swipe-l]').forEach(attachSwipe);
  }
  function boot() {
    scan(document.body);
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        for (var j = 0; j < m.addedNodes.length; j++) if (m.addedNodes[j].nodeType === 1) scan(m.addedNodes[j]);
        if (m.type === 'attributes' && m.target.nodeType === 1) scan(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hold', 'data-swipe-r', 'data-swipe-l'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.EnoHaptic = EnoHaptic;
  window.EnoGestures = { hold: attachHold, swipe: attachSwipe, haptic: EnoHaptic };
})();
