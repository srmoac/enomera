const TOKEN_KEY = 'enomera_session_token_v1';
const DRAFT_COMBO_KEY = 'enomera_pending_combo_v1';

const APP_ORIGINS = {
  ambo: window.__ENOMERA_AMBO_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3001' : 'https://ambo-enomera.vercel.app'),
  minne: window.__ENOMERA_MINNE_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3002' : 'https://minne-enomera.vercel.app'),
  etha: window.__ENOMERA_ETHA_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3003' : 'https://etha-enomera.vercel.app'),
  helena: window.__ENOMERA_HELENA_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3004' : 'https://helenaduartepsi.vercel.app'),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function setToken(t) {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}
function loadCombo() {
  try {
    const raw = sessionStorage.getItem(DRAFT_COMBO_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { products: ['ambo', 'minne'], ethaFormat: 'one_page' };
}
function saveCombo(combo) {
  try { sessionStorage.setItem(DRAFT_COMBO_KEY, JSON.stringify(combo)); } catch {}
}

async function apiFetch(path, { method = 'GET', body = null, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== null) h['Content-Type'] = 'application/json';
  const tok = getToken();
  if (tok) h.Authorization = `Bearer ${tok}`;
  const res = await fetch(path, {
    method,
    headers: h,
    credentials: 'include',
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && tok) {
    setToken('');
  }
  return { ok: res.ok, status: res.status, data };
}

export async function mountEnomeraPlatform(rootEl) {
  const state = {
    tab: 'portal', // portal | auth | plans | profile | billing | pilot
    authMode: 'login', // login | signup | verify | recovery
    me: null,
    summary: null,
    catalog: null,
    quote: null,
    orders: [],
    profileData: null,
    combo: loadCombo(),
    pendingEmail: '',
    outboxMessages: [],
    feedback: null,
    busy: false,
    checkoutIdempotencyKey: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    lastOrder: null,
  };

  // Preserve selection from URL query (e.g. /portal?selecao=ambo,minne)
  const qs = new URLSearchParams(location.search);
  if (qs.get('selecao')) {
    const prods = qs.get('selecao').split(',').filter((x) => ['ambo', 'minne', 'etha'].includes(x));
    if (prods.length) { state.combo.products = prods; saveCombo(state.combo); }
  }
  if (location.pathname.startsWith('/checkout') || qs.get('etapa') === 'planos') state.tab = 'plans';
  if (location.pathname.startsWith('/conta') || qs.get('etapa') === 'conta') state.tab = 'auth';

  async function refreshSessionAndData() {
    const [catRes, meRes] = await Promise.all([apiFetch('/api/v1/catalog'), apiFetch('/api/v1/auth/me')]);
    if (catRes.ok) state.catalog = catRes.data;
    if (meRes.ok) {
      state.me = meRes.data;
      if (state.me.actorType === 'professional') {
        const [sumRes, ordRes, profRes] = await Promise.all([
          apiFetch('/api/v1/portal/summary'),
          apiFetch('/api/v1/commercial/orders'),
          apiFetch('/api/v1/professional/profile'),
        ]);
        if (sumRes.ok) state.summary = sumRes.data;
        if (ordRes.ok) state.orders = ordRes.data.orders || [];
        if (profRes.ok) state.profileData = profRes.data;
      }
    } else {
      state.me = null;
      state.summary = null;
      if (state.tab === 'portal' || state.tab === 'profile' || state.tab === 'billing') {
        state.tab = 'auth';
      }
    }
    await refreshQuote();
    render();
  }

  async function refreshQuote() {
    if (!state.combo.products.length) {
      state.quote = null;
      return;
    }
    const q = await apiFetch('/api/v1/catalog/quote', {
      method: 'POST',
      body: { products: state.combo.products, ethaFormat: state.combo.ethaFormat, mode: 'monthly' },
    });
    if (q.ok) state.quote = q.data;
  }

  async function loadOutbox(recipient) {
    if (!recipient) return;
    const r = await apiFetch(`/api/v1/dev/outbox?recipient=${encodeURIComponent(recipient)}`);
    if (r.ok) state.outboxMessages = r.data.messages || [];
  }

  async function launchAppWithHandoff(appKey, returnPath = '/') {
    const targetOrigin = APP_ORIGINS[appKey];
    if (!targetOrigin) return;
    if (!state.me) {
      window.open(targetOrigin + returnPath, '_blank', 'noopener');
      return;
    }
    const res = await apiFetch('/api/v1/auth/handoff', {
      method: 'POST',
      body: { targetOrigin, returnPath },
    });
    if (res.ok) {
      const sep = returnPath.includes('?') ? '&' : '?';
      window.open(`${targetOrigin}${returnPath}${sep}handoff=${encodeURIComponent(res.data.handoffCode)}`, '_blank', 'noopener');
    } else {
      state.feedback = { tone: 'err', text: res.data.error || 'Não foi possível gerar passagem autenticada.' };
      render();
    }
  }

  function renderTopbar() {
    const authed = Boolean(state.me);
    const tabs = authed
      ? [
          ['portal', 'Portal'],
          ['plans', 'Planos e checkout'],
          ['profile', 'Perfil e agenda'],
          ['billing', 'Cobrança e ciclo'],
          ['pilot', 'Piloto (2 sem.)'],
        ]
      : [
          ['auth', 'Entrar / Criar conta'],
          ['plans', 'Comparar preços'],
          ['pilot', 'Piloto (2 sem.)'],
        ];
    return `
      <header class="eno-topbar">
        <a class="eno-brand" href="/"><img src="/assets/brand.svg" width="32" height="27" alt="">enomera</a>
        <nav class="eno-nav-tabs" aria-label="Navegação do portal">
          ${tabs.map(([id, label]) => `<button type="button" class="eno-tab" data-tab="${id}" aria-current="${state.tab === id ? 'page' : 'false'}">${label}</button>`).join('')}
        </nav>
        <div class="eno-btn-row">
          ${authed ? `<span class="eno-pill">${esc(state.me.user.fullName)}</span><button type="button" class="eno-btn eno-btn-sec" id="eno-logout">Sair</button>` : `<a class="eno-btn eno-btn-sec" href="/">Voltar ao site</a>`}
        </div>
      </header>
    `;
  }

  function renderFeedback() {
    if (!state.feedback) return '';
    const cls = state.feedback.tone === 'ok' ? 'eno-pill-ok' : state.feedback.tone === 'warn' ? 'eno-pill-warn' : 'eno-pill-err';
    return `<div class="eno-status-banner ${cls}" role="status">${esc(state.feedback.text)}</div>`;
  }

  function renderOutboxBox() {
    if (!state.outboxMessages.length) return '';
    return `
      <div class="eno-outbox">
        <strong>Caixa de homologação (SMTP/WhatsApp não configurado neste ambiente):</strong>
        <span>Nenhuma mensagem externa real foi enviada. Use o código abaixo para completar a verificação real:</span>
        ${state.outboxMessages.slice(0, 3).map((m) => `<div>• <b>${esc(m.subject)}</b> — ${esc(m.body_preview)}</div>`).join('')}
      </div>
    `;
  }

  function renderAuthView() {
    const comboText = state.combo.products.length ? state.combo.products.join(' + ').toUpperCase() : 'Nenhum serviço pré-selecionado';
    return `
      <section class="eno-grid-2">
        <div class="eno-card">
          <div class="eno-btn-row">
            <button type="button" class="eno-tab" data-authmode="login" aria-current="${state.authMode === 'login' ? 'page' : 'false'}">Entrar</button>
            <button type="button" class="eno-tab" data-authmode="signup" aria-current="${state.authMode === 'signup' ? 'page' : 'false'}">Criar conta profissional</button>
            <button type="button" class="eno-tab" data-authmode="verify" aria-current="${state.authMode === 'verify' ? 'page' : 'false'}">Verificar e-mail</button>
            <button type="button" class="eno-tab" data-authmode="recovery" aria-current="${state.authMode === 'recovery' ? 'page' : 'false'}">Recuperar acesso</button>
          </div>
          ${state.authMode === 'login' ? `
            <h1 class="eno-h1">Entrar na conta profissional</h1>
            <p class="eno-muted">Sua combinação escolhida (<b>${esc(comboText)}</b>) será preservada ao entrar.</p>
            <form id="eno-login-form" class="eno-list">
              <div class="eno-field"><label for="l-email">E-mail profissional</label><input id="l-email" name="email" type="email" class="eno-input" required placeholder="voce@consultorio.com.br"></div>
              <div class="eno-field"><label for="l-pwd">Senha</label><input id="l-pwd" name="password" type="password" class="eno-input" required minlength="8"></div>
              <div class="eno-btn-row">
                <button type="submit" class="eno-btn">Entrar</button>
                <button type="button" class="eno-btn eno-btn-sec" id="eno-fill-helena">Preencher conta fictícia Helena Duarte</button>
              </div>
            </form>
          ` : state.authMode === 'signup' ? `
            <h1 class="eno-h1">Criar conta profissional na Enomera</h1>
            <p class="eno-muted">Cadastro real com senha protegida (scrypt) e verificação de e-mail por código de uso único.</p>
            <form id="eno-signup-form" class="eno-list">
              <div class="eno-field"><label for="s-name">Nome completo</label><input id="s-name" name="fullName" class="eno-input" required placeholder="Ex.: Helena Duarte"></div>
              <div class="eno-field"><label for="s-email">E-mail profissional</label><input id="s-email" name="email" type="email" class="eno-input" required placeholder="helena@exemplo.com.br"></div>
              <div class="eno-field"><label for="s-crp">CRP ou CRM</label><input id="s-crp" name="crpOrCrm" class="eno-input" placeholder="CRP 06/148290"></div>
              <div class="eno-field"><label for="s-spec">Especialidade</label><select id="s-spec" name="specialty" class="eno-select"><option value="Psicologia">Psicologia</option><option value="Psiquiatria">Psiquiatria</option></select></div>
              <div class="eno-field"><label for="s-pwd">Senha (mínimo 8 caracteres)</label><input id="s-pwd" name="password" type="password" class="eno-input" required minlength="8"></div>
              <button type="submit" class="eno-btn">Criar conta e gerar código de verificação</button>
            </form>
          ` : state.authMode === 'verify' ? `
            <h1 class="eno-h1">Verificar contato</h1>
            <p class="eno-muted">Digite o código de 6 dígitos (uso único, expira em 15 minutos).</p>
            <form id="eno-verify-form" class="eno-list">
              <div class="eno-field"><label for="v-email">E-mail</label><input id="v-email" name="email" type="email" class="eno-input" required value="${esc(state.pendingEmail || state.me?.user?.email || '')}"></div>
              <div class="eno-field"><label for="v-code">Código de 6 dígitos</label><input id="v-code" name="code" class="eno-input" required maxlength="6" placeholder="000000"></div>
              <div class="eno-btn-row">
                <button type="submit" class="eno-btn">Confirmar verificação</button>
                <button type="button" class="eno-btn eno-btn-sec" id="eno-resend-ver">Reenviar código</button>
              </div>
            </form>
          ` : `
            <h1 class="eno-h1">Recuperar acesso</h1>
            <p class="eno-muted">Redefinir a senha revoga automaticamente todas as sessões anteriores.</p>
            <form id="eno-rec-req" class="eno-list">
              <div class="eno-field"><label for="r-email">E-mail cadastrado</label><input id="r-email" name="email" type="email" class="eno-input" required value="${esc(state.pendingEmail)}"></div>
              <button type="submit" class="eno-btn eno-btn-sec">Gerar código de recuperação</button>
            </form>
            <form id="eno-rec-confirm" class="eno-list">
              <div class="eno-field"><label for="rc-code">Código de recuperação (6 dígitos)</label><input id="rc-code" name="code" class="eno-input" required maxlength="6"></div>
              <div class="eno-field"><label for="rc-pwd">Nova senha (mínimo 8 caracteres)</label><input id="rc-pwd" name="newPassword" type="password" class="eno-input" required minlength="8"></div>
              <button type="submit" class="eno-btn">Redefinir senha</button>
            </form>
          `}
          ${renderOutboxBox()}
        </div>

        <aside class="eno-card">
          <span class="eno-pill">AMBIENTE INTEGRADO · SIMULAÇÃO COMERCIAL</span>
          <h2 class="eno-h2">Contas fictícias de homologação</h2>
          <p class="eno-muted">Você pode criar uma conta nova do zero ou testar com as contas fictícias semeadas:</p>
          <div class="eno-list">
            <div class="eno-row"><div><b>Helena Duarte</b><div class="eno-muted">Conjunto completo (Ambo + Minne + Etha)</div></div></div>
            <div class="eno-row"><div><b>Dr. Paulo Mendes</b><div class="eno-muted">Minne isolado (testa isolamento entre contas)</div></div></div>
            <div class="eno-row"><div><b>Marcos Martins</b><div class="eno-muted">Operador Etha (zero acesso clínico ao Minne)</div></div></div>
          </div>
          <p class="eno-muted"><b>Aviso:</b> Autenticação, autorização, banco e integração são reais. Apenas os pagamentos são simulados.</p>
        </aside>
      </section>
    `;
  }

  function renderPlansAndCheckout() {
    const q = state.quote;
    const isSel = (p) => state.combo.products.includes(p);
    return `
      <section class="eno-grid-2">
        <div class="eno-card">
          <span class="eno-pill eno-pill-warn">PREÇOS DE SIMULAÇÃO · CATÁLOGO ${esc(state.catalog?.version || '2026-11-sim-v2')}</span>
          <h1 class="eno-h1">Monte sua combinação ou comece por um serviço</h1>
          <p class="eno-muted">${esc(state.catalog?.disclaimer || 'Valores provisórios sem cobrança real.')}</p>

          <div class="eno-list">
            <label class="eno-check-card" data-prod="ambo" data-selected="${isSel('ambo')}">
              <div>
                <span class="eno-pill eno-pill-ambo">Ambo · R$ 39/mês</span>
                <p class="eno-muted" style="margin-top:6px">Perfil público, 1ª consulta por preferência, convites, remarcação e operação Ambo Solo. Hospedagem, atualizações e suporte incluídos.</p>
                <small class="eno-muted">Licença permanente (hipótese pendente): R$ 790 + hospedagem/suporte separados a definir.</small>
              </div>
              <input type="checkbox" data-toggle-prod="ambo" ${isSel('ambo') ? 'checked' : ''} style="width:22px;height:22px">
            </label>

            <label class="eno-check-card" data-prod="minne" data-selected="${isSel('minne')}">
              <div>
                <span class="eno-pill eno-pill-minne">Minne · R$ 69/mês</span>
                <p class="eno-muted" style="margin-top:6px">Agenda, solicitações integradas do Ambo, rascunhos, registros versionados e importação real de prontuários. Combo Ambo + Minne: <b>R$ 89/mês</b> (economia de R$ 19).</p>
                <small class="eno-muted">Licença permanente (hipótese pendente): R$ 1.390 + hospedagem/suporte separados a definir.</small>
              </div>
              <input type="checkbox" data-toggle-prod="minne" ${isSel('minne') ? 'checked' : ''} style="width:22px;height:22px">
            </label>

            <label class="eno-check-card" data-prod="etha" data-selected="${isSel('etha')}">
              <div>
                <span class="eno-pill eno-pill-etha">Etha · Site exclusivo (50% entrada + 50% aprovação)</span>
                <p class="eno-muted" style="margin-top:6px">Página única: R$ 1.190 (hoje R$ 595) · Até 4 páginas: R$ 2.190 (hoje R$ 1.095). Hospedagem e painel R$ 39/mês somente após publicação.</p>
                ${isSel('etha') ? `
                  <div style="margin-top:10px">
                    <select id="eno-etha-fmt" class="eno-select">
                      <option value="one_page" ${state.combo.ethaFormat === 'one_page' ? 'selected' : ''}>Página única — R$ 1.190 (50% hoje: R$ 595)</option>
                      <option value="multi_page" ${state.combo.ethaFormat === 'multi_page' ? 'selected' : ''}>Até quatro páginas — R$ 2.190 (50% hoje: R$ 1.095)</option>
                    </select>
                  </div>
                ` : ''}
              </div>
              <input type="checkbox" data-toggle-prod="etha" ${isSel('etha') ? 'checked' : ''} style="width:22px;height:22px">
            </label>
          </div>
        </div>

        <aside class="eno-card">
          <span class="eno-pill">RESUMO CALCULADO NO SERVIDOR</span>
          <h2 class="eno-h2">Checkout simulado (idempotente)</h2>
          ${q ? `
            <div class="eno-list">
              ${q.lines.map((l) => `<div class="eno-row"><div><b>${esc(l.label)}</b><div class="eno-muted">${esc(l.includes)}</div></div></div>`).join('')}
            </div>
            <div class="eno-card" style="background:#F0F4FE;padding:16px;border-color:#CAD4F8">
              <div><b>Hoje (simulado):</b> ${esc(q.answers.dueToday)}</div>
              <div><b>Recorrente:</b> ${esc(q.answers.recurring)}</div>
              <div><b>Saldo futuro:</b> ${esc(q.answers.balanceOnApproval)}</div>
              <div><b>Desconto:</b> ${esc(q.answers.discountWhere)}</div>
              <div class="eno-muted"><b>Se retirar 1 produto:</b> ${esc(q.answers.ifRemoveOne)}</div>
            </div>

            ${state.me ? `
              <div class="eno-field">
                <label for="chk-outcome">Estado do simulador de cobrança (sem cobrança real)</label>
                <select id="chk-outcome" class="eno-select">
                  <option value="approved">Aprovar contratação simulada e liberar serviços</option>
                  <option value="pending">Simular pagamento pendente (retomável)</option>
                  <option value="declined">Simular recusa (preserva combinação para nova tentativa)</option>
                </select>
              </div>
              <div class="eno-btn-row">
                <button type="button" class="eno-btn" id="eno-checkout-submit">Confirmar pedido simulado</button>
                ${!isSel('etha') ? `<button type="button" class="eno-btn eno-btn-minne" id="eno-start-trial">Iniciar teste 7 dias (sem cartão)</button>` : ''}
              </div>
              <small class="eno-muted">Chave de idempotência: <code>${esc(state.checkoutIdempotencyKey)}</code> — cliques duplos não duplicam o pedido.</small>
            ` : `
              <button type="button" class="eno-btn" id="eno-go-auth">Entrar ou criar conta para continuar</button>
            `}
          ` : `<p class="eno-muted">Selecione ao menos um serviço para calcular.</p>`}

          ${state.lastOrder ? `
            <div class="eno-card ${state.lastOrder.order.status === 'approved' ? 'eno-card-minne' : 'eno-card-warn'}">
              <span class="eno-pill ${state.lastOrder.order.status === 'approved' ? 'eno-pill-ok' : 'eno-pill-warn'}">Comprovante demonstrativo · ${esc(state.lastOrder.order.receipt_code)}</span>
              <b>Status: ${esc(state.lastOrder.order.status)}</b>
              ${state.lastOrder.order.status !== 'approved' ? `<button type="button" class="eno-btn" id="eno-retry-order" data-order-id="${esc(state.lastOrder.order.id)}">Retomar tentativa e aprovar (simulado)</button>` : `<button type="button" class="eno-btn eno-btn-ambo" data-tab="portal">Ir para o Portal e configurar</button>`}
            </div>
          ` : ''}
        </aside>
      </section>
    `;
  }

  function renderPortalView() {
    const s = state.summary;
    if (!s) return '<div class="eno-card"><p class="eno-muted">Carregando seu portal...</p></div>';
    const e = s.entitlements || {};
    const activeCount = ['ambo', 'minne', 'etha'].filter((p) => e[p]?.canReadExport).length;
    const isEthaOnly = e.etha?.canReadExport && !e.ambo?.canReadExport && !e.minne?.canReadExport;

    return `
      <section class="eno-list" style="gap:22px">
        <div class="eno-card">
          <div class="eno-row" style="background:transparent;border:0;padding:0">
            <div>
              <span class="eno-pill">PORTAL PROFISSIONAL · ${esc(s.account.displayName)} ${s.account.crpOrCrm ? `· ${esc(s.account.crpOrCrm)}` : ''}</span>
              <h1 class="eno-h1" style="margin-top:8px">${activeCount ? 'Seus serviços integrados' : 'Bem-vinda! Escolha como começar'}</h1>
              <p class="eno-muted">Próxima ação recomendada: <b>${esc(s.nextAction.label)}</b></p>
            </div>
            ${!state.me.user.emailVerified ? `<button type="button" class="eno-btn eno-btn-sec" id="eno-go-verify">Verificar e-mail pendente</button>` : `<span class="eno-pill eno-pill-ok">E-mail verificado</span>`}
          </div>
          ${s.pendingSyncs?.length ? `
            <div class="eno-card eno-card-warn">
              <b>Sincronização pendente (${s.pendingSyncs.length})</b>
              <p class="eno-muted">O registro principal já está salvo no banco. Clique para concluir a propagação sem duplicar a ação.</p>
              ${s.pendingSyncs.map((ev) => `<button type="button" class="eno-btn eno-btn-sec" data-retry-sync="${esc(ev.id)}">Reenviar sincronização ${esc(ev.event_type)}</button>`).join('')}
            </div>
          ` : ''}
        </div>

        ${isEthaOnly ? `
          <div class="eno-card eno-card-etha">
            <span class="eno-pill eno-pill-etha">PORTAL ADAPTADO · SOMENTE ETHA</span>
            <h2 class="eno-h2">Andamento do seu site exclusivo</h2>
            <p class="eno-muted">Como você contratou apenas a Etha, exibimos o andamento do seu site sem painéis vazios de agenda ou prontuário. Status atual: <b>${esc(s.routine.ethaProject?.status || 'briefing')}</b>.</p>
            <div class="eno-btn-row">
              <button type="button" class="eno-btn eno-btn-etha" data-launch="etha" data-path="/">Abrir Etha (briefing, revisão e painel) ↗</button>
              <button type="button" class="eno-btn eno-btn-sec" data-tab="plans">Conhecer Ambo e Minne</button>
            </div>
          </div>
        ` : `
          <div class="eno-grid-3">
            <article class="eno-card ${e.ambo?.canReadExport ? 'eno-card-ambo' : ''}">
              <span class="eno-pill ${e.ambo?.canWrite ? 'eno-pill-ok' : 'eno-pill-ambo'}">${e.ambo ? `Ambo · ${esc(e.ambo.status)}` : 'Ambo · Não contratado'}</span>
              <h2 class="eno-h2">ambo</h2>
              <p class="eno-muted">Perfil público: <code>?pro=${esc(s.account.slug)}</code><br>${e.ambo?.canReadExport ? `Solicitações pendentes: <b>${s.routine.pendingRequests ?? 0}</b>` : 'Agendamento online e área do paciente.'}</p>
              <div class="eno-btn-row">
                ${e.ambo?.canReadExport ? `
                  <button type="button" class="eno-btn eno-btn-ambo" data-launch="ambo" data-path="/?pro=${encodeURIComponent(s.account.slug)}">Ver perfil público ↗</button>
                  <button type="button" class="eno-btn eno-btn-sec" data-launch="ambo" data-path="/operacao">Operação Ambo ↗</button>
                ` : `<button type="button" class="eno-btn eno-btn-sec" data-tab="plans">Contratar / Testar 7 dias</button>`}
              </div>
            </article>

            <article class="eno-card ${e.minne?.canReadExport ? 'eno-card-minne' : ''}">
              <span class="eno-pill ${e.minne?.canWrite ? 'eno-pill-ok' : 'eno-pill-minne'}">${e.minne ? `Minne · ${esc(e.minne.status)}` : 'Minne · Não contratado'}</span>
              <h2 class="eno-h2">minne</h2>
              <p class="eno-muted">${e.minne?.canReadExport ? `Consultas confirmadas: <b>${s.routine.confirmedAppointments ?? 0}</b> · Rascunhos clínicos: <b>${s.routine.clinicalDrafts ?? 0}</b>` : 'Agenda clínica, prontuários versionados e importação de registros.'}</p>
              <div class="eno-btn-row">
                ${e.minne?.canReadExport ? `
                  <button type="button" class="eno-btn eno-btn-minne" data-launch="minne" data-path="/?modo=ao-vivo">Abrir Minne (rotina clínica) ↗</button>
                  <button type="button" class="eno-btn eno-btn-sec" data-launch="minne" data-path="/?modo=ao-vivo&aba=importar">Importar prontuários ↗</button>
                ` : `<button type="button" class="eno-btn eno-btn-sec" data-tab="plans">Contratar / Testar 7 dias</button>`}
              </div>
            </article>

            <article class="eno-card ${e.etha?.canReadExport ? 'eno-card-etha' : ''}">
              <span class="eno-pill ${e.etha?.canWrite ? 'eno-pill-ok' : 'eno-pill-etha'}">${e.etha ? `Etha · ${esc(s.routine.ethaProject?.status || e.etha.status)}` : 'Etha · Outro serviço'}</span>
              <h2 class="eno-h2">etha</h2>
              <p class="eno-muted">Site exclusivo com briefing, revisão consolidada e painel de edição.</p>
              <div class="eno-btn-row">
                ${e.etha?.canReadExport ? `
                  <button type="button" class="eno-btn eno-btn-etha" data-launch="etha" data-path="/">Abrir Etha ↗</button>
                  <button type="button" class="eno-btn eno-btn-sec" data-launch="helena" data-path="/">Site de homologação ↗</button>
                ` : `<button type="button" class="eno-btn eno-btn-sec" data-tab="plans">Adicionar site Etha</button>`}
              </div>
            </article>
          </div>
        `}
      </section>
    `;
  }

  function renderProfileView() {
    const p = state.profileData?.profile;
    if (!p) return '<div class="eno-card"><p class="eno-muted">Carregando perfil...</p></div>';
    return `
      <section class="eno-grid-2">
        <form id="eno-profile-form" class="eno-card">
          <span class="eno-pill">PERFIL COMPARTILHADO (AMBO + MINNE)</span>
          <h1 class="eno-h1">Dados profissionais, modalidades e valor</h1>
          <div class="eno-field"><label for="p-name">Nome de exibição</label><input id="p-name" name="displayName" class="eno-input" value="${esc(p.displayName)}"></div>
          <div class="eno-field"><label for="p-crp">CRP / CRM</label><input id="p-crp" name="crpOrCrm" class="eno-input" value="${esc(p.crpOrCrm)}"></div>
          <div class="eno-field"><label for="p-price">Valor da consulta em reais (acerto fora do app)</label><input id="p-price" name="priceReais" type="number" min="0" class="eno-input" value="${Math.round((p.sessionPriceCents || 22000) / 100)}"></div>
          <div class="eno-field"><label for="p-city">Cidade / consultório</label><input id="p-city" name="city" class="eno-input" value="${esc(p.city)}"></div>
          <div class="eno-field"><label for="p-meet">Link externo da sala online (liberado só no horário autorizado)</label><input id="p-meet" name="onlineMeetingUrl" class="eno-input" value="${esc(p.onlineMeetingUrl)}"></div>
          <button type="submit" class="eno-btn">Salvar alterações no backend</button>
        </form>

        <div class="eno-card">
          <span class="eno-pill eno-pill-ambo">DISPONIBILIDADE E BLOQUEIOS</span>
          <h2 class="eno-h2">Janelas ativas (Fuso: ${esc(p.timezone)})</h2>
          <p class="eno-muted">Regras padrão ativas de Segunda a Sexta (09h–18h). Adicione um bloqueio pontual para testar indisponibilidade real no Ambo e Minne:</p>
          <form id="eno-block-form" class="eno-list">
            <div class="eno-field"><label for="b-start">Início do bloqueio (ISO com -03:00)</label><input id="b-start" name="startAt" class="eno-input" value="${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}T14:00:00-03:00"></div>
            <div class="eno-field"><label for="b-end">Fim do bloqueio</label><input id="b-end" name="endAt" class="eno-input" value="${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}T16:00:00-03:00"></div>
            <div class="eno-field"><label for="b-reason">Motivo</label><input id="b-reason" name="reason" class="eno-input" value="Supervisão clínica"></div>
            <button type="submit" class="eno-btn eno-btn-ambo">Salvar bloqueio na agenda</button>
          </form>
          <div class="eno-list">
            ${(state.profileData.availabilityBlocks || []).map((b) => `<div class="eno-row"><span>${esc(b.reason)}</span><small>${esc(b.start_at)} → ${esc(b.end_at)}</small></div>`).join('') || '<p class="eno-muted">Nenhum bloqueio cadastrado.</p>'}
          </div>
        </div>
      </section>
    `;
  }

  function renderBillingView() {
    const ents = state.me?.entitlements || {};
    return `
      <section class="eno-grid-2">
        <div class="eno-card">
          <span class="eno-pill">CICLO DE VIDA E DIREITOS DE ACESSO</span>
          <h1 class="eno-h1">Serviços, cancelamento parcial e exportação</h1>
          <p class="eno-muted">Cancelar um serviço coloca apenas aquele produto em leitura/exportação sem apagar dados nem interromper os demais produtos ativos.</p>
          <div class="eno-list">
            ${['ambo', 'minne', 'etha'].map((prod) => {
              const ent = ents[prod];
              if (!ent) return `<div class="eno-row"><b>${prod.toUpperCase()}</b><span class="eno-muted">Não contratado</span></div>`;
              return `
                <div class="eno-row">
                  <div>
                    <b>${prod.toUpperCase()}</b> · <span class="eno-pill ${ent.canWrite ? 'eno-pill-ok' : 'eno-pill-warn'}">${esc(ent.status)}</span>
                    <div class="eno-muted">${ent.trialEndsAt ? `Teste até ${esc(ent.trialEndsAt.slice(0, 10))}` : `Ciclo: ${esc(ent.billingMode)}`}</div>
                  </div>
                  ${ent.canWrite
                    ? `<button type="button" class="eno-btn eno-btn-sec" data-ent-action="cancel" data-ent-prod="${prod}">Cancelar só ${prod}</button>`
                    : `<button type="button" class="eno-btn" data-ent-action="reactivate" data-ent-prod="${prod}">Reativar ${prod}</button>`}
                </div>
              `;
            }).join('')}
          </div>
          <div class="eno-btn-row">
            <button type="button" class="eno-btn eno-btn-minne" id="eno-export-account">Exportar dados autorizados (JSON)</button>
            <button type="button" class="eno-btn eno-btn-danger" id="eno-logout-all">Encerrar todas as sessões</button>
          </div>
        </div>

        <aside class="eno-card">
          <span class="eno-pill">HISTÓRICO DE PEDIDOS SIMULADOS</span>
          <h2 class="eno-h2">Comprovantes demonstrativos</h2>
          <div class="eno-list">
            ${state.orders.length ? state.orders.map((o) => `
              <div class="eno-row">
                <div>
                  <b>${esc(o.receipt_code)}</b> · ${esc(o.items.join(' + ').toUpperCase())}
                  <div class="eno-muted">Hoje: ${brl(o.due_today_cents)} · Recorrente: ${brl(o.recurring_monthly_cents)}/mês · Status: <b>${esc(o.status)}</b></div>
                </div>
                ${o.status !== 'approved' ? `<button type="button" class="eno-btn eno-btn-sec" id="eno-retry-order" data-order-id="${esc(o.id)}">Retomar</button>` : ''}
              </div>
            `).join('') : '<p class="eno-muted">Nenhum pedido simulado registrado ainda.</p>'}
          </div>
        </aside>
      </section>
    `;
  }

  function renderPilotView() {
    return `
      <section class="eno-card" style="max-width:760px">
        <span class="eno-pill eno-pill-etha">PILOTO ACOMPANHADO · 2 SEMANAS (DISTINTO DO TESTE DE 7 DIAS)</span>
        <h1 class="eno-h1">Solicitar participação no piloto acompanhado</h1>
        <p class="eno-muted">Duas semanas de uso gratuito com acompanhamento próximo de Marcos Martins (turmas de 2 a 3 profissionais, sem cobrança). Se quiser testar Ambo e Minne agora mesmo de forma autônoma, use o teste comercial de 7 dias sem cartão na aba Planos.</p>
        <form id="eno-pilot-form" class="eno-list">
          <div class="eno-field"><label for="pl-name">Nome completo</label><input id="pl-name" name="fullName" class="eno-input" required value="${esc(state.me?.user?.fullName || '')}"></div>
          <div class="eno-field"><label for="pl-email">E-mail</label><input id="pl-email" name="email" type="email" class="eno-input" required value="${esc(state.me?.user?.email || '')}"></div>
          <div class="eno-field"><label for="pl-notes">O que você mais gostaria de avaliar?</label><input id="pl-notes" name="notes" class="eno-input" placeholder="Ex.: agendamento no Ambo e importação de prontuários no Minne"></div>
          <button type="submit" class="eno-btn eno-btn-etha">Registrar interesse no piloto (sem cobrança)</button>
        </form>
      </section>
    `;
  }

  function render() {
    const view = state.tab === 'auth' ? renderAuthView()
      : state.tab === 'plans' ? renderPlansAndCheckout()
      : state.tab === 'profile' ? renderProfileView()
      : state.tab === 'billing' ? renderBillingView()
      : state.tab === 'pilot' ? renderPilotView()
      : renderPortalView();

    rootEl.innerHTML = `<div class="eno-shell">${renderTopbar()}<div class="eno-container" id="portal-content" tabindex="-1">${renderFeedback()}${view}</div></div>`;
    bindEvents();
  }

  function bindEvents() {
    rootEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      state.feedback = null;
      render();
    }));
    rootEl.querySelectorAll('[data-authmode]').forEach((b) => b.addEventListener('click', () => {
      state.authMode = b.dataset.authmode;
      state.feedback = null;
      render();
    }));

    rootEl.querySelector('#eno-fill-helena')?.addEventListener('click', () => {
      const e = rootEl.querySelector('#l-email');
      const p = rootEl.querySelector('#l-pwd');
      if (e) e.value = 'helena@helenaduartepsi.com.br';
      if (p) p.value = 'HelenaDemo!2026';
    });

    rootEl.querySelector('#eno-login-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const res = await apiFetch('/api/v1/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      setToken(res.data.sessionToken);
      state.feedback = { tone: 'ok', text: `Bem-vinda de volta, ${res.data.user.fullName}.` };
      state.tab = 'portal';
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-signup-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const email = String(fd.get('email') || '').trim();
      const res = await apiFetch('/api/v1/auth/signup', {
        method: 'POST',
        body: { fullName: fd.get('fullName'), email, crpOrCrm: fd.get('crpOrCrm'), specialty: fd.get('specialty'), password: fd.get('password') },
      });
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      setToken(res.data.sessionToken);
      state.pendingEmail = email;
      await loadOutbox(email);
      state.authMode = 'verify';
      state.feedback = { tone: 'warn', text: `Conta criada! ${res.data.verification.delivery.notice}` };
      await refreshSessionAndData();
      state.tab = 'auth';
      state.authMode = 'verify';
      render();
    });

    rootEl.querySelector('#eno-verify-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const res = await apiFetch('/api/v1/auth/verify-email', { method: 'POST', body: { email: fd.get('email'), code: fd.get('code') } });
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      state.feedback = { tone: 'ok', text: 'E-mail verificado com sucesso! Agora escolha ou confirme sua combinação.' };
      state.tab = 'plans';
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-resend-ver')?.addEventListener('click', async () => {
      const email = rootEl.querySelector('#v-email')?.value;
      const res = await apiFetch('/api/v1/auth/resend-verification', { method: 'POST', body: { email } });
      await loadOutbox(email);
      state.feedback = { tone: 'warn', text: res.data.delivery?.notice || 'Novo código gerado.' };
      render();
    });

    rootEl.querySelector('#eno-rec-req')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = new FormData(ev.currentTarget).get('email');
      state.pendingEmail = String(email || '');
      const res = await apiFetch('/api/v1/auth/recovery/request', { method: 'POST', body: { email } });
      await loadOutbox(state.pendingEmail);
      state.feedback = { tone: 'warn', text: res.data.delivery?.notice || res.data.message };
      render();
    });

    rootEl.querySelector('#eno-rec-confirm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const res = await apiFetch('/api/v1/auth/recovery/confirm', {
        method: 'POST',
        body: { email: state.pendingEmail || rootEl.querySelector('#r-email')?.value, code: fd.get('code'), newPassword: fd.get('newPassword') },
      });
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      state.authMode = 'login';
      state.feedback = { tone: 'ok', text: res.data.message };
      render();
    });

    rootEl.querySelector('#eno-go-auth')?.addEventListener('click', () => { state.tab = 'auth'; state.authMode = 'signup'; render(); });
    rootEl.querySelector('#eno-go-verify')?.addEventListener('click', async () => {
      state.pendingEmail = state.me?.user?.email || '';
      await loadOutbox(state.pendingEmail);
      state.tab = 'auth'; state.authMode = 'verify'; render();
    });

    rootEl.querySelectorAll('[data-toggle-prod]').forEach((cb) => cb.addEventListener('change', async () => {
      const prod = cb.dataset.toggleProd;
      state.combo.products = cb.checked
        ? [...new Set([...state.combo.products, prod])]
        : state.combo.products.filter((x) => x !== prod);
      saveCombo(state.combo);
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await refreshQuote();
      render();
    }));

    rootEl.querySelector('#eno-etha-fmt')?.addEventListener('change', async (e) => {
      state.combo.ethaFormat = e.target.value;
      saveCombo(state.combo);
      await refreshQuote();
      render();
    });

    rootEl.querySelector('#eno-start-trial')?.addEventListener('click', async () => {
      const res = await apiFetch('/api/v1/commercial/trial/start', { method: 'POST', body: { products: state.combo.products } });
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      state.feedback = { tone: 'ok', text: `Teste comercial de 7 dias ativado até ${res.data.trialEndsAt.slice(0, 10)} (sem cartão).` };
      state.tab = 'portal';
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-checkout-submit')?.addEventListener('click', async () => {
      const outcome = rootEl.querySelector('#chk-outcome')?.value || 'approved';
      const res = await apiFetch('/api/v1/commercial/orders', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': state.checkoutIdempotencyKey },
        body: { products: state.combo.products, ethaFormat: state.combo.ethaFormat, simulatedOutcome: outcome, method: 'simulated_pix' },
      });
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      state.lastOrder = res.data;
      state.feedback = {
        tone: res.data.order.status === 'approved' ? 'ok' : 'warn',
        text: res.data.order.status === 'approved'
          ? `Contratação simulada aprovada (${res.data.order.receipt_code}) e serviços liberados no servidor!`
          : `Pedido ${res.data.order.receipt_code} salvo como "${res.data.order.status}". Retome abaixo sem duplicar.`,
      };
      await refreshSessionAndData();
    });

    rootEl.querySelectorAll('#eno-retry-order').forEach((btn) => btn.addEventListener('click', async () => {
      const res = await apiFetch(`/api/v1/commercial/orders/${btn.dataset.orderId}/retry`, {
        method: 'POST', body: { simulatedOutcome: 'approved', method: 'simulated_pix' },
      });
      if (res.ok) {
        state.lastOrder = res.data;
        state.feedback = { tone: 'ok', text: 'Tentativa retomada e aprovada na simulação. Serviços liberados!' };
        await refreshSessionAndData();
      }
    }));

    rootEl.querySelectorAll('[data-launch]').forEach((b) => b.addEventListener('click', () => launchAppWithHandoff(b.dataset.launch, b.dataset.path || '/')));

    rootEl.querySelectorAll('[data-retry-sync]').forEach((b) => b.addEventListener('click', async () => {
      const res = await apiFetch(`/api/v1/sync/events/${b.dataset.retrySync}/retry`, { method: 'POST', body: {} });
      if (res.ok) { state.feedback = { tone: 'ok', text: 'Sincronização concluída sem duplicar a ação.' }; await refreshSessionAndData(); }
    }));

    rootEl.querySelector('#eno-profile-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const res = await apiFetch('/api/v1/professional/profile', {
        method: 'PATCH',
        body: {
          displayName: fd.get('displayName'),
          crpOrCrm: fd.get('crpOrCrm'),
          sessionPriceCents: Math.round(Number(fd.get('priceReais') || 0) * 100),
          city: fd.get('city'),
          onlineMeetingUrl: fd.get('onlineMeetingUrl'),
        },
      });
      if (res.ok) { state.feedback = { tone: 'ok', text: 'Perfil atualizado no backend (refletido no Ambo e Minne).' }; await refreshSessionAndData(); }
    });

    rootEl.querySelector('#eno-block-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const currentBlocks = (state.profileData?.availabilityBlocks || []).map((b) => ({ startAt: b.start_at, endAt: b.end_at, reason: b.reason }));
      currentBlocks.push({ startAt: fd.get('startAt'), endAt: fd.get('endAt'), reason: fd.get('reason') });
      const res = await apiFetch('/api/v1/professional/availability', { method: 'PUT', body: { blocks: currentBlocks } });
      if (res.ok) { state.feedback = { tone: 'ok', text: 'Bloqueio salvo e aplicado à disponibilidade real.' }; await refreshSessionAndData(); }
    });

    rootEl.querySelectorAll('[data-ent-action]').forEach((b) => b.addEventListener('click', async () => {
      const res = await apiFetch(`/api/v1/commercial/entitlements/${b.dataset.entProd}/${b.dataset.entAction}`, { method: 'POST', body: {} });
      if (res.ok) { state.feedback = { tone: 'warn', text: res.data.note }; await refreshSessionAndData(); }
    }));

    rootEl.querySelector('#eno-export-account')?.addEventListener('click', async () => {
      const res = await apiFetch('/api/v1/account/export');
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `enomera-export-${state.me.account.slug}.json`;
      a.click();
      state.feedback = { tone: 'ok', text: 'Exportação JSON autorizada gerada (schema enomera-export-v1).' };
      render();
    });

    rootEl.querySelector('#eno-pilot-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const res = await apiFetch('/api/v1/commercial/pilot/apply', {
        method: 'POST',
        body: { fullName: fd.get('fullName'), email: fd.get('email'), notes: fd.get('notes') },
      });
      state.feedback = res.ok ? { tone: 'ok', text: res.data.message } : { tone: 'err', text: res.data.error };
      render();
    });

    const doLogout = async (revokeAll) => {
      await apiFetch('/api/v1/auth/logout', { method: 'POST', body: { revokeAll } });
      setToken('');
      state.me = null; state.summary = null; state.tab = 'auth';
      state.feedback = { tone: 'ok', text: revokeAll ? 'Todas as sessões foram revogadas no servidor.' : 'Você saiu da conta.' };
      render();
    };
    rootEl.querySelector('#eno-logout')?.addEventListener('click', () => doLogout(false));
    rootEl.querySelector('#eno-logout-all')?.addEventListener('click', () => doLogout(true));
  }

  await refreshSessionAndData();
}
