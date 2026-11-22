/* Painel do piloto · só para o administrador. Dados de /api/v1/pilot/admin/*. */
(function () {
  'use strict';
  var TOKEN_KEY = 'enomera_session_token_v1';
  var main = document.getElementById('pn');
  var state = { dias: 14, teste: false, data: null, sort: { key: 'activeMs', dir: -1 }, heat: { product: '', screen: '', participant: '', form: '' }, newLink: null };
  var PRODUCTS = { enomera: 'Enomera', ambo: 'Ambo', minne: 'Minne', etha: 'Etha', site: 'Site da profissional' };
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
      '<p class="pl-err" id="l-err" role="alert">' + esc(errText || '') + '</p>' +
      '<button class="pl-btn" type="submit">Entrar</button></form>', function () {
      var f = document.getElementById('pn-login'); setTimeout(function () { document.getElementById('l-email').focus(); }, 60);
      f.addEventListener('submit', function (e) {
        e.preventDefault(); var btn = f.querySelector('button[type=submit]'); if (btn.getAttribute('aria-busy') === 'true') return;
        var email = f.querySelector('#l-email').value.trim(); var pass = f.querySelector('#l-pass').value;
        if (!email || !pass) { document.getElementById('l-err').textContent = 'Preencha e-mail e senha.'; return; }
        btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="pl-spin" aria-hidden="true"></span>Entrando';
        api('/api/v1/auth/login', { method: 'POST', body: { email: email, password: pass } }).then(function (r) {
          btn.removeAttribute('aria-busy'); btn.textContent = 'Entrar';
          if (!r.ok) { document.getElementById('l-err').textContent = r.d.error || 'Não foi possível entrar.'; return; }
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
      document.getElementById('pn-nav').hidden = false; document.getElementById('pn-tools').hidden = false; placeLens();
      if (!state.heat.screen && r.d.screens.length) { state.heat.product = r.d.screens[0].product; state.heat.screen = r.d.screens[0].screen; }
      render(Boolean(prev));
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
        '<td class="n' + (s.exitRate >= 50 && s.views >= 2 ? ' pn-hot' : '') + '">' + s.exitRate + '%</td><td class="n">' + (s.avgScroll == null ? '—' : s.avgScroll + '%') + '</td><td class="n">' + s.clicks + '</td>' +
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
          '<div style="display:flex;gap:8px;align-items:center"><span class="pn-chip ' + l[1] + '">' + l[0] + '</span>' + (i.state === 'open' && i.kind !== 'admin' ? '<button type="button" class="pl-btn is-ghost" data-revoke="' + esc(i.id) + '">Cancelar</button>' : '') + '</div></div>';
      }).join('') + '</div>' +
      '<form class="pn-form-inline" id="pn-new-invite" novalidate><div class="pl-field"><label for="ni-label">Novo convite para</label><input id="ni-label" maxlength="60" placeholder="Ex.: Convidado 3 · psicóloga de Recife" aria-describedby="ni-err"><p class="pl-err" id="ni-err"></p></div><button class="pl-btn" type="submit">Criar link</button></form>';
  }

  function render(isRefresh) {
    var d = state.data; var t = d.totals;
    var noUse = t.active === 0;
    var html =
      '<section class="pn-section" id="resumo"><div class="pn-head"><div><h1>Uso real do piloto</h1><p>O que as pessoas convidadas fazem de fato nos produtos, nos últimos ' + d.days + ' dias. ' + (d.includeSelfTest ? 'Inclui sua conta de teste.' : 'Sua conta de teste e seu acesso de administrador não entram.') + '</p></div><span class="pn-updated">Atualizado ' + esc(when(d.generatedAt)) + '</span></div>' +
      '<div class="pn-kpis pl-stagger">' + kpi('entraram', t.joined + '/' + t.invited) + kpi('usaram no período', t.active) + kpi('voltaram outro dia', t.returned) + kpi('tempo ativo', dur(t.activeMs)) + kpi('sessões', t.sessions) + kpi('erros', t.errors) + '</div>' +
      (noUse ? '<div class="pn-empty">' + (t.joined ? 'As contas já existem, mas ainda não há uso registrado no período.' : 'Ninguém aceitou o convite ainda. Envie os links da seção Convites.') + ' Os números aparecem aqui assim que a primeira pessoa usar.</div>' : insights(d)) + '</section>' +

      '<section class="pn-section" id="pessoas"><div class="pn-head"><div><h2>Pessoas</h2><p>Toque em uma pessoa para ver as sessões, o caminho percorrido e o registro técnico.</p></div></div>' +
      (d.participants.length ? '<div class="pn-people pl-stagger">' + d.participants.map(personCard).join('') + '</div>' : '<div class="pn-empty">Nenhum convidado entrou ainda.</div>') +
      (d.participants.length ? '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><h3 style="margin-bottom:10px">Retorno dia a dia</h3>' + retention(d) + '</div>' : '') + '</section>' +

      '<section class="pn-section" id="funcionalidades"><div class="pn-head"><div><h2>Funcionalidades</h2><p>Quantas das pessoas que usaram no período chegaram a cada função. Barra vazia é função que ninguém usou.</p></div></div>' +
      '<div class="pn-grid two"><div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><div class="pn-bars">' + featuresBlock(d) + '</div></div>' +
      '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><h3 style="margin-bottom:10px">Onde mais tocaram</h3><div class="pn-bars">' + elementsBlock(d) + '</div>' +
      (d.frustration.length ? '<h3 style="margin:18px 0 10px">Sinais de frustração</h3><div class="pn-bars">' + d.frustration.slice(0, 6).map(function (e) { return bar(e.target, prod(e.product), e.rage * 3 + e.dead, d.frustration[0].rage * 3 + d.frustration[0].dead, e.rage + ' rep. · ' + e.dead + ' s/ef.', 'Toques repetidos: ' + e.rage + ' · sem efeito: ' + e.dead); }).join('') + '</div>' : '') +
      '</div></div></section>' +

      '<section class="pn-section" id="telas"><div class="pn-head"><div><h2>Telas</h2><p>Tempo ativo conta só com a tela visível e alguém mexendo nos últimos 30 segundos. "Saída aqui" é a parcela das visitas em que a sessão terminou nessa tela.</p></div></div>' + screensTable(d) + '</section>' +

      '<section class="pn-section" id="mapa"><div class="pn-head"><div><h2>Mapa de cliques</h2><p>Cada ponto é um toque, na posição relativa da página inteira (largura da tela × altura rolada). Anel vermelho marca toque repetido.</p></div></div>' + heatShell(d) + '</section>' +

      '<section class="pn-section" id="erros"><div class="pn-head"><div><h2>Erros e depuração</h2><p>Erros de JavaScript, mensagens de console.error e chamadas à Core que falharam, agrupados.</p></div></div>' + errorsBlock(d) + '</section>' +

      '<section class="pn-section" id="convites"><div class="pn-head"><div><h2>Convites</h2><p>Cada link cria uma conta uma única vez. Crie mais quando quiser chamar outra pessoa.</p></div><button type="button" class="pl-btn is-ghost" id="pn-export">Baixar dados (JSON)</button></div>' +
      '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera" id="pn-invites-card">' + invitesBlock(d) + '</div></section>';
    var y = scrollY;
    if (isRefresh) { main.innerHTML = html; scrollTo(0, y); } else swap(html);
    setTimeout(function () { drawHeat(); spy(); }, isRefresh ? 0 : 200);
  }

  // ── mapa de cliques ──
  function heatShell(d) {
    if (!d.screens.length) return '<div class="pn-empty">Sem toques registrados ainda.</div>';
    var opts = d.screens.filter(function (s) { return s.clicks > 0; });
    if (!opts.length) return '<div class="pn-empty">Sem toques registrados ainda.</div>';
    if (!opts.some(function (s) { return s.product === state.heat.product && s.screen === state.heat.screen; })) { state.heat.product = opts[0].product; state.heat.screen = opts[0].screen; }
    return '<div class="pn-card lg" data-glass="regular" data-glass-tint="enomera"><div class="pn-heat-controls">' +
      '<label class="eno-sr-only" for="h-screen">Tela</label><select class="pl-select" id="h-screen">' + opts.map(function (s) { var v = s.product + '|' + s.screen; return '<option value="' + esc(v) + '"' + (s.product === state.heat.product && s.screen === state.heat.screen ? ' selected' : '') + '>' + esc(prod(s.product) + ' · ' + screenLabel(s.screen) + ' (' + s.clicks + ')') + '</option>'; }).join('') + '</select>' +
      '<label class="eno-sr-only" for="h-person">Pessoa</label><select class="pl-select" id="h-person"><option value="">Todas as pessoas</option>' + d.participants.map(function (p) { return '<option value="' + esc(p.id) + '"' + (state.heat.participant === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' +
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
    drawer.hidden = false; scrim.hidden = false;
    requestAnimationFrame(function () { requestAnimationFrame(function () { drawer.classList.add('is-on'); scrim.classList.add('is-on'); }); });
    setTimeout(function () { var c = drawer.querySelector('[data-close]'); if (c) c.focus(); }, 60);
    document.body.style.overflow = 'hidden';
    api('/api/v1/pilot/admin/participants/' + encodeURIComponent(id) + '/timeline').then(function (r) {
      var log = document.getElementById('pn-log'); if (!log || !r.ok) return;
      log.innerHTML = r.d.events.length ? r.d.events.slice(0, 300).map(function (e) {
        var t = new Date(e.occurred_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        var extra = e.type === 'api' ? ' → ' + (e.meta.status) + (e.meta.code ? ' ' + e.meta.code : '') + ' · ' + e.n + ' ms' : e.type === 'time' ? ' · ' + dur(e.n) : e.type === 'load' ? ' · ' + e.n + ' ms' : '';
        return '<div class="t-' + esc(e.type) + '"><span>' + t + '</span><span>' + esc(e.type) + '</span><span>' + esc(prod(e.product)) + ' ' + esc(e.screen) + (e.target ? ' · ' + esc(e.target) : '') + esc(extra) + '</span></div>';
      }).join('') : '<span class="muted">Sem eventos.</span>';
    });
  }
  function closeDrawer() {
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
  addEventListener('resize', function () { placeLens(); clearTimeout(window.__pnR); window.__pnR = setTimeout(drawHeat, 200); });

  // ── navegação ativa ──
  var spyObs = null;
  function spy() {
    if (spyObs) spyObs.disconnect();
    var links = document.querySelectorAll('.pn-nav a');
    spyObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) links.forEach(function (a) { a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + en.target.id)); }); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('.pn-section').forEach(function (s) { spyObs.observe(s); });
  }

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
    if ((b = t.closest('[data-copy]'))) { var v = b.getAttribute('data-copy'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { b.textContent = 'Copiado'; setTimeout(function () { b.textContent = 'Copiar link'; }, 1600); }).catch(function () { b.textContent = 'Selecione e copie'; }); return; }
    if ((b = t.closest('[data-revoke]'))) {
      if (b.getAttribute('data-confirm') !== '1') { b.setAttribute('data-confirm', '1'); b.textContent = 'Confirmar cancelamento'; setTimeout(function () { if (b.isConnected) { b.removeAttribute('data-confirm'); b.textContent = 'Cancelar'; } }, 4000); return; }
      api('/api/v1/pilot/admin/invites/' + encodeURIComponent(b.getAttribute('data-revoke')) + '/revoke', { method: 'POST', body: {} }).then(function () { load(); }); return;
    }
    if ((b = t.closest('#pn-export'))) {
      var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' }); var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'piloto-uso-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); return;
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'h-screen') { var v = e.target.value.split('|'); state.heat.product = v[0]; state.heat.screen = v.slice(1).join('|'); drawHeat(); }
    if (e.target.id === 'h-person') { state.heat.participant = e.target.value; drawHeat(); }
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
