/* Painel do piloto · só para o administrador. Dados de /api/v1/pilot/admin/*. */
(function () {
  'use strict';
  var TOKEN_KEY = 'enomera_session_token_v1';
  var main = document.getElementById('pn');
  var state = { dias: 14, teste: false, data: null, sort: { key: 'activeMs', dir: -1 }, heat: { product: '', screen: '', participant: '', form: '' }, newLink: null, view: '', sobFilter: 'open' };
  var PRODUCTS = { enomera: 'Enomera', ambo: 'Agendamento', minne: 'Consultório', etha: 'Site', site: 'Site da profissional' };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { localStorage.setItem('eno_uso_off', '1'); } catch (e) {}

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function dur(ms) {
    ms = Math.max(0, Number(ms) || 0); var s = Math.round(ms / 1000);
    if (s < 60) return s + ' s'; var m = Math.round(s / 60); if (m < 60) return m + ' min';
    var h = Math.floor(m / 60); return h + ' h ' + String(m % 60).padStart(2, '0') + ' min';
  }
  function when(iso) { if (!iso) return 'nunca'; var d = new Date(iso); return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function ago(iso) {
    if (!iso) return 'nunca'; var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 2) return 'agora'; if (m < 60) return 'há ' + m + ' min'; var h = Math.round(m / 60); if (h < 24) return 'há ' + h + ' h'; var d = Math.round(h / 24); return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  }
  function prod(p) { return PRODUCTS[p] || p; }
  function screenLabel(s) { return s || '/'; }

  function api(path, opts) {
    opts = opts || {}; var h = { 'Content-Type': 'application/json' };
    var tok = ''; try { tok = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
    if (tok) h.Authorization = 'Bearer ' + tok;
    return fetch(path, { method: opts.method || 'GET', headers: h, credentials: 'same-origin', body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }

  // Troca de conteúdo com uma entrada só: o antigo sai rápido, o novo materializa.
  function swap(html, after) {
    var mount = function () { main.innerHTML = html; if (after) after(); };
    if (main.firstElementChild && !reduced) { main.classList.add('pl-out'); setTimeout(function () { main.classList.remove('pl-out'); mount(); }, 160); } else mount();
  }

  // ── entrada ──
  function loginView(errText) {
    document.getElementById('pn-nav').hidden = true; document.getElementById('pn-tools').hidden = true;
    swap('<form class="pn-login lg pl-in" data-glass="reading" data-glass-tint="enomera" novalidate id="pn-login">' +
      '<div class="pl-stagger" style="display:grid;gap:8px"><p class="small" style="color:var(--accent);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Administrador</p><h1>Painel do piloto</h1><p class="muted">Entre com o acesso criado no seu convite de administrador.</p></div>' +
      '<div class="pl-field"><label for="l-email">E-mail</label><input id="l-email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" aria-describedby="l-err"></div>' +
      '<div class="pl-field"><label for="l-pass">Senha</label><input id="l-pass" type="password" autocomplete="current-password" aria-describedby="l-err"></div>' +
      '<div class="pl-field pl-in" id="l-code-box" hidden><label for="l-code">Código de 6 dígitos</label><input id="l-code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" aria-describedby="l-code-hint l-err"><p class="hint" id="l-code-hint"></p></div>' +
      '<p class="pl-err" id="l-err" role="alert">' + esc(errText || '') + '</p>' +
      '<button class="pl-btn" type="submit">Entrar</button></form>', function () {
      var f = document.getElementById('pn-login'); setTimeout(function () { document.getElementById('l-email').focus(); }, 60);
      f.addEventListener('submit', function (e) {
        e.preventDefault(); var btn = f.querySelector('button[type=submit]'); if (btn.getAttribute('aria-busy') === 'true') return;
        var email = f.querySelector('#l-email').value.trim(); var pass = f.querySelector('#l-pass').value;
        if (!email || !pass) { document.getElementById('l-err').textContent = 'Preencha e-mail e senha.'; return; }
        btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="pl-spin" aria-hidden="true"></span>Entrando';
        var codeEl = f.querySelector('#l-code'); var body = { email: email, password: pass };
        if (codeEl && !codeEl.closest('[hidden]')) {
          body.code = codeEl.value.replace(/\D/g, '');
          if (body.code.length !== 6) { btn.removeAttribute('aria-busy'); btn.textContent = 'Entrar'; document.getElementById('l-err').textContent = 'Digite os 6 dígitos do código enviado ao seu e-mail.'; codeEl.focus(); return; }
        }
        api('/api/v1/auth/login', { method: 'POST', body: body }).then(function (r) {
          btn.removeAttribute('aria-busy'); btn.textContent = 'Entrar';
          if (!r.ok && r.d && r.d.code === 'ADMIN_CODE_REQUIRED') {
            // Segundo fator do administrador: o servidor enviou um código ao e-mail.
            var box = document.getElementById('l-code-box'); box.hidden = false;
            if (r.d.devCode) codeEl.value = r.d.devCode;
            document.getElementById('l-err').textContent = '';
            document.getElementById('l-code-hint').textContent = 'Enviamos um código de 6 dígitos para o seu e-mail. Digite para concluir a entrada.';
            codeEl.focus(); return;
          }
          if (!r.ok) { document.getElementById('l-err').textContent = (r.d && r.d.error) || 'Não foi possível entrar.'; return; }
          if (r.d.user && r.d.user.role !== 'pilot_admin') { document.getElementById('l-err').textContent = 'Esta conta não é a de administrador do piloto.'; return; }
          try { sessionStorage.setItem(TOKEN_KEY, r.d.sessionToken); } catch (err) {}
          load(true);
        });
      });
    });
  }

  // ── carga ──
  var loading = false;
  function load(first) {
    if (loading) return; loading = true;
    if (first || !state.data) main.innerHTML = '<div class="pn-kpis">' + '<div class="pn-skel"></div>'.repeat(6) + '</div><div class="pn-skel tall"></div><div class="pn-skel tall"></div>';
    var btn = document.getElementById('pn-refresh'); btn.setAttribute('aria-busy', 'true');
    api('/api/v1/pilot/admin/overview?dias=' + state.dias + (state.teste ? '&teste=1' : '')).then(function (r) {
      loading = false; btn.removeAttribute('aria-busy');
      if (r.status === 401) return loginView();
      if (r.status === 403) return loginView('Esta sessão não é a do administrador do piloto. Entre com o acesso de administrador.');
      if (!r.ok) { main.innerHTML = '<div class="pn-empty">Não foi possível carregar agora (' + esc(r.d.error || r.status) + '). Tente Atualizar.</div>'; return; }
      var prev = state.data; state.data = r.d;
      return Promise.all([
        api('/api/v1/pilot/admin/etha-sob-medida').then(function (s2) { state.sob = s2.ok ? (s2.d.orders || []) : []; }).catch(function () { state.sob = []; }),
        api('/api/v1/pilot/admin/digests').then(function (s3) { state.digests = s3.ok ? (s3.d.digests || []) : []; }).catch(function () { state.digests = []; }),
      ]).then(function () {
      document.getElementById('pn-nav').hidden = false; document.getElementById('pn-tools').hidden = false; placeLens(); navFade();
      if (!state.heat.screen && r.d.screens.length) { state.heat.product = r.d.screens[0].product; state.heat.screen = r.d.screens[0].screen; }
      render(Boolean(prev));
      });
    }).catch(function () { loading = false; btn.removeAttribute('aria-busy'); });
  }

  // ── leitura rápida (respostas às perguntas do piloto) ──
  function insights(d) {
    var out = [];
    var activeP = d.participants.filter(function (p) { return p.sessionCount > 0; });
    if (!activeP.length) return '';
    var held = d.screens.filter(function (s) { return s.views > 0; })[0];
    if (held) out.push(['O que mais segurou', esc(prod(held.product)) + ' · <span class="scr">' + esc(screenLabel(held.screen)) + '</span>: ' + dur(held.activeMs) + ' de uso ativo, ' + held.users + (held.users === 1 ? ' pessoa' : ' pessoas') + '.']);
    var exit = d.exits[0];
    if (exit) out.push(['Onde mais pararam', esc(prod(exit.product)) + ' · <span class="scr">' + esc(screenLabel(exit.screen)) + '</span>: ' + exit.sessions + (exit.sessions === 1 ? ' sessão terminou' : ' sessões terminaram') + ' ali.']);
    var never = d.features.filter(function (f) { return f.users === 0; });
    if (never.length) out.push(['Nunca usado', never.slice(0, 5).map(function (f) { return esc(f.label); }).join(', ') + (never.length > 5 ? ' e mais ' + (never.length - 5) : '') + '.']);
    var top = d.features.slice().sort(function (a, b) { return b.uses - a.uses; })[0];
    if (top && top.uses) out.push(['Mais usado', esc(top.label) + ': ' + top.uses + (top.uses === 1 ? ' vez' : ' vezes') + ', por ' + top.users + (top.users === 1 ? ' pessoa' : ' pessoas') + '.']);
    var fr = d.frustration[0];
    if (fr) out.push(['Mais frustração', '<span class="scr">' + esc(fr.target) + '</span> em ' + esc(prod(fr.product)) + ': ' + (fr.rage ? fr.rage + ' toques repetidos' : '') + (fr.rage && fr.dead ? ' e ' : '') + (fr.dead ? fr.dead + ' toques sem efeito' : '') + '.']);
    var err = d.errors[0] || d.apiFailures[0];
    if (err) out.push(['Erro mais frequente', esc(prod(err.product)) + ': <span class="scr">' + esc(err.message || (err.endpoint + ' → ' + err.status + (err.code ? ' ' + err.code : ''))) + '</span> (' + err.count + 'x).']);
    var gone = activeP.filter(function (p) { return p.lastSeen && Date.now() - Date.parse(p.lastSeen) > 3 * 864e5; });
    if (gone.length) out.push(['Sumiu', gone.map(function (p) { return esc(p.name); }).join(', ') + ' não abre nada há mais de 3 dias.']);
    return '<ul class="pn-insights pl-stagger">' + out.map(function (o) { return '<li><b>' + o[0] + '</b><span>' + o[1] + '</span></li>'; }).join('') + '</ul>';
  }

  function kpi(label, value, sub) { return '<div class="pn-kpi lg" data-glass="regular" data-glass-tint="enomera"><b class="num" data-count="' + esc(value) + '">' + esc(value) + '</b><span>' + label + (sub ? ' · ' + sub : '') + '</span></div>'; }

  function bar(label, sub, value, max, valText, tip) {
    var pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return '<div class="pn-bar" data-tip="' + esc(tip || '') + '"><span class="lbl">' + esc(label) + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</span><span class="track"><span class="fill' + (pct === 0 ? ' is-zero' : '') + '" style="width:' + pct.toFixed(1) + '%"></span></span><span class="val">' + esc(valText) + '</span></div>';
  }

  function retention(d) {
    var days = []; for (var i = Math.min(d.days, 30) - 1; i >= 0; i--) days.push(new Date(Date.now() - i * 864e5).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }));
    var step = function (ms) { var m = ms / 60000; return m <= 0 ? null : m < 5 ? .22 : m < 15 ? .45 : m < 30 ? .7 : 1; };
    var rows = d.participants.map(function (p) {
      return '<tr><th scope="row">' + esc(p.name) + '</th>' + days.map(function (day) {
        var has = Object.prototype.hasOwnProperty.call(p.days, day); var ms = p.days[day] || 0; var a = has ? (step(ms) || .16) : .05;
        return '<td class="cell" style="--a:' + a + '" data-tip="' + esc(p.name + ' · ' + new Date(day + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) + ' · ' + (has ? dur(ms) + ' ativo' : 'não abriu')) + '"></td>';
      }).join('') + '</tr>';
    }).join('');
    var head = '<tr><th></th>' + days.map(function (day, i) { return '<th>' + (i % 2 === 0 || days.length <= 14 ? day.slice(8) : '') + '</th>'; }).join('') + '</tr>';
    return '<div class="pn-ret"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pn-legend"><span><i style="--a:.05"></i>não abriu</span><span><i style="--a:.22"></i>menos de 5 min</span><span><i style="--a:.45"></i>5 a 15</span><span><i style="--a:.7"></i>15 a 30</span><span><i style="--a:1"></i>30 min ou mais</span></div>';
  }

  function personCard(p) {
    var status = p.selfTest ? '<span class="pn-chip mute">Seu teste</span>' : !p.sessionCount ? '<span class="pn-chip mute">Ainda não usou</span>' : p.returned ? '<span class="pn-chip ok">Voltou ' + p.daysActive + ' dias</span>' : '<span class="pn-chip">1 dia de uso</span>';
    var prods = Object.keys(p.products).sort(function (a, b) { return p.products[b].activeMs - p.products[a].activeMs; });
    var maxP = prods.length ? p.products[prods[0]].activeMs : 0;
    var used = p.features.filter(function (f) { return f.used; }).length;
    return '<button type="button" class="pn-person lg" data-glass="regular" data-glass-tint="enomera" data-person="' + esc(p.id) + '" aria-label="Abrir detalhes de ' + esc(p.name) + '">' +
      '<header><div><h3>' + esc(p.name) + '</h3><p class="small muted">' + esc(p.label) + ' · último acesso ' + esc(ago(p.lastSeen)) + '</p></div>' + status + '</header>' +
      '<div class="pn-stats"><div><b>' + dur(p.activeMs) + '</b><span>tempo ativo</span></div><div><b>' + p.sessionCount + '</b><span>sessões</span></div><div><b>' + used + '/' + p.features.length + '</b><span>funções usadas</span></div><div><b' + (p.errors + p.apiFailures ? ' class="pn-hot"' : '') + '>' + (p.errors + p.apiFailures) + '</b><span>erros</span></div></div>' +
      (prods.length ? '<div class="pn-bars">' + prods.map(function (k) { return bar(prod(k), '', p.products[k].activeMs, maxP, dur(p.products[k].activeMs), prod(k) + ': ' + dur(p.products[k].activeMs) + ' ativo, ' + p.products[k].clicks + ' toques'); }).join('') + '</div>' : '') +
      (p.lastStop ? '<p class="pn-stop">Parou em <b>' + esc(prod(p.lastStop.product)) + '</b> · <span class="scr">' + esc(screenLabel(p.lastStop.screen)) + '</span>' + (p.lastStop.hadError ? ' <span class="pn-chip bad">com erro</span>' : '') + '</p>' : '<p class="pn-stop">Conta criada ' + esc(ago(p.joinedAt)) + '. Nenhum uso registrado ainda.</p>') +
      '</button>';
  }

  function featuresBlock(d) {
    var groups = {}; d.features.forEach(function (f) { (groups[f.product] = groups[f.product] || []).push(f); });
    var active = Math.max(1, d.totals.active);
    return Object.keys(groups).map(function (g) {
      return '<p class="pn-group-title">' + esc(prod(g)) + '</p>' + groups[g].map(function (f) {
        return bar(f.label, '', f.users, active, f.users + ' de ' + d.totals.active, f.label + ': ' + f.users + ' de ' + d.totals.active + ' pessoas, ' + f.uses + ' usos');
      }).join('');
    }).join('');
  }

  var COLS = [
    ['product', 'Produto', false], ['screen', 'Tela', false], ['users', 'Pessoas', true], ['activeMs', 'Tempo ativo', true], ['avg', 'Média por visita', true],
    ['exitRate', 'Saída aqui', true], ['avgScroll', 'Rolagem', true], ['clicks', 'Toques', true], ['rage', 'Repetidos', true], ['dead', 'Sem efeito', true], ['errors', 'Erros', true],
  ];
  function screensTable(d) {
    var rows = d.screens.map(function (s) { return Object.assign({ avg: s.views ? s.activeMs / s.views : 0 }, s); });
    var k = state.sort.key; var dir = state.sort.dir;
    rows.sort(function (a, b) { var x = a[k], y = b[k]; if (typeof x === 'string') return dir * x.localeCompare(y); return dir * ((x || 0) - (y || 0)); });
    if (!rows.length) return '<div class="pn-empty">Nenhuma tela registrada no período.</div>';
    return '<div class="pn-table lg" data-glass="reading" data-glass-tint="enomera"><table><thead><tr>' + COLS.map(function (c) {
      var sorted = state.sort.key === c[0];
      return '<th class="' + (c[2] ? 'n' : '') + '"><button type="button" data-sort="' + c[0] + '"' + (sorted ? ' aria-sort="' + (dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + c[1] + (sorted ? (dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
    }).join('') + '</tr></thead><tbody>' + rows.slice(0, 60).map(function (s) {
      return '<tr><td>' + esc(prod(s.product)) + '</td><td class="scr">' + esc(screenLabel(s.screen)) + '</td><td class="n">' + s.users + '</td><td class="n">' + dur(s.activeMs) + '</td><td class="n">' + dur(s.avg) + '</td>' +
        '<td class="n' + (s.exitRate >= 50 && s.views >= 2 ? ' pn-hot' : '') + '">' + s.exitRate + '%</td><td class="n">' + (s.avgScroll == null ? 'sem dado' : s.avgScroll + '%') + '</td><td class="n">' + s.clicks + '</td>' +
        '<td class="n' + (s.rage ? ' pn-hot' : '') + '">' + s.rage + '</td><td class="n">' + s.dead + '</td><td class="n' + (s.errors ? ' pn-hot' : '') + '">' + s.errors + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function elementsBlock(d) {
    var top = d.elements.slice(0, 12); var max = top.length ? top[0].clicks : 0;
    var html = top.length ? top.map(function (e) { return bar(e.target, prod(e.product), e.clicks, max, e.clicks + 'x', e.target + ' · ' + e.users + (e.users === 1 ? ' pessoa' : ' pessoas') + ' · ' + e.screens.join(', ')); }).join('') : '<div class="pn-empty">Sem toques no período.</div>';
    return html;
  }

  function errorsBlock(d) {
    var items = d.errors.map(function (e) {
      return '<details class="pn-err"><summary><span class="pn-chip bad">' + (e.kind === 'console' ? 'console' : 'erro') + '</span><span class="msg">' + esc(e.message) + '</span><span class="num small">' + e.count + 'x</span></summary>' +
        '<div class="body"><span>' + esc(prod(e.product)) + ' · ' + e.users + (e.users === 1 ? ' pessoa' : ' pessoas') + ' · último ' + esc(when(e.lastAt)) + '</span><span>Telas: <span class="scr">' + e.screens.map(esc).join(', ') + '</span></span>' + (e.source ? '<span>Arquivo: <span class="scr">' + esc(e.source) + '</span></span>' : '') + (e.stack ? '<pre>' + esc(e.stack.split(' | ').join('\n')) + '</pre>' : '') + '</div></details>';
    }).concat(d.apiFailures.map(function (a) {
      return '<details class="pn-err"><summary><span class="pn-chip">' + (a.status === 0 ? 'rede' : a.status) + '</span><span class="msg">' + esc(a.endpoint) + (a.code ? ' · ' + esc(a.code) : '') + '</span><span class="num small">' + a.count + 'x</span></summary>' +
        '<div class="body"><span>' + esc(prod(a.product)) + ' · ' + a.users + (a.users === 1 ? ' pessoa' : ' pessoas') + ' · último ' + esc(when(a.lastAt)) + '</span><span>Na tela <span class="scr">' + esc(a.screen) + '</span></span></div></details>';
    }));
    return items.length ? '<div class="pn-errors pl-stagger">' + items.join('') + '</div>' : '<div class="pn-empty">Nenhum erro registrado no período. Bom sinal.</div>';
  }

  function invitesBlock(d) {
    var labels = { open: ['Aguardando cadastro', ''], used: ['Usado', 'ok'], revoked: ['Cancelado', 'mute'], expired: ['Vencido', 'mute'] };
    return (state.newLink ? '<div class="pn-newlink"><b>Link criado para ' + esc(state.newLink.label) + '</b><code>' + esc(state.newLink.link) + '</code><div><button type="button" class="pl-btn is-quiet" data-copy="' + esc(state.newLink.link) + '">Copiar link</button></div><p class="small muted">Ele aparece só agora. Funciona uma única vez.</p></div>' : '') +
      '<div class="pn-invites">' + d.invites.map(function (i) {
        var l = labels[i.state] || [i.state, 'mute'];
        return '<div class="pn-invite"><div><b>' + esc(i.label) + '</b> <span class="small muted">' + (i.kind === 'admin' ? 'administrador' : i.kind === 'self_test' ? 'seu teste, fora dos totais' : 'convidado') + ' · criado ' + esc(ago(i.createdAt)) + (i.usedAt ? ' · usado ' + esc(ago(i.usedAt)) : '') + '</span></div>' +
          '<div style="display:flex;gap:8px;align-items:center"><span class="pn-chip ' + l[1] + '">' + l[0] + '</span>' + (i.state === 'open' && i.kind !== 'admin' ? '<button type="button" class="pl-btn is-ghost" data-hold="Segure para cancelar o convite" data-hold-ms="1000" data-revoke="' + esc(i.id) + '">Cancelar</button>' : '') + '</div></div>';
      }).join('') + '</div>' +
      '<p class="small muted" style="margin-top:12px">Vagas de convidado fechadas: o feedback fica com os 2 convidados exclusivos (1 mês grátis cada). Quem entrou antes continua como está; o resto do público usa as 2 semanas grátis.</p>';
  }

  // ── Site Sob medida ──
  // Sites publicados: <base>/<slug>. Mesmo endereço do Enomera Site (ENOMERA_SITES_URL na build).
  var SITES = String(window.__ENOMERA_SITES_URL || 'https://sites.enomera.com.br').replace(/\/+$/, '') + '/';
  var SOB_STATUS = { 'new': ['Novo', ''], production: ['Em produção', 'warn'], delivered: ['Entregue', 'ok'] };
  var PUBLICOS = { adultos: 'Adultos', adolescentes: 'Adolescentes', criancas: 'Crianças', casais: 'Casais', familias: 'Famílias', idosos: 'Pessoas idosas' };
  var PROFISSOES = { psicologa: 'Psicóloga', psicologo: 'Psicólogo', psicanalista: 'Psicanalista', psiquiatra: 'Psiquiatra', psicoterapeuta: 'Psicoterapeuta' };
  var CORES = {
    'tom-quente': ['Tons quentes', 'linear-gradient(135deg,#F4B9CB,#F2A99A,#EED69A)'], 'tom-frio': ['Tons frios', 'linear-gradient(135deg,#C7BDF4,#B8CDEB,#BFE3D3)'],
    'tom-neutro': ['Tons neutros', 'linear-gradient(135deg,#F1EEE8,#DCD6CF,#8D8A93)'], livre: ['Escolham por mim', 'conic-gradient(#F4B9CB,#C7BDF4,#B8CDEB,#B7CDB4,#EED69A,#F4B9CB)'],
    rosa: ['Rosa', '#F4B9CB'], 'rosa-antigo': ['Rosa antigo', '#D9A3AE'], coral: ['Coral', '#F2A99A'], pessego: ['Pêssego', '#F7CBB0'], terracota: ['Terracota', '#D9967A'], mostarda: ['Mostarda', '#E6C46E'], vinho: ['Vinho', '#9E5D6E'],
    lavanda: ['Lavanda', '#C7BDF4'], lilas: ['Lilás', '#D9C4EE'], azul: ['Azul sereno', '#B8CDEB'], 'azul-marinho': ['Azul-marinho', '#3E4F7A'], petroleo: ['Azul-petróleo', '#5E8C94'], salvia: ['Verde sálvia', '#B7CDB4'], menta: ['Menta', '#BFE3D3'], oliva: ['Verde-oliva', '#8E9A6B'],
    neutro: ['Areia', '#E6DCCB'], 'off-white': ['Off-white', '#F1EEE8'], bege: ['Bege', '#D8C7AE'], cinza: ['Cinza quente', '#CFC8C0'], cafe: ['Café', '#8A6E5C'], grafite: ['Grafite', '#55525C'],
  };
  function list(a, map) { return (Array.isArray(a) ? a : a ? [a] : []).map(function (x) { return map && map[x] ? map[x] : x; }).filter(Boolean); }
  function spanLeft(ms) {
    var h = Math.round(Math.abs(ms) / 36e5);
    if (h < 1) return 'menos de 1 h'; if (h < 24) return h + ' h'; var d = Math.round(h / 24); return d + (d === 1 ? ' dia' : ' dias');
  }
  function dueDay(iso) { return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: 'short' }); }
  function dueText(o) {
    if (o.status === 'delivered') {
      var late = Date.parse(o.deliveredAt) - Date.parse(o.dueAt);
      return ['Entregue ' + when(o.deliveredAt) + (late > 0 ? ', ' + spanLeft(late) + ' depois do prazo' : ', dentro do prazo'), late > 0 ? 'warn' : 'ok'];
    }
    if (!o.submitted) return ['Escolheu Sob medida, mas ainda não enviou o material', 'mute'];
    var left = Date.parse(o.dueAt) - Date.now();
    if (left < 0) return ['Atrasado há ' + spanLeft(left) + ' · prazo era ' + dueDay(o.dueAt), 'bad'];
    return ['Prazo ' + dueDay(o.dueAt) + ', fim do dia · faltam ' + spanLeft(left), left < 864e5 ? 'warn' : ''];
  }
  function duePct(o) {
    var a = Date.parse(o.receivedAt), b = Date.parse(o.dueAt), now = o.deliveredAt ? Date.parse(o.deliveredAt) : Date.now();
    return b > a ? Math.max(2, Math.min(100, ((now - a) / (b - a)) * 100)) : 100;
  }
  function sobCounts() {
    var c = { all: 0, 'new': 0, production: 0, delivered: 0, late: 0 };
    (state.sob || []).forEach(function (o) { c.all++; c[o.status]++; if (o.late && o.submitted) c.late++; });
    return c;
  }
  function orderCard(o) {
    var st = SOB_STATUS[o.status] || SOB_STATUS['new']; var dt = dueText(o);
    return '<button type="button" class="pn-order lg" data-glass="regular" data-glass-tint="enomera" data-sob-open="' + esc(o.projectId) + '" aria-label="Abrir o pedido de ' + esc(o.name) + '">' +
      '<header><div><h3>' + esc(o.name) + '</h3><p class="small muted">/' + esc(o.slug) + (o.email ? ' · ' + esc(o.email) : '') + '</p></div><span class="pn-chip ' + st[1] + '">' + st[0] + '</span></header>' +
      '<div class="pn-due ' + dt[1] + '"><span class="track"><span class="fill" style="width:' + duePct(o).toFixed(1) + '%"></span></span><span class="txt">' + esc(dt[0]) + '</span></div>' +
      '<p class="small muted">' + (o.submitted ? 'Material recebido ' + esc(when(o.receivedAt)) : 'Pedido aberto ' + esc(ago(o.receivedAt))) + ' · ' + o.files + (o.files === 1 ? ' arquivo' : ' arquivos') + '</p>' +
      '<span class="pn-open" aria-hidden="true">Ver material<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>';
  }
  function sobView() {
    var all = state.sob || []; var c = sobCounts(); var f = state.sobFilter || 'open';
    var shown = all.filter(function (o) { return f === 'all' ? true : f === 'open' ? o.status !== 'delivered' : o.status === f; });
    var seg = '<div class="pl-seg pn-seg-scroll" role="group" aria-label="Filtrar pedidos"><span class="pl-lens" aria-hidden="true"></span>' +
      [['open', 'Em aberto', c['new'] + c.production], ['new', 'Novos', c['new']], ['production', 'Em produção', c.production], ['delivered', 'Entregues', c.delivered], ['all', 'Todos', c.all]].map(function (x) {
        return '<button type="button" data-sob-filter="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + ' <b class="num">' + x[2] + '</b></button>';
      }).join('') + '</div>';
    var body = !all.length ? '<div class="pn-empty">Nenhum pedido Sob medida ainda. Ele aparece aqui assim que alguém escolhe Site Sob medida, e o material chega junto quando a pessoa envia.</div>'
      : !shown.length ? '<div class="pn-empty">Nada nesta lista agora.</div>'
      : '<div class="pn-orders pl-stagger">' + shown.map(orderCard).join('') + '</div>';
    return '<div class="pn-head"><div><h1>Site Sob medida</h1><p>Sites feitos pela equipe. O prazo é de 2 dias úteis a partir do envio do material, até o fim do dia. Abra um pedido para ver e baixar tudo o que a pessoa mandou.</p></div>' +
      (c.late ? '<span class="pn-chip bad">' + c.late + (c.late === 1 ? ' atrasado' : ' atrasados') + '</span>' : '') + '</div>' + seg + '<div id="pn-sob-list">' + body + '</div>';
  }

  // Detalhe do pedido na gaveta
  var blobUrls = [];
  function authFetch(path) {
    var tok = ''; try { tok = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
    return fetch(path, { headers: tok ? { Authorization: 'Bearer ' + tok } : {}, credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.blob(); });
  }
  function size(n) { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  function row(label, value) { return value ? '<div class="pn-kv"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>' : ''; }
  function txt(v) { return v ? esc(v).replace(/\n/g, '<br>') : ''; }
  function chips(arr) { return arr.length ? '<span class="pn-tags">' + arr.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</span>' : ''; }
  function block(title, inner, extra) { return inner ? '<section class="pn-dsec"><div class="pn-dsec-h"><h3>' + esc(title) + '</h3>' + (extra || '') + '</div><dl class="pn-kvs">' + inner + '</dl></section>' : ''; }
  function link(href, label) { return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label || href) + '</a>'; }
  function urlish(v) { v = String(v || '').trim(); if (!v) return ''; return /^https?:\/\//i.test(v) ? v : 'https://' + v.replace(/^\/+/, ''); }
  function igUrl(v) { v = String(v || '').trim(); if (!v) return ''; if (/instagram\.com/i.test(v)) return urlish(v); return 'https://instagram.com/' + v.replace(/^@/, ''); }
  function phone(d) { d = String(d || '').replace(/\D/g, ''); if (!d) return ''; var n = d.length > 11 ? d.slice(-11) : d; return n.length === 11 ? '(' + n.slice(0, 2) + ') ' + n.slice(2, 7) + '-' + n.slice(7) : n.length === 10 ? '(' + n.slice(0, 2) + ') ' + n.slice(2, 6) + '-' + n.slice(6) : d; }
  function copyBtn(value, label) { return value ? '<button type="button" class="pn-mini" data-copy="' + esc(value) + '" data-copy-label="' + esc(label || 'Copiar') + '">' + esc(label || 'Copiar') + '</button>' : ''; }

  var ANSWER_LABELS = { name: 'Nome no site', profession: 'Profissão', register: 'Registro', modalities: 'Atendimento', city: 'Cidade', neighborhood: 'Bairro', address: 'Endereço', showAddress: 'Mostrar endereço',
    audiences: 'Público', approach: 'Abordagem', approachOther: 'Outra abordagem', themes: 'Temas', customThemes: 'Temas próprios', headline: 'Frase de abertura', photo: 'Foto', whatsapp: 'WhatsApp', service: 'Serviço',
    specialty: 'Especialidade', photosConfirmed: 'Fotos confirmadas', approachName: 'Abordagem', updatedAt: 'Atualizado em' };
  function answerValue(k, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
    if (k === 'audiences') return esc(list(v, PUBLICOS).join(', '));
    if (k === 'profession') return esc(PROFISSOES[v] || v);
    if (k === 'modalities') return esc(list(v, { online: 'Online', presencial: 'Presencial' }).join(' e '));
    if (k === 'service') return v === 'sob_medida' ? 'Sob medida' : 'Essencial';
    if (k === 'whatsapp') return esc(phone(v));
    if (k === 'headline' && typeof v === 'object') { var h = v.custom || [v.start, v.end].filter(Boolean).join(' '); return h ? esc(h) : (v.pick != null ? 'Sugestão ' + (Number(v.pick) + 1) : ''); }
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    if (Array.isArray(v)) return esc(v.map(function (x) { return typeof x === 'object' ? JSON.stringify(x) : x; }).join(', '));
    if (typeof v === 'object') return '<code>' + esc(JSON.stringify(v)) + '</code>';
    if (/At$/.test(k) && /^\d{4}-\d\d-\d\dT/.test(v)) return esc(when(v));
    return txt(String(v));
  }
  function answersBlock(obj, skip) {
    if (!obj) return '';
    return Object.keys(obj).filter(function (k) { return k !== 'v' && (!skip || skip.indexOf(k) < 0); }).map(function (k) {
      var val = answerValue(k, obj[k]); return val ? row(ANSWER_LABELS[k] || k, val) : '';
    }).join('');
  }

  function stepper(o) {
    var idx = { 'new': 0, production: 1, delivered: 2 }[o.status] || 0;
    var steps = [['Novo', o.receivedAt ? 'recebido ' + when(o.receivedAt) : ''], ['Em produção', o.startedAt ? 'desde ' + when(o.startedAt) : ''], ['Entregue', o.deliveredAt ? when(o.deliveredAt) : '']];
    var dt = dueText(o);
    var actions = o.status === 'new' ? '<button type="button" class="pl-btn" data-sob-status="production">Começar produção</button>'
      : o.status === 'production' ? '<button type="button" class="pl-btn" data-sob-status="delivered">Marcar como entregue</button><button type="button" class="pl-btn is-ghost" data-sob-status="new" data-hold="Segure para voltar para novo">Voltar para novo</button>'
      : '<button type="button" class="pl-btn is-quiet" data-sob-status="production" data-hold="Segure para reabrir o pedido">Reabrir pedido</button>';
    return '<div class="pn-steps" style="--p:' + (idx / 2) + '"><span class="pn-steps-line" aria-hidden="true"><i></i></span><ol>' + steps.map(function (s, i) {
      return '<li class="' + (i < idx ? 'done' : i === idx ? 'cur' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '><span class="dot" aria-hidden="true"></span><b>' + s[0] + '</b><small>' + esc(s[1]) + '</small></li>';
    }).join('') + '</ol></div>' +
      '<div class="pn-due ' + dt[1] + '"><span class="track"><span class="fill" style="width:' + duePct(o).toFixed(1) + '%"></span></span><span class="txt">' + esc(dt[0]) + '</span></div>' +
      '<div class="pn-actions">' + actions + '</div><p class="pl-err" id="sob-err" role="alert"></p>' +
      '<p class="small muted">' + (o.status === 'delivered' ? 'Entregue: o site da pessoa sai sem a marca Enomera. Reabrir volta o pedido para produção.' : 'Ao marcar como entregue, o site da pessoa passa a sair sem a marca Enomera.') + '</p>';
  }

  function filesBlock(d) {
    if (!d.files.length) return '<section class="pn-dsec"><div class="pn-dsec-h"><h3>Arquivos</h3></div><p class="muted small">Nenhum arquivo enviado' + (d.submitted ? '.' : ' ainda.') + '</p></section>';
    var base = '/api/v1/pilot/admin/etha-sob-medida/' + encodeURIComponent(d.projectId) + '/arquivos/';
    return '<section class="pn-dsec"><div class="pn-dsec-h"><h3>Arquivos <span class="muted">' + d.files.length + '</span></h3>' + (d.files.length > 1 ? '<button type="button" class="pn-mini" data-dl-all>Baixar todos</button>' : '') + '</div><div class="pn-files">' + d.files.map(function (f) {
      var img = String(f.mime || '').indexOf('image/') === 0;
      return '<div class="pn-file"><div class="thumb' + (img ? ' is-img' : '') + '"' + (img ? ' data-thumb="' + esc(base + encodeURIComponent(f.id)) + '"' : '') + '>' +
        (img ? '' : '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><span>' + esc((f.name.split('.').pop() || '').toUpperCase().slice(0, 4)) + '</span>') + '</div>' +
        '<div class="meta"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b><span class="small muted">' + esc(f.kind) + ' · ' + size(f.size) + '</span></div>' +
        '<div class="acts"><button type="button" class="pn-mini" data-dl="' + esc(f.id) + '" data-dl-name="' + esc(f.name) + '">Baixar</button><button type="button" class="pn-mini is-quiet" data-open-file="' + esc(f.id) + '">Abrir</button></div></div>';
    }).join('') + '</div></section>';
  }

  function sobDetailHtml(d) {
    var sm = d.sobMedida || {}; var pr = sm.profile || {}; var pc = sm.practice || {}; var ct = sm.contacts || {}; var id = sm.identity || {}; var ad = pc.address || null;
    var b = d.briefing || {}; var an = b.answers || {};
    var colors = list(id.colors && id.colors.length ? id.colors : sm.colors).map(function (c) { var m = CORES[c]; return '<span class="pn-swatch"><i style="background:' + esc(m ? m[1] : c) + '"></i>' + esc(m ? m[0] : c) + '</span>'; }).join('');
    var wa = ct.whatsapp || an.whatsapp || '';
    var addr = ad ? [[ad.street, ad.number].filter(Boolean).join(', '), ad.complement, ad.district, [ad.city, ad.uf].filter(Boolean).join(' / '), ad.cep ? 'CEP ' + ad.cep : ''].filter(Boolean).join(' · ') : '';
    var refs = list(sm.references);
    var contato =
      row('E-mail', ct.email ? link('mailto:' + ct.email, ct.email) + copyBtn(ct.email) : d.account.email ? link('mailto:' + d.account.email, d.account.email) + ' <small class="muted">(da conta)</small>' + copyBtn(d.account.email) : '') +
      row('WhatsApp', wa ? link('https://wa.me/' + (String(wa).replace(/\D/g, '').length <= 11 ? '55' : '') + String(wa).replace(/\D/g, ''), phone(wa)) + copyBtn(phone(wa)) : '') +
      row('Instagram', ct.instagram ? link(igUrl(ct.instagram), ct.instagram) : '') + row('LinkedIn', ct.linkedin ? link(urlish(ct.linkedin), ct.linkedin) : '') + row('Outro link', ct.other ? link(urlish(ct.other), ct.other) : '') +
      row('Endereço', addr ? esc(addr) + (ad.showOnSite === false ? ' <span class="pn-chip mute">não mostrar no site</span>' : ' <span class="pn-chip">mostrar no site</span>') + copyBtn(addr) : '');
    var perfil = row('Nome', esc(d.account.fullName || d.account.name)) + row('Nome no site', an.name && an.name !== d.account.name ? esc(an.name) : '') + row('Profissão', esc(PROFISSOES[an.profession] || b.specialty || d.account.specialty || '')) +
      row('Registro', esc(an.register || d.account.crp || '')) + row('Sobre', txt(pr.about)) + row('Formação e trajetória', txt(pr.career)) + row('Idiomas', chips(list(pr.languages))) + row('Currículo', pr.cvName ? esc(pr.cvName) : '');
    var atend = row('Modalidade', esc(list(pc.modalities || an.modalities, { online: 'Online', presencial: 'Presencial' }).join(' e '))) + row('Público', chips(list(pc.audiences || an.audiences, PUBLICOS))) +
      row('Abordagem', esc(pc.approach || b.approach || '')) + row('Temas', chips(list(pc.themes || an.themes))) + row('Dias e horários', txt(pc.hours));
    var ident = row('Cores', colors ? '<span class="pn-swatches">' + colors + '</span>' : '') + row('Sensação', chips(list(id.styles))) + row('Páginas', chips(list(id.pages))) + row('Domínio', esc(id.domain || d.site.domain || ''));
    var extra = row('Referências', refs.length ? '<span class="pn-links">' + refs.map(function (r) { return link(urlish(r), r); }).join('') + '</span>' : '') + row('Observações', txt(sm.notes));
    var content = d.content || {}; var full = answersBlock(an) + answersBlock(content.answers, Object.keys(an));
    return '<div class="pn-drawer-head"><div><p class="small muted">Site Sob medida · <a href="' + esc(SITES + d.slug) + '" target="_blank" rel="noopener noreferrer">/' + esc(d.slug) + '</a></p><h2 id="pn-drawer-title" style="font-size:22px">' + esc(d.name) + '</h2></div><button type="button" class="pl-btn is-quiet" data-close aria-label="Fechar">Fechar</button></div>' +
      '<div class="pn-drawer-body pl-stagger">' +
      '<section class="pn-dsec pn-statusbox" id="sob-status">' + stepper(d) + '</section>' +
      '<div class="pn-quick"><button type="button" class="pn-mini" data-copy-brief>Copiar briefing em texto</button><a class="pn-mini is-quiet" href="' + esc(SITES + d.slug) + '" target="_blank" rel="noopener noreferrer">Ver site atual</a></div>' +
      filesBlock(d) + block('Contato e endereço', contato) + block('Sobre a profissional', perfil) + block('Atendimento', atend) + block('Identidade do site', ident) + block('Referências e observações', extra) +
      (full ? '<details class="pn-dsec pn-more"><summary><h3>Todas as respostas do formulário</h3></summary><dl class="pn-kvs">' + full + '</dl></details>' : '') +
      (!d.submitted ? '<p class="pn-empty">A pessoa escolheu Sob medida, mas ainda não clicou em "Enviar para a equipe". O que aparece aqui é o que ela já preencheu.</p>' : '') +
      '</div>';
  }

  function briefText(d) {
    var root = document.createElement('div'); root.innerHTML = sobDetailHtml(d);
    var out = [d.name + ' · ' + SITES + d.slug, dueText(d)[0], ''];
    root.querySelectorAll('.pn-dsec').forEach(function (s) {
      if (s.id === 'sob-status') return; var h = s.querySelector('h3'); if (!h) return; out.push('== ' + h.textContent.trim() + ' ==');
      s.querySelectorAll('.pn-kv').forEach(function (kv) { var dd = kv.querySelector('dd').cloneNode(true); dd.querySelectorAll('button').forEach(function (x) { x.remove(); }); out.push(kv.querySelector('dt').textContent + ': ' + dd.innerText.replace(/\s+\n/g, '\n').trim()); });
      s.querySelectorAll('.pn-file .meta b').forEach(function (x) { out.push('- ' + x.textContent); });
      out.push('');
    });
    return out.join('\n');
  }

  var sobCur = null;
  function openSob(id) {
    lastFocus = document.activeElement; sobCur = null;
    drawer.innerHTML = '<div class="pn-drawer-head"><div><p class="small muted">Site Sob medida</p><h2 id="pn-drawer-title" style="font-size:22px">Carregando pedido…</h2></div><button type="button" class="pl-btn is-quiet" data-close aria-label="Fechar">Fechar</button></div><div class="pn-drawer-body"><div class="pn-skel"></div><div class="pn-skel tall"></div></div>';
    showDrawer();
    api('/api/v1/pilot/admin/etha-sob-medida/' + encodeURIComponent(id)).then(function (r) {
      if (drawer.hidden) return;
      if (!r.ok) { drawer.querySelector('.pn-drawer-body').innerHTML = '<div class="pn-empty">Não foi possível abrir o pedido (' + esc(r.d.error || r.status) + ').</div>'; return; }
      sobCur = r.d; drawer.innerHTML = sobDetailHtml(r.d); loadThumbs();
      var c = drawer.querySelector('[data-close]'); if (c) c.focus();
    });
  }
  function loadThumbs() {
    drawer.querySelectorAll('[data-thumb]').forEach(function (el) {
      authFetch(el.getAttribute('data-thumb')).then(function (bl) {
        var u = URL.createObjectURL(bl); blobUrls.push(u);
        var im = new Image(); im.alt = ''; im.decoding = 'async'; im.onload = function () { el.classList.add('is-loaded'); }; im.src = u; el.appendChild(im);
      }).catch(function () { el.classList.add('is-broken'); });
    });
  }
  function fileUrl(fid, dl) { return '/api/v1/pilot/admin/etha-sob-medida/' + encodeURIComponent(sobCur.projectId) + '/arquivos/' + encodeURIComponent(fid) + (dl ? '?baixar=1' : ''); }
  function download(fid, name, btn) {
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Baixando…'; }
    return authFetch(fileUrl(fid, true)).then(function (bl) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = name || 'arquivo'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      if (btn) { btn.removeAttribute('aria-busy'); btn.textContent = 'Baixado'; setTimeout(function () { if (btn.isConnected) btn.textContent = 'Baixar'; }, 1600); }
    }).catch(function () { if (btn) { btn.removeAttribute('aria-busy'); btn.textContent = 'Tentar de novo'; } });
  }
  function setSobStatus(btn) {
    var to = btn.getAttribute('data-sob-status'); var conf = btn.getAttribute('data-needs-confirm');
    if (conf && btn.getAttribute('data-confirm') !== '1') {
      var orig = btn.textContent; btn.setAttribute('data-confirm', '1'); btn.textContent = conf;
      setTimeout(function () { if (btn.isConnected) { btn.removeAttribute('data-confirm'); btn.textContent = orig; } }, 4000); return;
    }
    if (btn.getAttribute('aria-busy') === 'true' || !sobCur) return;
    btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="pl-spin" aria-hidden="true"></span>Salvando';
    api('/api/v1/pilot/admin/etha-sob-medida/' + encodeURIComponent(sobCur.projectId) + '/status', { method: 'POST', body: { status: to } }).then(function (r) {
      if (!r.ok) { btn.removeAttribute('aria-busy'); btn.textContent = 'Tentar de novo'; var er = document.getElementById('sob-err'); if (er) er.textContent = r.d.error || 'Não foi possível salvar agora.'; return; }
      Object.assign(sobCur, { status: r.d.status, startedAt: r.d.startedAt, deliveredAt: r.d.deliveredAt });
      sobCur.late = sobCur.status !== 'delivered' && Date.now() > Date.parse(sobCur.dueAt);
      var o = (state.sob || []).find(function (x) { return x.projectId === sobCur.projectId; });
      if (o) Object.assign(o, { status: sobCur.status, startedAt: sobCur.startedAt, deliveredAt: sobCur.deliveredAt, late: sobCur.late });
      var box = document.getElementById('sob-status');
      if (box) { box.innerHTML = stepper(sobCur); box.classList.remove('is-flash'); void box.offsetWidth; box.classList.add('is-flash'); var nb = box.querySelector('.pn-actions .pl-btn'); if (nb) nb.focus(); }
      badges(); if (state.view === 'sob') { var l = document.getElementById('pn-sob-list'); if (l) { var tmp = document.createElement('div'); tmp.innerHTML = sobView(); l.innerHTML = tmp.querySelector('#pn-sob-list').innerHTML; document.querySelector('.pn-seg-scroll').outerHTML = tmp.querySelector('.pn-seg-scroll').outerHTML; placeLens(); } }
    });
  }

  // ── resumo do dia (fechado em Brasília, com histórico) ──
  function dayLabel(day, long) {
    var d = new Date(day + 'T12:00:00Z');
    if (long) { var t = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' }); return t.charAt(0).toUpperCase() + t.slice(1); }
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', timeZone: 'UTC' });
  }
  function deltaTag(n, invert) {
    if (n == null) return '';
    if (n === 0) return ' <small class="pn-delta">=</small>';
    var good = invert ? n < 0 : n > 0;
    return ' <small class="pn-delta ' + (good ? 'up' : 'down') + '">' + (n > 0 ? '+' : '−') + Math.abs(n) + '</small>';
  }
  function digestBlock() {
    var lst = state.digests || [];
    if (!lst.length) return '<div class="pn-empty">O primeiro resumo aparece aqui depois da meia-noite do primeiro dia com convidados. Cada dia fecha às 00h (Brasília) e vai também para o seu e-mail.</div>';
    var cur = lst.find(function (x) { return x.day === state.digestDay; }) || lst[0];
    var t = cur.totals, dl = cur.deltas || {};
    var chipsRow = '<div class="pn-days" role="tablist" aria-label="Dias">' + lst.map(function (x) {
      var on = x.day === cur.day;
      return '<button type="button" role="tab" class="pn-day" data-digest="' + esc(x.day) + '" aria-selected="' + on + '">' + esc(dayLabel(x.day)) + '<b class="num">' + x.totals.active + '</b></button>';
    }).join('') + '</div>';
    var kp = '<div class="pn-kpis four pl-stagger">' +
      '<div class="pn-kpi lg" data-glass="regular" data-glass-tint="enomera"><b class="num">' + t.active + deltaTag(dl.active) + '</b><span>usaram</span></div>' +
      '<div class="pn-kpi lg" data-glass="regular" data-glass-tint="enomera"><b class="num">' + esc(dur(t.activeMs)) + '</b><span>tempo ativo' + (dl.activeMs != null && dl.activeMs !== 0 ? ' · ' + (dl.activeMs > 0 ? '+' : '−') + esc(dur(Math.abs(dl.activeMs))) : '') + '</span></div>' +
      '<div class="pn-kpi lg" data-glass="regular" data-glass-tint="enomera"><b class="num">' + t.sessions + deltaTag(dl.sessions) + '</b><span>sessões</span></div>' +
      '<div class="pn-kpi lg" data-glass="regular" data-glass-tint="enomera"><b class="num">' + t.errors + deltaTag(dl.errors, true) + '</b><span>erros</span></div></div>';
    var hl = '<ul class="pn-insights pl-stagger">' + cur.highlights.map(function (h) { return '<li><b>' + esc(h[0]) + '</b><span>' + esc(h[1]) + '</span></li>'; }).join('') + '</ul>';
    var ppl = cur.people.length ? '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><h3 style="margin-bottom:10px">Quem usou</h3><div class="pn-invites">' + cur.people.map(function (p) {
      return '<div class="pn-invite"><div><b>' + esc(p.name) + '</b> <span class="small muted">' + esc(dur(p.activeMs)) + ' · ' + p.sessions + (p.sessions === 1 ? ' sessão' : ' sessões') + (p.products.length ? ' · ' + esc(p.products.map(prod).join(', ')) : '') + (p.lastStop ? ' · parou em ' + esc(prod(p.lastStop.product) + ' ' + screenLabel(p.lastStop.screen)) : '') + '</span></div>' +
        '<span class="pn-chip ' + (p.returning ? 'ok' : '') + '">' + (p.returning ? 'Voltou' : 'Primeira vez') + '</span></div>';
    }).join('') + '</div></div>' : '';
    var errs = cur.newErrors.length ? '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><h3 style="margin-bottom:10px">Erros novos no dia</h3><div class="pn-invites">' + cur.newErrors.map(function (e) {
      return '<div class="pn-invite"><div><b>' + esc(e.text) + '</b> <span class="small muted">' + esc(prod(e.product)) + (e.screen ? ' · ' + esc(screenLabel(e.screen)) : '') + ' · ' + e.count + 'x</span></div></div>';
    }).join('') + '</div></div>' : '';
    return chipsRow + '<p class="pn-day-title">' + esc(dayLabel(cur.day, true)) + (cur.emailedAt ? ' · <span class="muted small">enviado por e-mail</span>' : '') + '</p>' + kp + hl + (ppl || errs ? '<div class="pn-grid two">' + ppl + errs + '</div>' : '');
  }
  function todoBlock() {
    var c = sobCounts(); var d = state.data; var items = [];
    if (c.late) items.push(['bad', c.late + (c.late === 1 ? ' pedido Sob medida atrasado' : ' pedidos Sob medida atrasados'), 'sob', 'Ver pedidos']);
    if (c['new']) items.push(['', c['new'] + (c['new'] === 1 ? ' pedido Sob medida novo' : ' pedidos Sob medida novos') + ' esperando produção', 'sob', 'Abrir']);
    if (c.production) items.push(['warn', c.production + ' em produção', 'sob', 'Acompanhar']);
    var errN = d.errors.length + d.apiFailures.length;
    if (errN) items.push(['bad', errN + (errN === 1 ? ' tipo de erro' : ' tipos de erro') + ' nos últimos ' + d.days + ' dias', 'erros', 'Ver erros']);
    var open = d.invites.filter(function (i) { return i.state === 'open' && i.kind !== 'admin'; }).length;
    if (open) items.push(['mute', open + (open === 1 ? ' convite ainda não usado' : ' convites ainda não usados'), 'convites', 'Ver convites']);
    if (!items.length) return '<div class="pn-todo is-clear"><span class="pn-chip ok">Tudo em dia</span><span class="muted small">Nenhum pedido esperando, nenhum erro no período.</span></div>';
    return '<div class="pn-todo pl-stagger">' + items.map(function (x) { return '<a class="pn-todo-item" href="#' + x[2] + '"><span class="pn-dot ' + x[0] + '" aria-hidden="true"></span><span>' + esc(x[1]) + '</span><b>' + x[3] + '</b></a>'; }).join('') + '</div>';
  }

  // ── vistas ──
  var VIEWS = ['dia', 'uso', 'sob', 'convites', 'erros'];
  function viewFromHash() { var h = location.hash.replace('#', ''); return VIEWS.indexOf(h) >= 0 ? h : 'dia'; }
  function viewHtml(v) {
    var d = state.data; var t = d.totals; var scope = d.includeSelfTest ? 'Inclui sua conta de teste.' : 'Sua conta de teste e seu acesso de administrador não entram.';
    if (v === 'dia') return '<div class="pn-head"><div><h1>Resumo do dia</h1><p>Cada dia fecha à meia-noite (Brasília) e é comparado com o anterior. Só você vê.</p></div><span class="pn-updated">Atualizado ' + esc(when(d.generatedAt)) + '</span></div>' +
      '<section class="pn-section"><h2 class="pn-sub">Para você agora</h2>' + todoBlock() + '</section>' +
      '<section class="pn-section"><h2 class="pn-sub">Dias fechados</h2><div id="pn-digest">' + digestBlock() + '</div></section>';
    if (v === 'uso') {
      var noUse = t.active === 0;
      return '<div class="pn-head"><div><h1>Convidados e uso</h1><p>O que as pessoas convidadas fazem de fato nos produtos, nos últimos ' + d.days + ' dias. ' + scope + '</p></div><span class="pn-updated">Atualizado ' + esc(when(d.generatedAt)) + '</span></div>' +
        '<nav class="pn-jump" aria-label="Ir para"><a href="#uso/pessoas">Pessoas</a><a href="#uso/funcionalidades">Funcionalidades</a><a href="#uso/telas">Telas</a><a href="#uso/mapa">Mapa de cliques</a></nav>' +
        '<div class="pn-kpis pl-stagger">' + kpi('entraram', t.joined + '/' + t.invited) + kpi('usaram no período', t.active) + kpi('voltaram outro dia', t.returned) + kpi('tempo ativo', dur(t.activeMs)) + kpi('sessões', t.sessions) + kpi('erros', t.errors) + '</div>' +
        (noUse ? '<div class="pn-empty">' + (t.joined ? 'As contas já existem, mas ainda não há uso registrado no período.' : 'Ninguém aceitou o convite ainda. Envie os links em Convites.') + ' Os números aparecem aqui assim que a primeira pessoa usar.</div>' : insights(d)) +
        '<section class="pn-section" id="pessoas"><div class="pn-head"><div><h2>Pessoas</h2><p>Toque em uma pessoa para ver as sessões, o caminho percorrido e o registro técnico.</p></div></div>' +
        (d.participants.length ? '<div class="pn-people pl-stagger">' + d.participants.map(personCard).join('') + '</div>' : '<div class="pn-empty">Nenhum convidado entrou ainda.</div>') +
        (d.participants.length ? '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><h3 style="margin-bottom:10px">Retorno dia a dia</h3>' + retention(d) + '</div>' : '') + '</section>' +
        '<section class="pn-section" id="funcionalidades"><div class="pn-head"><div><h2>Funcionalidades</h2><p>Quantas das pessoas que usaram no período chegaram a cada função. Barra vazia é função que ninguém usou.</p></div></div>' +
        '<div class="pn-grid two"><div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><div class="pn-bars">' + featuresBlock(d) + '</div></div>' +
        '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><h3 style="margin-bottom:10px">Onde mais tocaram</h3><div class="pn-bars">' + elementsBlock(d) + '</div>' +
        (d.frustration.length ? '<h3 style="margin:18px 0 10px">Sinais de frustração</h3><div class="pn-bars">' + d.frustration.slice(0, 6).map(function (e) { return bar(e.target, prod(e.product), e.rage * 3 + e.dead, d.frustration[0].rage * 3 + d.frustration[0].dead, e.rage + ' rep. · ' + e.dead + ' s/ef.', 'Toques repetidos: ' + e.rage + ' · sem efeito: ' + e.dead); }).join('') + '</div>' : '') +
        '</div></div></section>' +
        '<section class="pn-section" id="telas"><div class="pn-head"><div><h2>Telas</h2><p>Tempo ativo conta só com a tela visível e alguém mexendo nos últimos 30 segundos. "Saída aqui" é a parcela das visitas em que a sessão terminou nessa tela.</p></div></div>' + screensTable(d) + '</section>' +
        '<section class="pn-section" id="mapa"><div class="pn-head"><div><h2>Mapa de cliques</h2><p>Cada ponto é um toque, na posição relativa da página inteira (largura da tela × altura rolada). Anel vermelho marca toque repetido.</p></div></div>' + heatShell(d) + '</section>';
    }
    if (v === 'sob') return sobView();
    if (v === 'convites') return '<div class="pn-head"><div><h1>Convites</h1><p>Cada link cria uma conta uma única vez. Crie mais quando quiser chamar outra pessoa. No piloto, tudo é grátis para quem entra por convite.</p></div><button type="button" class="pl-btn is-ghost" id="pn-export">Baixar dados (JSON)</button></div>' +
      '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera" id="pn-invites-card">' + invitesBlock(d) + '</div>';
    return '<div class="pn-head"><div><h1>Erros e depuração</h1><p>Erros de JavaScript, mensagens de console.error e chamadas à Core que falharam nos últimos ' + d.days + ' dias, agrupados. Toque para ver telas, arquivo e pilha.</p></div><span class="pn-updated">Atualizado ' + esc(when(d.generatedAt)) + '</span></div>' + errorsBlock(d);
  }
  function badges() {
    var c = sobCounts(); var d = state.data; if (!d) return;
    var set = function (v, n, bad) { var el = document.querySelector('.pn-nav [data-view="' + v + '"] .pn-badge'); if (!el) return; el.textContent = n || ''; el.hidden = !n; el.classList.toggle('bad', Boolean(bad)); };
    set('sob', c['new'] + c.production, c.late); set('erros', d.errors.length + d.apiFailures.length, true);
  }
  function placeTab() {
    var nav = document.getElementById('pn-nav'); var on = nav.querySelector('[aria-current="page"]'); var lens = nav.querySelector('.pn-tab-lens'); if (!on || !lens) return;
    lens.style.width = on.offsetWidth + 'px'; lens.style.transform = 'translateX(' + (on.offsetLeft - nav.scrollLeft) + 'px)';
    var l = on.offsetLeft, r = l + on.offsetWidth; if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: l - 16, behavior: reduced ? 'auto' : 'smooth' });
  }
  function render(isRefresh) {
    var prevView = state.view; var v = viewFromHash(); state.view = v;
    document.querySelectorAll('.pn-nav [data-view]').forEach(function (a) { if (a.getAttribute('data-view') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.getElementById('pn-period').hidden = !(v === 'uso' || v === 'erros'); document.getElementById('pn-teste').hidden = v !== 'uso';
    badges(); placeTab();
    var html = '<div class="pn-view" data-view="' + v + '">' + viewHtml(v) + '</div>';
    var after = function () { placeLens(); if (v === 'uso') drawHeat(); var sub = location.hash.split('/')[1]; if (sub && !isRefresh) { var el = document.getElementById(sub); if (el) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); } };
    if (isRefresh && prevView === v) { var y = scrollY; main.innerHTML = html; scrollTo(0, y); after(); return; }
    var dir = VIEWS.indexOf(v) >= VIEWS.indexOf(prevView || 'dia') ? 1 : -1; main.style.setProperty('--dir', dir);
    swap(html, function () { if (prevView && prevView !== v) scrollTo(0, 0); after(); });
  }
  addEventListener('hashchange', function () {
    if (!state.data) return;
    var v = viewFromHash(); if (v === state.view && location.hash.indexOf('/') > 0) { var el = document.getElementById(location.hash.split('/')[1]); if (el) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); return; }
    render(false);
  });

  // ── mapa de cliques (filtros em chips, sem lista nativa) ──
  function heatShell(d) {
    var opts = d.screens.filter(function (s) { return s.clicks > 0; });
    if (!opts.length) return '<div class="pn-empty">Sem toques registrados ainda.</div>';
    if (!opts.some(function (s) { return s.product === state.heat.product && s.screen === state.heat.screen; })) { state.heat.product = opts[0].product; state.heat.screen = opts[0].screen; }
    return '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><div class="pn-heat-controls">' +
      '<p class="pn-pick-l" id="h-screen-l">Tela</p><div class="pn-pick" role="group" aria-labelledby="h-screen-l">' + opts.map(function (s) { var v = s.product + '|' + s.screen; return '<button type="button" data-hscreen="' + esc(v) + '" aria-pressed="' + (s.product === state.heat.product && s.screen === state.heat.screen) + '">' + esc(prod(s.product)) + ' <span class="scr">' + esc(screenLabel(s.screen)) + '</span> <b class="num">' + s.clicks + '</b></button>'; }).join('') + '</div>' +
      '<p class="pn-pick-l" id="h-person-l">Pessoa</p><div class="pn-pick" role="group" aria-labelledby="h-person-l"><button type="button" data-hperson="" aria-pressed="' + (!state.heat.participant) + '">Todas</button>' + d.participants.map(function (p) { return '<button type="button" data-hperson="' + esc(p.id) + '" aria-pressed="' + (state.heat.participant === p.id) + '">' + esc(p.name) + '</button>'; }).join('') + '</div>' +
      '<div class="pl-seg" role="group" aria-label="Formato da tela" id="h-form"><span class="pl-lens" aria-hidden="true"></span><button type="button" data-form="" aria-pressed="' + (!state.heat.form) + '">Todos</button><button type="button" data-form="celular" aria-pressed="' + (state.heat.form === 'celular') + '">Celular</button><button type="button" data-form="computador" aria-pressed="' + (state.heat.form === 'computador') + '">Computador</button></div>' +
      '</div><div class="pn-heat" style="margin-top:14px"><div id="h-canvas"></div><div><h3 style="margin-bottom:10px">Elementos tocados nesta tela</h3><div class="pn-bars" id="h-targets"></div></div></div></div>';
  }

  var heatReq = 0;
  function drawHeat() {
    var holder = document.getElementById('h-canvas'); if (!holder) return;
    var h = state.heat; var my = ++heatReq;
    var q = '?produto=' + encodeURIComponent(h.product) + '&tela=' + encodeURIComponent(h.screen) + (h.participant ? '&participante=' + encodeURIComponent(h.participant) : '') + (h.form ? '&formato=' + h.form : '') + (state.teste ? '&teste=1' : '');
    api('/api/v1/pilot/admin/heatmap' + q).then(function (r) {
      if (my !== heatReq || !r.ok) return;
      var d = r.d; var wrapW = Math.min(holder.clientWidth || 360, d.ratio > 1.2 ? 340 : 9999);
      var wrapH = Math.min(Math.round(wrapW * d.ratio), 900);
      holder.innerHTML = '<div class="pn-canvas-wrap pl-in" style="width:' + wrapW + 'px;height:' + wrapH + 'px"><canvas role="img" aria-label="' + d.points.length + ' toques nesta tela. A lista ao lado mostra os elementos."></canvas></div>';
      var cv = holder.querySelector('canvas'); var dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = wrapW * dpr; cv.height = wrapH * dpr; var ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
      var viz = getComputedStyle(document.documentElement).getPropertyValue('--viz').trim().split(/\s+/).join(',');
      var bad = getComputedStyle(document.documentElement).getPropertyValue('--bad').trim();
      ctx.globalCompositeOperation = 'source-over';
      d.points.forEach(function (p) {
        var x = p[0] / 1000 * wrapW; var y = p[1] / 1000 * wrapH;
        var g = ctx.createRadialGradient(x, y, 0, x, y, 18); g.addColorStop(0, 'rgba(' + viz + ',.42)'); g.addColorStop(1, 'rgba(' + viz + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
      });
      d.points.forEach(function (p) {
        var x = p[0] / 1000 * wrapW; var y = p[1] / 1000 * wrapH;
        ctx.fillStyle = 'rgba(' + viz + ',.95)'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        if (p[2]) { ctx.strokeStyle = bad; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke(); }
      });
      var tg = document.getElementById('h-targets'); var max = d.targets.length ? d.targets[0].clicks : 0;
      tg.innerHTML = d.targets.length ? d.targets.map(function (t) { return bar(t.target, '', t.clicks, max, t.clicks + 'x', t.target); }).join('') : '<div class="pn-empty">Sem toques com esse filtro.</div>';
      placeLens();
    });
  }


  // ── detalhe da pessoa ──
  var drawer = document.getElementById('pn-drawer'); var scrim = document.getElementById('pn-scrim'); var lastFocus = null;
  function openPerson(id) {
    var p = state.data.participants.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    lastFocus = document.activeElement;
    var feats = p.features;
    drawer.innerHTML = '<div class="pn-drawer-head"><div><p class="small muted">' + esc(p.label) + ' · ' + esc(p.email) + '</p><h2 id="pn-drawer-title" style="font-size:22px">' + esc(p.name) + '</h2><p class="small muted">Entrou ' + esc(when(p.joinedAt)) + ' · ' + esc(p.devices.join(' / ') || 'sem aparelho registrado') + '</p></div><button type="button" class="pl-btn is-quiet" data-close aria-label="Fechar">Fechar</button></div>' +
      '<div class="pn-drawer-body pl-stagger">' +
      '<div class="pn-stats"><div><b>' + dur(p.activeMs) + '</b><span>tempo ativo</span></div><div><b>' + dur(p.avgSessionMs) + '</b><span>por sessão</span></div><div><b>' + p.daysActive + '</b><span>dias com uso</span></div><div><b>' + p.rage + '/' + p.dead + '</b><span>repetidos / sem efeito</span></div></div>' +
      '<div><h3 style="margin-bottom:8px">Funções</h3><div class="pn-bars">' + feats.map(function (f) { return '<div class="pn-feat"><span>' + esc(f.label) + ' <small class="muted">' + esc(prod(f.product)) + '</small></span><span>' + (f.used ? '<span class="pn-chip ok">usou</span>' : '<span class="pn-chip mute">não usou</span>') + '</span></div>'; }).join('') + '</div></div>' +
      '<div><h3 style="margin-bottom:8px">Telas onde passou mais tempo</h3><div class="pn-bars">' + (p.topScreens.length ? p.topScreens.map(function (s) { return bar(screenLabel(s.screen), prod(s.product), s.activeMs, p.topScreens[0].activeMs, dur(s.activeMs)); }).join('') : '<p class="muted small">Sem dados.</p>') + '</div></div>' +
      '<div><h3 style="margin-bottom:8px">Sessões recentes</h3><div class="pn-sessions">' + (p.recentSessions.length ? p.recentSessions.map(function (s) {
        return '<div class="pn-session"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b class="small">' + esc(when(s.start)) + '</b><span class="small muted">' + dur(s.activeMs) + ' · ' + s.clicks + ' toques' + (s.errors ? ' · <span class="pn-hot">' + s.errors + ' erros</span>' : '') + '</span></div>' +
          '<div class="pn-path">' + s.path.map(function (x, i) { return (i ? '<i>→</i>' : '') + '<span>' + esc(prod(x.product)) + ' ' + esc(screenLabel(x.screen)) + '</span>'; }).join('') + (s.pathLength > s.path.length ? '<i>… +' + (s.pathLength - s.path.length) + '</i>' : '') + '</div></div>';
      }).join('') : '<p class="muted small">Nenhuma sessão ainda.</p>') + '</div></div>' +
      '<div><h3 style="margin-bottom:8px">Registro técnico (últimos eventos)</h3><div class="pn-log" id="pn-log"><span class="muted">Carregando…</span></div></div>' +
      '</div>';
    showDrawer();
    api('/api/v1/pilot/admin/participants/' + encodeURIComponent(id) + '/timeline').then(function (r) {
      var log = document.getElementById('pn-log'); if (!log || !r.ok) return;
      log.innerHTML = r.d.events.length ? r.d.events.slice(0, 300).map(function (e) {
        var t = new Date(e.occurred_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        var extra = e.type === 'api' ? ' → ' + (e.meta.status) + (e.meta.code ? ' ' + e.meta.code : '') + ' · ' + e.n + ' ms' : e.type === 'time' ? ' · ' + dur(e.n) : e.type === 'load' ? ' · ' + e.n + ' ms' : '';
        return '<div class="t-' + esc(e.type) + '"><span>' + t + '</span><span>' + esc(e.type) + '</span><span>' + esc(prod(e.product)) + ' ' + esc(e.screen) + (e.target ? ' · ' + esc(e.target) : '') + esc(extra) + '</span></div>';
      }).join('') : '<span class="muted">Sem eventos.</span>';
    });
  }
  function showDrawer() {
    drawer.hidden = false; scrim.hidden = false; drawer.scrollTop = 0;
    requestAnimationFrame(function () { requestAnimationFrame(function () { drawer.classList.add('is-on'); scrim.classList.add('is-on'); }); });
    setTimeout(function () { var c = drawer.querySelector('[data-close]'); if (c) c.focus(); }, 60);
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    sobCur = null; blobUrls.splice(0).forEach(function (u) { URL.revokeObjectURL(u); });
    drawer.classList.remove('is-on'); scrim.classList.remove('is-on'); document.body.style.overflow = '';
    setTimeout(function () { drawer.hidden = true; scrim.hidden = true; }, reduced ? 0 : 220);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  scrim.addEventListener('click', closeDrawer);
  addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
    if (e.key === 'Tab' && !drawer.hidden) {
      var f = drawer.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])'); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // ── lentes dos segmentos ──
  function placeLens() {
    document.querySelectorAll('.pl-seg').forEach(function (seg) {
      var on = seg.querySelector('[aria-pressed="true"]'); var lens = seg.querySelector('.pl-lens'); if (!on || !lens) return;
      lens.style.width = on.offsetWidth + 'px'; lens.style.transform = 'translateX(' + on.offsetLeft + 'px)';
    });
  }
  // A lente se mede de novo quando a fonte termina de carregar ou o grupo muda de tamanho
  // (antes ficava torta no celular: media com a fonte reserva e com o grupo ainda escondido).
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placeLens(); placeTab(); });
  if (window.ResizeObserver) { var pnRO = new ResizeObserver(function () { placeLens(); }); ['pn-period', 'pn-tools'].forEach(function (id) { var el = document.getElementById(id); if (el) pnRO.observe(el); }); }
  addEventListener('resize', function () { placeLens(); placeTab(); clearTimeout(window.__pnR); window.__pnR = setTimeout(drawHeat, 200); });

  // Abas que passam da largura: sombra de continuação nas bordas e aba ativa sempre à vista.
  function navFade() {
    var nav = document.getElementById('pn-nav'); if (!nav || nav.hidden) return;
    nav.toggleAttribute('data-more-start', nav.scrollLeft > 4);
    nav.toggleAttribute('data-more-end', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
  }
  document.getElementById('pn-nav').addEventListener('scroll', function () { placeTab(); navFade(); }, { passive: true });
  addEventListener('resize', navFade);

  // ── dicas ──
  var tip = document.getElementById('pn-tip');
  document.addEventListener('pointerover', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]'); if (!el || !el.getAttribute('data-tip')) { tip.classList.remove('is-on'); return; }
    tip.textContent = el.getAttribute('data-tip'); tip.hidden = false;
    var r = el.getBoundingClientRect(); var tw = Math.min(280, tip.offsetWidth);
    tip.style.left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px'; tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + 'px';
    tip.classList.add('is-on');
  });
  document.addEventListener('scroll', function () { tip.classList.remove('is-on'); }, { passive: true });

  // ── ações ──
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var b;
    if ((b = t.closest('[data-dias]'))) { document.querySelectorAll('[data-dias]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); placeLens(); state.dias = Number(b.getAttribute('data-dias')); load(); return; }
    if ((b = t.closest('#pn-refresh'))) { load(); return; }
    if ((b = t.closest('#pn-teste'))) { state.teste = !state.teste; b.setAttribute('aria-pressed', String(state.teste)); load(); return; }
    if ((b = t.closest('[data-person]'))) { openPerson(b.getAttribute('data-person')); return; }
    if ((b = t.closest('[data-close]'))) { closeDrawer(); return; }
    if ((b = t.closest('[data-sort]'))) {
      var k = b.getAttribute('data-sort'); state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'product' || k === 'screen' ? 1 : -1) };
      var sec = document.getElementById('telas'); var tbl = sec.querySelector('.pn-table, .pn-empty'); if (tbl) tbl.outerHTML = screensTable(state.data);
      var nb = document.querySelector('[data-sort="' + k + '"]'); if (nb) nb.focus(); return;
    }
    if ((b = t.closest('#h-form [data-form]'))) { document.querySelectorAll('#h-form [data-form]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); placeLens(); state.heat.form = b.getAttribute('data-form'); drawHeat(); return; }
    if ((b = t.closest('[data-copy]'))) { var v = b.getAttribute('data-copy'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { var lb = b.getAttribute('data-copy-label') || 'Copiar link'; b.textContent = 'Copiado'; setTimeout(function () { if (b.isConnected) b.textContent = lb; }, 1600); }).catch(function () { b.textContent = 'Selecione e copie'; }); return; }
    if ((b = t.closest('[data-revoke]'))) {
      if (!b.hasAttribute('data-hold') && b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Confirmar cancelamento'; setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-confirm'); b.textContent = 'Cancelar'; } }, 4000); return; }
      api('/api/v1/pilot/admin/invites/' + encodeURIComponent(b.getAttribute('data-revoke')) + '/revoke', { method: 'POST', body: {} }).then(function () { load(); }); return;
    }
    if ((b = t.closest('[data-digest]'))) {
      state.digestDay = b.getAttribute('data-digest');
      var box = document.getElementById('pn-digest'); if (box) { box.innerHTML = digestBlock(); var nb2 = box.querySelector('[data-digest="' + state.digestDay + '"]'); if (nb2) nb2.focus(); }
      return;
    }
    if ((b = t.closest('[data-sob-open]'))) { openSob(b.getAttribute('data-sob-open')); return; }
    if ((b = t.closest('[data-sob-filter]'))) {
      state.sobFilter = b.getAttribute('data-sob-filter'); b.parentElement.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); placeLens();
      var tmp = document.createElement('div'); tmp.innerHTML = sobView(); var l = document.getElementById('pn-sob-list'); if (l) l.innerHTML = tmp.querySelector('#pn-sob-list').innerHTML; return;
    }
    if ((b = t.closest('[data-sob-status]'))) { setSobStatus(b); return; }
    if ((b = t.closest('[data-dl]'))) { download(b.getAttribute('data-dl'), b.getAttribute('data-dl-name'), b); return; }
    if ((b = t.closest('[data-dl-all]'))) {
      if (!sobCur || b.getAttribute('aria-busy') === 'true') return; b.setAttribute('aria-busy', 'true'); b.textContent = 'Baixando…';
      sobCur.files.reduce(function (p, f) { return p.then(function () { return download(f.id, f.name); }).then(function () { return new Promise(function (ok) { setTimeout(ok, 350); }); }); }, Promise.resolve())
        .then(function () { b.removeAttribute('aria-busy'); b.textContent = 'Baixados'; setTimeout(function () { if (b.isConnected) b.textContent = 'Baixar todos'; }, 1800); }); return;
    }
    if ((b = t.closest('[data-open-file]')) && sobCur) {
      var w = window.open('', '_blank'); var fid = b.getAttribute('data-open-file');
      authFetch(fileUrl(fid, false)).then(function (bl) { var u = URL.createObjectURL(bl); blobUrls.push(u); if (w) w.location = u; else location.assign(u); }).catch(function () { if (w) w.close(); b.textContent = 'Tentar de novo'; }); return;
    }
    if ((b = t.closest('[data-copy-brief]'))) {
      if (!sobCur) return; var text = briefText(sobCur);
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { b.textContent = 'Briefing copiado'; setTimeout(function () { if (b.isConnected) b.textContent = 'Copiar briefing em texto'; }, 1800); }).catch(function () { b.textContent = 'Não deu para copiar'; }); return;
    }
    if ((b = t.closest('[data-hscreen]'))) { var hv = b.getAttribute('data-hscreen').split('|'); state.heat.product = hv[0]; state.heat.screen = hv.slice(1).join('|'); b.parentElement.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawHeat(); return; }
    if ((b = t.closest('[data-hperson]'))) { state.heat.participant = b.getAttribute('data-hperson'); b.parentElement.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawHeat(); return; }
    if ((b = t.closest('#pn-export'))) {
      var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' }); var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'piloto-uso-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); return;
    }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'pn-new-invite') return; e.preventDefault();
    var input = document.getElementById('ni-label'); var label = input.value.trim();
    if (!label) { document.getElementById('ni-err').textContent = 'Dê um nome para lembrar de quem é o convite.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    var btn = e.target.querySelector('button[type=submit]'); btn.setAttribute('aria-busy', 'true');
    api('/api/v1/pilot/admin/invites', { method: 'POST', body: { label: label } }).then(function (r) {
      btn.removeAttribute('aria-busy');
      if (!r.ok) { document.getElementById('ni-err').textContent = r.d.error || 'Não foi possível criar.'; return; }
      state.newLink = r.d;
      api('/api/v1/pilot/admin/overview?dias=' + state.dias + (state.teste ? '&teste=1' : '')).then(function (o) { if (o.ok) { state.data = o.d; document.getElementById('pn-invites-card').innerHTML = invitesBlock(o.d); } });
    });
  });

  setInterval(function () { if (document.visibilityState === 'visible' && state.data && drawer.hidden) load(); }, 60000);
  load(true);
})();
