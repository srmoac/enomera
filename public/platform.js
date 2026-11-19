const TOKEN_KEY = 'enomera_session_token_v1';
const DRAFT_COMBO_KEY = 'enomera_pending_combo_v1';
const LAST_ORDER_KEY = 'enomera_last_order_v1';

const APP_ORIGINS = {
  ambo: window.__ENOMERA_AMBO_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3001' : 'https://ambo-enomera.vercel.app'),
  minne: window.__ENOMERA_MINNE_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3002' : 'https://minne-enomera.vercel.app'),
  etha: window.__ENOMERA_ETHA_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3003' : 'https://etha-enomera.vercel.app'),
  helena: window.__ENOMERA_HELENA_URL || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:3004' : 'https://helenaduartepsi.vercel.app'),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);

function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function setToken(t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch {} }
function loadCombo() {
  try { const raw = sessionStorage.getItem(DRAFT_COMBO_KEY); if (raw) return JSON.parse(raw); } catch {}
  return { products: ['ambo', 'minne'], ethaFormat: 'one_page', viewMode: 'monthly' };
}
function saveCombo(combo) { try { sessionStorage.setItem(DRAFT_COMBO_KEY, JSON.stringify(combo)); } catch {} }
function loadSavedOrder() { try { const r = sessionStorage.getItem(LAST_ORDER_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveLastOrder(o) { try { if (o) sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(o)); else sessionStorage.removeItem(LAST_ORDER_KEY); } catch {} }

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
  if (res.status === 401 && tok) setToken('');
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
    formCache: { fullName: '', email: '', crpOrCrm: '', specialty: 'Psicologia' },
    fieldError: null,
    pendingEmail: '',
    lastSentEmail: '',
    otpDigits: ['', '', '', '', '', ''],
    lastDelivery: null,
    outboxMessages: [],
    feedback: null,
    processingCheckout: false,
    busyAction: null,
    deltaPulse: false,
    resendCooldown: 0,
    checkoutIdempotencyKey: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    lastOrder: loadSavedOrder(),
    returnAfterAuth: 'portal',
  };

  let quoteSeq = 0;

  const qs = new URLSearchParams(location.search);
  if (qs.get('selecao')) {
    const prods = qs.get('selecao').split(',').filter((x) => ['ambo', 'minne', 'etha'].includes(x));
    if (prods.length) { state.combo.products = prods; saveCombo(state.combo); }
  }
  if (location.pathname.startsWith('/checkout') || qs.get('etapa') === 'planos') {
    state.tab = 'plans';
    state.returnAfterAuth = 'plans';
  }
  if (location.pathname.startsWith('/conta') || qs.get('etapa') === 'conta') {
    state.tab = 'auth';
    state.returnAfterAuth = 'plans';
  }

  let cooldownTimer = null;
  function startResendCooldown(sec = 30) {
    state.resendCooldown = sec;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      state.resendCooldown = Math.max(0, state.resendCooldown - 1);
      const btn = rootEl.querySelector('#eno-resend-ver');
      if (btn) {
        btn.disabled = state.resendCooldown > 0;
        btn.textContent = state.resendCooldown > 0 ? `Reenviar código (${state.resendCooldown}s)` : 'Reenviar código';
      }
      if (state.resendCooldown === 0) clearInterval(cooldownTimer);
    }, 1000);
  }

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
        if (ordRes.ok) {
          state.orders = ordRes.data.orders || [];
          // Recover pending order after page reload automatically!
          const pendingOrd = state.orders.find((o) => o.status === 'pending' || o.status === 'declined');
          if (pendingOrd && !state.lastOrder) {
            state.lastOrder = { order: pendingOrd };
            saveLastOrder(state.lastOrder);
          }
        }
        if (profRes.ok) state.profileData = profRes.data;
      }
    } else {
      state.me = null;
      state.summary = null;
      if (['portal', 'profile', 'billing'].includes(state.tab)) state.tab = 'auth';
    }
    await refreshQuote(false);
    render();
  }

  async function refreshQuote(pulse = true) {
    const seq = ++quoteSeq;
    if (!state.combo.products.length) { state.quote = null; return; }
    const q = await apiFetch('/api/v1/catalog/quote', {
      method: 'POST',
      body: { products: state.combo.products, ethaFormat: state.combo.ethaFormat, mode: 'monthly' },
    });
    if (seq !== quoteSeq) return; // drop stale out-of-order response
    if (q.ok) {
      state.quote = q.data;
      state.deltaPulse = pulse;
    }
  }

  async function loadOutbox(recipient) {
    if (!recipient) return;
    const r = await apiFetch(`/api/v1/dev/outbox?recipient=${encodeURIComponent(recipient)}`);
    if (r.ok) state.outboxMessages = r.data.messages || [];
  }

  async function launchAppWithHandoff(appKey, returnPath = '/') {
    const targetOrigin = APP_ORIGINS[appKey];
    if (!targetOrigin) return;
    if (!state.me) { window.open(targetOrigin + returnPath, '_blank', 'noopener'); return; }
    const res = await apiFetch('/api/v1/auth/handoff', { method: 'POST', body: { targetOrigin, returnPath } });
    if (res.ok) {
      const sep = returnPath.includes('?') ? '&' : '?';
      window.open(`${targetOrigin}${returnPath}${sep}handoff=${encodeURIComponent(res.data.handoffCode)}`, '_blank', 'noopener');
    } else {
      state.feedback = { tone: 'err', text: res.data.error || 'Não foi possível gerar passagem autenticada.' };
      render();
    }
  }

  function renderSegmented(id, options, activeKey, attrName) {
    const idx = Math.max(0, options.findIndex(([k]) => k === activeKey));
    const pct = 100 / options.length;
    return `
      <div class="eno-seg" id="${id}" role="tablist">
        <span class="eno-seg-indicator" style="width:calc(${pct}% - 4px);transform:translateX(calc(${idx * 100}%))"></span>
        ${options.map(([k, lbl]) => `<button type="button" role="tab" aria-selected="${activeKey === k}" ${attrName}="${k}">${lbl}</button>`).join('')}
      </div>
    `;
  }

  function renderTopbar() {
    const authed = Boolean(state.me);
    const tabs = authed
      ? [['portal', 'Portal'], ['plans', 'Planos e checkout'], ['profile', 'Perfil e agenda'], ['billing', 'Cobrança e ciclo'], ['pilot', 'Piloto (2 sem.)']]
      : [['auth', 'Conta'], ['plans', 'Comparar preços'], ['pilot', 'Piloto (2 sem.)']];
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
    return `<div class="eno-status-banner ${cls}" role="status" aria-live="polite">${esc(state.feedback.text)}</div>`;
  }

  function renderOutboxBox() {
    if (!state.outboxMessages.length) return '';
    return `
      <div class="eno-outbox">
        <strong>Caixa local de homologação (alternativa sem Resend/SMTP configurado):</strong>
        <span>Nenhuma mensagem externa foi disparada. Copie ou cole o código de 6 dígitos abaixo:</span>
        ${state.outboxMessages.slice(0, 2).map((m) => `<div>• <b>${esc(m.subject)}</b> — ${esc(m.body_preview)}</div>`).join('')}
      </div>
    `;
  }

  function renderAuthView() {
    const comboNames = state.combo.products.map((p) => p.toUpperCase()).join(' + ') || 'Nenhum';
    const modeTitles = {
      login: 'Entrar na sua conta Enomera',
      signup: 'Criar conta profissional',
      verify: 'Confirmar seu e-mail com código',
      recovery: 'Recuperar acesso à conta',
    };
    const emailTarget = state.pendingEmail || state.formCache.email || state.me?.user?.email || '';

    return `
      <section class="eno-grid-2">
        <div class="eno-card">
          ${renderSegmented('eno-auth-seg', [
            ['login', 'Entrar'],
            ['signup', 'Criar conta'],
            ['verify', 'Código'],
            ['recovery', 'Recuperar'],
          ], state.authMode, 'data-authmode')}

          <div class="eno-panel-enter" key="${state.authMode}">
            <h1 class="eno-h1" style="margin-bottom:8px">${modeTitles[state.authMode]}</h1>

            ${state.authMode === 'login' ? `
              <p class="eno-muted" style="margin-bottom:14px">Sua seleção atual (<b>${esc(comboNames)}</b>) acompanha você automaticamente após entrar.</p>
              <form id="eno-login-form" class="eno-list">
                <div class="eno-field">
                  <label for="l-email">E-mail profissional</label>
                  <input id="l-email" name="email" type="email" class="eno-input" required value="${esc(state.formCache.email)}" placeholder="voce@consultorio.com.br" aria-invalid="${state.fieldError?.field === 'login' ? 'true' : 'false'}">
                </div>
                <div class="eno-field">
                  <label for="l-pwd">Senha</label>
                  <input id="l-pwd" name="password" type="password" class="eno-input" required minlength="8" aria-invalid="${state.fieldError?.field === 'login' ? 'true' : 'false'}">
                  ${state.fieldError?.field === 'login' ? `<span class="eno-field-err">${esc(state.fieldError.text)}</span>` : ''}
                </div>
                <div class="eno-btn-row">
                  <button type="submit" class="eno-btn">Entrar e continuar</button>
                  <button type="button" class="eno-btn eno-btn-sec" id="eno-fill-helena">Usar Helena (fictícia)</button>
                </div>
              </form>
            ` : state.authMode === 'signup' ? `
              <p class="eno-muted" style="margin-bottom:14px">Ao criar a conta, sua combinação <b>${esc(comboNames)}</b> segue salva até o checkout.</p>
              <form id="eno-signup-form" class="eno-list">
                <div class="eno-field"><label for="s-name">Nome completo</label><input id="s-name" name="fullName" class="eno-input" required value="${esc(state.formCache.fullName)}" placeholder="Ex.: Helena Duarte"></div>
                <div class="eno-field">
                  <label for="s-email">E-mail profissional</label>
                  <input id="s-email" name="email" type="email" class="eno-input" required value="${esc(state.formCache.email)}" placeholder="helena@exemplo.com.br" aria-invalid="${state.fieldError?.field === 'email' ? 'true' : 'false'}">
                  ${state.fieldError?.field === 'email' ? `<span class="eno-field-err">${esc(state.fieldError.text)}</span>` : ''}
                </div>
                <div class="eno-grid-2" style="grid-template-columns:1fr 1fr;gap:10px">
                  <div class="eno-field"><label for="s-crp">CRP ou CRM</label><input id="s-crp" name="crpOrCrm" class="eno-input" value="${esc(state.formCache.crpOrCrm)}" placeholder="CRP 06/148290"></div>
                  <div class="eno-field"><label for="s-spec">Especialidade</label><select id="s-spec" name="specialty" class="eno-select"><option value="Psicologia" ${state.formCache.specialty === 'Psicologia' ? 'selected' : ''}>Psicologia</option><option value="Psiquiatria" ${state.formCache.specialty === 'Psiquiatria' ? 'selected' : ''}>Psiquiatria</option></select></div>
                </div>
                <div class="eno-field"><label for="s-pwd">Senha (mínimo 8 caracteres)</label><input id="s-pwd" name="password" type="password" class="eno-input" required minlength="8"></div>
                <button type="submit" class="eno-btn">Criar conta e receber código</button>
              </form>
            ` : state.authMode === 'verify' ? `
              <p class="eno-muted" style="margin-bottom:10px">
                ${state.lastDelivery?.sentExternally
                  ? `Enviamos um código de 6 dígitos para <b>${esc(emailTarget)}</b>.`
                  : `Código de 6 dígitos em homologação (caixa local — sem envio externo por Resend/SMTP neste ambiente) para <b>${esc(emailTarget)}</b>.`}
              </p>
              <p class="eno-muted" style="margin-bottom:12px;font-size:0.84rem">
                ${esc(state.lastDelivery?.delayGuidance || 'Se demorar mais de 60 segundos, verifique o spam, corrija o e-mail abaixo ou clique em Reenviar código.')}
              </p>
              <form id="eno-verify-form" class="eno-list">
                <div class="eno-field">
                  <label for="v-email">E-mail de verificação (você pode corrigir aqui se digitou errado)</label>
                  <input id="v-email" name="email" type="email" class="eno-input" required value="${esc(emailTarget)}">
                </div>
                <div class="eno-field">
                  <label for="otp-0">Código de 6 dígitos (aceita colar o código inteiro)</label>
                  <div class="eno-otp-row" id="eno-otp-group">
                    ${[0, 1, 2, 3, 4, 5].map((i) => `<input id="otp-${i}" class="eno-otp-digit" inputmode="numeric" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" maxlength="6" value="${esc(state.otpDigits[i] || '')}" aria-label="Dígito ${i + 1} de 6">`).join('')}
                  </div>
                  <input type="hidden" id="v-code" name="code" value="${esc(state.otpDigits.join(''))}">
                  ${state.fieldError?.field === 'code' ? `<span class="eno-field-err">${esc(state.fieldError.text)}</span>` : ''}
                </div>
                <div class="eno-btn-row">
                  <button type="submit" class="eno-btn" ${state.busyAction === 'verify' ? 'disabled' : ''}>${state.busyAction === 'verify' ? '<span class="eno-spinner" aria-hidden="true"></span> Validando...' : 'Confirmar código e ir ao checkout'}</button>
                  <button type="button" class="eno-btn eno-btn-sec" id="eno-resend-ver" ${state.resendCooldown > 0 || state.busyAction === 'resend' ? 'disabled' : ''}>${state.busyAction === 'resend' ? 'Reenviando...' : state.resendCooldown > 0 ? `Reenviar código (${state.resendCooldown}s)` : 'Reenviar código'}</button>
                </div>
              </form>
            ` : `
              <p class="eno-muted" style="margin-bottom:12px">Redefinir a senha encerra automaticamente sessões antigas em outros dispositivos.</p>
              <form id="eno-rec-req" class="eno-list" style="margin-bottom:14px">
                <div class="eno-field"><label for="r-email">E-mail cadastrado</label><input id="r-email" name="email" type="email" class="eno-input" required value="${esc(emailTarget)}"></div>
                <button type="submit" class="eno-btn eno-btn-sec">Enviar código de recuperação</button>
              </form>
              <form id="eno-rec-confirm" class="eno-list">
                <div class="eno-field"><label for="rc-code">Código de 6 dígitos</label><input id="rc-code" name="code" class="eno-input" required maxlength="6" placeholder="000000"></div>
                <div class="eno-field"><label for="rc-pwd">Nova senha (mínimo 8 caracteres)</label><input id="rc-pwd" name="newPassword" type="password" class="eno-input" required minlength="8"></div>
                <button type="submit" class="eno-btn">Redefinir senha e entrar</button>
              </form>
            `}
          </div>
          ${renderOutboxBox()}
        </div>

        <aside class="eno-card">
          <span class="eno-pill">SEU CARRINHO PRESERVADO</span>
          <h2 class="eno-h2">${esc(comboNames)}</h2>
          ${state.quote ? `
            <p class="eno-muted">Hoje (simulado): <b>${esc(state.quote.answers.dueToday)}</b><br>Recorrente: <b>${esc(state.quote.answers.recurring)}</b></p>
            <button type="button" class="eno-btn eno-btn-sec" data-tab="plans">Alterar combinação</button>
          ` : ''}
          <hr style="border:0;border-top:1px solid #E2E9F7;margin:4px 0">
          <span class="eno-pill eno-pill-warn">CONTAS FICTÍCIAS DE TESTE</span>
          <div class="eno-list">
            <div class="eno-row"><div><b>Helena Duarte</b><div class="eno-muted">Ambo + Minne + Etha</div></div></div>
            <div class="eno-row"><div><b>Dr. Paulo Mendes</b><div class="eno-muted">Minne solo (isolamento)</div></div></div>
            <div class="eno-row"><div><b>Marcos Martins</b><div class="eno-muted">Operação Etha (sem acesso clínico)</div></div></div>
          </div>
        </aside>
      </section>
    `;
  }

  function renderPlansAndCheckout() {
    const q = state.quote;
    const isSel = (p) => state.combo.products.includes(p);
    const isPermView = state.combo.viewMode === 'permanent';
    const pulseClass = state.deltaPulse ? 'eno-delta-pulse' : '';
    state.deltaPulse = false;

    return `
      <section class="eno-grid-2">
        <div class="eno-card">
          <span class="eno-pill eno-pill-warn">CATÁLOGO DE HOMOLOGAÇÃO ${esc(state.catalog?.version || '2026-11-sim-v2')} · SEM COBRANÇA REAL</span>
          <h1 class="eno-h1">Escolha seus serviços Enomera</h1>

          ${renderSegmented('eno-bill-seg', [
            ['monthly', 'Assinatura mensal (simulação)'],
            ['permanent', 'Licença permanente (em avaliação)'],
          ], state.combo.viewMode || 'monthly', 'data-viewmode')}

          ${isPermView ? `
            <div class="eno-card eno-card-warn eno-panel-enter" style="padding:16px">
              <b>Licença permanente — oferta em avaliação (não liberada para cobrança)</b>
              <p class="eno-muted">Hipóteses de referência: <b>Ambo R$ 790</b> e <b>Minne R$ 1.390</b> (pagamento único com atualizações futuras incluídas). Hospedagem gerenciada, suporte e condições continuam sendo cobrados separadamente e dependem de definição antes da venda real.</p>
            </div>
          ` : ''}

          <div class="eno-list">
            <label class="eno-check-card" data-prod="ambo" data-selected="${isSel('ambo')}">
              <div>
                <span class="eno-pill eno-pill-ambo">Ambo · R$ 39/mês</span>
                <p class="eno-muted" style="margin-top:6px">Agendamento online, área verificada do paciente, convites e Ambo Solo. Hospedagem, atualizações e suporte incluídos.</p>
              </div>
              <input type="checkbox" data-toggle-prod="ambo" ${isSel('ambo') ? 'checked' : ''} style="width:22px;height:22px;accent-color:#235D94">
            </label>

            <label class="eno-check-card" data-prod="minne" data-selected="${isSel('minne')}">
              <div>
                <span class="eno-pill eno-pill-minne">Minne · R$ 69/mês (Combo Ambo + Minne: R$ 89/mês)</span>
                <p class="eno-muted" style="margin-top:6px">Agenda integrada ao Ambo, prontuários versionados e importação em 6 formatos. Economia explícita de <b>R$ 19/mês</b> no combo.</p>
              </div>
              <input type="checkbox" data-toggle-prod="minne" ${isSel('minne') ? 'checked' : ''} style="width:22px;height:22px;accent-color:#1E625E">
            </label>

            <div class="eno-check-card" data-prod="etha" data-selected="${isSel('etha')}">
              <div style="flex:1">
                <label for="cb-etha" style="cursor:pointer;display:block">
                  <span class="eno-pill eno-pill-etha">Etha · 50% entrada hoje + 50% na entrega</span>
                  <p class="eno-muted" style="margin-top:6px">Página única: <b>R$ 1.190</b> (R$ 595 hoje + R$ 595 na aprovação) · Multipágina até 4 pág.: <b>R$ 2.190</b> (R$ 1.095 + R$ 1.095). Hospedagem e painel <b>R$ 39/mês</b> somente após publicação.</p>
                </label>
                ${isSel('etha') ? `
                  <div style="margin-top:10px">
                    <label for="eno-etha-fmt" class="eno-sr-only">Formato do site Etha</label>
                    <select id="eno-etha-fmt" class="eno-select">
                      <option value="one_page" ${state.combo.ethaFormat === 'one_page' ? 'selected' : ''}>Página única — R$ 1.190 (50% hoje: R$ 595 · 50% na entrega: R$ 595)</option>
                      <option value="multi_page" ${state.combo.ethaFormat === 'multi_page' ? 'selected' : ''}>Multipágina (até 4 pág.) — R$ 2.190 (50% hoje: R$ 1.095 · 50% na entrega: R$ 1.095)</option>
                    </select>
                  </div>
                ` : ''}
              </div>
              <input id="cb-etha" type="checkbox" data-toggle-prod="etha" ${isSel('etha') ? 'checked' : ''} aria-label="Incluir site exclusivo Etha" style="width:22px;height:22px;accent-color:#53459A;flex-shrink:0">
            </div>
          </div>
        </div>

        <aside class="eno-card" aria-live="polite">
          <span class="eno-pill">${isPermView ? 'SIMULAÇÃO MENSAL · LICENÇA PERMANENTE EM AVALIAÇÃO' : 'RESUMO EM TEMPO REAL · SIMULAÇÃO'}</span>
          <h2 class="eno-h2">Checkout simulado (idempotente)</h2>
          ${isPermView ? `<p class="eno-muted" style="font-size:0.85rem;color:#7D5112"><b>Nota:</b> a licença permanente ainda está em avaliação e não está liberada para contratação. Volte para <b>Assinatura mensal</b> para simular o pedido.</p>` : ''}
          ${q ? `
            <div class="eno-list">
              ${q.lines.map((l) => `<div class="eno-row"><div><b>${esc(l.label)}</b><div class="eno-muted">${esc(l.includes)}</div></div></div>`).join('')}
            </div>
            <div class="eno-card ${pulseClass}" style="background:#F0F4FE;padding:16px;border-color:#CAD4F8">
              <div><b>Hoje (entrada/1º ciclo):</b> ${esc(q.answers.dueToday)}</div>
              <div><b>Saldo na entrega/aprovação:</b> ${esc(q.answers.balanceOnApproval)}</div>
              <div><b>Recorrência separada:</b> ${esc(q.answers.recurring)}</div>
              <div><b>Desconto aplicado:</b> ${esc(q.answers.discountWhere)}</div>
              <div class="eno-muted"><b>Se retirar 1 produto:</b> ${esc(q.answers.ifRemoveOne)}</div>
            </div>

            ${state.me ? `
              <div class="eno-field">
                <label for="chk-outcome">Simular resposta do pagamento (sem cobrança real)</label>
                <select id="chk-outcome" class="eno-select">
                  <option value="approved">Aprovado (libera produtos no backend)</option>
                  <option value="pending">Pendente (retomável após recarregar)</option>
                  <option value="declined">Recusado (mantém seleção para nova tentativa)</option>
                </select>
              </div>
              <div class="eno-btn-row">
                <button type="button" class="eno-btn" id="eno-checkout-submit" ${state.processingCheckout || isPermView ? 'disabled' : ''}>
                  ${state.processingCheckout ? '<span class="eno-spinner" aria-hidden="true"></span> Processando pedido...' : isPermView ? 'Disponível no modo mensal' : `Confirmar pedido simulado · ${esc(q.answers.dueToday)}`}
                </button>
                ${!isSel('etha') ? `<button type="button" class="eno-btn eno-btn-minne" id="eno-start-trial" ${state.busyAction === 'trial' ? 'disabled' : ''}>${state.busyAction === 'trial' ? 'Ativando...' : 'Teste 7 dias (sem cartão)'}</button>` : ''}
              </div>
              <small class="eno-muted">Pedido único protegido contra cliques repetidos (<code>${esc(state.checkoutIdempotencyKey)}</code>).</small>
            ` : `
              <button type="button" class="eno-btn" id="eno-go-auth">Criar conta ou entrar mantendo seleção →</button>
            `}
          ` : `<p class="eno-muted">Selecione ao menos um serviço para calcular.</p>`}

          ${state.lastOrder ? `
            <div class="eno-card eno-panel-enter ${state.lastOrder.order.status === 'approved' ? 'eno-card-minne' : state.lastOrder.order.status === 'declined' ? 'eno-card-err' : 'eno-card-warn'}">
              <span class="eno-pill ${state.lastOrder.order.status === 'approved' ? 'eno-pill-ok' : state.lastOrder.order.status === 'declined' ? 'eno-pill-err' : 'eno-pill-warn'}">
                ${state.lastOrder.order.status === 'approved' ? 'Aprovado (simulação)' : state.lastOrder.order.status === 'pending' ? 'Pagamento pendente' : 'Pagamento recusado'} · ${esc(state.lastOrder.order.receipt_code)}
              </span>
              <p class="eno-muted">
                ${state.lastOrder.order.status === 'approved'
                  ? 'Direitos liberados no servidor. Abra o Portal para começar pela primeira ação útil.'
                  : state.lastOrder.order.status === 'pending'
                    ? 'Seu pedido segue registrado mesmo se você recarregar a página. Acompanhe em Cobrança ou conclua a simulação abaixo.'
                    : 'Nenhuma cobrança real foi feita e sua combinação foi mantida. Tente novamente sem preencher tudo outra vez.'}
              </p>
              ${state.lastOrder.order.status !== 'approved'
                ? `<button type="button" class="eno-btn" data-retry-order="${esc(state.lastOrder.order.id)}" ${state.busyAction === 'retryOrder' ? 'disabled' : ''}>${state.busyAction === 'retryOrder' ? 'Retomando...' : 'Retomar e aprovar pedido (simulado)'}</button>`
                : `<button type="button" class="eno-btn eno-btn-ambo" data-tab="portal">Ir para o Portal (produtos ativos) →</button>`}
            </div>
          ` : ''}
        </aside>
      </section>

      ${q ? `
        <div class="eno-mobile-bar" id="eno-mobile-bar" role="region" aria-live="polite" aria-label="Resumo móvel da contratação">
          <div style="min-width:0;flex:1">
            <small class="eno-muted" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Hoje (simulado)</small>
            <div style="font-weight:800;font-size:1.02rem;white-space:nowrap">${esc(q.answers.dueToday)}</div>
          </div>
          ${state.me
            ? `<button type="button" class="eno-btn" id="eno-mobile-checkout" style="flex-shrink:0" ${state.processingCheckout || isPermView ? 'disabled' : ''}>${state.processingCheckout ? 'Processando...' : isPermView ? 'Modo mensal' : 'Confirmar'}</button>`
            : `<button type="button" class="eno-btn" id="eno-mobile-auth" style="flex-shrink:0">Continuar →</button>`}
        </div>
      ` : ''}
    `;
  }

  function renderPortalView() {
    const s = state.summary;
    if (!s) return '<div class="eno-card"><p class="eno-muted">Carregando seu portal...</p></div>';
    const e = s.entitlements || {};
    const activeCount = ['ambo', 'minne', 'etha'].filter((p) => e[p]?.canReadExport).length;
    const isEthaOnly = e.etha?.canReadExport && !e.ambo?.canReadExport && !e.minne?.canReadExport;

    return `
      <section class="eno-list eno-panel-enter" style="gap:20px">
        <div class="eno-card eno-card-highlight">
          <div class="eno-row" style="background:transparent;border:0;padding:0">
            <div>
              <span class="eno-pill">PORTAL PROFISSIONAL · ${esc(s.account.displayName)} ${s.account.crpOrCrm ? `· ${esc(s.account.crpOrCrm)}` : ''}</span>
              <h1 class="eno-h1" style="margin-top:8px">${activeCount ? 'Seus produtos prontos para uso' : 'Bem-vinda! Escolha seu ponto de partida'}</h1>
              <p class="eno-muted">Primeira ação recomendada agora: <b>${esc(s.nextAction.label)}</b></p>
            </div>
            <div class="eno-btn-row">
              ${!state.me.user.emailVerified ? `<button type="button" class="eno-btn eno-btn-sec" id="eno-go-verify">Verificar e-mail pendente</button>` : `<span class="eno-pill eno-pill-ok">E-mail verificado</span>`}
              <button type="button" class="eno-btn eno-btn-sec" data-tab="profile">Configurar disponibilidade</button>
            </div>
          </div>
          ${s.pendingSyncs?.length ? `
            <div class="eno-card eno-card-warn">
              <b>Atualização pendente entre produtos (${s.pendingSyncs.length})</b>
              <p class="eno-muted">O registro principal está salvo no banco. Conclua a propagação sem duplicar a ação:</p>
              ${s.pendingSyncs.map((ev) => `<button type="button" class="eno-btn eno-btn-sec" data-retry-sync="${esc(ev.id)}">Reenviar sincronização ${esc(ev.event_type)}</button>`).join('')}
            </div>
          ` : ''}
        </div>

        ${isEthaOnly ? `
          <div class="eno-card eno-card-etha">
            <span class="eno-pill eno-pill-etha">PORTAL ADAPTADO · SOMENTE ETHA</span>
            <h2 class="eno-h2">Andamento do seu site exclusivo</h2>
            <p class="eno-muted">Sem menus vazios de agenda ou prontuário. Status atual na Etha: <b>${esc(s.routine.ethaProject?.status || 'briefing')}</b>.</p>
            <div class="eno-btn-row">
              <button type="button" class="eno-btn eno-btn-etha" data-launch="etha" data-path="/?modo=ao-vivo">Abrir Etha (briefing, revisão e painel) ↗</button>
              <button type="button" class="eno-btn eno-btn-sec" data-tab="plans">Conhecer Ambo e Minne</button>
            </div>
          </div>
        ` : `
          <div class="eno-grid-3">
            <article class="eno-card ${e.ambo?.canReadExport ? 'eno-card-ambo' : ''}">
              <span class="eno-pill ${e.ambo?.canWrite ? 'eno-pill-ok' : 'eno-pill-ambo'}">${e.ambo ? `Ambo · ${esc(e.ambo.status)}` : 'Ambo · Não contratado'}</span>
              <h2 class="eno-h2">ambo</h2>
              <p class="eno-muted">Link público: <code>?pro=${esc(s.account.slug)}</code><br>${e.ambo?.canReadExport ? `Solicitações pendentes: <b>${s.routine.pendingRequests ?? 0}</b>` : 'Agendamento online e área verificada do paciente.'}</p>
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
              <p class="eno-muted">${e.minne?.canReadExport ? `Consultas confirmadas: <b>${s.routine.confirmedAppointments ?? 0}</b> · Rascunhos: <b>${s.routine.clinicalDrafts ?? 0}</b>` : 'Agenda clínica, prontuários versionados e importação em 6 meios.'}</p>
              <div class="eno-btn-row">
                ${e.minne?.canReadExport ? `
                  <button type="button" class="eno-btn eno-btn-minne" data-launch="minne" data-path="/?modo=ao-vivo">Abrir Minne ↗</button>
                  <button type="button" class="eno-btn eno-btn-sec" data-launch="minne" data-path="/?modo=ao-vivo&aba=importar">Importar prontuários ↗</button>
                ` : `<button type="button" class="eno-btn eno-btn-sec" data-tab="plans">Contratar / Testar 7 dias</button>`}
              </div>
            </article>

            <article class="eno-card ${e.etha?.canReadExport ? 'eno-card-etha' : ''}">
              <span class="eno-pill ${e.etha?.canWrite ? 'eno-pill-ok' : 'eno-pill-etha'}">${e.etha ? `Etha · ${esc(s.routine.ethaProject?.status || e.etha.status)}` : 'Etha · Outro serviço'}</span>
              <h2 class="eno-h2">etha</h2>
              <p class="eno-muted">Site exclusivo com briefing, 1 rodada consolidada e painel de edição.</p>
              <div class="eno-btn-row">
                ${e.etha?.canReadExport ? `
                  <button type="button" class="eno-btn eno-btn-etha" data-launch="etha" data-path="/?modo=ao-vivo">Abrir Etha ↗</button>
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
      <section class="eno-grid-2 eno-panel-enter">
        <form id="eno-profile-form" class="eno-card">
          <span class="eno-pill">PERFIL COMPARTILHADO (AMBO + MINNE)</span>
          <h1 class="eno-h1">Dados profissionais, modalidades e valor</h1>
          <div class="eno-field"><label for="p-name">Nome de exibição</label><input id="p-name" name="displayName" class="eno-input" value="${esc(p.displayName)}"></div>
          <div class="eno-field"><label for="p-crp">CRP / CRM</label><input id="p-crp" name="crpOrCrm" class="eno-input" value="${esc(p.crpOrCrm)}"></div>
          <div class="eno-field"><label for="p-price">Valor da consulta em reais (acerto fora do app)</label><input id="p-price" name="priceReais" type="number" min="0" class="eno-input" value="${Math.round((p.sessionPriceCents || 22000) / 100)}"></div>
          <div class="eno-field"><label for="p-city">Cidade / consultório</label><input id="p-city" name="city" class="eno-input" value="${esc(p.city)}"></div>
          <div class="eno-field"><label for="p-meet">Link externo da sala online</label><input id="p-meet" name="onlineMeetingUrl" class="eno-input" value="${esc(p.onlineMeetingUrl)}"></div>
          <button type="submit" class="eno-btn">Salvar alterações</button>
        </form>

        <div class="eno-card">
          <span class="eno-pill eno-pill-ambo">DISPONIBILIDADE E BLOQUEIOS</span>
          <h2 class="eno-h2">Fuso configurado: ${esc(p.timezone)}</h2>
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
      <section class="eno-grid-2 eno-panel-enter">
        <div class="eno-card">
          <span class="eno-pill">CICLO DE VIDA E DIREITOS DE ACESSO</span>
          <h1 class="eno-h1">Serviços, cancelamento parcial e exportação</h1>
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
                ${o.status !== 'approved' ? `<button type="button" class="eno-btn eno-btn-sec" data-retry-order="${esc(o.id)}" ${state.busyAction === 'retryOrder' ? 'disabled' : ''}>Retomar</button>` : ''}
              </div>
            `).join('') : '<p class="eno-muted">Nenhum pedido registrado ainda.</p>'}
          </div>
        </aside>
      </section>
    `;
  }

  function renderPilotView() {
    return `
      <section class="eno-card eno-panel-enter" style="max-width:760px">
        <span class="eno-pill eno-pill-etha">PILOTO ACOMPANHADO · 2 SEMANAS</span>
        <h1 class="eno-h1">Solicitar participação no piloto acompanhado</h1>
        <p class="eno-muted">Duas semanas gratuitas com acompanhamento próximo (2 a 3 profissionais, sem cobrança). Distinto do teste comercial de 7 dias sem cartão.</p>
        <form id="eno-pilot-form" class="eno-list">
          <div class="eno-field"><label for="pl-name">Nome completo</label><input id="pl-name" name="fullName" class="eno-input" required value="${esc(state.me?.user?.fullName || '')}"></div>
          <div class="eno-field"><label for="pl-email">E-mail</label><input id="pl-email" name="email" type="email" class="eno-input" required value="${esc(state.me?.user?.email || '')}"></div>
          <div class="eno-field"><label for="pl-notes">O que deseja avaliar?</label><input id="pl-notes" name="notes" class="eno-input" placeholder="Ex.: agendamento no Ambo e prontuário no Minne"></div>
          <button type="submit" class="eno-btn eno-btn-etha">Registrar interesse no piloto (sem cobrança)</button>
        </form>
      </section>
    `;
  }

  function render() {
    const active = document.activeElement;
    const focusKey = active?.id
      ? { by: 'id', val: active.id }
      : active?.dataset?.tab
        ? { by: 'attr', attr: 'data-tab', val: active.dataset.tab }
        : active?.dataset?.authmode
          ? { by: 'attr', attr: 'data-authmode', val: active.dataset.authmode }
          : active?.dataset?.viewmode
            ? { by: 'attr', attr: 'data-viewmode', val: active.dataset.viewmode }
            : active?.dataset?.toggleProd
              ? { by: 'attr', attr: 'data-toggle-prod', val: active.dataset.toggleProd }
              : null;

    const view = state.tab === 'auth' ? renderAuthView()
      : state.tab === 'plans' ? renderPlansAndCheckout()
      : state.tab === 'profile' ? renderProfileView()
      : state.tab === 'billing' ? renderBillingView()
      : state.tab === 'pilot' ? renderPilotView()
      : renderPortalView();

    rootEl.innerHTML = `<div class="eno-shell">${renderTopbar()}<div class="eno-container" id="portal-content" tabindex="-1">${renderFeedback()}${view}</div></div>`;
    bindEvents();

    if (focusKey) {
      const target = focusKey.by === 'id'
        ? rootEl.querySelector(`#${CSS.escape(focusKey.val)}`)
        : rootEl.querySelector(`[${focusKey.attr}="${CSS.escape(focusKey.val)}"]`);
      if (target && typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    }
  }

  async function runCheckoutSubmit() {
    if (state.processingCheckout || state.combo.viewMode === 'permanent') return;
    const outcome = rootEl.querySelector('#chk-outcome')?.value || 'approved';
    state.processingCheckout = true;
    render();
    const res = await apiFetch('/api/v1/commercial/orders', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': state.checkoutIdempotencyKey },
      body: { products: state.combo.products, ethaFormat: state.combo.ethaFormat, simulatedOutcome: outcome, method: 'simulated_pix' },
    });
    state.processingCheckout = false;
    if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
    state.lastOrder = res.data;
    saveLastOrder(res.data);
    state.feedback = {
      tone: res.data.order.status === 'approved' ? 'ok' : res.data.order.status === 'pending' ? 'warn' : 'err',
      text: res.data.order.status === 'approved'
        ? `Contratação simulada aprovada (${res.data.order.receipt_code}) e serviços liberados no backend!`
        : res.data.order.status === 'pending'
          ? `Pedido ${res.data.order.receipt_code} em processamento. Mesmo recarregando a página, você retoma este mesmo pedido.`
          : `Pagamento simulado recusado (${res.data.order.receipt_code}). Sua combinação foi preservada para tentar novamente.`,
    };
    await refreshSessionAndData();
  }

  function bindOtpInputs() {
    const inputs = [...rootEl.querySelectorAll('.eno-otp-digit')];
    const hidden = rootEl.querySelector('#v-code');
    if (!inputs.length || !hidden) return;
    const syncHidden = () => {
      state.otpDigits = inputs.map((i) => i.value.replace(/\D/g, '').slice(-1));
      hidden.value = state.otpDigits.join('');
    };
    const fillFrom = (raw) => {
      const clean = raw.replace(/\D/g, '').slice(0, 6);
      inputs.forEach((el, j) => { el.value = clean[j] || ''; });
      syncHidden();
      inputs[Math.min(clean.length, 5)]?.focus();
    };

    inputs.forEach((inp, idx) => {
      inp.addEventListener('input', () => {
        const clean = inp.value.replace(/\D/g, '');
        if (clean.length >= 6) {
          fillFrom(clean);
          return;
        }
        if (clean.length > 1) {
          const prev = state.otpDigits[idx] || '';
          const fresh = prev && clean.startsWith(prev) ? clean.slice(1) : clean.slice(-1);
          inp.value = fresh.slice(-1);
        } else {
          inp.value = clean;
        }
        syncHidden();
        if (inp.value && inputs[idx + 1]) inputs[idx + 1].focus();
      });
      inp.addEventListener('paste', (ev) => {
        const pasted = (ev.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!pasted) return;
        ev.preventDefault();
        fillFrom(pasted);
      });
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Backspace' && !inp.value && inputs[idx - 1]) {
          ev.preventDefault();
          inputs[idx - 1].value = '';
          syncHidden();
          inputs[idx - 1].focus();
        } else if (ev.key === 'ArrowLeft' && inputs[idx - 1]) {
          ev.preventDefault();
          inputs[idx - 1].focus();
        } else if (ev.key === 'ArrowRight' && inputs[idx + 1]) {
          ev.preventDefault();
          inputs[idx + 1].focus();
        }
      });
    });

    // Reset resend cooldown immediately if user edits verification email to a different address
    const vEmail = rootEl.querySelector('#v-email');
    if (vEmail) {
      vEmail.addEventListener('input', () => {
        const cur = vEmail.value.trim().toLowerCase();
        state.pendingEmail = vEmail.value.trim();
        if (state.lastSentEmail && cur && cur !== state.lastSentEmail.toLowerCase() && state.resendCooldown > 0) {
          state.resendCooldown = 0;
          clearInterval(cooldownTimer);
          const btn = rootEl.querySelector('#eno-resend-ver');
          if (btn) { btn.disabled = false; btn.textContent = 'Enviar para este e-mail'; }
        }
      });
    }
  }

  function bindEvents() {
    bindOtpInputs();
    rootEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      state.feedback = null;
      state.fieldError = null;
      render();
    }));
    rootEl.querySelectorAll('[data-authmode]').forEach((b) => b.addEventListener('click', () => {
      state.authMode = b.dataset.authmode;
      state.feedback = null;
      state.fieldError = null;
      render();
    }));
    rootEl.querySelectorAll('[data-viewmode]').forEach((b) => b.addEventListener('click', () => {
      state.combo.viewMode = b.dataset.viewmode;
      saveCombo(state.combo);
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
      state.formCache.email = String(fd.get('email') || '');
      const res = await apiFetch('/api/v1/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      if (!res.ok) {
        state.fieldError = { field: 'login', text: res.data.error || 'E-mail ou senha inválidos. Confira ou use Recuperar acesso.' };
        render();
        return;
      }
      setToken(res.data.sessionToken);
      state.fieldError = null;
      state.feedback = { tone: 'ok', text: `Bem-vinda de volta, ${res.data.user.fullName}. Sua combinação foi mantida.` };
      state.tab = state.returnAfterAuth || 'portal';
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-signup-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const email = String(fd.get('email') || '').trim();
      state.formCache = {
        fullName: String(fd.get('fullName') || ''),
        email,
        crpOrCrm: String(fd.get('crpOrCrm') || ''),
        specialty: String(fd.get('specialty') || 'Psicologia'),
      };
      const res = await apiFetch('/api/v1/auth/signup', {
        method: 'POST',
        body: { ...state.formCache, password: fd.get('password') },
      });
      if (!res.ok) {
        const isEmailErr = res.status === 409 || /e-?mail/i.test(res.data.error || '');
        if (isEmailErr) state.fieldError = { field: 'email', text: res.data.error };
        else { state.fieldError = null; state.feedback = { tone: 'err', text: res.data.error }; }
        render();
        return;
      }
      setToken(res.data.sessionToken);
      state.fieldError = null;
      state.pendingEmail = email;
      state.lastSentEmail = email;
      state.otpDigits = ['', '', '', '', '', ''];
      state.lastDelivery = res.data.verification.delivery;
      await loadOutbox(email);
      state.authMode = 'verify';
      startResendCooldown(30);
      state.feedback = { tone: state.lastDelivery.sentExternally ? 'ok' : 'warn', text: state.lastDelivery.notice };
      await refreshSessionAndData();
      state.tab = 'auth';
      state.authMode = 'verify';
      render();
      rootEl.querySelector('#otp-0')?.focus();
    });

    rootEl.querySelector('#eno-verify-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (state.busyAction === 'verify') return;
      const fd = new FormData(ev.currentTarget);
      const email = String(fd.get('email') || '').trim();
      const code = state.otpDigits.join('') || String(fd.get('code') || '').trim();
      state.pendingEmail = email;
      if (code.length < 6) {
        state.fieldError = { field: 'code', text: 'Preencha ou cole todos os 6 dígitos do código.' };
        render();
        const firstEmpty = state.otpDigits.findIndex((d) => !d);
        rootEl.querySelector(`#otp-${firstEmpty >= 0 ? firstEmpty : 0}`)?.focus();
        return;
      }
      state.busyAction = 'verify';
      render();
      const res = await apiFetch('/api/v1/auth/verify-email', { method: 'POST', body: { email, code } });
      state.busyAction = null;
      if (!res.ok) {
        state.fieldError = { field: 'code', text: res.data.error };
        render();
        rootEl.querySelector('#otp-0')?.focus();
        return;
      }
      state.fieldError = null;
      state.otpDigits = ['', '', '', '', '', ''];
      state.feedback = { tone: 'ok', text: 'E-mail verificado! Levando você ao checkout com sua seleção preservada.' };
      state.tab = 'plans';
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-resend-ver')?.addEventListener('click', async () => {
      if (state.busyAction === 'resend' || state.resendCooldown > 0) return;
      const email = String(rootEl.querySelector('#v-email')?.value || '').trim();
      state.pendingEmail = email;
      state.lastSentEmail = email;
      state.busyAction = 'resend';
      render();
      const res = await apiFetch('/api/v1/auth/resend-verification', { method: 'POST', body: { email } });
      state.busyAction = null;
      state.lastDelivery = res.data.delivery || null;
      await loadOutbox(email);
      startResendCooldown(30);
      state.feedback = { tone: state.lastDelivery?.sentExternally ? 'ok' : 'warn', text: res.data.delivery?.notice || 'Novo código gerado.' };
      render();
    });

    rootEl.querySelector('#eno-rec-req')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = String(new FormData(ev.currentTarget).get('email') || '').trim();
      state.pendingEmail = email;
      const res = await apiFetch('/api/v1/auth/recovery/request', { method: 'POST', body: { email } });
      await loadOutbox(email);
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

    const goAuthFromPlans = () => { state.returnAfterAuth = 'plans'; state.tab = 'auth'; state.authMode = 'signup'; render(); };
    rootEl.querySelector('#eno-go-auth')?.addEventListener('click', goAuthFromPlans);
    rootEl.querySelector('#eno-mobile-auth')?.addEventListener('click', goAuthFromPlans);

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
      await refreshQuote(true);
      render();
    }));

    rootEl.querySelector('#eno-etha-fmt')?.addEventListener('change', async (e) => {
      state.combo.ethaFormat = e.target.value;
      saveCombo(state.combo);
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await refreshQuote(true);
      render();
    });

    rootEl.querySelector('#eno-start-trial')?.addEventListener('click', async () => {
      if (state.busyAction === 'trial') return;
      state.busyAction = 'trial';
      render();
      const res = await apiFetch('/api/v1/commercial/trial/start', { method: 'POST', body: { products: state.combo.products } });
      state.busyAction = null;
      if (!res.ok) { state.feedback = { tone: 'err', text: res.data.error }; render(); return; }
      state.feedback = { tone: 'ok', text: `Teste comercial de 7 dias ativado até ${res.data.trialEndsAt.slice(0, 10)} (sem cartão).` };
      state.tab = 'portal';
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-checkout-submit')?.addEventListener('click', runCheckoutSubmit);
    rootEl.querySelector('#eno-mobile-checkout')?.addEventListener('click', runCheckoutSubmit);

    // Hide mobile sticky bar while an input/select/textarea has focus so it never overlaps keyboard/controls
    const mobileBar = rootEl.querySelector('#eno-mobile-bar');
    if (mobileBar) {
      rootEl.querySelectorAll('input, select, textarea').forEach((el) => {
        el.addEventListener('focus', () => mobileBar.classList.add('is-hidden-for-input'));
        el.addEventListener('blur', () => mobileBar.classList.remove('is-hidden-for-input'));
      });
    }

    rootEl.querySelectorAll('[data-retry-order]').forEach((btn) => btn.addEventListener('click', async () => {
      if (state.busyAction === 'retryOrder') return;
      state.busyAction = 'retryOrder';
      render();
      const res = await apiFetch(`/api/v1/commercial/orders/${btn.dataset.retryOrder}/retry`, {
        method: 'POST', body: { simulatedOutcome: 'approved', method: 'simulated_pix' },
      });
      state.busyAction = null;
      if (res.ok) {
        state.lastOrder = res.data;
        saveLastOrder(res.data);
        state.feedback = { tone: 'ok', text: 'Tentativa retomada e aprovada na simulação. Serviços liberados!' };
        await refreshSessionAndData();
      } else {
        state.feedback = { tone: 'err', text: res.data.error || 'Não foi possível retomar o pedido.' };
        render();
      }
    }));

    rootEl.querySelectorAll('[data-launch]').forEach((b) => b.addEventListener('click', () => launchAppWithHandoff(b.dataset.launch, b.dataset.path || '/')));
    rootEl.querySelectorAll('[data-retry-sync]').forEach((b) => b.addEventListener('click', async () => {
      if (state.busyAction) return;
      state.busyAction = 'sync';
      b.disabled = true;
      const res = await apiFetch(`/api/v1/sync/events/${b.dataset.retrySync}/retry`, { method: 'POST', body: {} });
      state.busyAction = null;
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
      if (res.ok) { state.feedback = { tone: 'ok', text: 'Perfil salvo no backend (refletido no Ambo e Minne).' }; await refreshSessionAndData(); }
    });

    rootEl.querySelector('#eno-block-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const currentBlocks = (state.profileData?.availabilityBlocks || []).map((b) => ({ startAt: b.start_at, endAt: b.end_at, reason: b.reason }));
      currentBlocks.push({ startAt: fd.get('startAt'), endAt: fd.get('endAt'), reason: fd.get('reason') });
      const res = await apiFetch('/api/v1/professional/availability', { method: 'PUT', body: { blocks: currentBlocks } });
      if (res.ok) { state.feedback = { tone: 'ok', text: 'Bloqueio salvo na agenda real.' }; await refreshSessionAndData(); }
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
      setToken(''); saveLastOrder(null);
      state.me = null; state.summary = null; state.lastOrder = null; state.tab = 'auth';
      state.feedback = { tone: 'ok', text: revokeAll ? 'Todas as sessões foram revogadas no servidor.' : 'Você saiu da conta.' };
      render();
    };
    rootEl.querySelector('#eno-logout')?.addEventListener('click', () => doLogout(false));
    rootEl.querySelector('#eno-logout-all')?.addEventListener('click', () => doLogout(true));
  }

  await refreshSessionAndData();
}
