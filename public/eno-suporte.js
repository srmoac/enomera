/* Enomera · chat de ajuda (28 nov 2026). Sem dependências e sem custo: responde no navegador,
   a partir de /eno-suporte-base.json (perguntas e respostas escritas pela Enomera).
   Quando não sabe responder, anota a pergunta (para a base melhorar) e oferece falar com uma pessoa:
   WhatsApp com a pergunta já escrita, ou mensagem por e-mail (POST /api/v1/suporte/chamados).

   Uso: <link rel="stylesheet" href="/eno-suporte.css"> e <script src="/eno-suporte.js" defer></script>
   Opções no próprio <script>: data-api="https://enomera.vercel.app" (quando o produto está em outro endereço),
   data-base="/eno-suporte-base.json", data-oculto (não mostra o botão; abrir com EnoSuporte.open()).
   API: window.EnoSuporte.open(pergunta?) · .close() · .buscar(texto) → { item, score, parecidas } */
(function () {
  if (window.EnoSuporte) return;
  var script = document.currentScript;
  var cfg = {
    api: (script && script.getAttribute('data-api')) || '',
    base: (script && script.getAttribute('data-base')) || '/eno-suporte-base.json',
    oculto: Boolean(script && script.hasAttribute('data-oculto'))
  };
  var reduce = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var EASE = 'cubic-bezier(.23,1,.32,1)';
  var KEY = 'eno-suporte-conversa';

  /* ---------------- Busca na base ---------------- */
  var STOP = ('a o as os um uma uns umas de da do das dos em no na nos nas por para pra pro com sem que se e ou mas ' +
    'eu voce voces vc ele ela nos meu minha meus minhas seu sua seus suas me te lhe isso isto esse essa este esta ' +
    'como qual quais quando onde porque pq ja nao sim tem ter ser estar esta estou sou foi vai fazer faz posso pode ' +
    'quero queria gostaria saber preciso ajuda oi ola bom boa dia tarde noite obrigado obrigada favor ai la aqui ' +
    'muito mais menos so tambem the do da enomera').split(' ');
  var STOPSET = {}; STOP.forEach(function (w) { STOPSET[w] = 1; });
  STOPSET.enomera = 0; // "o que é a enomera" precisa da palavra

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function stem(w) {
    if (w.length > 4 && /oes$/.test(w)) return w.slice(0, -3) + 'ao';
    if (w.length > 4 && /aes$/.test(w)) return w.slice(0, -3) + 'ao';
    if (w.length > 3 && /s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function tokens(s, keepStop) {
    return norm(s).split(' ').filter(function (w) { return w && (keepStop || !STOPSET[w]) && w.length > 1; }).map(stem);
  }

  var base = null, index = null, loading = null;
  function loadBase() {
    if (base) return Promise.resolve(base);
    if (loading) return loading;
    loading = fetch(cfg.base, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('base ' + r.status);
      return r.json();
    }).then(function (b) { base = b; buildIndex(); return b; })
      .catch(function (e) { loading = null; throw e; });
    return loading;
  }
  function buildIndex() {
    var df = {};
    index = base.respostas.map(function (item) {
      var w = {};
      item.perguntas.forEach(function (q) { tokens(q).forEach(function (t) { w[t] = Math.max(w[t] || 0, 1); }); });
      (item.palavras || []).forEach(function (p) { tokens(p).forEach(function (t) { w[t] = Math.max(w[t] || 0, 1.5); }); });
      tokens(item.titulo).forEach(function (t) { w[t] = Math.max(w[t] || 0, 1); });
      Object.keys(w).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      return { item: item, w: w, frases: item.perguntas.map(function (q) { return norm(q); }) };
    });
    var n = index.length;
    index.forEach(function (e) {
      e.idf = {};
      Object.keys(e.w).forEach(function (t) { e.idf[t] = Math.log(1 + n / df[t]); });
    });
  }
  function matchToken(e, t) {
    if (e.w[t]) return e.w[t] * e.idf[t];
    if (t.length >= 5) { // "cancelamento" ≈ "cancelar", "agendar" ≈ "agendamento"
      var pre = t.slice(0, 5), best = 0;
      Object.keys(e.w).forEach(function (k) { if (k.length >= 5 && k.slice(0, 5) === pre) best = Math.max(best, e.w[k] * e.idf[k] * 0.7); });
      return best;
    }
    return 0;
  }
  function buscar(texto) {
    if (!index) return { item: null, score: 0, parecidas: [] };
    var q = tokens(texto), nq = norm(texto);
    if (!q.length) return { item: null, score: 0, parecidas: [] };
    var scored = index.map(function (e) {
      var s = 0, hits = 0;
      q.forEach(function (t) { var v = matchToken(e, t); if (v) { s += v; hits++; } });
      s = s / Math.sqrt(q.length);
      e.frases.forEach(function (f) { if (f.length > 6 && (nq.indexOf(f) >= 0 || f.indexOf(nq) >= 0 && nq.length > 8)) s += 2.5; });
      return { e: e, s: s, hits: hits };
    }).sort(function (a, b) { return b.s - a.s; });
    // Prioridade: sinais de crise sempre vencem, mesmo com pontuação menor.
    var crise = scored.filter(function (x) { return x.e.item.prioridade && x.hits > 0; })[0];
    if (crise) return { item: crise.e.item, score: 99, parecidas: [] };
    var top = scored[0];
    var LIMIAR = 1.5;
    if (!top || top.s < LIMIAR) {
      return { item: null, score: top ? top.s : 0, parecidas: scored.filter(function (x) { return x.s >= 0.8; }).slice(0, 3).map(function (x) { return x.e.item; }) };
    }
    var parecidas = scored.slice(1).filter(function (x) { return x.s >= Math.max(LIMIAR, top.s * 0.6); }).slice(0, 2).map(function (x) { return x.e.item; });
    return { item: top.e.item, score: top.s, parecidas: parecidas };
  }

  /* ---------------- Interface ---------------- */
  var root, launcher, panel, list, input, form, lastFocus = null, open = false;
  var conversa = [];
  try { conversa = JSON.parse(sessionStorage.getItem(KEY) || '[]') || []; } catch (e) { conversa = []; }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(conversa.slice(-30))); } catch (e) { /* sem armazenamento */ } }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function icon(path, size) { return '<svg aria-hidden="true" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; }
  var IC = {
    chat: '<path d="M20 12.2c0 4-3.6 7.3-8 7.3-1.1 0-2.2-.2-3.1-.6L4.5 20l1.2-3.5C4.6 15.3 4 13.8 4 12.2 4 8.2 7.6 5 12 5s8 3.2 8 7.2Z"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
    wa: '<path d="M4.5 19.5l1.1-3.6A7.8 7.8 0 1 1 8.4 18.6Z"/><path d="M9.3 8.9c.2-.4.4-.4.7-.4h.4c.2 0 .3.1.4.3l.6 1.4c.1.2 0 .4-.1.5l-.4.5c.5.9 1.2 1.6 2.1 2.1l.5-.4c.1-.1.3-.2.5-.1l1.4.6c.2.1.3.2.3.4v.4c0 .3-.1.6-.4.7-.5.3-1.2.4-1.8.2a7 7 0 0 1-4.2-4.2c-.2-.6-.1-1.3.2-1.9Z"/>',
    mail: '<rect x="3.5" y="6" width="17" height="12" rx="2.5"/><path d="M4 7.5l8 5.5 8-5.5"/>',
    ok: '<path d="M5 12.5l4.2 4L19 7"/>',
    link: '<path d="M7 17L17 7M9 7h8v8"/>'
  };

  function build() {
    root = el('div', 'eno-sup');
    root.setAttribute('data-state', 'closed');
    launcher = el('button', 'eno-sup-launch', icon(IC.chat, 22) + '<span>Ajuda</span>');
    launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'eno-sup-panel');
    launcher.addEventListener('click', function () { toggle(); });
    if (cfg.oculto) launcher.hidden = true;

    panel = el('section', 'eno-sup-panel');
    panel.id = 'eno-sup-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'eno-sup-title');
    panel.hidden = true;
    panel.innerHTML =
      '<div class="eno-sup-grab" aria-hidden="true"></div>' +
      '<header class="eno-sup-head">' +
        '<span class="eno-sup-avatar" aria-hidden="true">' + icon(IC.chat, 18) + '</span>' +
        '<div><h2 id="eno-sup-title">Ajuda da Enomera</h2><p>Respostas na hora. Se precisar, uma pessoa continua.</p></div>' +
        '<button type="button" class="eno-sup-x" aria-label="Fechar a ajuda">' + icon(IC.close, 18) + '</button>' +
      '</header>' +
      '<div class="eno-sup-list" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<form class="eno-sup-compose" autocomplete="off">' +
        '<label class="eno-sup-sr" for="eno-sup-input">Escreva a sua dúvida</label>' +
        '<input id="eno-sup-input" type="text" maxlength="300" placeholder="Escreva a sua dúvida" enterkeyhint="send">' +
        '<button type="submit" class="eno-sup-send" aria-label="Enviar">' + icon(IC.send, 18) + '</button>' +
      '</form>';
    list = panel.querySelector('.eno-sup-list');
    input = panel.querySelector('#eno-sup-input');
    form = panel.querySelector('.eno-sup-compose');
    panel.querySelector('.eno-sup-x').addEventListener('click', function () { close(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var t = input.value.trim();
      if (!t) { input.focus(); return; }
      input.value = '';
      perguntar(t);
    });
    panel.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
    grabToClose(panel.querySelector('.eno-sup-grab'));

    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);
  }

  // Folha no celular: arrastar a alça para baixo fecha.
  function grabToClose(grab) {
    var y0 = null, dy = 0;
    grab.addEventListener('pointerdown', function (ev) { y0 = ev.clientY; dy = 0; grab.setPointerCapture(ev.pointerId); panel.style.transition = 'none'; });
    grab.addEventListener('pointermove', function (ev) {
      if (y0 == null) return;
      dy = Math.max(0, ev.clientY - y0);
      panel.style.transform = 'translateY(' + dy + 'px)';
    });
    function end() {
      if (y0 == null) return;
      y0 = null;
      panel.style.transition = '';
      if (dy > 90) { close(); } else if (dy > 0 && !reduce()) {
        panel.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' });
      }
      panel.style.transform = '';
    }
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  }

  function toggle() { if (open) close(); else openPanel(); }

  function openPanel(pergunta) {
    if (!root) build();
    if (open) { if (pergunta) perguntar(pergunta); return; }
    open = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    root.setAttribute('data-state', 'open');
    launcher.setAttribute('aria-expanded', 'true');
    if (!reduce()) {
      panel.animate([
        { opacity: 0, transform: 'translateY(12px) scale(.97)', filter: 'blur(8px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' }
      ], { duration: 320, easing: EASE });
    }
    if (!list.children.length) restore();
    loadBase().then(function () { if (!list.children.length) saudacao(); if (pergunta) perguntar(pergunta); })
      .catch(function () { if (!list.children.length) botMsg({ html: 'Não consegui carregar as respostas agora. Você pode falar direto com a gente:' }); handoff(''); });
    setTimeout(function () { if (window.matchMedia('(pointer: fine)').matches) input.focus(); else panel.querySelector('.eno-sup-x').focus(); }, 60);
  }

  function close() {
    if (!open) return;
    open = false;
    root.setAttribute('data-state', 'closed');
    launcher.setAttribute('aria-expanded', 'false');
    var done = function () { panel.hidden = true; panel.style.transform = ''; };
    if (reduce()) done();
    else panel.animate([{ opacity: 1, transform: getComputedStyle(panel).transform === 'none' ? 'none' : getComputedStyle(panel).transform }, { opacity: 0, transform: 'translateY(10px) scale(.98)' }], { duration: 200, easing: EASE }).onfinish = done;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* ok */ }
  }

  function scrollEnd() { list.scrollTo({ top: list.scrollHeight, behavior: reduce() ? 'auto' : 'smooth' }); }

  function enter(node, i) {
    list.appendChild(node);
    if (!reduce()) node.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: (i || 0) * 40, easing: EASE, fill: 'backwards' });
    scrollEnd();
    return node;
  }

  function personMsg(text, silent) {
    var n = el('div', 'eno-sup-msg eno-sup-me', esc(text));
    enter(n);
    if (!silent) { conversa.push({ de: 'pessoa', texto: text }); save(); }
  }
  function botMsg(o) {
    var n = el('div', 'eno-sup-msg eno-sup-bot', o.html);
    enter(n, o.i);
    return n;
  }
  function chips(items, label) {
    var wrap = el('div', 'eno-sup-chips');
    if (label) wrap.setAttribute('aria-label', label);
    items.forEach(function (it) {
      var b = el('button', 'eno-sup-chip', esc(it.titulo));
      b.type = 'button';
      b.addEventListener('click', function () { personMsg(it.titulo); responder(it, [], it.titulo); });
      wrap.appendChild(b);
    });
    return enter(wrap, 1);
  }

  function typing(ms) {
    var n = el('div', 'eno-sup-msg eno-sup-bot eno-sup-typing', '<i></i><i></i><i></i>');
    n.setAttribute('aria-label', 'Escrevendo');
    enter(n);
    return new Promise(function (res) { setTimeout(function () { n.remove(); res(); }, reduce() ? 0 : ms); });
  }

  function saudacao() {
    botMsg({ html: 'Oi! Sobre o que é a sua dúvida? Toque num assunto ou escreva com as suas palavras.' });
    var byId = {}; base.respostas.forEach(function (r) { byId[r.id] = r; });
    chips((base.sugestoes || []).map(function (id) { return byId[id]; }).filter(Boolean).concat([byId['falar-pessoa']]).filter(Boolean), 'Assuntos comuns');
  }

  function restore() {
    if (!conversa.length) return;
    var prev = conversa.slice(-8);
    prev.forEach(function (m) {
      if (m.de === 'pessoa') list.appendChild(el('div', 'eno-sup-msg eno-sup-me', esc(m.texto)));
      else list.appendChild(el('div', 'eno-sup-msg eno-sup-bot', esc(m.texto).replace(/\n/g, '<br>')));
    });
    list.appendChild(el('div', 'eno-sup-sep', '<span>Conversa anterior</span>'));
  }

  function textoHtml(t) {
    return esc(t).split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  function perguntar(t) {
    personMsg(t);
    loadBase().then(function () {
      var r = buscar(t);
      if (r.item) responder(r.item, r.parecidas, t);
      else naoSei(t, r.parecidas);
    }).catch(function () { naoSei(t, []); });
  }

  function responder(item, parecidas, pergunta) {
    typing(420 + Math.min(500, item.resposta.length * 1.2)).then(function () {
      var html = '<b class="eno-sup-t">' + esc(item.titulo) + '</b>' + textoHtml(item.resposta);
      if (item.links && item.links.length) {
        html += '<div class="eno-sup-links">' + item.links.map(function (l) {
          var ext = /^https?:/.test(l.href);
          return '<a class="eno-sup-link" href="' + esc(l.href) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.rotulo) + icon(IC.link, 14) + '</a>';
        }).join('') + '</div>';
      }
      botMsg({ html: html });
      conversa.push({ de: 'chat', texto: item.titulo + ': ' + item.resposta.slice(0, 300) }); save();
      if (item.humano) { handoff(pergunta === item.titulo ? '' : pergunta); return; }
      if (item.semHumano) return;
      var fb = el('div', 'eno-sup-fb',
        '<span>Resolveu?</span><button type="button" data-v="sim">Sim</button><button type="button" data-v="nao">Não, falar com uma pessoa</button>');
      fb.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        fb.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
        b.setAttribute('aria-pressed', 'true');
        if (b.getAttribute('data-v') === 'sim') { botMsg({ html: 'Que bom! Se surgir outra dúvida, é só escrever.' }); }
        else { anotar(pergunta + ' [resposta "' + item.titulo + '" não resolveu]'); handoff(pergunta); }
      });
      enter(fb, 1);
      if (parecidas && parecidas.length) chips(parecidas, 'Perguntas parecidas');
    });
  }

  function anotar(pergunta) {
    var body = JSON.stringify({ pergunta: pergunta, pagina: location.pathname });
    try { fetch(cfg.api + '/api/v1/suporte/sem-resposta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); } catch (e) { /* offline */ }
  }

  function naoSei(t, parecidas) {
    anotar(t);
    typing(520).then(function () {
      botMsg({ html: '<p>Ainda não sei responder isso com certeza, e anotei a sua pergunta para melhorar.</p>' + (parecidas.length ? '<p>Pode ser um destes assuntos?</p>' : '<p>Uma pessoa da Enomera pode te ajudar:</p>') });
      conversa.push({ de: 'chat', texto: 'Ainda não sei responder isso.' }); save();
      if (parecidas.length) chips(parecidas, 'Assuntos parecidos');
      handoff(t);
    });
  }

  function whatsappHref(pergunta) {
    var num = (base && base.contato && base.contato.whatsapp) || '5513912352841';
    var txt = 'Oi, Enomera! Vim pelo chat de ajuda' + (pergunta ? '. Minha dúvida: ' + pergunta : '.');
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(txt);
  }

  function handoff(pergunta) {
    var card = el('div', 'eno-sup-hand',
      '<a class="eno-sup-opt" href="' + esc(whatsappHref(pergunta)) + '" target="_blank" rel="noopener">' +
        '<span class="eno-sup-opt-ic eno-sup-wa">' + icon(IC.wa, 20) + '</span>' +
        '<span><b>WhatsApp</b><small>' + esc((base && base.contato && base.contato.whatsappRotulo) || '(13) 91235-2841') + ' · a sua dúvida já vai escrita</small></span></a>' +
      '<button type="button" class="eno-sup-opt" data-mail>' +
        '<span class="eno-sup-opt-ic">' + icon(IC.mail, 20) + '</span>' +
        '<span><b>Mensagem por e-mail</b><small>Escreva aqui e a gente responde no seu e-mail</small></span></button>');
    card.querySelector('[data-mail]').addEventListener('click', function (ev) {
      var btn = ev.currentTarget;
      if (card.querySelector('.eno-sup-mail')) { card.querySelector('#eno-sup-nome').focus(); return; }
      btn.setAttribute('aria-expanded', 'true');
      mailForm(card, pergunta);
    });
    enter(card, 1);
  }

  function mailForm(card, pergunta) {
    var f = el('form', 'eno-sup-mail');
    f.noValidate = true;
    f.innerHTML =
      '<label><span>Seu nome</span><input id="eno-sup-nome" name="nome" autocomplete="name" maxlength="120"></label>' +
      '<label><span>Seu e-mail</span><input name="email" type="email" inputmode="email" autocomplete="email" maxlength="200" required><em class="eno-sup-err" data-for="email"></em></label>' +
      '<label><span>Mensagem</span><textarea name="mensagem" rows="3" maxlength="2000" required></textarea><em class="eno-sup-err" data-for="mensagem"></em></label>' +
      '<button type="submit" class="eno-sup-submit">Enviar mensagem</button>';
    f.querySelector('textarea').value = pergunta || '';
    card.appendChild(f);
    var h = f.scrollHeight;
    if (!reduce()) f.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' });
    setTimeout(function () { f.querySelector('#eno-sup-nome').focus(); scrollEnd(); }, 40);
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var data = { nome: f.nome.value.trim(), email: f.email.value.trim(), mensagem: f.mensagem.value.trim(), pergunta: pergunta, pagina: location.pathname, conversa: conversa };
      var errs = {};
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) errs.email = 'Confira o e-mail para a gente conseguir responder.';
      if (data.mensagem.length < 3) errs.mensagem = 'Escreva a sua dúvida em poucas palavras.';
      showErrs(f, errs);
      if (Object.keys(errs).length) { f.querySelector(errs.email ? '[name=email]' : '[name=mensagem]').focus(); return; }
      var sb = f.querySelector('.eno-sup-submit');
      sb.disabled = true; sb.setAttribute('data-busy', ''); sb.textContent = 'Enviando…';
      fetch(cfg.api + '/api/v1/suporte/chamados', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw j; return j; }); })
        .then(function () {
          var done = el('div', 'eno-sup-done', icon(IC.ok, 18) + '<span>Recebemos! A gente responde em <b>' + esc(data.email) + '</b>.</span>');
          f.replaceWith(done);
          if (!reduce()) done.animate([{ opacity: 0, transform: 'scale(.97)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 320, easing: EASE });
          conversa.push({ de: 'chat', texto: 'Mensagem enviada para a equipe.' }); save();
          scrollEnd();
        })
        .catch(function (j) {
          sb.disabled = false; sb.removeAttribute('data-busy'); sb.textContent = 'Enviar mensagem';
          var e = {}; e[(j && j.field) || 'mensagem'] = (j && (j.message || j.error)) || 'Não deu para enviar agora. Tente de novo ou use o WhatsApp.';
          showErrs(f, e);
        });
    });
  }

  function showErrs(f, errs) {
    f.querySelectorAll('.eno-sup-err').forEach(function (em) {
      var k = em.getAttribute('data-for'), msg = errs[k] || '';
      var field = f.querySelector('[name=' + k + ']');
      if (field) { if (msg) field.setAttribute('aria-invalid', 'true'); else field.removeAttribute('aria-invalid'); }
      if (em.textContent === msg) return;
      em.textContent = msg;
      if (msg && !reduce()) em.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
    });
  }

  window.EnoSuporte = { open: openPanel, close: close, buscar: function (t) { return loadBase().then(function () { return buscar(t); }); } };

  // O aviso de privacidade (eno-consent) fica no mesmo canto: o botão sobe acima dele, com movimento.
  function lift() {
    if (!root) return;
    var c = document.querySelector('.eno-consent:not([data-leaving])');
    var h = 0;
    if (c) { var r = c.getBoundingClientRect(); if (r.height && r.bottom > window.innerHeight - 140) h = Math.round(window.innerHeight - r.top) - 4; }
    var cur = root.style.getPropertyValue('--eno-sup-lift');
    var next = h ? h + 'px' : '0px';
    if (cur === next) return;
    root.style.setProperty('--eno-sup-lift', next);
  }
  function start() {
    build();
    lift();
    if (window.MutationObserver) new MutationObserver(function () { requestAnimationFrame(lift); }).observe(document.body, { childList: true, attributes: true, attributeFilter: ['data-leaving'], subtree: true });
    document.addEventListener('animationend', function (e) { if (e.target && e.target.classList && e.target.classList.contains('eno-consent')) lift(); }, true);
    window.addEventListener('resize', lift, { passive: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // Links "Fale com a gente" podem abrir o chat: <a href="#ajuda" data-eno-suporte>
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('[data-eno-suporte]');
    if (!a) return;
    ev.preventDefault();
    openPanel(a.getAttribute('data-eno-suporte') || '');
  });
})();
