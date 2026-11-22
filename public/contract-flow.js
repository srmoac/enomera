import { otpFieldHTML } from './otp-field.js';
// Percurso de contratação aprovado no Figma em 22 nov 2026
// (arquivo R4FYsZmgvfyA1ESAlTuOCY, seção 76:696): Escolha → Conta → Código → Checkout → Ativando → Portal.
// Funções puras de renderização; o estado e os eventos ficam em platform.js.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PRODUCT_INFO = {
  ambo: { name: 'Ambo', description: 'Agendamento e área do paciente', monthly: 'R$ 39', annual: 'R$ 390' },
  minne: { name: 'Minne', description: 'Gestão clínica, agenda e prontuários', monthly: 'R$ 59', annual: 'R$ 590' },
  etha: { name: 'Etha', description: 'Site exclusivo, hospedagem e painel', monthly: 'R$ 49', annual: 'R$ 490' },
};

const ORDER = ['ambo', 'minne', 'etha'];

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
  const steps = [['choice', 'Escolha'], ['account', 'Conta'], ['review', 'Checkout'], ['portal', 'Portal']];
  const idx = steps.findIndex(([k]) => k === step);
  return `
    <ol class="eno-flow-steps" aria-label="Etapas da contratação">
      ${steps.map(([k, label], i) => {
        const done = i < idx;
        const current = i === idx;
        return `<li class="${done ? 'is-done' : ''} ${current ? 'is-current' : ''}" ${current ? 'aria-current="step"' : ''}>${done ? '✓ ' : `${i + 1} `}${label}</li>`;
      }).join('<li class="eno-flow-sep" aria-hidden="true">—</li>')}
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
  const { price, cadence } = priceFor(product, billing, ethaFormat);
  const mark = selected ? '✓' : '○';
  const inner = `
    <span class="eno-pc-mark" aria-hidden="true">${mark}</span>
    <span class="eno-pc-dot" aria-hidden="true"></span>
    <span class="eno-pc-body">
      <span class="eno-pc-name">${info.name}</span>
      <span class="eno-pc-desc">${notIncluded ? 'Não incluído nesta combinação' : esc(info.description)}</span>
    </span>
    <span class="eno-pc-price">
      <b>${esc(price)}</b>
      <small>${esc(cadence)}</small>
    </span>
  `;
  if (!interactive) {
    return `<div class="eno-pc eno-pc-${product} ${selected ? 'is-selected' : ''} ${notIncluded ? 'is-excluded' : ''}" data-prod="${product}">${inner}</div>`;
  }
  return `<button type="button" class="eno-pc eno-pc-${product} ${selected ? 'is-selected' : ''}" data-toggle-prod="${product}" aria-pressed="${selected}" aria-label="${info.name}, ${esc(price)} ${esc(cadence)}">${inner}</button>`;
}

export function renderSummary(contract, { billing, withToggle = false, cta = '', showTitle = true, busy = false } = {}) {
  if (!contract) {
    return `
      <div class="eno-sum eno-glass" aria-live="polite">
        ${showTitle ? '<h2 class="eno-sum-title">Sua combinação</h2>' : ''}
        <p class="eno-sum-empty">Escolha ao menos um serviço para ver o resumo.</p>
      </div>
      ${cta}
    `;
  }
  const hasSaas = contract.lines.length > 0;
  return `
    <div class="eno-sum eno-glass ${busy ? 'is-busy' : ''}" aria-live="polite">
      ${showTitle ? '<h2 class="eno-sum-title">Sua combinação</h2>' : ''}
      <p class="eno-sum-label"><span>${esc(contract.label)}</span><span class="eno-sum-label-billing"> · ${esc(contract.billingLabel)}</span></p>
      ${withToggle && hasSaas ? `
        <div class="eno-flow-seg" role="radiogroup" aria-label="Periodicidade">
          <button type="button" role="radio" data-viewmode="monthly" aria-checked="${billing !== 'permanent'}">Mensal</button>
          <button type="button" role="radio" data-viewmode="permanent" aria-checked="${billing === 'permanent'}">Anual</button>
        </div>
      ` : `<p class="eno-sum-billing">${hasSaas ? esc(contract.billingLabel) : 'Projeto'}</p>`}
      <dl class="eno-sum-lines">
        ${contract.lines.map((l) => `<div><dt>${esc(l.label)}</dt><dd>${esc(l.amount)}</dd></div>`).join('')}
        ${contract.discount ? `<div class="is-discount"><dt>${esc(contract.discount.label)}</dt><dd>${esc(contract.discount.amount)}</dd></div>` : ''}
      </dl>
      ${contract.discountHint ? `<p class="eno-sum-hint">${esc(contract.discountHint)}</p>` : ''}
      ${contract.notes.map((n) => `<p class="eno-sum-hint">${esc(n)}</p>`).join('')}
      <div class="eno-sum-total">
        <span>${esc(contract.totalLabel)}</span>
        <strong>${esc(contract.total)}</strong>
      </div>
      <p class="eno-sum-today">Cobrado hoje: ${esc(contract.chargedToday)} · <span class="eno-hide-sm">${esc(contract.chargedTodayNote)}</span><span class="eno-show-sm">sem cartão</span></p>
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
      <span>${esc(contract.total)} · cobrado hoje ${esc(contract.chargedToday)}</span>
    </div>
  `;
}

function footerNotes() {
  return `
    <footer class="eno-flow-foot">
      <p>Mensal ou anual (10 mensalidades). Os primeiros 30 dias são grátis.</p>
      <small>Nenhuma cobrança real é feita agora.</small>
    </footer>
  `;
}

export function renderChoice({ combo, contract, signedIn, returnedFromReview }) {
  const billing = combo.viewMode === 'permanent' ? 'permanent' : 'monthly';
  const sel = (p) => combo.products.includes(p);
  const ctaLabel = returnedFromReview ? 'Voltar à revisão' : signedIn ? 'Continuar · revisar e ativar' : 'Continuar · verificar conta';
  const cta = `<button type="button" class="eno-btn eno-flow-cta" id="eno-flow-continue" ${combo.products.length ? '' : 'disabled'}>${ctaLabel}</button>`;
  return `
    <section class="eno-flow eno-flow-choice" data-flow-step="choice">
      <div class="eno-flow-main">
        ${renderFlowStepper('choice')}
        <h1 class="eno-flow-title">O que sua prática<br> precisa agora?</h1>
        ${returnedFromReview
          ? `<p class="eno-flow-lead is-return" role="status">↻ Você voltou da revisão. ${esc(comboLabel(combo.products) || 'Sua escolha')} e ${esc(billingLabel(billing))} foram mantidos; a conta continua verificada.</p>`
          : '<p class="eno-flow-lead">Contrate um serviço ou combine. <span class="eno-hide-sm">O desconto aparece no resumo.</span></p>'}
        <div class="eno-pc-list" role="group" aria-label="Serviços">
          ${ORDER.map((p) => renderProductCard(p, { selected: sel(p), billing, ethaFormat: combo.ethaFormat })).join('')}
        </div>
      </div>
      <aside class="eno-flow-side">
        ${flower()}
        ${renderSummary(contract, { billing, withToggle: true, cta })}
      </aside>
      ${footerNotes()}
    </section>
  `;
}

export function renderAccount({ mode, email, contract, codeDigits, codeError, cooldown, busy, devCode, deliveryNote, fieldError, login = false, verified = false }) {
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
            ${devCode ? `<p class="eno-flow-dev">Homologação sem envio externo: código <b>${esc(devCode)}</b> <button type="button" class="eno-link" id="eno-fill-dev-code" data-dev-code="${esc(devCode)}">Preencher</button></p>` : ''}
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
            ${flowLogin ? '' : '<p class="eno-flow-note eno-legal-note">Ao continuar, você concorda com os <a class="eno-link" href="/termos" target="_blank" rel="noopener">Termos de Uso</a> e a <a class="eno-link" href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</p>'}
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
  // Mostra Ambo e Minne sempre; o que não foi escolhido aparece como "não incluído".
  const cards = ORDER.filter((p) => chosen.includes(p));
  const cta = `
    <button type="button" class="eno-btn eno-flow-cta" id="eno-checkout-submit" ${activating ? 'aria-disabled="true" aria-busy="true"' : ''}>${activating ? '<span class="eno-spinner" aria-hidden="true"></span> Ativando…' : 'Ativar sem cobrança hoje'}</button>
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
          Os primeiros 30 dias são grátis e nenhum cartão é solicitado.<br>
          A periodicidade pode ser trocada depois em Outros serviços.</p>
        </div>
        <button type="button" class="eno-link eno-flow-change" data-flow-go="choice" id="eno-review-change">Alterar combinação</button>
      </div>
      <aside class="eno-flow-side">
        ${flower()}
        ${renderSummary(contract, { billing, cta, busy: activating })}
        <p class="eno-flow-note eno-show-sm">Ativação simulada do piloto. ${esc(names)} ${chosen.length > 1 ? 'aparecem' : 'aparece'} no portal na mesma hora.</p>
      </aside>
      
    </section>
  `;
}

export function renderActivationBanner(activation) {
  if (!activation) return '';
  return `<div class="eno-activation-banner eno-glass" role="status">✓ ${esc(activation.names)} ${activation.count > 1 ? 'ativos' : 'ativo'} · cobrado hoje ${esc(activation.chargedToday)}</div>`;
}
