/* Enomera · Deslize para confirmar (23 nov 2026). Para decisões que merecem um gesto:
   ativar o teste, abrir a agenda. Vidro tingido pela cor do produto (--eg-c).

   const s = EnoSlide.mount(host, { label: 'Deslize para ativar', busyLabel: 'Ativando…', doneLabel: 'Ativado',
     onConfirm: async () => true|false, state: 'idle'|'busy'|'done' });

   Motion: o rótulo tem um brilho que corre (convite ao gesto); a alça segue o dedo 1:1 e o trilho
   preenche atrás dela; o rótulo some conforme avança; soltar antes de 85% volta com mola; passar
   de 85% completa sozinho, a seta vira carregando e depois um ✓ desenhado, com vibração curta.
   Falha: volta com mola e o trilho treme. Teclado: Enter ou Espaço completa o gesto (com a mesma animação). */
(function () {
  if (window.EnoSlide) return;
  var SPRING = 'linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 20.4%, 1.041 24.6%, 1.035 28.5%, 1.004 38.3%, .997 46.7%, 1)';
  var reduce = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var ARROW = '<svg class="es-ico es-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
  var CHECK = '<svg class="es-ico es-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  var SPIN = '<span class="es-spin" aria-hidden="true"></span>';

  function mount(host, opts) {
    opts = opts || {};
    host.classList.add('es');
    host.setAttribute('data-m-skip', '');
    host.innerHTML = '<span class="es-fill" aria-hidden="true"></span>' +
      '<span class="es-label"><span class="es-text"></span></span>' +
      '<button type="button" class="es-knob">' + ARROW + SPIN + CHECK + '</button>';
    var fill = host.querySelector('.es-fill');
    var label = host.querySelector('.es-label');
    var text = host.querySelector('.es-text');
    var knob = host.querySelector('.es-knob');
    var state = 'idle', x = 0, max = 0, startX = 0, dragging = false, moved = false;
    knob.setAttribute('aria-label', (opts.label || 'Deslize para confirmar') + '. Ou pressione Enter.');

    function measure() { max = Math.max(0, host.clientWidth - knob.offsetWidth - 8); }
    function paint() {
      var p = max ? x / max : 0;
      knob.style.transform = 'translateX(' + x + 'px)';
      fill.style.width = (x + knob.offsetWidth + 8) + 'px';
      if (state !== 'idle') { label.style.opacity = '1'; label.style.transform = 'none'; return; }
      label.style.opacity = String(Math.max(0, 1 - p * 1.6));
      label.style.transform = 'translateX(' + (p * 18) + 'px)';
    }
    function setState(s) {
      state = s; host.dataset.state = s;
      text.textContent = s === 'busy' ? (opts.busyLabel || 'Confirmando…') : s === 'done' ? (opts.doneLabel || 'Pronto') : (opts.label || 'Deslize para confirmar');
      knob.disabled = s !== 'idle';
      if (s !== 'idle') { measure(); x = max; paint(); label.style.opacity = '1'; label.style.transform = 'none'; }
      host.setAttribute('aria-busy', s === 'busy' ? 'true' : 'false');
    }
    function animateTo(to, easing, dur) {
      var from = x; x = to;
      if (reduce()) { paint(); return Promise.resolve(); }
      knob.style.transition = 'none'; fill.style.transition = 'none';
      var kf = knob.animate([{ transform: 'translateX(' + from + 'px)' }, { transform: 'translateX(' + to + 'px)' }], { duration: dur, easing: easing });
      fill.animate([{ width: (from + knob.offsetWidth + 8) + 'px' }, { width: (to + knob.offsetWidth + 8) + 'px' }], { duration: dur, easing: easing });
      paint();
      return kf.finished.catch(function () {});
    }
    async function complete() {
      measure();
      await animateTo(max, 'cubic-bezier(.23,1,.32,1)', 220);
      setState('busy');
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
      var ok = true;
      try { ok = opts.onConfirm ? (await opts.onConfirm()) !== false : true; } catch (e) { ok = false; }
      if (!host.isConnected) return;
      if (ok) {
        setState('done');
        try { if (navigator.vibrate) navigator.vibrate([12, 40, 18]); } catch (e) {}
        if (!reduce()) host.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 360, easing: SPRING });
      } else {
        state = 'idle'; host.dataset.state = 'idle'; knob.disabled = false; text.textContent = opts.label || 'Deslize para confirmar';
        host.setAttribute('aria-busy', 'false');
        await animateTo(0, SPRING, 620);
        if (!reduce()) host.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 360, easing: 'cubic-bezier(.23,1,.32,1)' });
      }
    }

    knob.addEventListener('pointerdown', function (e) {
      if (state !== 'idle') return;
      measure(); dragging = true; startX = e.clientX - x;
      knob.setPointerCapture(e.pointerId); host.classList.add('is-drag');
    });
    knob.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      // Resistência elástica além do fim do trilho, como no iOS.
      var raw = e.clientX - startX;
      if (Math.abs(raw - x) > 2) moved = true;
      x = raw < 0 ? raw * 0.15 : raw > max ? max + (raw - max) * 0.15 : raw;
      paint();
    });
    function release() {
      if (!dragging) return;
      dragging = false; host.classList.remove('is-drag');
      if (x >= max * 0.85) complete();
      else animateTo(0, SPRING, 620);
    }
    knob.addEventListener('pointerup', release);
    knob.addEventListener('pointercancel', release);
    knob.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && state === 'idle') { e.preventDefault(); complete(); }
    });
    // Toque rápido na alça: mostra o caminho (puxa um pouco e volta) em vez de não fazer nada.
    knob.addEventListener('click', function () {
      if (moved) { moved = false; return; }
      if (state !== 'idle' || x > 4 || reduce()) return;
      measure();
      knob.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + Math.min(48, max * 0.2) + 'px)' }, { transform: 'translateX(0)' }], { duration: 560, easing: SPRING });
    });
    window.addEventListener('resize', function () { measure(); if (state !== 'idle') x = max; paint(); });

    setState(opts.state || 'idle');
    requestAnimationFrame(function () { measure(); if (state === 'idle') { x = 0; } paint(); });
    return { setState: setState, complete: complete };
  }

  window.EnoSlide = { mount: mount };
})();
