import {
  comboLabel,
  namesWithE,
  renderAccount,
  renderActivationBanner,
  renderChoice,
  renderReview,
} from './contract-flow.js';
const TOKEN_KEY = 'enomera_session_token_v1';
const DRAFT_COMBO_KEY = 'enomera_pending_combo_v1';
const LAST_ORDER_KEY = 'enomera_last_order_v1';
const ACTIVATION_KEY = 'enomera_last_activation_v1';
const FLOW_EMAIL_KEY = 'enomera_flow_email_v1';


// Preview: o projeto Vercel real de cada produto (nomes de projeto != nomes de marca).
// Produção: domínio público oficial. Sempre sobrescrevível por window.__ENOMERA_*_URL.
function resolveSiblingOrigin(override, localPort, previewProject, prodOrigin) {
  if (override) return override;
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    return `http://127.0.0.1:${localPort}`;
  }
  const m = location.hostname.match(/^enomera(-git-.+\.vercel\.app)$/);
  if (m) {
    if (previewProject === 'clara-azevedo-site' && m[1].startsWith('-git-feat-enomera-platform-v1-')) {
      return 'https://clara-azevedo-site-git-feat-enomera-99e58e-marcosvmgs-projects.vercel.app';
    }
    return `https://${previewProject}${m[1]}`;
  }
  return prodOrigin;
}

const APP_ORIGINS = {
  ambo: resolveSiblingOrigin(window.__ENOMERA_AMBO_URL, 3001, 'lotus-app', 'https://ambo-enomera.vercel.app'),
  minne: resolveSiblingOrigin(window.__ENOMERA_MINNE_URL, 3002, 'compasso-app', 'https://compasso-app-seven.vercel.app'),
  etha: resolveSiblingOrigin(window.__ENOMERA_ETHA_URL, 3003, 'etha-enomera', 'https://etha-enomera.vercel.app'),
  helena: resolveSiblingOrigin(window.__ENOMERA_HELENA_URL, 3004, 'clara-azevedo-site', 'https://helenaduartepsi.vercel.app'),
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
function loadActivation() { try { const r = sessionStorage.getItem(ACTIVATION_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveActivation(a) { try { if (a) sessionStorage.setItem(ACTIVATION_KEY, JSON.stringify(a)); else sessionStorage.removeItem(ACTIVATION_KEY); } catch {} }
function loadFlowEmail() { try { return sessionStorage.getItem(FLOW_EMAIL_KEY) || ''; } catch { return ''; } }
function saveFlowEmail(e) { try { if (e) sessionStorage.setItem(FLOW_EMAIL_KEY, e); else sessionStorage.removeItem(FLOW_EMAIL_KEY); } catch {} }
function loadSavedOrder() { try { const r = sessionStorage.getItem(LAST_ORDER_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function saveLastOrder(o) { try { if (o) sessionStorage.setItem(LAST_ORDER_KEY, JSON.stringify(o)); else sessionStorage.removeItem(LAST_ORDER_KEY); } catch {} }

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isRemoteInfraError(status, data) {
  const code = String(data?.code || '');
  return (
    status === 503 ||
    code === 'REMOTE_INFRA_NOT_CONFIGURED' ||
    code === 'REMOTE_DB_NOT_CONFIGURED' ||
    code === 'REMOTE_BLOB_NOT_CONFIGURED' ||
    code === 'REMOTE_MAILER_NOT_CONFIGURED'
  );
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
  if (res.status === 401 && tok) setToken('');
  const infraError = isRemoteInfraError(res.status, data)
    ? {
        code: data.code || 'REMOTE_INFRA_NOT_CONFIGURED',
        error: data.error || 'Infraestrutura remota de Preview aguarda configuração das variáveis de ambiente.',
        missingEnvVars: Array.isArray(data.missingEnvVars) ? data.missingEnvVars : [],
      }
    : null;
  return { ok: res.ok, status: res.status, data, infraError };
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
    formCache: { fullName: '', email: '', crpOrCrm: '', specialty: 'Psicologia', loginPwd: '', signupPwd: '', recoveryCode: '', recoveryPwd: '' },
    pwdVisible: { 'l-pwd': false, 's-pwd': false, 'rc-pwd': false },
    fieldError: null,
    infraError: null,
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
    // Percurso de contratação aprovado (22 nov)
    flowEmail: loadFlowEmail(),
    codeError: '',
    devCode: '',
    returnedFromReview: false,
    activating: false,
    activation: loadActivation(),
    comboDirty: false, // escolha feita nesta aba ainda não gravada na conta
  };

  const motionTracker = {
    prevTab: null,
    prevAuthMode: null,
    prevViewMode: null,
    segIndices: {},
  };

  function syncHistory(tab, authMode) {
    if (!window.history?.pushState) return;
    const nextPath = tab === 'plans' || tab === 'review' ? '/checkout' : tab === 'auth' ? '/conta' : '/portal';
    const nextSearch = tab === 'review' ? '?etapa=revisao' : '';
    const st = window.history.state || {};
    if (st.enoTab === tab && st.enoAuthMode === authMode && location.pathname === nextPath && location.search === nextSearch) return;
    try {
      window.history.pushState({ enoTab: tab, enoAuthMode: authMode }, '', nextPath + nextSearch);
    } catch {}
  }

  window.addEventListener('popstate', (ev) => {
    const st = ev.state;
    if (st?.enoTab) {
      state.tab = st.enoTab;
      if (st.enoAuthMode) state.authMode = st.enoAuthMode;
    } else if (location.pathname.startsWith('/checkout')) {
      state.tab = new URLSearchParams(location.search).get('etapa') === 'revisao' ? 'review' : 'plans';
    } else if (location.pathname.startsWith('/conta')) {
      state.tab = 'auth';
    } else {
      state.tab = state.me ? 'portal' : 'auth';
    }
    state.fieldError = null;
    render();
  });

  let quoteSeq = 0;

  const qs = new URLSearchParams(location.search);
  if (qs.get('selecao')) {
    const prods = qs.get('selecao').split(',').filter((x) => ['ambo', 'minne', 'etha'].includes(x));
    if (prods.length) { state.combo.products = prods; state.comboDirty = true; saveCombo(state.combo); }
  }
  if (qs.get('periodicidade')) {
    state.combo.viewMode = qs.get('periodicidade') === 'licenca' ? 'permanent' : 'monthly';
    state.comboDirty = true;
    saveCombo(state.combo);
  }
  state.authMode = state.flowEmail && qs.get('etapa') === 'codigo' ? 'code' : 'email';
  if (location.pathname.startsWith('/checkout') || qs.get('etapa') === 'planos') {
    state.tab = qs.get('etapa') === 'revisao' ? 'review' : 'plans';
    state.returnAfterAuth = 'review';
  }
  if (location.pathname.startsWith('/conta') || qs.get('etapa') === 'conta') {
    state.tab = 'auth';
    state.returnAfterAuth = 'review';
  }

  let cooldownTimer = null;
  function startResendCooldown(sec = 30) {
    state.resendCooldown = sec;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      state.resendCooldown = Math.max(0, state.resendCooldown - 1);
      if (state.tab === 'auth' && state.authMode === 'code') {
        const note = rootEl.querySelector('#eno-code-form .eno-flow-note');
        if (state.resendCooldown === 0) {
          render(); // mostra "Reenviar código" (o foco é preservado por id)
        } else if (note && !state.codeError && note.firstChild?.nodeType === 3) {
          const mm = Math.floor(state.resendCooldown / 60);
          const ss = String(state.resendCooldown % 60).padStart(2, '0');
          note.firstChild.textContent = `Reenviar código em ${mm}:${ss} · `;
        }
      }
      if (state.resendCooldown === 0) clearInterval(cooldownTimer);
    }, 1000);
  }

  async function refreshSessionAndData() {
    const hadToken = Boolean(getToken());
    const [healthRes, catRes, meRes] = await Promise.all([
      apiFetch('/api/v1/health'),
      apiFetch('/api/v1/catalog'),
      apiFetch('/api/v1/auth/me'),
    ]);
    if (healthRes.infraError) state.infraError = healthRes.infraError;
    else if (meRes.infraError) state.infraError = meRes.infraError;
    else if (healthRes.ok && healthRes.data?.ok) state.infraError = null;
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
        await syncAccountSelection();
      }
      if (state.tab === 'auth') state.tab = state.returnAfterAuth === 'review' ? 'review' : 'portal';
    } else {
      state.me = null;
      state.summary = null;
      if (hadToken && meRes.status === 401) {
        if (state.tab !== 'auth') state.returnAfterAuth = state.tab;
        state.tab = 'auth';
        state.authMode = 'email';
        state.feedback = {
          tone: 'warn',
          text: 'Sua sessão expirou. Entre novamente para retomar exatamente de onde parou com sua seleção preservada.',
        };
      } else if (['portal', 'profile', 'billing', 'review'].includes(state.tab)) {
        state.returnAfterAuth = state.tab;
        state.tab = 'auth';
      }
    }
    await refreshQuote(false);
    render();
  }

  function selectionPayload() {
    return {
      products: state.combo.products,
      billing: state.combo.viewMode === 'permanent' ? 'permanent' : 'monthly',
      ethaFormat: state.combo.ethaFormat,
    };
  }

  // A combinação escolhida é estado da conta: a conta guarda; a aba só guarda até a verificação.
  async function syncAccountSelection() {
    if (!state.me?.account) return;
    if (state.comboDirty && state.combo.products.length) {
      const put = await apiFetch('/api/v1/commercial/selection', { method: 'PUT', body: selectionPayload() });
      if (put.ok) state.comboDirty = false;
      return;
    }
    const res = await apiFetch('/api/v1/commercial/selection');
    const sel = res.ok ? res.data.selection : null;
    if (sel?.products?.length) {
      state.combo.products = sel.products;
      state.combo.viewMode = sel.billing === 'permanent' ? 'permanent' : 'monthly';
      if (sel.ethaFormat) state.combo.ethaFormat = sel.ethaFormat;
      saveCombo(state.combo);
    }
  }

  let selectionTimer = null;
  function persistSelectionSoon() {
    saveCombo(state.combo);
    state.comboDirty = true;
    if (!state.me?.account || !state.combo.products.length) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(async () => {
      const res = await apiFetch('/api/v1/commercial/selection', { method: 'PUT', body: selectionPayload() });
      if (res.ok) state.comboDirty = false;
    }, 250);
  }

  async function refreshQuote(pulse = true) {
    const seq = ++quoteSeq;
    if (!state.combo.products.length) { state.quote = null; return; }
    const q = await apiFetch('/api/v1/catalog/quote', {
      method: 'POST',
      body: { ...selectionPayload(), mode: 'monthly' },
    });
    if (seq !== quoteSeq) return; // drop stale out-of-order response
    if (q.ok) {
      state.quote = q.data;
      state.deltaPulse = pulse;
    }
  }

  async function requestEmailCode(email) {
    state.busyAction = 'email';
    state.fieldError = null;
    render();
    const res = await apiFetch('/api/v1/auth/email-code/request', { method: 'POST', body: { email } });
    state.busyAction = null;
    if (res.infraError) state.infraError = res.infraError;
    if (!res.ok && res.data.code !== 'CODE_REQUEST_TOO_SOON') {
      if (state.authMode === 'code') state.codeError = res.data.error || 'Não foi possível reenviar agora.';
      else state.fieldError = { field: 'email', text: res.data.error || 'Não foi possível enviar o código agora.' };
      render();
      return;
    }
    state.lastDelivery = res.data.delivery || null;
    state.devCode = '';
    if (!state.lastDelivery?.sentExternally) {
      await loadOutbox(email);
      const m = /\b(\d{6})\b/.exec(String(state.outboxMessages[0]?.body_preview || ''));
      state.devCode = m ? m[1] : '';
    }
    state.authMode = 'code';
    state.otpDigits = ['', '', '', '', '', ''];
    startResendCooldown(res.data.resendAfterSec || 60);
    syncHistory(state.tab, state.authMode);
    render();
    rootEl.querySelector('#otp-0')?.focus();
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
      <div class="eno-seg" id="${id}" data-seg-idx="${idx}" role="tablist">
        <span class="eno-seg-indicator" style="width:calc(${pct}% - 4px);transform:translateX(calc(${idx * 100}%))"></span>
        ${options.map(([k, lbl]) => `<button type="button" role="tab" aria-selected="${activeKey === k}" ${attrName}="${k}">${lbl}</button>`).join('')}
      </div>
    `;
  }

  function renderInfraAlert() {
    if (!state.infraError) return '';
    const missing = state.infraError.missingEnvVars || [];
    return `
      <section class="eno-infra-alert" role="alert" aria-live="polite">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="max-width:740px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <span class="eno-pill eno-pill-warn">503 · Infraestrutura Remota Pendente</span>
              <strong style="font-size:0.92rem">Ambiente Preview aguardando configuração (${esc(state.infraError.code)})</strong>
            </div>
            <p style="margin:4px 0 6px;font-size:0.84rem;line-height:1.45">
              ${esc(state.infraError.error)} Sua seleção de serviços e os dados preenchidos continuam salvos nesta aba.
            </p>
            ${missing.length ? `
              <div style="font-size:0.77rem;font-weight:650;margin-top:6px">Variáveis ausentes no ambiente Preview:</div>
              <div class="eno-infra-env-list">
                ${missing.map((envName) => `<span class="eno-infra-env-pill">${esc(envName)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
          <button type="button" class="eno-btn eno-btn-sec eno-btn-sm" id="eno-retry-health">Verificar novamente</button>
        </div>
      </section>
    `;
  }

  function renderPasswordField({ id, name, label, hint, value, autocomplete, invalid, errorText }) {
    const isVisible = Boolean(state.pwdVisible[id]);
    return `
      <div class="eno-field">
        <label for="${id}">${esc(label)}</label>
        ${hint ? `<span class="eno-field-hint">${esc(hint)}</span>` : ''}
        <div class="eno-input-wrap">
          <input id="${id}" name="${name}" type="${isVisible ? 'text' : 'password'}" class="eno-input eno-input-with-toggle" required minlength="8" autocomplete="${autocomplete}" value="${esc(value || '')}" aria-invalid="${invalid ? 'true' : 'false'}">
          <button type="button" class="eno-pwd-toggle" data-toggle-pwd="${id}" aria-label="${isVisible ? 'Ocultar senha' : 'Mostrar senha'}">${isVisible ? 'Ocultar' : 'Mostrar'}</button>
        </div>
        ${errorText ? `<span class="eno-field-err">${esc(errorText)}</span>` : ''}
      </div>
    `;
  }

  function renderTopbar() {
    const authed = Boolean(state.me);
    const tabs = authed
      ? [['portal', 'Portal'], ['profile', 'Perfil e agenda'], ['plans', 'Outros serviços'], ['billing', 'Cobrança'], ['pilot', 'Piloto (2 sem.)']]
      : [['auth', 'Entrar'], ['plans', 'Serviços e preços'], ['pilot', 'Piloto (2 sem.)']];
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
    const latest = state.outboxMessages[0];
    const codeMatch = String(latest?.body_preview || '').match(/\b(\d{6})\b/);
    const latestCode = codeMatch ? codeMatch[1] : '';
    return `
      <div class="eno-outbox">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <strong>Caixa local de homologação (alternativa sem Resend/SMTP configurado):</strong>
          ${latestCode ? `<button type="button" class="eno-btn eno-btn-sec eno-btn-sm" id="eno-fill-dev-code" data-dev-code="${esc(latestCode)}">Preencher código agora (${esc(latestCode)})</button>` : ''}
        </div>
        <span>Nenhuma mensagem externa foi disparada. Copie ou cole o código de 6 dígitos abaixo:</span>
        ${state.outboxMessages.slice(0, 2).map((m) => `<div>• <b>${esc(m.subject)}</b> — ${esc(m.body_preview)}</div>`).join('')}
      </div>
    `;
  }

  function renderPortalView() {
    const s = state.summary;
    if (!s) return '<div class="eno-card"><p class="eno-muted">Carregando seu portal...</p></div>';
    const e = s.entitlements || {};
    const activeCount = ['ambo', 'minne', 'etha'].filter((p) => e[p]?.canReadExport).length;
    const isEthaOnly = e.etha?.canReadExport && !e.ambo?.canReadExport && !e.minne?.canReadExport;

    const chosen = state.combo.products.length
      ? `${comboLabel(state.combo.products)} · ${state.combo.viewMode === 'permanent' ? 'Licença permanente' : 'Mensal'}`
      : '';
    return `
      <section class="eno-list eno-panel-enter" style="gap:20px">
        ${renderActivationBanner(state.activation)}
        <div class="eno-card eno-card-highlight">
          <div class="eno-row" style="background:transparent;border:0;padding:0">
            <div>
              <span class="eno-pill">PORTAL PROFISSIONAL · ${esc(s.account.displayName)} ${s.account.crpOrCrm ? `· ${esc(s.account.crpOrCrm)}` : ''}</span>
              <h1 class="eno-h1" style="margin-top:8px">${activeCount ? 'Seus produtos prontos para uso' : 'Bem-vinda! Escolha seu ponto de partida'}</h1>
              <p class="eno-muted">Primeira ação recomendada agora: <b>${esc(s.nextAction.label)}</b></p>
              ${chosen ? `<p class="eno-muted" data-portal-combo>Sua combinação: <b>${esc(chosen)}</b> · <button type="button" class="eno-link" data-tab="plans">Alterar</button></p>` : ''}
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
          <div class="eno-field"><div class="eno-label-row"><label for="pl-notes">O que deseja avaliar?</label><span class="eno-opt-tag">(opcional)</span></div><input id="pl-notes" name="notes" class="eno-input" placeholder="Ex.: agendamento no Ambo e prontuário no Minne"></div>
          <button type="submit" class="eno-btn eno-btn-etha">Registrar interesse no piloto (sem cobrança)</button>
        </form>
      </section>
    `;
  }

  function animateSegmentedIndicators() {
    const rootStyles = getComputedStyle(document.documentElement);
    const pillDuration = parseInt(rootStyles.getPropertyValue('--eno-dur-base'), 10) || 180;
    const pillEasing = rootStyles.getPropertyValue('--eno-ease-pill').trim() || 'ease-out';
    rootEl.querySelectorAll('.eno-seg[id]').forEach((segEl) => {
      const id = segEl.id;
      const curIdx = Number(segEl.dataset.segIdx || 0);
      const prevIdx = motionTracker.segIndices[id];
      motionTracker.segIndices[id] = curIdx;
      if (prevIdx !== undefined && prevIdx !== curIdx && !prefersReducedMotion()) {
        const ind = segEl.querySelector('.eno-seg-indicator');
        if (ind && typeof ind.animate === 'function') {
          ind.animate(
            [
              { transform: `translateX(${prevIdx * 100}%)` },
              { transform: `translateX(${curIdx * 100}%)` },
            ],
            { duration: pillDuration, easing: pillEasing }
          );
        }
      }
    });
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

    const animateAuthBody = state.tab === 'auth' && (motionTracker.prevTab !== 'auth' || motionTracker.prevAuthMode !== state.authMode);
    motionTracker.prevTab = state.tab;
    motionTracker.prevAuthMode = state.authMode;
    motionTracker.prevViewMode = state.combo.viewMode;

    const flowTab = ['plans', 'auth', 'review'].includes(state.tab);
    if (flowTab) {
      const contract = state.combo.products.length ? state.quote?.contract || null : null;
      const flowView = state.tab === 'auth'
        ? renderAccount({
          mode: state.authMode === 'code' ? 'code' : 'email',
          email: state.flowEmail,
          contract,
          codeDigits: state.otpDigits,
          codeError: state.codeError,
          cooldown: state.resendCooldown,
          busy: state.busyAction === 'email' || state.busyAction === 'verify',
          devCode: state.devCode,
          deliveryNote: '',
          fieldError: state.fieldError?.field === 'email' ? state.fieldError.text : '',
        })
        : state.tab === 'review'
          ? renderReview({ combo: state.combo, contract, me: state.me, activating: state.activating })
          : renderChoice({ combo: state.combo, contract, signedIn: Boolean(state.me), returnedFromReview: state.returnedFromReview && Boolean(state.me) });
      rootEl.innerHTML = `<div class="eno-shell eno-flow-shell"><header class="eno-flow-top"><a class="eno-brand" href="/"><img src="/assets/brand.svg" width="32" height="27" alt="">enomera</a>${state.me ? `<button type="button" class="eno-link" data-tab="portal">Ir ao portal</button>` : '<a class="eno-link" href="/">Voltar ao site</a>'}</header><main class="eno-container" id="portal-content" tabindex="-1">${renderInfraAlert()}${state.feedback && state.feedback.tone === 'err' ? renderFeedback() : ''}${flowView}</main></div>`;
      bindEvents();
      if (focusKey) {
        const target = focusKey.by === 'id'
          ? rootEl.querySelector(`#${CSS.escape(focusKey.val)}`)
          : rootEl.querySelector(`[${focusKey.attr}="${CSS.escape(focusKey.val)}"]`);
        if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
      }
      return;
    }

    const view = state.tab === 'profile' ? renderProfileView()
      : state.tab === 'billing' ? renderBillingView()
      : state.tab === 'pilot' ? renderPilotView()
      : renderPortalView();

    rootEl.innerHTML = `<div class="eno-shell"><img class="eno-flower-watermark" src="/assets/flower.svg" alt="" aria-hidden="true">${renderTopbar()}<div class="eno-container" id="portal-content" tabindex="-1">${renderInfraAlert()}${renderFeedback()}${view}</div></div>`;
    animateSegmentedIndicators();
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
    if (state.activating || state.processingCheckout || !state.combo.products.length) return;
    state.activating = true;
    state.processingCheckout = true;
    render();
    const started = Date.now();
    const sel = selectionPayload();
    const res = await apiFetch('/api/v1/commercial/orders', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': state.checkoutIdempotencyKey },
      body: { ...sel, simulatedOutcome: 'approved', method: 'simulated_pix' },
    });
    const wait = prefersReducedMotion() ? 0 : Math.max(0, 1400 - (Date.now() - started));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    state.activating = false;
    state.processingCheckout = false;
    if (!res.ok) {
      state.feedback = { tone: 'err', text: res.data.error || 'Não foi possível ativar agora. Sua combinação continua guardada.' };
      render();
      return;
    }
    state.lastOrder = res.data;
    saveLastOrder(res.data);
    state.activation = {
      names: namesWithE(sel.products),
      count: sel.products.length,
      chargedToday: res.data.summary?.contract?.chargedToday || 'R$ 0,00',
      at: new Date().toISOString(),
    };
    saveActivation(state.activation);
    state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.returnedFromReview = false;
    state.feedback = null;
    state.tab = 'portal';
    syncHistory(state.tab, state.authMode);
    await refreshSessionAndData();
  }

  function bindOtpInputs() {
    const inputs = [...rootEl.querySelectorAll('.eno-otp-digit')];
    const hidden = rootEl.querySelector('#v-code');
    if (!inputs.length) return;
    const syncHidden = () => {
      state.otpDigits = inputs.map((i) => i.value.replace(/\D/g, '').slice(-1));
      if (hidden) hidden.value = state.otpDigits.join('');
      if (state.codeError) {
        state.codeError = '';
        inputs.forEach((el) => el.setAttribute('aria-invalid', 'false'));
        rootEl.querySelector('#eno-otp-group')?.classList.remove('has-error');
        rootEl.querySelector('#eno-code-err')?.remove();
      }
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

    // Live clear of inline errors + keep password/form values across error re-renders
    rootEl.querySelectorAll('.eno-input, .eno-select, .eno-otp-digit').forEach((el) => {
      el.addEventListener('input', () => {
        if (el.id === 'l-email' || el.id === 's-email') state.formCache.email = el.value;
        else if (el.id === 's-name') state.formCache.fullName = el.value;
        else if (el.id === 's-crp') state.formCache.crpOrCrm = el.value;
        else if (el.id === 's-spec') state.formCache.specialty = el.value;
        else if (el.id === 'l-pwd') state.formCache.loginPwd = el.value;
        else if (el.id === 's-pwd') state.formCache.signupPwd = el.value;
        else if (el.id === 'rc-code') state.formCache.recoveryCode = el.value;
        else if (el.id === 'rc-pwd') state.formCache.recoveryPwd = el.value;

        if (el.getAttribute('aria-invalid') === 'true') {
          el.setAttribute('aria-invalid', 'false');
          const err = el.closest('.eno-field')?.querySelector('.eno-field-err');
          if (err) err.remove();
        }
      });
    });

    rootEl.querySelector('#eno-retry-health')?.addEventListener('click', async () => {
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-step-back')?.addEventListener('click', () => {
      state.fieldError = null;
      if (state.tab === 'auth' && (state.authMode === 'verify' || state.authMode === 'recovery')) {
        state.authMode = state.authMode === 'verify' ? 'signup' : 'login';
      } else {
        state.tab = 'plans';
      }
      syncHistory(state.tab, state.authMode);
      render();
    });

    rootEl.querySelector('#eno-auth-back')?.addEventListener('click', () => {
      state.fieldError = null;
      state.authMode = state.authMode === 'verify' ? 'signup' : 'login';
      syncHistory(state.tab, state.authMode);
      render();
    });

    rootEl.querySelectorAll('[data-toggle-pwd]').forEach((btn) => btn.addEventListener('click', () => {
      const targetId = btn.dataset.togglePwd;
      if (!targetId) return;
      state.pwdVisible[targetId] = !state.pwdVisible[targetId];
      const input = rootEl.querySelector(`#${CSS.escape(targetId)}`);
      if (input) {
        input.type = state.pwdVisible[targetId] ? 'text' : 'password';
        btn.textContent = state.pwdVisible[targetId] ? 'Ocultar' : 'Mostrar';
        btn.setAttribute('aria-label', state.pwdVisible[targetId] ? 'Ocultar senha' : 'Mostrar senha');
        input.focus();
      }
    }));

    rootEl.querySelector('#eno-fill-dev-code')?.addEventListener('click', (ev) => {
      const code = String(ev.currentTarget.dataset.devCode || '').replace(/\D/g, '').slice(0, 6);
      if (!code) return;
      if (state.authMode === 'recovery') {
        state.formCache.recoveryCode = code;
        const rc = rootEl.querySelector('#rc-code');
        if (rc) rc.value = code;
        return;
      }
      state.codeError = '';
      state.otpDigits = [0, 1, 2, 3, 4, 5].map((i) => code[i] || '');
      const inputs = [...rootEl.querySelectorAll('.eno-otp-digit')];
      inputs.forEach((inp, i) => {
        inp.value = state.otpDigits[i];
        inp.setAttribute('aria-invalid', 'false');
      });
      const hidden = rootEl.querySelector('#v-code');
      if (hidden) hidden.value = code;
    });

    rootEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      state.feedback = null;
      state.fieldError = null;
      syncHistory(state.tab, state.authMode);
      render();
    }));
    rootEl.querySelectorAll('[data-authmode]').forEach((b) => b.addEventListener('click', () => {
      state.authMode = b.dataset.authmode;
      state.feedback = null;
      state.fieldError = null;
      syncHistory(state.tab, state.authMode);
      render();
    }));
    rootEl.querySelectorAll('[data-viewmode]').forEach((b) => b.addEventListener('click', async () => {
      if (state.combo.viewMode === b.dataset.viewmode) return;
      state.combo.viewMode = b.dataset.viewmode;
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      persistSelectionSoon();
      render();
      await refreshQuote(true);
      if (state.tab === 'plans') render();
    }));

    rootEl.querySelector('#eno-fill-helena')?.addEventListener('click', () => {
      state.formCache.email = 'helena@helenaduartepsi.com.br';
      state.formCache.loginPwd = 'HelenaDemo!2026';
      const e = rootEl.querySelector('#l-email');
      const p = rootEl.querySelector('#l-pwd');
      if (e) e.value = state.formCache.email;
      if (p) p.value = state.formCache.loginPwd;
    });

    rootEl.querySelector('#eno-login-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      state.formCache.email = String(fd.get('email') || '');
      state.formCache.loginPwd = String(fd.get('password') || '');
      const res = await apiFetch('/api/v1/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      if (res.infraError) state.infraError = res.infraError;
      if (!res.ok) {
        state.fieldError = { field: 'login', text: res.data.error || 'E-mail ou senha inválidos. Confira ou use Recuperar acesso.' };
        render();
        return;
      }
      setToken(res.data.sessionToken);
      state.formCache.loginPwd = '';
      state.fieldError = null;
      state.feedback = { tone: 'ok', text: `Bem-vinda de volta, ${res.data.user.fullName}. Sua combinação foi mantida.` };
      state.tab = state.returnAfterAuth || 'portal';
      state.returnAfterAuth = null;
      syncHistory(state.tab, state.authMode);
      await refreshSessionAndData();
    });

    rootEl.querySelector('#eno-signup-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const email = String(fd.get('email') || '').trim();
      const password = String(fd.get('password') || '');
      state.formCache = {
        ...state.formCache,
        fullName: String(fd.get('fullName') || ''),
        email,
        crpOrCrm: String(fd.get('crpOrCrm') || ''),
        specialty: String(fd.get('specialty') || 'Psicologia'),
        signupPwd: password,
      };
      const res = await apiFetch('/api/v1/auth/signup', {
        method: 'POST',
        body: {
          fullName: state.formCache.fullName,
          email: state.formCache.email,
          crpOrCrm: state.formCache.crpOrCrm,
          specialty: state.formCache.specialty,
          password,
        },
      });
      if (res.infraError) state.infraError = res.infraError;
      if (!res.ok) {
        const isEmailErr = res.status === 409 || /e-?mail/i.test(res.data.error || '');
        if (isEmailErr) state.fieldError = { field: 'email', text: res.data.error };
        else { state.fieldError = null; state.feedback = { tone: 'err', text: res.data.error }; }
        render();
        return;
      }
      setToken(res.data.sessionToken);
      state.formCache.signupPwd = '';
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
      syncHistory(state.tab, state.authMode);
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

    const goAuthFromPlans = () => { state.returnAfterAuth = 'plans'; state.tab = 'auth'; state.authMode = 'signup'; syncHistory(state.tab, state.authMode); render(); };
    rootEl.querySelector('#eno-go-auth')?.addEventListener('click', goAuthFromPlans);
    rootEl.querySelector('#eno-mobile-auth')?.addEventListener('click', goAuthFromPlans);

    rootEl.querySelector('#eno-go-verify')?.addEventListener('click', async () => {
      state.pendingEmail = state.me?.user?.email || '';
      await loadOutbox(state.pendingEmail);
      state.tab = 'auth'; state.authMode = 'verify'; syncHistory(state.tab, state.authMode); render();
    });

    rootEl.querySelectorAll('button[data-toggle-prod]').forEach((btn) => btn.addEventListener('click', async () => {
      const prod = btn.dataset.toggleProd;
      const on = !state.combo.products.includes(prod);
      state.combo.products = on
        ? ['ambo', 'minne', 'etha'].filter((p) => p === prod || state.combo.products.includes(p))
        : state.combo.products.filter((x) => x !== prod);
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      persistSelectionSoon();
      render(); // resposta imediata ao toque antes da cotação retornar
      await refreshQuote(true);
      if (state.tab === 'plans') render(); // nunca re-renderizar sobre outra tela após a cotação tardia
    }));

    rootEl.querySelector('#eno-etha-fmt')?.addEventListener('change', async (e) => {
      state.combo.ethaFormat = e.target.value;
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      persistSelectionSoon();
      await refreshQuote(true);
      if (state.tab === 'plans') render();
    });

    rootEl.querySelector('#eno-flow-continue')?.addEventListener('click', () => {
      if (!state.combo.products.length) return;
      state.feedback = null;
      if (state.me) {
        state.tab = 'review';
      } else {
        state.tab = 'auth';
        state.authMode = 'email';
        state.returnAfterAuth = 'review';
      }
      state.returnedFromReview = false;
      syncHistory(state.tab, state.authMode);
      render();
      rootEl.querySelector(state.tab === 'auth' ? '#eno-email' : 'h1')?.focus?.();
    });

    rootEl.querySelectorAll('[data-flow-go="choice"]').forEach((b) => b.addEventListener('click', () => {
      state.returnedFromReview = state.tab === 'review';
      state.tab = 'plans';
      state.feedback = null;
      syncHistory(state.tab, state.authMode);
      render();
    }));

    rootEl.querySelector('#eno-email-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (state.busyAction === 'email') return;
      const email = String(new FormData(ev.currentTarget).get('email') || '').trim();
      state.flowEmail = email;
      saveFlowEmail(email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        state.fieldError = { field: 'email', text: 'Confira o e-mail: ele precisa ter o formato nome@dominio.com.br.' };
        render();
        rootEl.querySelector('#eno-email')?.focus();
        return;
      }
      await requestEmailCode(email);
    });

    rootEl.querySelector('#eno-change-email')?.addEventListener('click', () => {
      state.authMode = 'email';
      state.codeError = '';
      state.otpDigits = ['', '', '', '', '', ''];
      render();
      rootEl.querySelector('#eno-email')?.focus();
    });

    rootEl.querySelector('#eno-resend-code')?.addEventListener('click', async () => {
      if (state.resendCooldown > 0 || state.busyAction) return;
      state.codeError = '';
      state.otpDigits = ['', '', '', '', '', ''];
      await requestEmailCode(state.flowEmail);
    });

    rootEl.querySelector('#eno-code-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (state.busyAction === 'verify') return;
      const code = state.otpDigits.join('');
      if (code.length < 6) {
        state.codeError = 'Preencha ou cole os 6 dígitos do código.';
        render();
        const firstEmpty = state.otpDigits.findIndex((d) => !d);
        rootEl.querySelector(`#otp-${firstEmpty >= 0 ? firstEmpty : 0}`)?.focus();
        return;
      }
      state.busyAction = 'verify';
      render();
      const res = await apiFetch('/api/v1/auth/email-code/verify', {
        method: 'POST',
        body: { email: state.flowEmail, code, selection: state.combo.products.length ? selectionPayload() : null },
      });
      state.busyAction = null;
      if (res.infraError) state.infraError = res.infraError;
      if (!res.ok) {
        state.codeError = res.data.code === 'CODE_INVALID'
          ? 'Código incorreto. Confira os 6 dígitos ou peça um novo código. Sua combinação continua guardada.'
          : `${res.data.error || 'Não foi possível verificar o código.'} Sua combinação continua guardada.`;
        render();
        rootEl.querySelector('#otp-0')?.focus();
        return;
      }
      setToken(res.data.sessionToken);
      state.codeError = '';
      state.devCode = '';
      state.otpDigits = ['', '', '', '', '', ''];
      state.comboDirty = false;
      if (res.data.selection?.products?.length) {
        state.combo.products = res.data.selection.products;
        state.combo.viewMode = res.data.selection.billing === 'permanent' ? 'permanent' : 'monthly';
        if (res.data.selection.ethaFormat) state.combo.ethaFormat = res.data.selection.ethaFormat;
        saveCombo(state.combo);
      }
      const goReview = state.returnAfterAuth === 'review' && state.combo.products.length;
      state.tab = goReview ? 'review' : (state.returnAfterAuth && state.returnAfterAuth !== 'review' ? state.returnAfterAuth : 'portal');
      state.returnAfterAuth = null;
      state.authMode = 'email';
      syncHistory(state.tab, state.authMode);
      await refreshSessionAndData();
      rootEl.querySelector('h1')?.focus?.();
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

    // Hide mobile sticky bar only while a virtual-keyboard text input has focus (not checkboxes/selects)
    const mobileBar = rootEl.querySelector('#eno-mobile-bar');
    if (mobileBar) {
      rootEl.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea').forEach((el) => {
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
      state.me = null; state.summary = null; state.lastOrder = null; state.tab = 'auth'; state.authMode = 'email'; state.returnAfterAuth = null; state.activation = null; saveActivation(null);
      state.formCache.loginPwd = ''; state.formCache.signupPwd = ''; state.formCache.recoveryCode = ''; state.formCache.recoveryPwd = '';
      state.feedback = { tone: 'ok', text: revokeAll ? 'Todas as sessões foram revogadas no servidor.' : 'Você saiu da conta.' };
      syncHistory(state.tab, state.authMode);
      render();
    };
    rootEl.querySelector('#eno-logout')?.addEventListener('click', () => doLogout(false));
    rootEl.querySelector('#eno-logout-all')?.addEventListener('click', () => doLogout(true));
  }

  await refreshSessionAndData();
}
