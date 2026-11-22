import { approvedPlans, approvedSummary, approvedTopbar, approvedStepper, approvedPortal, approvedAuth } from './approved-journey.js';
const TOKEN_KEY = 'enomera_session_token_v1';
const DRAFT_COMBO_KEY = 'enomera_pending_combo_v1';
const LAST_ORDER_KEY = 'enomera_last_order_v1';

// Cross-product destinations are explicit per deployment; never infer a production fallback.
function resolveSiblingOrigin(override, localPort) {
  if (override) return override;
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    return `http://127.0.0.1:${localPort}`;
  }
  return '';
}

const APP_ORIGINS = {
  ambo: resolveSiblingOrigin(window.__ENOMERA_AMBO_URL, 3001),
  minne: resolveSiblingOrigin(window.__ENOMERA_MINNE_URL, 3002),
  etha: resolveSiblingOrigin(window.__ENOMERA_ETHA_URL, 3003),
  helena: resolveSiblingOrigin(window.__ENOMERA_HELENA_URL, 3004),
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
  }).catch(() => null);
  if (!res) return { ok:false, status:0, data:{error:'Não foi possível conectar. Suas informações continuam aqui; tente novamente.'}, infraError:null };
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
  let lastInputWasKeyboard=false;
  rootEl.addEventListener('keydown',()=>{lastInputWasKeyboard=true;},true);
  rootEl.addEventListener('pointerdown',()=>{lastInputWasKeyboard=false;},true);
  const state = {
    checkoutStage: 'selection',
    showEtha: false,
    selectionDirty: false,
    tab: 'portal', // portal | auth | plans | profile | billing | pilot
    authMode: 'login', // login | signup | verify | recovery
    me: null,
    summary: null,
    catalog: null,
    quote: null,
    quotePending: false,
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
  };

  const motionTracker = {
    prevTab: null,
    prevAuthMode: null,
    prevViewMode: null,
    segIndices: {},
  };

  function syncHistory(tab, authMode) {
    if (!window.history?.pushState) return;
    const nextPath = tab === 'plans' ? '/checkout' : tab === 'auth' ? '/conta' : '/portal';
    const st = window.history.state || {};
    if (st.enoTab === tab && st.enoAuthMode === authMode && st.enoCheckoutStage === state.checkoutStage && location.pathname === nextPath) return;
    try {
      window.history.pushState({ enoTab: tab, enoAuthMode: authMode, enoCheckoutStage:state.checkoutStage }, '', nextPath + location.search);
      if (state.me && tab === 'plans') apiFetch('/api/v1/commercial/selection',{method:'PUT',body:{...state.combo,stage:state.checkoutStage}});
    } catch {}
  }

  window.addEventListener('popstate', (ev) => {
    const st = ev.state;
    if (st?.enoTab) {
      state.tab = st.enoTab;
      if (st.enoAuthMode) state.authMode = st.enoAuthMode;
      if (st.enoCheckoutStage) state.checkoutStage = st.enoCheckoutStage;
    } else if (location.pathname.startsWith('/checkout')) {
      state.tab = 'plans';
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
    if (prods.length) { state.combo.products = prods; state.selectionDirty = true; saveCombo(state.combo); }
  }
  if (location.pathname.startsWith('/checkout') || qs.get('etapa') === 'planos') {
    state.tab = 'plans';
    state.returnAfterAuth = 'plans';
  }
  if (location.pathname.startsWith('/conta') || qs.get('etapa') === 'conta') {
    state.tab = 'auth';
    state.returnAfterAuth = 'portal';
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
      if (state.lastOrder?.order?.account_id && state.lastOrder.order.account_id !== state.me.account?.id) {
        state.lastOrder=null; saveLastOrder(null);
      }
      if (!state.me.user.emailVerified && state.tab === 'auth' && state.authMode !== 'recovery') {
        state.authMode='verify'; state.pendingEmail=state.me.user.email;
      }
      if (state.me.actorType === 'professional') {
        if (state.selectionDirty) {
          await apiFetch('/api/v1/commercial/selection', { method:'PUT', body:{...state.combo,stage:state.checkoutStage} });
          state.selectionDirty = false;
        } else {
          const saved = await apiFetch('/api/v1/commercial/selection');
          if (saved.ok && saved.data.selection) { state.combo = {...state.combo, ...saved.data.selection};
            state.checkoutStage=saved.data.selection.stage === 'verification' && state.me.user.emailVerified ? 'review' : saved.data.selection.stage || 'selection'; saveCombo(state.combo); }
        }
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
          if (state.checkoutStage === 'confirmed' && !state.lastOrder) {
            const approved = state.orders.find(o=>o.status==='approved');
            if (approved) { state.lastOrder={order:approved}; saveLastOrder(state.lastOrder); }
          }
        }
        if (profRes.ok) state.profileData = profRes.data;
      }
    } else {
      state.me = null;
      state.summary = null;
      if (hadToken && meRes.status === 401) {
        if (state.tab !== 'auth') state.returnAfterAuth = state.tab;
        state.tab = 'auth';
        state.authMode = 'login';
        state.feedback = {
          tone: 'warn',
          text: 'Sua sessão expirou. Entre novamente para retomar exatamente de onde parou com sua seleção preservada.',
        };
      } else if (['portal', 'profile', 'billing'].includes(state.tab)) {
        state.returnAfterAuth = state.tab;
        state.tab = 'auth';
      }
    }
    await refreshQuote(false);
    render();
  }

  async function refreshQuote(pulse = true) {
    const seq = ++quoteSeq;
    state.quotePending = true;
    if (!state.combo.products.length) { state.quote = null; state.quotePending=false; return; }
    const q = await apiFetch('/api/v1/catalog/quote', {
      method: 'POST',
      body: { products: state.combo.products, ethaFormat: state.combo.ethaFormat, mode: 'monthly' },
    });
    if (seq !== quoteSeq) return; // drop stale out-of-order response
    state.quotePending = false;
    if (q.ok) {
      state.quote = q.data;
      state.deltaPulse = pulse;
      if (state.me && state.selectionDirty) {
        const saved = await apiFetch('/api/v1/commercial/selection', { method:'PUT', body:{...state.combo,stage:state.checkoutStage} });
        if (saved.ok && seq === quoteSeq) state.selectionDirty = false;
      }
    }
  }

  async function loadOutbox(recipient) {
    if (!recipient) return;
    const r = await apiFetch(`/api/v1/dev/outbox?recipient=${encodeURIComponent(recipient)}`);
    if (r.ok) state.outboxMessages = r.data.messages || [];
  }

  async function launchAppWithHandoff(appKey, returnPath = '/') {
    const targetOrigin = APP_ORIGINS[appKey];
    if (!targetOrigin) { state.feedback={tone:'err',text:'O endereço deste produto ainda precisa ser configurado nesta homologação.'}; render(); return; }
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
              <span class="eno-pill eno-pill-warn">Homologação em preparação</span>
              <strong style="font-size:0.92rem">${missing.length && missing.every(name => name.startsWith('RESEND_')) ? 'O envio de e-mail ainda não está disponível.' : 'Um serviço está temporariamente indisponível.'}</strong>
            </div>
            <p style="margin:4px 0 6px;font-size:0.84rem;line-height:1.45">
              Sua seleção de serviços e os dados preenchidos continuam salvos nesta aba. Tente novamente após a liberação do serviço.
            </p>
          </div>
          <button type="button" class="eno-btn eno-btn-sec eno-btn-sm" id="eno-retry-health">Verificar novamente</button>
        </div>
      </section>
    `;
  }

  function renderStepper() { return approvedStepper(state); }

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

  function renderTopbar() { return approvedTopbar(state); }

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

  function renderAuthView() { return approvedAuth(state, {password:renderPasswordField,outbox:renderOutboxBox}); }

  function renderPlansAndCheckout() { return approvedPlans(state); }

  function renderPortalView() { return approvedPortal(state); }

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
    const oldSummary = rootEl.querySelector('.eno-contract-summary')?.getBoundingClientRect();
    const oldHeading = rootEl.querySelector('h1')?.textContent;
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

    const view = state.tab === 'auth' ? renderAuthView(animateAuthBody)
      : state.tab === 'plans' ? renderPlansAndCheckout()
      : state.tab === 'profile' ? renderProfileView()
      : state.tab === 'billing' ? renderBillingView()
      : state.tab === 'pilot' ? renderPilotView()
      : renderPortalView();

    rootEl.innerHTML = `<div class="eno-shell eno-approved-shell"><picture><source media="(min-width:768px)" srcset="/assets/approved/substrate-desktop.svg"><img class="eno-approved-substrate" src="/assets/approved/substrate.svg" alt="" aria-hidden="true"></picture><picture><source media="(min-width:768px)" srcset="/assets/approved/petals-desktop.svg"><img class="eno-approved-petals" src="/assets/approved/petals.svg" alt="" aria-hidden="true"></picture>${renderTopbar()}<div class="eno-container" id="portal-content" tabindex="-1">${renderInfraAlert()}${renderStepper()}${renderFeedback()}${view}</div></div>`;
    animateSegmentedIndicators();
    bindEvents();
    if (!prefersReducedMotion() && !lastInputWasKeyboard) {
      const summary = rootEl.querySelector('.eno-contract-summary');
      const next = summary?.getBoundingClientRect();
      if (oldSummary?.width && next?.width) {
        summary.animate([{transform:`translate(${oldSummary.left-next.left}px,${oldSummary.top-next.top}px)`},{transform:'translate(0,0)'}],
          {duration:220,easing:'cubic-bezier(0.23,1,0.32,1)'});
      }
      if (oldHeading && oldHeading !== rootEl.querySelector('h1')?.textContent) {
        rootEl.querySelector('.eno-auth-task, .eno-approved-main')?.animate(
          [{opacity:.7,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],
          {duration:180,easing:'cubic-bezier(0.23,1,0.32,1)'});
      }
    }

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
    if (res.data.order.status === 'approved') state.checkoutStage = 'confirmed';
    saveLastOrder(res.data);
    state.feedback = {
      tone: res.data.order.status === 'approved' ? 'ok' : res.data.order.status === 'pending' ? 'warn' : 'err',
      text: res.data.order.status === 'approved'
        ? `Contratação concluída. Seus serviços estão ativos; nenhuma cobrança foi feita.`
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
    rootEl.querySelector('#eno-etha-info')?.addEventListener('click', () => { state.showEtha = !state.showEtha; render(); });
    rootEl.querySelector('[data-edit-selection]')?.addEventListener('click', () => { state.checkoutStage='selection'; state.tab='plans'; syncHistory('plans',state.authMode); render(); rootEl.querySelector('h1')?.focus(); });
    rootEl.querySelector('#eno-continue-selection')?.addEventListener('click', () => {
      if (!state.combo.products.length) return;
      if (!state.me) goAuthFromPlans();
      else if (!state.me.user.emailVerified) { state.pendingEmail=state.me.user.email; state.tab='auth'; state.authMode='verify'; render(); }
      else { state.checkoutStage='review'; syncHistory('plans',state.authMode); render(); rootEl.querySelector('h1')?.focus(); }
    });
    rootEl.querySelector('#eno-simulate-decline')?.addEventListener('click', () => { const input=rootEl.querySelector('#chk-outcome'); if(input) input.value='declined'; runCheckoutSubmit(); });
    rootEl.querySelectorAll('[data-offer]').forEach(el => el.addEventListener('click', () => {
      state.combo.products=[...new Set([...state.combo.products,el.dataset.offer])]; state.showEtha=el.dataset.offer==='etha';
      state.selectionDirty=true; state.checkoutStage='selection'; state.tab='plans'; saveCombo(state.combo); render(); refreshQuote().then(render);
    }));
    rootEl.querySelector('#eno-change-email')?.addEventListener('click', async () => {
      const email=rootEl.querySelector('#v-email')?.value.trim();
      const result=await apiFetch('/api/v1/auth/change-email',{method:'POST',body:{email}});
      if (!result.ok) { state.feedback={tone:'err',text:result.data.error}; render(); return; }
      state.pendingEmail=email; state.lastSentEmail=email; state.lastDelivery=result.data.delivery; state.otpDigits=['','','','','',''];
      await loadOutbox(email); startResendCooldown(); state.feedback={tone:'ok',text:'Endereço atualizado. Confira o novo código.'}; render(); rootEl.querySelector('#otp-0')?.focus();
    });
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
      if (state.tab === 'plans') state.checkoutStage='selection';
      state.feedback = null;
      state.fieldError = null;
      syncHistory(state.tab, state.authMode);
      render();
      rootEl.querySelector('h1')?.focus({preventScroll:true});
    }));
    rootEl.querySelectorAll('[data-authmode]').forEach((b) => b.addEventListener('click', () => {
      state.authMode = b.dataset.authmode;
      state.feedback = null;
      state.fieldError = null;
      syncHistory(state.tab, state.authMode);
      render();
      rootEl.querySelector('h1')?.focus({preventScroll:true});
    }));
    rootEl.querySelectorAll('[data-viewmode]').forEach((b) => b.addEventListener('click', () => {
      state.combo.viewMode = b.dataset.viewmode;
      saveCombo(state.combo);
      render();
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
      if (state.busyAction === 'login') return;
      const fd = new FormData(ev.currentTarget);
      state.formCache.email = String(fd.get('email') || '');
      state.formCache.loginPwd = String(fd.get('password') || '');
      state.busyAction = 'login';
      render();
      const res = await apiFetch('/api/v1/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      state.busyAction = null;
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
      if (!res.data.user.emailVerified) { state.pendingEmail = res.data.user.email; state.tab='auth'; state.authMode='verify'; }
      else if (state.tab === 'plans') state.checkoutStage = 'review';
      state.returnAfterAuth = null;
      syncHistory(state.tab, state.authMode);
      await refreshSessionAndData();
      if (res.data.user.emailVerified && state.tab === 'portal' && state.checkoutStage === 'review') {
        state.tab = 'plans';
        syncHistory(state.tab, state.authMode);
        render();
        rootEl.querySelector('h1')?.focus();
      }
    });

    rootEl.querySelector('#eno-signup-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (state.busyAction === 'signup') return;
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
      state.busyAction = 'signup';
      render();
      const res = await apiFetch('/api/v1/auth/signup', {
        method: 'POST',
        body: {
          fullName: state.formCache.fullName,
          email: state.formCache.email,
          crpOrCrm: state.formCache.crpOrCrm,
          specialty: state.formCache.specialty,
          password,
          selection: { products:state.combo.products, ethaFormat:state.combo.ethaFormat },
        },
      });
      state.busyAction = null;
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
      state.checkoutStage = 'review';
      syncHistory(state.tab,state.authMode);
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
      if (!res.ok) { state.feedback={tone:'err',text:res.data.error || 'Não foi possível reenviar. Tente novamente.'}; render(); return; }
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

    const goAuthFromPlans = () => { state.selectionDirty = true; state.returnAfterAuth = 'plans'; state.tab = 'auth'; state.authMode = 'signup'; syncHistory(state.tab, state.authMode); render(); };
    rootEl.querySelector('#eno-go-auth')?.addEventListener('click', goAuthFromPlans);
    rootEl.querySelector('#eno-mobile-auth')?.addEventListener('click', goAuthFromPlans);

    rootEl.querySelector('#eno-go-verify')?.addEventListener('click', async () => {
      state.pendingEmail = state.me?.user?.email || '';
      await loadOutbox(state.pendingEmail);
      state.tab = 'auth'; state.authMode = 'verify'; syncHistory(state.tab, state.authMode); render();
    });

    rootEl.querySelectorAll('[data-toggle-prod]').forEach((cb) => cb.addEventListener('change', async () => {
      const prod = cb.dataset.toggleProd;
      state.selectionDirty = true;
      state.quotePending = true;
      state.combo.products = cb.checked
        ? [...new Set([...state.combo.products, prod])]
        : state.combo.products.filter((x) => x !== prod);
      saveCombo(state.combo);
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      render(); // resposta imediata ao clique antes da cotação retornar
      await refreshQuote(true);
      if (state.tab === 'plans') render(); // nunca re-renderizar sobre outra tela após a cotação tardia
    }));

    rootEl.querySelector('#eno-etha-fmt')?.addEventListener('change', async (e) => {
      state.combo.ethaFormat = e.target.value;
      state.selectionDirty = true;
      state.quotePending = true;
      saveCombo(state.combo);
      state.checkoutIdempotencyKey = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await refreshQuote(true);
      if (state.tab === 'plans') render();
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
        if (res.data.order?.status === 'approved') state.checkoutStage='confirmed';
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
      state.me = null; state.summary = null; state.lastOrder = null; state.tab = 'auth'; state.authMode = 'login'; state.returnAfterAuth = null;
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
