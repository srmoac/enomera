/* Enomera · Calendário próprio em vidro (23 nov 2026). Substitui o <input type="date|datetime-local">
   nativo em todos os produtos. Sem dependências. Cor do produto em --eg-c (eno-glass-ui.css).

   const cal = EnoCalendar.mount(el, { mode: 'single' | 'range', value: { start: 'AAAA-MM-DD', end }, min: 'AAAA-MM-DD', onChange(v) {} });
   cal.get() → { start, end }   cal.set({ start, end })

   Motion: troca de mês desliza na direção do gesto (sai 160 ms, entra 320 ms, ease-out); dia escolhido
   ganha um "pop"; intervalo pinta a faixa entre início e fim. Arrastar para os lados troca o mês.
   Teclado: setas movem o foco entre dias, PageUp/PageDown trocam o mês, Enter/Espaço escolhem. */
(function () {
  if (window.EnoCalendar) return;
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var WD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  var WD_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var reduce = function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var iso = function (y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); };
  var todayIso = function () { var t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
  var parse = function (s) { var p = String(s || '').split('-'); return p.length === 3 ? { y: +p[0], m: +p[1] - 1, d: +p[2] } : null; };

  function label(v) {
    var p = parse(v); if (!p) return '';
    var dt = new Date(p.y, p.m, p.d, 12);
    return WD_FULL[dt.getDay()] + ', ' + p.d + ' de ' + MONTHS[p.m];
  }

  function mount(el, opts) {
    opts = opts || {};
    var mode = opts.mode === 'range' ? 'range' : 'single';
    var st = { start: (opts.value && opts.value.start) || '', end: (opts.value && opts.value.end) || '', min: opts.min || todayIso() };
    var base = parse(st.start) || parse(todayIso());
    var view = { y: base.y, m: base.m };
    var focusIso = st.start || todayIso();
    var picking = 'start';

    el.classList.add('ecal');
    el.innerHTML =
      '<div class="ecal-head"><button type="button" class="ecal-nav" data-nav="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<div class="ecal-title" aria-live="polite"></div>' +
      '<button type="button" class="ecal-nav" data-nav="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>' +
      '<div class="ecal-wd" aria-hidden="true">' + WD.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>' +
      '<div class="ecal-stage"><div class="ecal-grid" role="grid"></div></div>';
    var titleEl = el.querySelector('.ecal-title');
    var stage = el.querySelector('.ecal-stage');

    function gridHtml() {
      var first = new Date(view.y, view.m, 1).getDay();
      var days = new Date(view.y, view.m + 1, 0).getDate();
      var out = [];
      for (var i = 0; i < first; i++) out.push('<span class="ecal-pad"></span>');
      var today = todayIso();
      for (var d = 1; d <= days; d++) {
        var v = iso(view.y, view.m, d);
        var dis = v < st.min;
        var sel = v === st.start || (mode === 'range' && v === st.end);
        var inRange = mode === 'range' && st.start && st.end && v > st.start && v < st.end;
        var cls = 'ecal-day' + (v === today ? ' is-today' : '') + (sel ? ' is-sel' : '') + (inRange ? ' is-in' : '') +
          (mode === 'range' && st.end && st.end !== st.start && v === st.start ? ' is-from' : '') +
          (mode === 'range' && st.end && st.end !== st.start && v === st.end ? ' is-to' : '');
        out.push('<button type="button" role="gridcell" class="' + cls + '" data-d="' + v + '"' + (dis ? ' disabled' : '') +
          ' aria-selected="' + (sel || inRange) + '" aria-label="' + label(v) + '" tabindex="' + (v === focusIso ? '0' : '-1') + '"><span>' + d + '</span></button>');
      }
      return out.join('');
    }

    function paintTitle() { var n = MONTHS[view.m]; titleEl.textContent = n.charAt(0).toUpperCase() + n.slice(1) + ' de ' + view.y; }

    function renderGrid(dir) {
      paintTitle();
      var old = stage.querySelector('.ecal-grid');
      var next = document.createElement('div');
      next.className = 'ecal-grid'; next.setAttribute('role', 'grid');
      next.innerHTML = gridHtml();
      if (!dir || reduce()) { stage.replaceChild(next, old); return; }
      var h0 = stage.offsetHeight;
      old.classList.add(dir > 0 ? 'out-l' : 'out-r');
      old.setAttribute('aria-hidden', 'true');
      next.classList.add(dir > 0 ? 'in-r' : 'in-l');
      stage.appendChild(next);
      var h1 = next.offsetHeight;
      if (h0 !== h1) stage.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' });
      setTimeout(function () { old.remove(); next.classList.remove('in-r', 'in-l'); }, 330);
    }

    // Repinta só as classes dos dias (sem trocar o DOM), para o "pop" e a faixa animarem.
    function repaint() {
      stage.querySelectorAll('.ecal-grid:last-child .ecal-day').forEach(function (b) {
        var v = b.dataset.d;
        var sel = v === st.start || (mode === 'range' && v === st.end);
        var inRange = mode === 'range' && st.start && st.end && v > st.start && v < st.end;
        var span = mode === 'range' && st.end && st.end !== st.start;
        var was = b.classList.contains('is-sel');
        b.classList.toggle('is-sel', sel);
        b.classList.toggle('is-in', Boolean(inRange));
        b.classList.toggle('is-from', Boolean(span && v === st.start));
        b.classList.toggle('is-to', Boolean(span && v === st.end));
        b.setAttribute('aria-selected', String(sel || Boolean(inRange)));
        if (sel && !was && !reduce()) b.animate([{ transform: 'scale(.82)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.23,1,.32,1)' });
      });
    }

    function choose(v) {
      if (mode === 'single') { st.start = v; st.end = v; }
      else if (picking === 'start' || !st.start || v < st.start) { st.start = v; st.end = v; picking = 'end'; }
      else { st.end = v; picking = 'start'; }
      focusIso = v;
      repaint();
      if (opts.onChange) opts.onChange({ start: st.start, end: st.end || st.start });
    }

    function go(dir) {
      view.m += dir;
      if (view.m < 0) { view.m = 11; view.y--; }
      if (view.m > 11) { view.m = 0; view.y++; }
      renderGrid(dir);
    }

    el.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (nav) { go(Number(nav.dataset.nav)); return; }
      var day = e.target.closest('.ecal-day');
      if (day && !day.disabled && !swiped) choose(day.dataset.d);
      swiped = false;
    });
    el.addEventListener('keydown', function (e) {
      var day = e.target.closest('.ecal-day');
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); go(e.key === 'PageUp' ? -1 : 1); return; }
      if (!day) return;
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      var p = parse(day.dataset.d);
      var dt = new Date(p.y, p.m, p.d + step, 12);
      var v = iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
      focusIso = v;
      if (dt.getMonth() !== view.m || dt.getFullYear() !== view.y) { view.y = dt.getFullYear(); view.m = dt.getMonth(); renderGrid(step > 0 ? 1 : -1); }
      var t = stage.querySelector('.ecal-grid:last-child [data-d="' + v + '"]');
      if (t) { stage.querySelectorAll('.ecal-day[tabindex="0"]').forEach(function (x) { x.tabIndex = -1; }); t.tabIndex = 0; t.focus(); }
    });
    // Arrastar para o lado troca o mês, como virar a página.
    var sx = null, sy = null, swiped = false;
    stage.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', function (e) {
      if (sx == null) return;
      var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { swiped = true; go(dx < 0 ? 1 : -1); }
    });

    renderGrid(0);
    return {
      get: function () { return { start: st.start, end: st.end || st.start }; },
      set: function (v) { st.start = (v && v.start) || ''; st.end = (v && v.end) || st.start; picking = 'start'; var p = parse(st.start); if (p && (p.y !== view.y || p.m !== view.m)) { view.y = p.y; view.m = p.m; renderGrid(0); } else repaint(); },
    };
  }

  window.EnoCalendar = { mount: mount, label: label, today: todayIso };
})();
