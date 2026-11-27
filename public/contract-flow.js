import { otpFieldHTML } from './otp-field.js';
// Percurso de contratação aprovado no Figma em 22 nov 2026
// (arquivo R4FYsZmgvfyA1ESAlTuOCY, seção 76:696): Escolha → Conta → Código → Checkout → Ativando → Portal.
// Funções puras de renderização; o estado e os eventos ficam em platform.js.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PRODUCT_INFO = {
  ambo: { name: 'Agendamento', description: 'Página para o paciente pedir e acompanhar consultas', monthly: 'R$ 39', annual: 'R$ 390' },
  minne: { name: 'Consultório', description: 'Pacientes, agenda do dia e prontuários', monthly: 'R$ 59', annual: 'R$ 590' },
  etha: { name: 'Site', description: 'Seu site profissional, com hospedagem', monthly: 'R$ 49', annual: 'R$ 490' },
};

const ORDER = ['ambo', 'minne', 'etha'];

// Piloto gratuito (22/11): para convidados do piloto, todos os serviços são grátis
// (planos, combos, anual e implantação Sob medida). Nenhuma tela mostra preço a pagar.
let PILOT_FREE = false;
export function setPilotFree(v) { PILOT_FREE = Boolean(v); }
export function isPilotFree() { return PILOT_FREE; }

// Planos prontos (preços aprovados em 22/11: 39 · 79 · 99 por mês; anual = 10 mensalidades).
// "Completo" é o recomendado: é o que mais economiza e cobre site, agenda e prontuário.
export const PLANS = [
  { id: 'agenda', name: 'Agendamento', products: ['ambo'], monthly: 39, separate: 39, for: 'Para começar a receber pedidos de consulta.',
    items: ['Página de agendamento com seus horários', 'Área do paciente para acompanhar consultas', 'Pedidos de primeira consulta'] },
  { id: 'consultorio', name: 'Agendamento + Consultório', products: ['ambo', 'minne'], monthly: 79, separate: 98, for: 'Agenda e prontuário no mesmo lugar.',
    items: ['Tudo do Agendamento', 'Prontuários e evolução clínica (Enomera Consultório)', 'Agenda do dia ligada aos pedidos'] },
  { id: 'completo', name: 'Completo', products: ['ambo', 'minne', 'etha'], monthly: 99, separate: 147, recommended: true, for: 'Site, agenda e prontuário: a prática inteira.',
    items: ['Tudo de Agendamento + Consultório', 'Site profissional (Enomera Site)', 'Hospedagem e atualizações'] },
];

// Site em dois níveis (22/11): Essencial sem taxa; Sob medida com implantação única.
export const ETHA_SERVICES = [
  { id: 'essencial', name: 'Essencial', price: 'Incluído', detail: 'Você responde 6 perguntas e o site sai do nosso modelo, com as suas informações.' },
  { id: 'sob_medida', name: 'Sob medida', price: '+ R$ 790 único', detail: 'A equipe monta o site com você: textos, fotos e páginas. Até 3x, cobrado só quando você aprovar o site.' },
];

function renderEthaService(service) {
  const cur = service === 'sob_medida' ? 'sob_medida' : 'essencial';
  return `
    <div class="eno-etha-svc" data-m-key="etha-svc" role="radiogroup" aria-labelledby="eno-etha-svc-title">
      <p class="eno-etha-svc-title" id="eno-etha-svc-title"><i class="eno-plan-dot eno-plan-dot-etha" aria-hidden="true"></i> Como você quer o seu site?</p>
      <div class="eno-etha-svc-list">
        ${ETHA_SERVICES.map((o) => `
          <button type="button" role="radio" aria-checked="${cur === o.id}" class="eno-etha-opt${cur === o.id ? ' is-selected' : ''}" data-etha-service="${o.id}" data-m-key="etha-opt-${o.id}" data-m-state="${cur === o.id ? 'on' : 'off'}">
            <span class="eno-etha-opt-head"><span class="eno-plan-radio m-pop" aria-hidden="true">${cur === o.id ? '✓' : ''}</span><b>${o.name}</b><span class="eno-etha-opt-price">${PILOT_FREE ? 'Grátis no piloto' : o.price}</span></span>
            <span class="eno-etha-opt-detail">${PILOT_FREE && o.id === 'sob_medida' ? 'A equipe monta o site com você: textos, fotos e páginas. Sem custo no piloto.' : o.detail}</span>
          </button>`).join('')}
      </div>
    </div>`;
}
const brl = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
export function planFor(products = []) {
  const key = ORDER.filter((p) => products.includes(p)).join('+');
  return PLANS.find((pl) => pl.products.join('+') === key) || null;
}

function renderPlanCard(plan, { selected, billing, current = false }) {
  if (current) {
    return `
    <div class="eno-plan eno-plan-${plan.id} is-current" data-m-key="plan-${plan.id}" aria-label="${plan.name}, seu plano atual">
      <span class="eno-plan-head"><span class="eno-plan-radio" aria-hidden="true">✓</span><span class="eno-plan-name">${plan.name}</span><span class="eno-plan-badge">Seu plano</span></span>
      <span class="eno-plan-for">Você já usa este plano.</span>
      <span class="eno-plan-dots" aria-hidden="true">${plan.products.map((p) => `<i class="eno-plan-dot eno-plan-dot-${p}"></i>`).join('')}<small>${plan.products.map((p) => PRODUCT_INFO[p].name).join(' + ')}</small></span>
    </div>`;
  }
  const annual = billing === 'permanent';
  const price = annual ? plan.monthly * 10 : plan.monthly;
  const save = annual ? plan.separate * 12 - plan.monthly * 10 : plan.separate - plan.monthly;
  const old = annual ? plan.separate * 12 : plan.separate;
  return `
    <button type="button" role="radio" aria-checked="${selected}" class="eno-plan eno-plan-${plan.id}${plan.recommended ? ' is-recommended' : ''}${selected ? ' is-selected' : ''}"
      data-plan="${plan.id}" data-m-key="plan-${plan.id}" data-m-state="${selected ? 'on' : 'off'}"
      aria-label="${plan.name}${plan.recommended ? ', recomendado' : ''}, ${PILOT_FREE ? 'grátis no piloto' : `${brl(price)} ${annual ? 'por ano' : 'por mês'}`}">
      <span class="eno-plan-head">
        <span class="eno-plan-radio m-pop" aria-hidden="true">${selected ? '✓' : ''}</span>
        <span class="eno-plan-name">${plan.name}</span>
        ${plan.recommended ? '<span class="eno-plan-badge">Recomendado</span>' : ''}
      </span>
      <span class="eno-plan-for">${plan.for}</span>
      <span class="eno-plan-dots" aria-hidden="true">${plan.products.map((p) => `<i class="eno-plan-dot eno-plan-dot-${p}"${selected ? ` data-m-key="pc-dot-${p}" data-m-share` : ''}></i>`).join('')}<small>${plan.products.map((p) => PRODUCT_INFO[p].name).join(' + ')}</small></span>
      <span class="eno-plan-price">
        <b data-m-key="plan-price-${plan.id}" data-m-num>${PILOT_FREE ? 'Grátis' : brl(price)}</b><small data-m-key="plan-cad-${plan.id}" data-m-num>${PILOT_FREE ? ' no piloto' : annual ? '/ano' : '/mês'}</small>
      </span>
      <span class="eno-plan-save" data-m-key="plan-save-${plan.id}" data-m-num>${PILOT_FREE ? 'Sem custo até o lançamento' : save > 0
        ? `<s>${brl(old)}</s> economiza ${brl(save)}${annual ? ' por ano' : ' por mês'}`
        : annual ? `${brl(plan.monthly * 10 / 12)} por mês, 2 meses grátis` : 'Sem fidelidade'}</span>
      <span class="eno-plan-items">${plan.items.map((i) => `<span>${i}</span>`).join('')}</span>
    </button>`;
}

export function namesWithE(products = []) {
  const names = ORDER.filter((p) => products.includes(p)).map((p) => PRODUCT_INFO[p].name);
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

export function comboLabel(products = []) {
  return ORDER.filter((p) => products.includes(p)).map((p) => PRODUCT_INFO[p].name).join(' + ');
}

export function billingLabel(billing) {
  return billing === 'permanent' ? 'Anual' : 'Mensal';
}

function flower() {
  return '<img class="eno-flow-flower" src="/assets/flower.svg" width="420" height="347" alt="" aria-hidden="true">';
}

export function renderFlowStepper(step) {
  const steps = [['choice', 'Escolha'], ['account', 'Conta'], ['review', 'Revisão'], ['portal', 'Portal']];
  const idx = steps.findIndex(([k]) => k === step);
  return `
    <ol class="eno-flow-steps" aria-label="Etapas da contratação">
      ${steps.map(([k, label], i) => {
        const done = i < idx;
        const current = i === idx;
        return `<li class="${done ? 'is-done' : ''} ${current ? 'is-current' : ''}" ${current ? 'aria-current="step"' : ''}>${done ? '✓ ' : `${i + 1} `}${label}</li>`;
      }).join('<li class="eno-flow-sep" aria-hidden="true">›</li>')}
    </ol>
  `;
}

function priceFor(product, billing, ethaFormat) {
  const info = PRODUCT_INFO[product];
  return billing === 'permanent'
    ? { price: info.annual, cadence: 'por ano' }
    : { price: info.monthly, cadence: 'por mês' };
}

export function renderProductCard(product, { selected, billing, ethaFormat, interactive = true, notIncluded = false }) {
  const info = PRODUCT_INFO[product];
  const { price, cadence } = PILOT_FREE ? { price: 'Grátis', cadence: 'no piloto' } : priceFor(product, billing, ethaFormat);
  const mark = selected ? '✓' : '○';
  const inner = `
    <span class="eno-pc-mark m-pop" aria-hidden="true">${mark}</span>
    <span class="eno-pc-dot" aria-hidden="true" data-m-key="pc-dot-${product}" data-m-share></span>
    <span class="eno-pc-body">
      <span class="eno-pc-name" data-m-key="pc-name-${product}" data-m-share>${info.name}</span>
      <span class="eno-pc-desc">${notIncluded ? 'Não incluído nesta combinação' : esc(info.description)}</span>
    </span>
    <span class="eno-pc-price">
      <b data-m-key="pc-price-${product}" data-m-num>${esc(price)}</b>
      <small data-m-key="pc-cad-${product}" data-m-num>${esc(cadence)}</small>
    </span>
  `;
  if (!interactive) {
    return `<div class="eno-pc eno-pc-${product} ${selected ? 'is-selected' : ''} ${notIncluded ? 'is-excluded' : ''}" data-prod="${product}" data-m-key="pc-${product}" data-m-state="${selected ? 'on' : 'off'}">${inner}</div>`;
  }
  return `<button type="button" class="eno-pc eno-pc-${product} ${selected ? 'is-selected' : ''}" data-toggle-prod="${product}" data-m-key="pc-${product}" data-m-state="${selected ? 'on' : 'off'}" aria-pressed="${selected}" aria-label="${info.name}, ${esc(price)} ${esc(cadence)}">${inner}</button>`;
}

export function renderSummary(contract, { billing, withToggle = false, cta = '', showTitle = true, busy = false } = {}) {
  if (!contract) {
    return `
      <div class="eno-sum eno-glass" aria-live="polite" data-m-key="sum" data-m-size data-m-share>
        ${showTitle ? '<h2 class="eno-sum-title">Sua combinação</h2>' : ''}
        <p class="eno-sum-empty" data-m-key="sum-empty">Escolha ao menos um serviço para ver o resumo.</p>
      </div>
      ${cta}
    `;
  }
  const hasSaas = contract.lines.length > 0;
  return `
    <div class="eno-sum eno-glass ${busy ? 'is-busy' : ''}" aria-live="polite" data-m-key="sum" data-m-size data-m-share>
      ${showTitle ? '<h2 class="eno-sum-title">Sua combinação</h2>' : ''}
      <p class="eno-sum-label" data-m-key="sum-label"><span data-m-key="sum-label-text" data-m-num>${esc(contract.label)}</span><span class="eno-sum-label-billing"> · ${esc(contract.billingLabel)}</span></p>
      ${withToggle && hasSaas ? `
        <div class="eno-flow-seg" role="radiogroup" aria-label="Periodicidade" data-m-key="seg">
          <span class="eno-seg-pill" data-m-key="seg-pill" data-active="${billing === 'permanent' ? '1' : '0'}" aria-hidden="true"></span>
          <button type="button" role="radio" data-viewmode="monthly" data-m-key="seg-m" data-m-state="${billing !== 'permanent'}" aria-checked="${billing !== 'permanent'}">Mensal</button>
          <button type="button" role="radio" data-viewmode="permanent" data-m-key="seg-a" data-m-state="${billing === 'permanent'}" aria-checked="${billing === 'permanent'}">Anual</button>
        </div>
      ` : `<p class="eno-sum-billing">${hasSaas ? esc(contract.billingLabel) : 'Projeto'}</p>`}
      <dl class="eno-sum-lines">
        ${contract.lines.map((l) => `<div data-m-key="line-${esc(l.product)}"><dt>${esc(l.label)}</dt><dd data-m-key="line-amt-${esc(l.product)}" data-m-num>${esc(l.amount)}</dd></div>`).join('')}
        ${contract.discount ? `<div class="is-discount" data-m-key="line-discount"><dt>${esc(contract.discount.label)}</dt><dd data-m-key="line-amt-discount" data-m-num>${esc(contract.discount.amount)}</dd></div>` : ''}
      </dl>
      ${contract.discountHint ? `<p class="eno-sum-hint" data-m-key="sum-hint" data-m-num>${esc(contract.discountHint)}</p>` : ''}
      ${contract.notes.map((n, i) => `<p class="eno-sum-hint" data-m-key="sum-note-${i}">${esc(n)}</p>`).join('')}
      <div class="eno-sum-total" data-m-key="sum-total">
        <span data-m-key="sum-total-label" data-m-num>${esc(contract.totalLabel)}</span>
        <strong data-m-key="sum-total-value" data-m-num>${esc(contract.total)}</strong>
      </div>
      ${contract.setup ? `<div class="eno-sum-setup" data-m-key="sum-setup"><span><b>+ ${esc(contract.setup.label)}</b><small>${esc(contract.setup.note)}</small></span><strong data-m-key="sum-setup-amt" data-m-num>${esc(contract.setup.amount)}</strong></div>` : ''}
      ${PILOT_FREE
        ? '<p class="eno-sum-today">Nada a pagar · <span class="eno-hide-sm">piloto gratuito, nenhum cartão solicitado</span><span class="eno-show-sm">sem cartão</span></p>'
        : `<p class="eno-sum-today">Cobrado hoje: ${esc(contract.chargedToday)} · <span class="eno-hide-sm">${esc(contract.chargedTodayNote)}</span><span class="eno-show-sm">sem cartão</span></p>`}
    </div>
    ${cta}
  `;
}

function renderCompactSummary(contract) {
  if (!contract) return '';
  return `
    <div class="eno-sum-compact eno-glass">
      <div class="eno-sum-compact-top"><span>Sua combinação</span><button type="button" class="eno-link" data-flow-go="choice">Alterar</button></div>
      <b>${esc(contract.label)} · ${esc(contract.billingLabel)}</b>
      <span>${PILOT_FREE ? 'Grátis no piloto · sem cartão' : `${esc(contract.total)} · cobrado hoje ${esc(contract.chargedToday)}`}</span>
    </div>
  `;
}

function footerNotes() {
  if (PILOT_FREE) return `
    <footer class="eno-flow-foot">
      <p>Piloto gratuito: todos os planos, combos e a implantação do Site sem custo até o lançamento.</p>
      <small>Nenhum cartão e nenhuma cobrança.</small>
    </footer>
  `;
  return `
    <footer class="eno-flow-foot">
      <p>Mensal ou anual (10 mensalidades). As 2 primeiras semanas são grátis.</p>
      <small>Nenhum cartão é pedido agora. A cobrança só começa se você assinar depois das 2 semanas.</small>
    </footer>
  `;
}

// Quem já tem todos os serviços não vê de novo a escolha de plano: vê o que tem.
function renderOwnedAll() {
  return `
    <section class="eno-flow eno-flow-choice" data-flow-step="choice">
      <div class="eno-flow-main">
        <h1 class="eno-flow-title">Você já tem o plano Completo.</h1>
        <p class="eno-flow-lead">Agendamento, Consultório e Site estão ativos na sua conta. Não há nada para contratar de novo.</p>
        <div class="eno-plan-list">
          ${['ambo', 'minne', 'etha'].map((p) => `<div class="eno-plan is-current"><span class="eno-plan-head"><span class="eno-plan-radio" aria-hidden="true">✓</span><span class="eno-plan-name">${PRODUCT_INFO[p].name}</span><span class="eno-plan-badge">Ativo</span></span><span class="eno-plan-for">${{ ambo: 'Pedidos de consulta online', minne: 'Pacientes, agenda e prontuário', etha: 'Seu site profissional' }[p]}</span></div>`).join('')}
        </div>
        <div class="eno-btn-row" style="margin-top:20px">
          <a class="eno-btn" href="/configurar">Configurar meus serviços</a>
          <button type="button" class="eno-btn eno-btn-sec" data-tab="portal">Ir ao portal</button>
        </div>
      </div>
    </section>`;
}

export function renderChoice({ combo, contract, signedIn, returnedFromReview, customOpen = false, owned = [] }) {
  if (signedIn && ['ambo', 'minne', 'etha'].every((p) => owned.includes(p))) return renderOwnedAll();
  const ownedPlan = owned.length ? planFor(owned) : null;
  const billing = combo.viewMode === 'permanent' ? 'permanent' : 'monthly';
  const sel = (p) => combo.products.includes(p);
  const plan = planFor(combo.products);
  customOpen = customOpen || (!plan && combo.products.length > 0);
  // Plano atual selecionado: nada a contratar, o botão diz isso em vez de "Começar".
  const isCurrent = signedIn && owned.length > 0 && combo.products.length === owned.length && owned.every((p) => combo.products.includes(p));
  const canGo = combo.products.length > 0 && !isCurrent;
  const ctaLabel = isCurrent ? 'Este já é o seu plano' : returnedFromReview ? 'Voltar à revisão' : (signedIn && owned.length) ? 'Trocar para este plano' : PILOT_FREE ? 'Continuar grátis' : 'Começar 2 semanas grátis';
  const cta = `<button type="button" class="eno-btn eno-flow-cta" id="eno-flow-continue" data-m-key="flow-cta" data-m-state="${canGo ? 'on' : 'off'}" ${canGo ? '' : 'disabled'}>${ctaLabel}</button>
    <p class="eno-flow-reassure" data-m-key="reassure">${isCurrent ? 'Escolha outro plano para trocar. O atual continua ativo.' : PILOT_FREE ? 'Piloto gratuito · sem cartão · nada é cobrado' : 'Sem cartão agora · nenhuma cobrança hoje · cancele quando quiser'}</p>`;
  const mobileBar = canGo && contract ? `
    <div class="eno-plan-bar eno-show-sm" data-m-key="plan-bar">
      <span><b data-m-key="bar-name" data-m-num>${esc(plan ? plan.name : comboLabel(combo.products))}</b><small data-m-key="bar-total" data-m-num>${PILOT_FREE ? 'Grátis no piloto' : `${esc(contract.total)}${contract.setup ? ' + R$ 790 único' : ''}`}</small></span>
      <button type="button" class="eno-btn" data-flow-continue>${returnedFromReview ? 'Voltar à revisão' : (signedIn && owned.length) ? 'Trocar de plano' : 'Começar grátis'}</button>
    </div>` : '';
  return `
    <section class="eno-flow eno-flow-choice" data-flow-step="choice">
      <div class="eno-flow-main">
        ${renderFlowStepper('choice')}
        <h1 class="eno-flow-title">Escolha seu plano.</h1>
        ${returnedFromReview
          ? `<p class="eno-flow-lead is-return" role="status">↻ Você voltou da revisão. ${esc(comboLabel(combo.products) || 'Sua escolha')} e ${esc(billingLabel(billing))} foram mantidos; a conta continua verificada.</p>`
          : PILOT_FREE
            ? '<p class="eno-flow-lead">Você está no piloto: todos os planos são gratuitos até o lançamento. Escolha o que quer testar.</p>'
            : '<p class="eno-flow-lead">2 semanas grátis em qualquer plano. Sem cartão, cancele quando quiser.</p>'}
        <div class="eno-flow-seg eno-plan-seg" role="radiogroup" aria-label="Periodicidade" data-m-key="seg">
          <span class="eno-seg-pill" data-m-key="seg-pill" data-active="${billing === 'permanent' ? '1' : '0'}" aria-hidden="true"></span>
          <button type="button" role="radio" data-viewmode="monthly" data-m-key="seg-m" data-m-state="${billing !== 'permanent'}" aria-checked="${billing !== 'permanent'}">Mensal</button>
          <button type="button" role="radio" data-viewmode="permanent" data-m-key="seg-a" data-m-state="${billing === 'permanent'}" aria-checked="${billing === 'permanent'}">Anual${PILOT_FREE ? '' : ' <span class="eno-seg-badge">2 meses grátis</span>'}</button>
        </div>
        <div class="eno-plan-list" role="radiogroup" aria-label="Planos">
          ${PLANS.map((pl) => renderPlanCard(pl, { selected: plan?.id === pl.id, billing, current: signedIn && ownedPlan?.id === pl.id })).join('')}
        </div>
        ${sel('etha') ? renderEthaService(combo.ethaService) : ''}
        <div class="eno-custom${customOpen ? ' is-open' : ''}" data-m-key="custom">
          <button type="button" class="eno-custom-toggle" id="eno-custom-toggle" aria-expanded="${customOpen}" aria-controls="eno-custom-list">
            ${plan ? 'Prefere montar do seu jeito?' : 'Montando do seu jeito'} <span aria-hidden="true">${customOpen ? '−' : '+'}</span>
          </button>
          ${customOpen ? `<p class="eno-custom-note">Escolha os serviços um a um. Combinações têm desconto automático.</p>
          <div class="eno-pc-list" id="eno-custom-list" role="group" aria-label="Serviços">
            ${ORDER.map((p) => renderProductCard(p, { selected: sel(p), billing, ethaFormat: combo.ethaFormat })).join('')}
          </div>` : ''}
        </div>
      </div>
      <aside class="eno-flow-side">
        ${flower()}
        ${renderSummary(contract, { billing, withToggle: false, cta })}
      </aside>
      ${footerNotes()}
      ${mobileBar}
    </section>
  `;
}

export function renderAccount({ mode, email, contract, codeDigits, codeError, cooldown, busy, devCode, deliveryNote, fieldError, termsError = '', acceptTerms = false, login = false, verified = false }) {
  const isCode = mode === 'code';
  // Entrada simples ("Entrar" do site): sem etapas nem resumo de compra.
  const flowLogin = login;
  const mm = Math.floor(cooldown / 60);
  const ss = String(cooldown % 60).padStart(2, '0');
  return `
    <section class="eno-flow eno-flow-account${flowLogin ? ' eno-flow-login' : ''}" data-flow-step="${isCode ? 'code' : 'account'}">
      <div class="eno-flow-main">
        ${flowLogin ? '' : renderFlowStepper('account')}
        ${isCode ? `
          <h1 class="eno-flow-title">Digite o código.</h1>
          <p class="eno-flow-lead">Enviado para <b>${esc(email)}</b></p>
          <form id="eno-code-form" class="eno-flow-card eno-glass" novalidate>
            ${otpFieldHTML({ value: (codeDigits || []).join(''), error: Boolean(codeError), describedBy: codeError ? 'eno-code-err' : 'eno-code-status', state: verified ? 'verified' : (busy ? 'verifying' : '') })}
            ${codeError ? `<p class="eno-flow-err" id="eno-code-err" role="alert">${esc(codeError)}</p>` : ''}
            <p class="eno-flow-note eno-otp-status" id="eno-code-status" role="status" aria-live="polite">${verified ? 'Pronto. Abrindo…' : busy ? '<span class="eno-spinner" aria-hidden="true"></span> Verificando…' : codeError ? '' : 'Verificamos ao completar.'}</p>
            ${!codeError ? `<p class="eno-flow-note">${cooldown > 0
              ? `Reenviar código em ${mm}:${ss} · <button type="button" class="eno-link" id="eno-change-email">Trocar e-mail</button>`
              : `<button type="button" class="eno-link" id="eno-resend-code">Reenviar código</button> · <button type="button" class="eno-link" id="eno-change-email">Trocar e-mail</button>`}</p>` : ''}
            ${codeError
              ? `<p class="eno-flow-note"><button type="button" class="eno-link" id="eno-resend-code" ${cooldown > 0 ? 'disabled' : ''}>${cooldown > 0 ? `Reenviar código em ${mm}:${ss}` : 'Reenviar código'}</button> · <button type="button" class="eno-link" id="eno-change-email">Trocar e-mail</button></p>`
              : ''}
            ${devCode ? `<p class="eno-flow-dev">Ambiente de teste, sem envio de e-mail: código <b>${esc(devCode)}</b> <button type="button" class="eno-link" id="eno-fill-dev-code" data-dev-code="${esc(devCode)}">Preencher</button></p>` : ''}
            ${deliveryNote ? `<p class="eno-flow-dev">${esc(deliveryNote)}</p>` : ''}
          </form>
        ` : `
          ${flowLogin
            ? `<h1 class="eno-flow-title">Entrar na Enomera</h1>
          <p class="eno-flow-lead">Use o e-mail da sua conta Enomera. Enviamos um código de 6 dígitos.</p>`
            : `<h1 class="eno-flow-title">Verifique sua conta<br> para continuar.</h1>
          <p class="eno-flow-lead">Enviaremos um código de 6 dígitos. Sua combinação fica guardada<span class="eno-hide-sm"> enquanto você confirma</span>.</p>`}
          <form id="eno-email-form" class="eno-flow-card eno-glass" novalidate>
            <label for="eno-email" class="eno-flow-label">E-mail profissional</label>
            <input id="eno-email" name="email" type="email" autocomplete="email" class="eno-input" required value="${esc(email)}" placeholder="voce@consultorio.com.br" aria-invalid="${fieldError ? 'true' : 'false'}" aria-describedby="eno-email-hint${fieldError ? ' eno-email-err' : ''}">
            ${fieldError ? `<p class="eno-flow-err" id="eno-email-err" role="alert">${esc(fieldError)}</p>` : ''}
            <p class="eno-flow-note" id="eno-email-hint">${flowLogin ? 'Ainda não tem conta? <a class="eno-link" href="/checkout">Escolher serviços</a>' : 'Quem já tem conta recebe o código no mesmo e-mail. Sem senha.'}</p>
            ${flowLogin ? '' : `<label class="eno-terms-check" for="eno-accept-terms"><input type="checkbox" id="eno-accept-terms" name="acceptTerms" ${acceptTerms ? 'checked' : ''} aria-invalid="${termsError ? 'true' : 'false'}" ${termsError ? 'aria-describedby="eno-terms-err"' : ''}><span class="eno-terms-box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.5"/></svg></span><span>Li e aceito os <a class="eno-link" href="/termos" target="_blank" rel="noopener">Termos de Uso</a> e a <a class="eno-link" href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>${termsError ? `<p class="eno-flow-err" id="eno-terms-err" role="alert">${esc(termsError)}</p>` : ''}`}
            <button type="submit" class="eno-btn eno-flow-cta" ${busy ? 'disabled' : ''}>${busy ? '<span class="eno-spinner" aria-hidden="true"></span> Enviando…' : 'Enviar código'}</button>
          </form>
        `}
        ${flowLogin ? '' : `<div class="eno-show-sm">${renderCompactSummary(contract)}</div>`}
      </div>
      ${flowLogin ? `<aside class="eno-flow-side eno-hide-sm">${flower()}</aside>` : `<aside class="eno-flow-side eno-hide-sm">
        ${flower()}
        ${renderSummary(contract, { billing: contract?.billing })}
        <button type="button" class="eno-link eno-flow-change" data-flow-go="choice">Alterar combinação</button>
      </aside>
      `}
    </section>
  `;
}

export function renderReview({ combo, contract, me, activating }) {
  const billing = combo.viewMode === 'permanent' ? 'permanent' : 'monthly';
  const chosen = combo.products;
  const names = namesWithE(chosen);
  // Mostra Agendamento e Consultório sempre; o que não foi escolhido aparece como "não incluído".
  const cards = ORDER.filter((p) => chosen.includes(p));
  const cta = `
    <div class="eno-slide-host" id="eno-checkout-slide" data-slide-state="${activating ? 'busy' : 'idle'}" data-slide-label="${PILOT_FREE ? 'Deslize para ativar grátis' : 'Deslize para ativar'}"></div>
    ${activating ? '<p class="eno-flow-note" role="status">Leva alguns segundos. Os controles seguem disponíveis; se você sair, a ativação continua.</p>' : ''}
  `;
  return `
    <section class="eno-flow eno-flow-review" data-flow-step="review">
      <div class="eno-flow-main">
        ${renderFlowStepper('review')}
        <h1 class="eno-flow-title">Revise e ative<br> sua combinação.</h1>
        <p class="eno-flow-lead is-verified">✓ Conta verificada · ${esc(me?.user?.fullName || '')}<span class="eno-hide-sm"> · ${esc(me?.user?.email || '')}</span></p>
        <div class="eno-pc-list">
          ${cards.map((p) => renderProductCard(p, { selected: chosen.includes(p), billing, ethaFormat: combo.ethaFormat, interactive: false, notIncluded: !chosen.includes(p) })).join('')}
        </div>
        <div class="eno-flow-card eno-glass eno-flow-info eno-hide-sm">
          <h2>Ao ativar</h2>
          <p>${esc(names)} ${chosen.length > 1 ? 'aparecem' : 'aparece'} no seu portal na mesma hora.<br>
          ${PILOT_FREE ? 'No piloto tudo é gratuito, sem cartão e sem cobrança.' : 'As 2 primeiras semanas são grátis e nenhum cartão é solicitado.'}<br>
          A periodicidade pode ser trocada depois em Outros serviços.</p>
        </div>
        <button type="button" class="eno-link eno-flow-change" data-flow-go="choice" id="eno-review-change">Alterar combinação</button>
      </div>
      <aside class="eno-flow-side">
        ${flower()}
        ${renderSummary(contract, { billing, cta, busy: activating })}
        <p class="eno-flow-note eno-show-sm">${PILOT_FREE ? 'Grátis no piloto.' : '2 semanas grátis, sem cartão.'} ${esc(names)} ${chosen.length > 1 ? 'aparecem' : 'aparece'} no portal na mesma hora.</p>
      </aside>
      
    </section>
  `;
}

export function renderActivationBanner(activation) {
  if (!activation) return '';
  return `<div class="eno-activation-banner eno-glass" role="status">✓ ${esc(activation.names)} ${activation.count > 1 ? 'ativos' : 'ativo'} · ${PILOT_FREE ? 'grátis no piloto' : '2 semanas grátis, sem cartão'}</div>`;
}
