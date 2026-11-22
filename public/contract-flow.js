// Percurso de contratação aprovado no Figma em 22 nov 2026
// (arquivo R4FYsZmgvfyA1ESAlTuOCY, seção 76:696): Escolha → Conta → Código → Checkout → Ativando → Portal.
// Funções puras de renderização; o estado e os eventos ficam em platform.js.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PRODUCT_INFO = {
  ambo: { name: 'Ambo', description: 'Agendamento e área do paciente', monthly: 'R$ 39/mês', permanent: 'R$ 790' },
  minne: { name: 'Minne', description: 'Gestão clínica, agenda e prontuários', monthly: 'R$ 69/mês', permanent: 'R$ 1.390' },
  etha: { name: 'Etha', description: 'Site exclusivo · hospedagem R$ 39/mês após publicar', project: 'R$ 1.190', projectMulti: 'R$ 2.190' },
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
  return billing === 'permanent' ? 'Licença permanente' : 'Mensal';
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
  if (product === 'etha') {
    return { price: ethaFormat === 'multi_page' ? info.projectMulti : info.project, cadence: 'projeto · 50% + 50%' };
  }
  return billing === 'permanent'
    ? { price: info.permanent, cadence: 'licença permanente' }
    : { price: info.monthly, cadence: 'assinatura mensal' };
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
      <span class="eno-pc-desc">${notIncluded ? 'Não incluído nesta combinação' : product === 'etha' ? 'Site exclusivo<span class="eno-hide-sm"> · hospedagem R$ 39/mês após publicar</span>' : esc(info.description)}</span>
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
        <div class="eno-flow-seg" role="radiogroup" aria-label="Periodicidade de Ambo e Minne">
          <button type="button" role="radio" data-viewmode="monthly" aria-checked="${billing !== 'permanent'}">Mensal</button>
          <button type="button" role="radio" data-viewmode="permanent" aria-checked="${billing === 'permanent'}">Licença permanente</button>
        </div>
      ` : `<p class="eno-sum-billing">${hasSaas ? esc(contract.billingLabel) : 'Projeto'}</p>`}
      <dl class="eno-sum-lines">
        ${contract.lines.map((l) => `<div><dt>${esc(l.label)}</dt><dd>${esc(l.amount)}</dd></div>`).join('')}
        ${contract.discount ? `<div class="is-discount"><dt>${esc(contract.discount.label)}</dt><dd>${esc(contract.discount.amount)}</dd></div>` : ''}
        ${contract.etha && hasSaas ? `<div class="is-etha"><dt>${esc(contract.etha.label)} <small>projeto · 50% + 50%</small></dt><dd>${esc(contract.etha.project)}</dd></div>` : ''}
      </dl>
      ${contract.discountHint ? `<p class="eno-sum-hint">${esc(contract.discountHint)}</p>` : ''}
      ${contract.notes.map((n) => `<p class="eno-sum-hint">${esc(n)}</p>`).join('')}
      <div class="eno-sum-total">
        <span>${esc(contract.totalLabel)}</span>
        <strong>${esc(contract.total)}</strong>
        ${!hasSaas && contract.etha ? `<small>${esc(contract.etha.split)} · ${esc(contract.etha.hostingAfterPublish)}</small>` : ''}
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
      <p>Ambo e Minne: mensal ou licença permanente. Na licença, hospedagem e suporte são separados.</p>
      <small>Demonstração comercial · nenhuma cobrança real está disponível.</small>
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
          ${sel('etha') ? `
            <label class="eno-etha-format">Formato do site
              <select id="eno-etha-fmt" class="eno-select">
                <option value="one_page" ${combo.ethaFormat !== 'multi_page' ? 'selected' : ''}>Página única · R$ 1.190</option>
                <option value="multi_page" ${combo.ethaFormat === 'multi_page' ? 'selected' : ''}>Até quatro páginas · R$ 2.190</option>
              </select>
            </label>` : ''}
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

export function renderAccount({ mode, email, contract, codeDigits, codeError, cooldown, busy, devCode, deliveryNote, fieldError }) {
  const isCode = mode === 'code';
  const mm = Math.floor(cooldown / 60);
  const ss = String(cooldown % 60).padStart(2, '0');
  return `
    <section class="eno-flow eno-flow-account" data-flow-step="${isCode ? 'code' : 'account'}">
      <div class="eno-flow-main">
        ${renderFlowStepper('account')}
        ${isCode ? `
          <h1 class="eno-flow-title">Digite o código<br> enviado ao seu e-mail.</h1>
          <p class="eno-flow-lead">Enviado para <b>${esc(email)}</b></p>
          <form id="eno-code-form" class="eno-flow-card eno-glass" novalidate>
            <div class="eno-otp-row ${codeError ? 'has-error' : ''}" id="eno-otp-group" role="group" aria-label="Código de 6 dígitos">
              ${[0, 1, 2, 3, 4, 5].map((i) => `<input id="otp-${i}" class="eno-otp-digit" inputmode="numeric" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" maxlength="6" value="${esc(codeDigits[i] || '')}" aria-label="Dígito ${i + 1} de 6" aria-invalid="${codeError ? 'true' : 'false'}" ${codeError ? 'aria-describedby="eno-code-err"' : ''}>`).join('')}
            </div>
            ${codeError ? `<p class="eno-flow-err" id="eno-code-err" role="alert">${esc(codeError)}</p>` : ''}
            ${!codeError ? `<p class="eno-flow-note">${cooldown > 0
              ? `Reenviar código em ${mm}:${ss} · <button type="button" class="eno-link" id="eno-change-email">Trocar e-mail</button>`
              : `<button type="button" class="eno-link" id="eno-resend-code">Reenviar código</button> · <button type="button" class="eno-link" id="eno-change-email">Trocar e-mail</button>`}</p>` : ''}
            <button type="submit" class="eno-btn eno-flow-cta" ${busy ? 'disabled' : ''}>${busy ? '<span class="eno-spinner" aria-hidden="true"></span> Verificando…' : 'Verificar e continuar'}</button>
            ${codeError
              ? `<p class="eno-flow-note"><button type="button" class="eno-link" id="eno-resend-code" ${cooldown > 0 ? 'disabled' : ''}>${cooldown > 0 ? `Reenviar código em ${mm}:${ss}` : 'Reenviar código'}</button></p>`
              : '<p class="eno-flow-note">Colar o código também funciona</p>'}
            ${devCode ? `<p class="eno-flow-dev">Homologação sem envio externo: código <b>${esc(devCode)}</b> <button type="button" class="eno-link" id="eno-fill-dev-code" data-dev-code="${esc(devCode)}">Preencher</button></p>` : ''}
            ${deliveryNote ? `<p class="eno-flow-dev">${esc(deliveryNote)}</p>` : ''}
          </form>
        ` : `
          <h1 class="eno-flow-title">Verifique sua conta<br> para continuar.</h1>
          <p class="eno-flow-lead">Enviaremos um código de 6 dígitos. Sua combinação fica guardada<span class="eno-hide-sm"> enquanto você confirma</span>.</p>
          <form id="eno-email-form" class="eno-flow-card eno-glass" novalidate>
            <label for="eno-email" class="eno-flow-label">E-mail profissional</label>
            <input id="eno-email" name="email" type="email" autocomplete="email" class="eno-input" required value="${esc(email)}" placeholder="voce@consultorio.com.br" aria-invalid="${fieldError ? 'true' : 'false'}" aria-describedby="eno-email-hint${fieldError ? ' eno-email-err' : ''}">
            ${fieldError ? `<p class="eno-flow-err" id="eno-email-err" role="alert">${esc(fieldError)}</p>` : ''}
            <p class="eno-flow-note" id="eno-email-hint">Quem já tem conta recebe o código no mesmo e-mail. Sem senha.</p>
            <button type="submit" class="eno-btn eno-flow-cta" ${busy ? 'disabled' : ''}>${busy ? '<span class="eno-spinner" aria-hidden="true"></span> Enviando…' : 'Enviar código'}</button>
          </form>
        `}
        <div class="eno-show-sm">${renderCompactSummary(contract)}</div>
      </div>
      <aside class="eno-flow-side eno-hide-sm">
        ${flower()}
        ${renderSummary(contract, { billing: contract?.billing })}
        <button type="button" class="eno-link eno-flow-change" data-flow-go="choice">Alterar combinação</button>
      </aside>
      ${footerNotes()}
    </section>
  `;
}

export function renderReview({ combo, contract, me, activating }) {
  const billing = combo.viewMode === 'permanent' ? 'permanent' : 'monthly';
  const chosen = combo.products;
  const names = namesWithE(chosen);
  // Mostra Ambo e Minne sempre; o que não foi escolhido aparece como "não incluído".
  const saasCards = ['ambo', 'minne'].filter((p) => chosen.includes(p) || chosen.includes(p === 'ambo' ? 'minne' : 'ambo'));
  const cards = [...saasCards, ...(chosen.includes('etha') ? ['etha'] : [])];
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
          Nenhum cartão é solicitado: ativação simulada do piloto.<br>
          ${billing === 'permanent' ? 'Hospedagem e suporte da licença: valor em definição.' : 'A periodicidade pode ser trocada depois em Outros serviços.'}</p>
        </div>
        <button type="button" class="eno-link eno-flow-change" data-flow-go="choice" id="eno-review-change">Alterar combinação</button>
      </div>
      <aside class="eno-flow-side">
        ${flower()}
        ${renderSummary(contract, { billing, cta, busy: activating })}
        <p class="eno-flow-note eno-show-sm">Ativação simulada do piloto. ${esc(names)} ${chosen.length > 1 ? 'aparecem' : 'aparece'} no portal na mesma hora.</p>
      </aside>
      ${footerNotes()}
    </section>
  `;
}

export function renderActivationBanner(activation) {
  if (!activation) return '';
  return `<div class="eno-activation-banner eno-glass" role="status">✓ ${esc(activation.names)} ${activation.count > 1 ? 'ativos' : 'ativo'} · cobrado hoje ${esc(activation.chargedToday)}</div>`;
}
