import { motionSnapshot, motionPlay } from './motion-flip.js';
import {
  comboLabel,
  PLANS,
  namesWithE,
  renderAccount,
  renderActivationBanner,
  renderChoice,
  renderReview,
  setPilotFree,
} from './contract-flow.js';
import { bindOtpField } from './otp-field.js';
const TOKEN_KEY = 'enomera_session_token_v1';
// Guarda o último código enviado automaticamente (sobrevive a re-render).
const otpAuto = { code: '' };
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
const PRODUCT_NAMES = { ambo: 'Ambo', minne: 'Minne', etha: 'Etha' };
const STATUS_LABELS = {
  active: 'Ativo', trial: 'Em teste', read_only: 'Somente leitura', cancelled: 'Cancelado', canceled: 'Cancelado',
  past_due: 'Pagamento pendente', expired: 'Encerrado', pending: 'Pendente', approved: 'Aprovado', failed: 'Não concluído',
  briefing: 'Briefing', draft: 'Rascunho', revision_submitted: 'Revisão enviada', published_staging: 'Site publicado',
  published: 'Site publicado', confirmed: 'Confirmado',
};
const statusLabel = (status) => STATUS_LABELS[status] || 'Em andamento';
const BILLING_LABELS = { monthly: 'Mensal', subscription: 'Mensal', permanent: 'Anual', annual: 'Anual', license: 'Anual', trial: '30 dias grátis', pilot: 'Grátis no piloto' };
const SYNC_LABELS = {};
const loadingSkeleton = (label, cards = 3) => `<div class="eno-skeleton" role="status" aria-busy="true"><span class="eno-sr-only">${label}</span>${Array.from({ length: cards }, () => '<div class="eno-skeleton-card" aria-hidden="true"><span class="eno-skeleton-line is-title"></span><span class="eno-skeleton-line"></span><span class="eno-skeleton-line is-short"></span></div>').join('')}</div>`;

const fmtDateTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso ?? '') : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const brl = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);

function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function setToken(t) { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch {} }
function loadCombo() {
  try { const raw = sessionStorage.getItem(DRAFT_COMBO_KEY); if (raw) return JSON.parse(raw); } catch {}
  return { products: ['ambo', 'minne', 'etha'], ethaFormat: 'one_page', ethaService: 'essencial', viewMode: 'monthly' }; // primeira visita: plano recomendado (Completo)
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
    billingStatus: null,
    billingPrices: null,
    sub: { cycle: 'monthly', doc: '', busy: false, error: '' },
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
    state.combo.viewMode = ['anual', 'licenca'].includes(qs.get('periodicidade')) ? 'permanent' : 'monthly';
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
        const note = rootEl.querySelector('#eno-code-form .eno-flow-note:not(.eno-otp-status)');
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
      try { if (state.me?.pilot?.free) localStorage.setItem('eno_piloto_gratis', '1'); else localStorage.removeItem('eno_piloto_gratis'); } catch {}
      if (state.me.actorType === 'professional') {
        const [sumRes, ordRes, profRes] = await Promise.all([
          apiFetch('/api/v1/portal/summary'),
          apiFetch('/api/v1/commercial/orders'),
          apiFetch('/api/v1/professional/profile'),
        ]);
        if (sumRes.ok) state.summary = sumRes.data;
        const [billRes, priceRes] = await Promise.all([
          apiFetch('/api/v1/billing/status'),
          state.billingPrices ? Promise.resolve(null) : apiFetch('/api/v1/billing/prices'),
        ]);
        if (billRes?.ok) state.billingStatus = billRes.data;
        if (priceRes?.ok) state.billingPrices = priceRes.data.prices || [];
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
      ethaService: state.combo.ethaService === 'sob_medida' ? 'sob_medida' : 'essencial',
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
      if (sel.ethaService) state.combo.ethaService = sel.ethaService;
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
    const tooSoon = !res.ok && ['CODE_REQUEST_TOO_SOON', 'RESEND_RATE_LIMITED'].includes(res.data?.code);
    if (!res.ok && !tooSoon) {
      if (state.authMode === 'code') state.codeError = res.data.error || 'Não foi possível reenviar agora.';
      else state.fieldError = { field: 'email', text: res.data.error || 'Não foi possível enviar o código agora.' };
      render();
      return;
    }
    state.lastDelivery = res.data.delivery || null;
    state.devCode = '';
    if (!tooSoon && !state.lastDelivery?.sentExternally) {
      await loadOutbox(email);
      const m = /\b(\d{6})\b/.exec(String(state.outboxMessages[0]?.body_preview || ''));
      state.devCode = m ? m[1] : '';
    }
    state.authMode = 'code';
    state.otpDigits = ['', '', '', '', '', ''];
    startResendCooldown(tooSoon ? 30 : (res.data.resendAfterSec || 60));
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
    // Detalhe de provedor e nomes de variáveis ficam no diagnóstico interno (/api/v1/health), não na tela.
    return `
      <section class="eno-infra-alert" role="alert" aria-live="polite">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="max-width:740px">
            <strong style="font-size:0.92rem">Ainda não é possível criar a conta por aqui</strong>
            <p style="margin:4px 0 6px;font-size:0.84rem;line-height:1.45">
              Este ambiente de teste está terminando de ser preparado, e o envio do código por e-mail ainda não está disponível. Nada foi cobrado nem enviado. Sua escolha de serviços continua salva nesta aba, e você retoma de onde parou.
            </p>
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
      ? [['portal', 'Portal'], ['profile', 'Perfil e agenda'], ['plans', 'Outros serviços'], ['billing', isPilot() ? 'Plano' : 'Cobrança'], ['pilot', 'Piloto']]
      : [['auth', 'Entrar'], ['plans', 'Serviços e preços'], ['pilot', 'Piloto']];
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
    if (!s) return loadingSkeleton('Carregando seu portal…', 3);
    const e = s.entitlements || {};
    const activeCount = ['ambo', 'minne', 'etha'].filter((p) => e[p]?.canReadExport).length;
    const activeProducts = ['ambo', 'minne', 'etha'].filter((p) => e[p]);
    const otherProducts = ['ambo', 'minne', 'etha'].filter((p) => !e[p]);
    // Com serviços na conta, o portal mostra o que está contratado; a escolha
    // guardada no navegador só aparece para quem ainda não contratou nada.
    const chosen = activeProducts.length
      ? comboLabel(activeProducts)
      : state.combo.products.length
        ? `${comboLabel(state.combo.products)} · ${state.combo.viewMode === 'permanent' ? 'Anual' : 'Mensal'}`
        : '';
    const productCard = (prod, owned) => {
      const ent = e[prod];
      const name = PRODUCT_NAMES[prod];
      const status = prod === 'etha' && ent ? (s.routine.ethaProject?.status || ent.status) : ent?.status;
      const pill = `<span class="eno-pill ${ent?.canWrite ? 'eno-pill-ok' : `eno-pill-${prod}`}">${name} · ${owned ? esc(statusLabel(status)) : 'Disponível'}</span>`;
      const body = {
        ambo: ent?.canReadExport ? `Seu endereço no Ambo: <code>?pro=${esc(s.account.slug)}</code><br>Solicitações aguardando resposta: <b>${s.routine.pendingRequests ?? 0}</b>` : 'Agendamento online e área do paciente.',
        minne: ent?.canReadExport ? `Consultas confirmadas: <b>${s.routine.confirmedAppointments ?? 0}</b> · Rascunhos: <b>${s.routine.clinicalDrafts ?? 0}</b>` : 'Agenda clínica, prontuários e importação dos seus registros.',
        etha: 'Site exclusivo com briefing, uma revisão e painel para editar textos e fotos.',
      }[prod];
      const actions = {
        ambo: `<button type="button" class="eno-btn eno-btn-ambo" data-launch="ambo" data-path="/?pro=${encodeURIComponent(s.account.slug)}">Ver perfil público ↗</button>
               <button type="button" class="eno-btn eno-btn-sec" data-launch="ambo" data-path="/operacao">Abrir agenda do Ambo ↗</button>`,
        minne: `<button type="button" class="eno-btn eno-btn-minne" data-launch="minne" data-path="/?modo=ao-vivo">Abrir Minne ↗</button>
                <button type="button" class="eno-btn eno-btn-sec" data-launch="minne" data-path="/?modo=ao-vivo&aba=importar">Importar prontuários ↗</button>`,
        etha: `<button type="button" class="eno-btn eno-btn-etha" data-launch="etha" data-path="/?modo=ao-vivo">Abrir Etha ↗</button>
               <button type="button" class="eno-btn eno-btn-sec" data-launch="helena" data-path="/?site=${encodeURIComponent(s.account.slug)}">Ver site publicado ↗</button>`,
      }[prod];
      const offer = isPilot() ? `Ativar ${name} grátis` : prod === 'etha' ? 'Adicionar site Etha' : 'Contratar ou testar 30 dias grátis';
      return `
        <article class="eno-card ${ent?.canReadExport ? `eno-card-${prod}` : ''}">
          ${pill}
          <h2 class="eno-h2">${name}</h2>
          <p class="eno-muted">${body}</p>
          <div class="eno-btn-row">
            ${ent?.canReadExport ? actions : `<button type="button" class="eno-btn eno-btn-sec" data-tab="plans">${owned ? 'Reativar' : offer}</button>`}
          </div>
        </article>`;
    };
    return `
      <section class="eno-list eno-panel-enter" style="gap:20px">
        ${renderActivationBanner(state.activation)}
        <div class="eno-card eno-card-highlight">
          <div class="eno-row" style="background:transparent;border:0;padding:0">
            <div>
              <h1 class="eno-h1">${activeCount ? 'Seus serviços' : 'Escolha seu ponto de partida'}</h1>
              ${chosen ? `<p class="eno-muted" data-portal-combo>${activeProducts.length ? 'Seus serviços' : 'Sua combinação'}: <b>${esc(chosen)}</b> · <button type="button" class="eno-link" data-tab="plans">${activeProducts.length ? 'Ver outros serviços' : 'Alterar'}</button></p>` : ''}
            </div>
            <div class="eno-btn-row">
              ${!state.me.user.emailVerified ? `<button type="button" class="eno-btn eno-btn-sec" id="eno-go-verify">Verificar e-mail pendente</button>` : ''}
              <button type="button" class="eno-btn eno-btn-sec" data-tab="profile">Configurar disponibilidade</button>
            </div>
          </div>
          ${s.pendingSyncs?.length ? `
            <div class="eno-card eno-card-warn">
              <b>${s.pendingSyncs.length === 1 ? 'Uma atualização ainda não chegou aos outros serviços' : `${s.pendingSyncs.length} atualizações ainda não chegaram aos outros serviços`}</b>
              <p class="eno-muted">O que você fez está salvo. Toque abaixo para enviar de novo, sem repetir a ação:</p>
              ${s.pendingSyncs.map((ev) => `<button type="button" class="eno-btn eno-btn-sec" data-retry-sync="${esc(ev.id)}">Atualizar ${esc(SYNC_LABELS[ev.event_type] || 'os outros serviços')}</button>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="eno-grid-3 eno-grid-fit">
          ${activeProducts.map((prod) => productCard(prod, true)).join('')}
        </div>
        ${otherProducts.length ? `
          <section class="eno-list" aria-labelledby="eno-other-title" style="gap:12px">
            <h2 class="eno-h2" id="eno-other-title">Outros serviços</h2>
            <div class="eno-grid-3">${otherProducts.map((prod) => productCard(prod, false)).join('')}</div>
          </section>
        ` : ''}
      </section>
    `;
  }

  function renderProfileView() {
    const p = state.profileData?.profile;
    if (!p) return loadingSkeleton('Carregando seu perfil…', 2);
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
            <div class="eno-field"><label for="b-start">Início do bloqueio</label><input id="b-start" name="startAt" type="datetime-local" class="eno-input" value="${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}T14:00"></div>
            <div class="eno-field"><label for="b-end">Fim do bloqueio</label><input id="b-end" name="endAt" type="datetime-local" class="eno-input" value="${new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}T16:00"></div>
            <div class="eno-field"><label for="b-reason">Motivo</label><input id="b-reason" name="reason" class="eno-input" value="Supervisão clínica"></div>
            <button type="submit" class="eno-btn eno-btn-ambo">Salvar bloqueio na agenda</button>
          </form>
          <div class="eno-list">
            ${(state.profileData.availabilityBlocks || []).map((b) => `<div class="eno-row"><span>${esc(b.reason)}</span><small>${esc(fmtDateTime(b.start_at))} até ${esc(fmtDateTime(b.end_at))}</small></div>`).join('') || '<p class="eno-muted">Nenhum bloqueio cadastrado.</p>'}
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
          <span class="eno-pill">SERVIÇOS E ACESSO</span>
          <h1 class="eno-h1">Serviços, cancelamento parcial e exportação</h1>
          <div class="eno-list">
            ${['ambo', 'minne', 'etha'].map((prod) => {
              const ent = ents[prod];
              if (!ent) return `<div class="eno-row"><b>${PRODUCT_NAMES[prod]}</b><span class="eno-muted">Não contratado</span></div>`;
              return `
                <div class="eno-row">
                  <div>
                    <b>${PRODUCT_NAMES[prod]}</b> · <span class="eno-pill ${ent.canWrite ? 'eno-pill-ok' : 'eno-pill-warn'}">${esc(statusLabel(ent.status))}</span>
                    <div class="eno-muted">${isPilot() ? `Grátis no piloto até ${esc(pilotUntil())}` : ent.trialEndsAt ? `Teste até ${esc(ent.trialEndsAt.slice(0, 10))}` : `Ciclo: ${esc(BILLING_LABELS[ent.billingMode] || 'Mensal')}`}</div>
                  </div>
                  ${ent.canWrite
                    ? `<button type="button" class="eno-btn eno-btn-sec" data-ent-action="cancel" data-ent-prod="${prod}">Cancelar só ${PRODUCT_NAMES[prod]}</button>`
                    : `<button type="button" class="eno-btn" data-ent-action="reactivate" data-ent-prod="${prod}">Reativar ${PRODUCT_NAMES[prod]}</button>`}
                </div>
              `;
            }).join('')}
          </div>
          <div class="eno-btn-row">
            <button type="button" class="eno-btn eno-btn-sec" id="eno-export-account">Exportar meus dados</button>
            <button type="button" class="eno-btn eno-btn-danger" id="eno-logout-all">Encerrar todas as sessões</button>
          </div>
        </div>

        <aside class="eno-card">
          ${renderSubscribeCard()}
          ${state.orders.length ? `<h2 class="eno-h2 eno-sub-history">Pedidos anteriores</h2>
          <div class="eno-list">
            ${state.orders.length ? state.orders.map((o) => `
              <div class="eno-row">
                <div>
                  <b>${esc(o.receipt_code)}</b> · ${esc(o.items.map((x) => PRODUCT_NAMES[x] || x).join(' + '))}
                  <div class="eno-muted">${isPilot() ? 'Grátis no piloto' : `Hoje: ${brl(o.due_today_cents)} · Recorrente: ${brl(o.recurring_monthly_cents)}/mês`} · Situação: <b>${esc(statusLabel(o.status))}</b></div>
                </div>
                ${o.status !== 'approved' ? `<button type="button" class="eno-btn eno-btn-sec" data-retry-order="${esc(o.id)}" ${state.busyAction === 'retryOrder' ? 'disabled' : ''}>Retomar</button>` : ''}
              </div>
            `).join('') : ''}
          </div>` : ''}
        </aside>
      </section>
    `;
  }

  function subscribeProducts() {
    const ents = state.me?.entitlements || {};
    const chosen = ['ambo', 'etha', 'minne'].filter((p) => ents[p] && ['trial', 'active', 'cancelled_grace'].includes(ents[p].status));
    return chosen.length ? chosen : (state.combo?.products?.length ? ['ambo', 'etha', 'minne'].filter((p) => state.combo.products.includes(p)) : []);
  }

  function subscribePrice(products, cycle) {
    const key = products.join('+');
    const row = (state.billingPrices || []).find((r) => r.products.join('+') === key);
    if (!row) return null;
    return cycle === 'annual' ? row.annualCents : row.monthlyCents;
  }

  function formatDoc(v) {
    const d = String(v || '').replace(/\D+/g, '').slice(0, 14);
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
  }

  const SUB_STATUS = { trial: '30 dias grátis', active: 'Em dia', overdue: 'Pagamento pendente', cancelled: 'Cancelada' };

  function renderSubscribeCard() {
    if (isPilot()) {
      return `
        <span class="eno-pill eno-pill-ok">PILOTO GRATUITO</span>
        <h2 class="eno-h2">Tudo grátis até o lançamento</h2>
        <p class="eno-muted">Como convidado do piloto, você usa todos os serviços sem custo até ${esc(pilotUntil())}: planos, combos, anual e a implantação Sob medida da Etha. Nenhum cartão é pedido e nenhuma fatura é gerada.</p>
        <p class="eno-muted">Antes do lançamento avisamos com antecedência. Nada é cobrado sem você escolher.</p>
      `;
    }
    const st = state.billingStatus;
    const sub = st?.subscription;
    const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '');
    if (sub) {
      return `
        <span class="eno-pill">ASSINATURA</span>
        <h2 class="eno-h2">${esc(sub.products.map((p) => PRODUCT_NAMES[p] || p).join(' + '))} · ${sub.cycle === 'annual' ? 'Anual' : 'Mensal'}</h2>
        <div class="eno-list">
          <div class="eno-row"><span>Situação</span><b>${esc(SUB_STATUS[sub.status] || sub.status)}</b></div>
          <div class="eno-row"><span>Valor</span><b>${brl(sub.valueCents)}${sub.cycle === 'annual' ? '/ano' : '/mês'}</b></div>
          ${sub.nextDueDate ? `<div class="eno-row"><span>${sub.status === 'trial' ? 'Primeira cobrança' : 'Próximo vencimento'}</span><b>${esc(fmtDate(sub.nextDueDate))}</b></div>` : ''}
        </div>
        ${sub.invoiceUrl ? `<div class="eno-btn-row"><a class="eno-btn" href="${esc(sub.invoiceUrl)}" target="_blank" rel="noopener">${sub.status === 'overdue' ? 'Pagar agora' : 'Ver fatura'} ↗</a></div>` : ''}
        ${sub.sandbox ? '<p class="eno-muted">Ambiente de teste: nenhum valor é cobrado de verdade.</p>' : ''}
      `;
    }
    const products = subscribeProducts();
    if (!products.length) {
      return `<span class="eno-pill">ASSINATURA</span><h2 class="eno-h2">Nenhum serviço ativo</h2><p class="eno-muted">Escolha seus serviços em <button type="button" class="eno-link" data-tab="plans">Outros serviços</button> para assinar.</p>`;
    }
    const cycle = state.sub.cycle;
    const cents = subscribePrice(products, cycle);
    const label = products.map((p) => PRODUCT_NAMES[p] || p).join(' + ');
    const head = `<span class="eno-pill">ASSINATURA</span><h2 class="eno-h2">${esc(label)}</h2>`;
    if (!st?.configured) {
      return `${head}<p class="eno-muted">Durante o piloto, nada é cobrado. O pagamento por Pix, boleto ou cartão abre no lançamento.</p>`;
    }
    return `
      ${head}
      <form id="eno-sub-form" class="eno-sub-form" novalidate>
        <div class="eno-flow-seg" role="radiogroup" aria-label="Periodicidade">
          <button type="button" role="radio" data-sub-cycle="monthly" aria-checked="${cycle === 'monthly'}">Mensal</button>
          <button type="button" role="radio" data-sub-cycle="annual" aria-checked="${cycle === 'annual'}">Anual</button>
        </div>
        <p class="eno-sub-price"><b>${cents != null ? brl(cents) : '—'}</b> ${cycle === 'annual' ? 'por ano (10 meses)' : 'por mês'}</p>
        <div class="eno-field">
          <label for="eno-sub-doc">CPF ou CNPJ para a fatura</label>
          <input id="eno-sub-doc" class="eno-input" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" value="${esc(formatDoc(state.sub.doc))}" aria-invalid="${state.sub.error ? 'true' : 'false'}" ${state.sub.error ? 'aria-describedby="eno-sub-err"' : ''}>
          ${state.sub.error ? `<span class="eno-field-err" id="eno-sub-err">${esc(state.sub.error)}</span>` : ''}
        </div>
        <button type="submit" class="eno-btn" ${state.sub.busy ? 'disabled' : ''}>${state.sub.busy ? 'Preparando…' : 'Assinar'}</button>
        <p class="eno-muted">A primeira cobrança só acontece depois dos 30 dias grátis. Você paga por Pix, boleto ou cartão na página segura do Asaas.${st.mode === 'sandbox' ? ' Ambiente de teste: nada é cobrado de verdade.' : ''}</p>
      </form>
    `;
  }

  function renderPilotView() {
    if (isPilot()) {
      return `
      <section class="eno-card eno-panel-enter" style="max-width:760px">
        <span class="eno-pill eno-pill-ok">VOCÊ ESTÁ NO PILOTO</span>
        <h1 class="eno-h1">Obrigado por testar a Enomera</h1>
        <p class="eno-muted">Todos os serviços estão liberados sem custo até ${esc(pilotUntil())}. Use Ambo, Minne e Etha como usaria no dia a dia; o que te prende e o que te atrapalha é exatamente o que queremos aprender.</p>
        <p class="eno-muted">Registramos só como você usa as telas (cliques, tempo e erros), nunca conteúdo clínico. Detalhes em <a class="eno-link" href="/privacidade#piloto">Privacidade</a>.</p>
      </section>`;
    }
    return `
      <section class="eno-card eno-panel-enter" style="max-width:760px">
        <span class="eno-pill eno-pill-etha">PILOTO ACOMPANHADO · 2 SEMANAS</span>
        <h1 class="eno-h1">Solicitar participação no piloto acompanhado</h1>
        <p class="eno-muted">30 dias grátis com acompanhamento próximo, sem cartão e sem cobrança.</p>
        <form id="eno-pilot-form" class="eno-list">
          <div class="eno-field"><label for="pl-name">Nome completo</label><input id="pl-name" name="fullName" class="eno-input" required value="${esc(state.me?.user?.fullName || '')}"></div>
          <div class="eno-field"><label for="pl-email">E-mail</label><input id="pl-email" name="email" type="email" class="eno-input" required value="${esc(state.me?.user?.email || '')}"></div>
          <div class="eno-field"><div class="eno-label-row"><label for="pl-notes">O que deseja avaliar?</label><span class="eno-opt-tag">(opcional)</span></div><input id="pl-notes" name="notes" class="eno-input" placeholder="Ex.: agendamento no Ambo e prontuário no Minne"></div>
          <button type="submit" class="eno-btn">Registrar interesse no piloto (sem cobrança)</button>
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

  function announceStep(text) {
    let live = document.getElementById('eno-step-live');
    if (!live) {
      live = document.createElement('div');
      live.id = 'eno-step-live';
      live.className = 'eno-sr-only';
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  }

  // Cada re-render passa pelo FLIP: o que mudou na mesma tela anima do estado antigo ao novo.
  const isPilot = () => Boolean(state.me?.pilot?.free);
  const pilotUntil = () => (state.me?.pilot?.until ? new Date(state.me.pilot.until).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

  function render() {
    setPilotFree(isPilot());
    const snap = motionSnapshot(rootEl);
    const prevH = rootEl.offsetHeight;
    renderInner();
    const route = Boolean(motionTracker.lastRouteDir);
    // Na mesma tela a página nunca encolhe durante a interação: se encolhesse, quem rolou até
    // o fim veria a tela "tremer" (o navegador puxa o scroll a cada quadro da animação de altura).
    // Troca de tela libera a altura.
    if (route) rootEl.style.minHeight = '';
    else if (snap) rootEl.style.minHeight = `${Math.max(prevH, parseFloat(rootEl.style.minHeight) || 0)}px`;
    motionPlay(rootEl, snap, { route });
    // Quando a animação termina, devolvemos a altura natural sem mexer no scroll atual.
    clearTimeout(motionTracker.heightTimer);
    if (!route && snap) motionTracker.heightTimer = setTimeout(() => {
      const needed = window.scrollY + window.innerHeight - (rootEl.getBoundingClientRect().top + window.scrollY);
      rootEl.style.minHeight = '';
      const natural = rootEl.offsetHeight;
      if (needed > natural + 1) rootEl.style.minHeight = `${Math.ceil(needed)}px`;
    }, 420);
  }
  function renderInner() {
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
    // Troca de tela ou de etapa: o conteúdo novo entra em cascata, na direção do percurso.
    const ROUTE_ORDER = ['plans', 'auth:email', 'auth:signup', 'auth:code', 'review', 'portal', 'profile', 'billing', 'pilot'];
    const routeKey = state.tab === 'auth' ? `auth:${state.authMode === 'code' ? 'code' : 'email'}` : state.tab;
    const prevRoute = motionTracker.prevRoute;
    motionTracker.prevRoute = routeKey;
    // Primeira pintura (vinda de outra página): entra para a frente. Re-render da mesma tela: nada anima.
    const routeDir = !prevRoute ? 'fwd' : prevRoute === routeKey ? '' : ROUTE_ORDER.indexOf(routeKey) < ROUTE_ORDER.indexOf(prevRoute) ? 'back' : 'fwd';
    motionTracker.lastRouteDir = routeDir;
    const markRoute = () => {
      if (!routeDir) return;
      const c = rootEl.querySelector('#portal-content');
      if (!c) return;
      c.dataset.routeIn = routeDir;
      clearTimeout(motionTracker.routeTimer);
      motionTracker.routeTimer = setTimeout(() => { if (c.isConnected) delete c.dataset.routeIn; }, 700);
    };
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
          verified: Boolean(state.otpVerified),
          devCode: state.devCode,
          deliveryNote: '',
          fieldError: state.fieldError?.field === 'email' ? state.fieldError.text : '',
          // "Entrar" é só login: nem etapas nem preço, inclusive depois de enviar o código (a URL vira /conta).
          login: !['review', 'plans'].includes(state.returnAfterAuth),
        })
        : state.tab === 'review'
          ? renderReview({ combo: state.combo, contract, me: state.me, activating: state.activating })
          : renderChoice({ combo: state.combo, contract, signedIn: Boolean(state.me), returnedFromReview: state.returnedFromReview && Boolean(state.me), customOpen: Boolean(state.customOpen) });
      queueMicrotask(markRoute);
      rootEl.innerHTML = `<div class="eno-shell eno-flow-shell"><header class="eno-flow-top"><a class="eno-brand" href="/"><img src="/assets/brand.svg" width="32" height="27" alt="">enomera</a>${state.me ? `<button type="button" class="eno-link" data-tab="portal">Ir ao portal</button>` : '<a class="eno-link" href="/">Voltar ao site</a>'}</header><main class="eno-container" id="portal-content" tabindex="-1">${renderInfraAlert()}${state.feedback && state.feedback.tone === 'err' ? renderFeedback() : ''}${flowView}</main></div>`;
      bindEvents();
      // Troca de etapa: foco no título da etapa nova e anúncio "Etapa N de 4".
      const stepKey = `${state.tab}:${state.tab === 'auth' ? state.authMode : ''}`;
      const stepChanged = motionTracker.prevFlowStep && motionTracker.prevFlowStep !== stepKey;
      motionTracker.prevFlowStep = stepKey;
      if (stepChanged) {
        const [num, label] = state.tab === 'plans' ? [1, 'Escolha'] : state.tab === 'auth' ? [2, 'Conta'] : [3, 'Checkout'];
        announceStep(`Etapa ${num} de 4: ${label}`);
        const title = rootEl.querySelector('.eno-flow-title');
        if (title) {
          title.setAttribute('tabindex', '-1');
          title.focus({ preventScroll: true });
          const top = title.getBoundingClientRect().top;
          if (top < 0 || top > window.innerHeight) title.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          return;
        }
      }
      if (focusKey) {
        const target = focusKey.by === 'id'
          ? rootEl.querySelector(`#${CSS.escape(focusKey.val)}`)
          : rootEl.querySelector(`[${focusKey.attr}="${CSS.escape(focusKey.val)}"]`);
        if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
      }
      return;
    }
    motionTracker.prevFlowStep = null;

    const view = state.tab === 'profile' ? renderProfileView()
      : state.tab === 'billing' ? renderBillingView()
      : state.tab === 'pilot' ? renderPilotView()
      : renderPortalView();

    rootEl.innerHTML = `<div class="eno-shell"><img class="eno-flower-watermark" src="/assets/flower.svg" alt="" aria-hidden="true">${renderTopbar()}<div class="eno-container" id="portal-content" tabindex="-1">${renderInfraAlert()}${renderFeedback()}${view}</div></div>`;
    markRoute();
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
    const hidden = rootEl.querySelector('#v-code');
    const ctl = bindOtpField(rootEl, {
      lastAuto: otpAuto,
      onChange: (digits) => {
        state.otpDigits = digits;
        if (hidden) hidden.value = digits.join('');
        if (state.codeError || state.fieldError?.field === 'code') {
          state.codeError = '';
          if (state.fieldError?.field === 'code') state.fieldError = null;
          const group = rootEl.querySelector('#eno-otp-group');
          group?.classList.remove('has-error');
          group?.querySelector('.eno-otp-input')?.setAttribute('aria-invalid', 'false');
          rootEl.querySelector('#eno-code-err')?.remove();
          rootEl.querySelector('#eno-code-error')?.remove();
        }
      },
      // Último dígito válido inicia uma única verificação (mesmo código não reenvia).
      onComplete: () => {
        const form = rootEl.querySelector('#eno-code-form') || rootEl.querySelector('#eno-verify-form');
        if (!form || state.busyAction === 'verify') return;
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
      },
    });
    if (ctl && state.otpFocusPending) {
      state.otpFocusPending = false;
      ctl.focus(state.otpSelectAll);
      state.otpSelectAll = false;
    }

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
    rootEl.querySelectorAll('.eno-input, .eno-select').forEach((el) => {
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
      const otpInput = rootEl.querySelector('.eno-otp-input');
      if (otpInput) {
        otpInput.value = code.slice(0, 6);
        otpInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
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
      if (res.data.user.role === 'professional' && !res.data.user.emailVerified) {
        // Cadastro pendente: leva direto para confirmar, reenviar ou corrigir o e-mail.
        state.pendingEmail = res.data.user.email;
        state.fixEmailOpen = false;
        state.tab = 'auth';
        state.authMode = 'verify';
        state.feedback = { tone: 'warn', text: 'Falta confirmar seu e-mail. Use o código que enviamos, peça um novo ou corrija o endereço.' };
        syncHistory(state.tab, state.authMode);
        await refreshSessionAndData();
        state.tab = 'auth';
        state.authMode = 'verify';
        render();
        return;
      }
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
      state.lastDelivery = res.data.verification.delivery || null;
      state.authMode = 'verify';
      if (res.data.verification.deliveryFailed) {
        state.fixEmailOpen = true;
        state.feedback = { tone: 'err', text: res.data.verification.error };
      } else {
        state.fixEmailOpen = false;
        await loadOutbox(email);
        startResendCooldown(30);
        state.feedback = { tone: state.lastDelivery?.sentExternally ? 'ok' : 'warn', text: res.data.verification.alreadySent ? 'Retomamos seu cadastro. O código que enviamos há pouco continua válido.' : res.data.resumed ? 'Retomamos seu cadastro e enviamos um novo código.' : state.lastDelivery?.notice };
      }
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
        rootEl.querySelector('#otp-0')?.focus();
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
      if (!res.ok) {
        state.fixEmailOpen = true;
        state.feedback = { tone: 'err', text: res.data.error || 'Não foi possível enviar um novo código agora.' };
        render();
        return;
      }
      state.lastDelivery = res.data.delivery || null;
      await loadOutbox(email);
      startResendCooldown(30);
      state.feedback = { tone: state.lastDelivery?.sentExternally ? 'ok' : 'warn', text: res.data.delivery?.notice || 'Novo código gerado.' };
      render();
    });

    rootEl.querySelector('#eno-fix-email')?.addEventListener('click', async () => {
      if (state.busyAction === 'fixEmail') return;
      const input = rootEl.querySelector('#v-email');
      const email = String(input?.value || '').trim();
      if (!input?.checkValidity() || !email) {
        state.fixEmailOpen = true;
        state.feedback = { tone: 'err', text: 'Digite um endereço de e-mail válido.' };
        render();
        return;
      }
      state.busyAction = 'fixEmail';
      render();
      const res = await apiFetch('/api/v1/auth/change-email', { method: 'POST', body: { email } });
      state.busyAction = null;
      state.fixEmailOpen = !res.ok;
      if (!res.ok) {
        state.feedback = { tone: 'err', text: res.data.error || 'Não foi possível trocar o endereço agora.' };
        render();
        return;
      }
      state.pendingEmail = res.data.email;
      state.lastSentEmail = res.data.email;
      state.formCache.email = res.data.email;
      state.lastDelivery = res.data.delivery || null;
      state.otpDigits = ['', '', '', '', '', ''];
      startResendCooldown(30);
      state.feedback = { tone: 'ok', text: `Endereço corrigido. Enviamos um novo código para ${res.data.email}.` };
      await refreshSessionAndData();
      state.tab = 'auth';
      state.authMode = 'verify';
      render();
      rootEl.querySelector('#otp-0')?.focus();
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

    rootEl.querySelectorAll('button[data-plan]').forEach((btn) => btn.addEventListener('click', async () => {
      const plan = PLANS.find((pl) => pl.id === btn.dataset.plan);
      if (!plan) return;
      state.combo.products = [...plan.products];
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      persistSelectionSoon();
      render();
      await refreshQuote(true);
      if (state.tab === 'plans') render();
    }));
    rootEl.querySelectorAll('button[data-etha-service]').forEach((btn) => btn.addEventListener('click', async () => {
      if (state.combo.ethaService === btn.dataset.ethaService) return;
      state.combo.ethaService = btn.dataset.ethaService;
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      persistSelectionSoon();
      render();
      await refreshQuote(true);
      if (state.tab === 'plans') render();
    }));
    rootEl.querySelector('#eno-custom-toggle')?.addEventListener('click', () => { state.customOpen = !state.customOpen; render(); });
    rootEl.querySelectorAll('[data-flow-continue]').forEach((b) => b.addEventListener('click', () => rootEl.querySelector('#eno-flow-continue')?.click()));

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
      render(); // render() leva o foco ao título da etapa e anuncia "Etapa N de 4".
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
        rootEl.querySelector('#otp-0')?.focus();
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
        const otpEl = rootEl.querySelector('#otp-0');
        otpEl?.focus();
        otpEl?.select();
        return;
      }
      setToken(res.data.sessionToken);
      // Êxito só depois da resposta do servidor: casas dão lugar ao ✓ por um instante.
      state.otpVerified = true;
      render();
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      await new Promise((r) => setTimeout(r, reduce ? 150 : 520));
      state.otpVerified = false;
      otpAuto.code = '';
      state.codeError = '';
      state.devCode = '';
      state.otpDigits = ['', '', '', '', '', ''];
      state.comboDirty = false;
      if (res.data.selection?.products?.length) {
        state.combo.products = res.data.selection.products;
        state.combo.viewMode = res.data.selection.billing === 'permanent' ? 'permanent' : 'monthly';
        if (res.data.selection.ethaFormat) state.combo.ethaFormat = res.data.selection.ethaFormat;
        if (res.data.selection.ethaService) state.combo.ethaService = res.data.selection.ethaService;
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
      state.feedback = { tone: 'ok', text: isPilot() ? `Ativado grátis no piloto até ${pilotUntil()} (sem cartão).` : `30 dias grátis ativados até ${res.data.trialEndsAt.slice(0, 10)} (sem cartão).` };
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
      // Campo datetime-local vem sem fuso; a agenda do profissional é em Brasília (-03:00).
      const withZone = (v) => (/[+-]\d\d:\d\d$|Z$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}-03:00`);
      currentBlocks.push({ startAt: withZone(String(fd.get('startAt'))), endAt: withZone(String(fd.get('endAt'))), reason: fd.get('reason') });
      const res = await apiFetch('/api/v1/professional/availability', { method: 'PUT', body: { blocks: currentBlocks } });
      if (res.ok) { state.feedback = { tone: 'ok', text: 'Bloqueio salvo na agenda real.' }; await refreshSessionAndData(); }
    });

    rootEl.querySelectorAll('[data-ent-action]').forEach((b) => b.addEventListener('click', async () => {
      const res = await apiFetch(`/api/v1/commercial/entitlements/${b.dataset.entProd}/${b.dataset.entAction}`, { method: 'POST', body: {} });
      if (res.ok) { state.feedback = { tone: 'warn', text: res.data.note }; await refreshSessionAndData(); }
    }));

    rootEl.querySelectorAll('[data-sub-cycle]').forEach((b) => b.addEventListener('click', () => {
      state.sub.cycle = b.dataset.subCycle === 'annual' ? 'annual' : 'monthly';
      render();
    }));
    const subDoc = rootEl.querySelector('#eno-sub-doc');
    subDoc?.addEventListener('input', () => {
      state.sub.doc = subDoc.value.replace(/\D+/g, '').slice(0, 14);
      subDoc.value = formatDoc(state.sub.doc);
    });
    rootEl.querySelector('#eno-sub-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (state.sub.busy) return;
      const digits = state.sub.doc;
      if (digits.length !== 11 && digits.length !== 14) {
        state.sub.error = 'Digite os 11 números do CPF ou os 14 do CNPJ.';
        render();
        rootEl.querySelector('#eno-sub-doc')?.focus();
        return;
      }
      state.sub.error = '';
      state.sub.busy = true;
      render();
      const res = await apiFetch('/api/v1/billing/checkout', { method: 'POST', body: { products: subscribeProducts(), cycle: state.sub.cycle, cpfCnpj: digits } });
      state.sub.busy = false;
      if (!res.ok) {
        state.sub.error = res.data.error || 'Não foi possível preparar a assinatura. Tente de novo.';
        render();
        return;
      }
      state.billingStatus = { ...(state.billingStatus || {}), subscription: res.data.subscription };
      state.feedback = { tone: 'ok', text: 'Assinatura criada. A primeira cobrança só acontece depois dos 30 dias grátis.' };
      render();
    });

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

  // Nunca tela branca: sem sessão, a entrada aparece na hora; com sessão, esqueleto do portal enquanto os dados chegam.
  if (!getToken() && ['portal', 'profile', 'billing', 'pilot'].includes(state.tab)) {
    state.returnAfterAuth = state.tab;
    state.tab = 'auth';
    render();
  } else {
    rootEl.innerHTML = `<div class="eno-shell" aria-busy="true"><header class="eno-flow-top"><a class="eno-brand" href="/"><img src="/assets/brand.svg" width="32" height="27" alt="">enomera</a></header><main class="eno-container eno-skeleton-page" id="portal-content" tabindex="-1"><span class="eno-visually-hidden" role="status">Carregando…</span><div class="eno-skel eno-skel-title"></div><div class="eno-skel eno-skel-line"></div><div class="eno-skel-grid"><div class="eno-skel eno-skel-card"></div><div class="eno-skel eno-skel-card"></div><div class="eno-skel eno-skel-card"></div></div></main></div>`;
  }
  await refreshSessionAndData();
}
