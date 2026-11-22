// Native controls adapted from the approved Figma journey. Data comes from the Core API.
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format((n || 0) / 100);
const names = { ambo:'Ambo', minne:'Minne', etha:'Etha' };
const combination = s => s.combo.products.map(p => names[p]).join(' + ');

export function approvedSummary(s) {
  const q = s.quote;
  return `<aside class="eno-card eno-contract-summary" aria-label="Sua combinação">
    <h2 class="eno-h2">Sua combinação</h2><p class="eno-summary-products">${escape(combination(s) || 'Escolha um serviço')}</p>
    ${s.combo.products.includes('ambo') && s.combo.products.includes('minne') ? '<p class="eno-muted eno-summary-discount"><span class="eno-summary-reference">Ambo R$ 39 + Minne R$ 69<br></span>Desconto do combo: −R$ 19/mês</p>' : ''}
    ${q ? `<p class="eno-summary-total" aria-live="polite">${s.quotePending ? 'Calculando…' : `${money(q.recurringMonthlyCents)} <span>/ mês</span>`}</p>
      ${s.combo.products.includes('etha') ? `<p class="eno-muted">Site: ${money(q.referenceDueTodayCents - q.recurringMonthlyCents)} de entrada prevista + ${money(q.balanceOnApprovalCents)} na entrega.<br>Hospedagem: R$ 39/mês após publicar.</p>` : ''}
      <p class="eno-muted eno-summary-simulation">Assinatura mensal · valores de simulação</p><p class="eno-today">Cobrado hoje: <strong>R$ 0,00</strong></p>` : '<p class="eno-muted">Selecione os produtos para ver os valores.</p>'}
  </aside>`;
}

export function approvedTopbar(s) {
  return `<header class="eno-topbar"><a class="eno-brand" href="/" aria-label="Enomera, início"><img src="/assets/approved/flower.svg" width="32" height="27" alt="">enomera</a>
    ${s.me ? `<nav class="eno-nav-tabs" aria-label="Navegação do portal">${[['portal','Portal'],['plans','Planos e checkout'],['profile','Perfil e agenda'],['billing','Cobrança simulada']].map(([id,label]) => `<button class="eno-tab" type="button" data-tab="${id}" aria-current="${s.tab === id ? 'page' : 'false'}">${label}</button>`).join('')}</nav>` : ''}
    <div class="eno-btn-row"><button type="button" class="eno-account-link" data-tab="${s.me ? 'portal' : 'auth'}">${s.me ? escape(s.me.user.fullName) : 'Minha conta'}</button>${s.me ? '<button type="button" class="eno-btn eno-btn-sec eno-btn-sm" id="eno-logout">Sair</button>' : ''}</div></header>`;
}

export function approvedStepper(s) {
  if (!['plans','auth'].includes(s.tab)) return '';
  const step = s.tab === 'plans' ? s.checkoutStage === 'review' ? 3 : 0 : s.authMode === 'verify' ? 2 : 1;
  return `<nav class="eno-approved-steps" aria-label="Etapas da contratação">${['Escolha','Conta','Verificação','Revisão'].map((label,i) => `<span ${i === step ? 'aria-current="step"' : ''}>${label}</span>${i < 3 ? '<span aria-hidden="true">→</span>' : ''}`).join('')}</nav>`;
}

export function approvedAuth(s, { password, outbox }) {
  const mode = s.authMode;
  const title = { signup:'Crie sua conta', login:'Entre na sua conta', verify:'Confirme seu e-mail', recovery:'Recupere seu acesso' }[mode];
  const email = s.pendingEmail || s.formCache.email || s.me?.user?.email || '';
  const q = s.quote;
  const field = (id,name,label,type,value,autocomplete) => `<div class="eno-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="${type}" class="eno-input" autocomplete="${autocomplete}" value="${escape(value)}" required ${name === 'fullName' ? 'minlength="2"' : ''} ${s.fieldError?.field === name ? 'aria-invalid="true" aria-describedby="eno-field-error"' : ''}>${s.fieldError?.field === name ? `<p class="eno-field-err" id="eno-field-error">${escape(s.fieldError.text)}</p>` : ''}</div>`;
  return `<section class="eno-approved-main eno-auth-main"><h1 class="eno-h1" tabindex="-1">${title}</h1>
    <p class="eno-contract-inline">${escape(combination(s))} · ${money(q?.recurringMonthlyCents)}/mês<br>${q?.discountCents ? `Economia de ${money(q.discountCents)} · ` : ''}Hoje R$ 0</p>
    <div class="eno-grid-2"><div class="eno-auth-task"><p class="eno-muted">${mode === 'signup' || mode === 'login' ? 'Sua escolha continua reservada durante a verificação.' : mode === 'verify' ? `Confira o código de 6 dígitos destinado a ${escape(email)}.` : 'Você receberá instruções se o endereço estiver cadastrado.'}</p>
    ${mode === 'signup' ? `<form id="eno-signup-form" class="eno-list">${field('s-name','fullName','Nome profissional','text',s.formCache.fullName,'name')}${field('s-email','email','E-mail profissional','email',s.formCache.email,'email')}
      ${password({id:'s-pwd',name:'password',label:'Senha',hint:'Use pelo menos 8 caracteres.',value:s.formCache.signupPwd,autocomplete:'new-password',invalid:s.fieldError?.field==='password',errorText:s.fieldError?.field==='password'?s.fieldError.text:''})}
      <details class="eno-optional-profile"><summary>Informações profissionais (opcional)</summary><div class="eno-list"><div class="eno-field"><label for="s-crp">CRP ou CRM</label><input class="eno-input" id="s-crp" name="crpOrCrm" value="${escape(s.formCache.crpOrCrm)}"></div><div class="eno-field"><label for="s-spec">Especialidade</label><select id="s-spec" class="eno-select" name="specialty"><option value="Psicologia" ${s.formCache.specialty==='Psicologia'?'selected':''}>Psicologia</option><option value="Psiquiatria" ${s.formCache.specialty==='Psiquiatria'?'selected':''}>Psiquiatria</option></select></div></div></details>
      <button class="eno-btn" type="submit" ${s.busyAction === 'signup' ? 'disabled aria-busy="true"' : ''}>${s.busyAction === 'signup' ? 'Criando sua conta…' : 'Criar conta e receber código'}</button></form>
      <button class="eno-btn eno-btn-sec" type="button" data-edit-selection>Voltar à escolha</button><button class="eno-btn eno-btn-sec" type="button" data-authmode="login">Já tenho conta</button>` : ''}
    ${mode === 'login' ? `<form id="eno-login-form" class="eno-list">${field('l-email','email','E-mail profissional','email',s.formCache.email,'email')}
      ${password({id:'l-pwd',name:'password',label:'Senha',hint:'',value:s.formCache.loginPwd,autocomplete:'current-password',invalid:s.fieldError?.field==='login',errorText:s.fieldError?.field==='login'?s.fieldError.text:''})}<button class="eno-btn" type="submit" ${s.busyAction === 'login'?'disabled aria-busy="true"':''}>${s.busyAction === 'login'?'Entrando…':'Entrar e continuar'}</button></form>
      <button class="eno-text-button" type="button" data-authmode="recovery">Esqueci minha senha</button><button class="eno-btn eno-btn-sec" type="button" data-authmode="signup">Criar uma conta</button>` : ''}
    ${mode === 'verify' ? `<form id="eno-verify-form" class="eno-list"><label for="otp-0">Código de confirmação</label><div class="eno-otp-row" id="eno-otp-group">${[0,1,2,3,4,5].map(i => `<input id="otp-${i}" class="eno-otp-digit" inputmode="numeric" autocomplete="${i===0?'one-time-code':'off'}" maxlength="6" aria-label="Dígito ${i+1} do código" aria-invalid="${s.fieldError?.field==='code'}" ${s.fieldError?.field==='code'?'aria-describedby="eno-code-error"':''} value="${escape(s.otpDigits[i])}">`).join('')}</div><input type="hidden" id="v-code" name="code" value="${escape(s.otpDigits.join(''))}">
      ${s.fieldError?.field==='code'?`<p class="eno-field-err" id="eno-code-error" role="alert">${escape(s.fieldError.text)}</p>`:''}
      <button class="eno-btn" type="submit" ${s.busyAction==='verify'?'disabled aria-busy="true"':''}>${s.busyAction==='verify'?'Confirmando…':'Confirmar e continuar'}</button>
      <button class="eno-btn eno-btn-sec" id="eno-resend-ver" type="button" ${s.resendCooldown>0||s.busyAction==='resend'?'disabled':''}>${s.resendCooldown>0?`Reenviar código (${s.resendCooldown}s)`:'Reenviar código'}</button>
      <details ${s.fixEmailOpen ? 'open' : ''}><summary>Corrigir endereço de e-mail</summary>${field('v-email','email','E-mail de verificação','email',email,'email')}<button class="eno-text-button" id="eno-fix-email" type="button" ${s.busyAction==='fixEmail'?'disabled aria-busy="true"':''}>${s.busyAction==='fixEmail'?'Salvando…':'Salvar endereço e enviar novo código'}</button></details></form><p class="eno-muted">O código expira em 15 minutos e pode ser usado uma única vez.</p>` : ''}
    ${mode === 'recovery' ? `<form id="eno-rec-req" class="eno-list">${field('r-email','email','E-mail profissional','email',email,'email')}<button class="eno-btn" type="submit">Enviar código de recuperação</button></form><form id="eno-rec-confirm" class="eno-list"><div class="eno-field"><label for="rc-code">Código de recuperação</label><input id="rc-code" name="code" class="eno-input" inputmode="numeric" autocomplete="one-time-code" required minlength="6" maxlength="6" value="${escape(s.formCache.recoveryCode)}"></div>${password({id:'rc-pwd',name:'newPassword',label:'Nova senha',hint:'Pelo menos 8 caracteres.',value:s.formCache.recoveryPwd,autocomplete:'new-password',invalid:false,errorText:''})}<button class="eno-btn" type="submit">Redefinir senha e entrar</button></form><button class="eno-text-button" type="button" data-authmode="login">Voltar à entrada</button>` : ''}
    ${outbox()}</div><div class="eno-summary-desktop">${approvedSummary(s)}</div></div></section>`;
}

export function approvedPlans(s) {
  const q = s.quote;
  const selected = p => s.combo.products.includes(p);
  if (s.lastOrder?.order.status === 'approved' && s.checkoutStage === 'confirmed') {
    return `<section class="eno-approved-confirmation eno-card"><span class="eno-pill eno-pill-ok">Contratação concluída</span><h1 class="eno-h1" tabindex="-1">Seus serviços estão ativos.</h1><p>${escape(combination(s))}</p><p class="eno-muted">Você já pode abrir seus produtos pelo portal. Esta contratação é uma simulação, sem cobrança.</p><p class="eno-today">Cobrado hoje: R$ 0,00</p><button class="eno-btn" type="button" data-tab="portal">Abrir meu portal</button><p class="eno-muted">Comprovante ${escape(s.lastOrder.order.receipt_code)}</p></section>`;
  }
  if (s.checkoutStage === 'review') {
    return `<section class="eno-approved-main"><h1 class="eno-h1" tabindex="-1">Revise sua contratação</h1><div class="eno-grid-2"><div class="eno-list">
      <article class="eno-card"><h2 class="eno-h2">${escape(combination(s))}</h2><p>Mensal · ${money(q?.recurringMonthlyCents)}/mês</p><p class="eno-muted">${escape(s.me?.user.fullName || '')}<br>${escape(s.me?.user.email || '')}</p><button type="button" class="eno-text-button" data-edit-selection>Alterar combinação</button></article>
      <article class="eno-card"><h2 class="eno-h2">Pagamento simulado</h2><p>Hoje: <strong>R$ 0,00</strong></p><p class="eno-muted">Sem cartão e sem cobrança. Os serviços serão ativados na sua conta.</p>
        <input type="hidden" id="chk-outcome" value="approved"><button class="eno-btn" id="eno-checkout-submit" type="button" ${s.processingCheckout ? 'disabled aria-busy="true"' : ''}>${s.processingCheckout ? 'Ativando seus serviços…' : 'Confirmar contratação'}</button>
        <button class="eno-text-button" id="eno-simulate-decline" type="button" ${s.processingCheckout ? 'disabled' : ''}>Testar uma recusa na simulação</button>
      </article>
      ${s.lastOrder && s.lastOrder.order.status !== 'approved' ? `<article class="eno-card eno-card-warn"><h2 class="eno-h2">${s.lastOrder.order.status === 'declined' ? 'A simulação foi recusada' : 'Aguardando confirmação'}</h2><p>Suas escolhas continuam salvas. Nenhum valor foi cobrado.</p><button class="eno-btn" type="button" data-retry-order="${escape(s.lastOrder.order.id)}">Tentar novamente</button></article>` : ''}
      </div>${approvedSummary(s)}</div></section>`;
  }
  return `<section class="eno-approved-main"><h1 class="eno-h1" tabindex="-1">O que sua prática precisa agora?</h1><div class="eno-grid-2"><div class="eno-list eno-product-selection">
    ${[['ambo','R$ 39/mês','Agendamento e acompanhamento do paciente.'],['minne','R$ 69/mês','Agenda e organização da rotina profissional.']].map(([id,price,description]) => `<label class="eno-check-card" data-prod="${id}" data-selected="${selected(id)}"><span><strong>${selected(id) ? 'Selecionado' : 'Selecionar'} · ${names[id]}</strong><span class="eno-product-price">${price}</span><span class="eno-product-description">${description}</span></span><input type="checkbox" data-toggle-prod="${id}" aria-label="Selecionar ${names[id]}" ${selected(id) ? 'checked' : ''}></label>`).join('')}
    <div class="eno-summary-mobile">${approvedSummary(s)}</div>
    <article class="eno-etha-offer"><button class="eno-text-button" type="button" id="eno-etha-info" aria-expanded="${Boolean(s.showEtha)}"><strong>Conhecer · Etha</strong><span>R$ 1.190 · 50/50 + hospedagem após publicar</span><span>Site exclusivo · Conhecer o serviço</span></button>
      ${s.showEtha || selected('etha') ? `<div class="eno-list eno-etha-details"><p>Um site autoral para sua prática, com briefing, edição, prévia e publicação.</p><label class="eno-field" for="eno-etha-fmt">Formato do site<select id="eno-etha-fmt" class="eno-select"><option value="one_page" ${s.combo.ethaFormat === 'one_page' ? 'selected' : ''}>Página única · R$ 1.190</option><option value="multi_page" ${s.combo.ethaFormat === 'multi_page' ? 'selected' : ''}>Até quatro páginas · R$ 2.190</option></select></label><p class="eno-muted">50% na entrada e 50% na entrega. Hospedagem de R$ 39/mês somente após publicação. Nesta homologação, o valor cobrado é R$ 0.</p><label class="eno-check-card" data-selected="${selected('etha')}"><span>Incluir Etha nesta contratação</span><input type="checkbox" data-toggle-prod="etha" aria-label="Selecionar Etha" ${selected('etha') ? 'checked' : ''}></label></div>` : ''}
    </article>
    <button class="eno-btn" type="button" id="eno-continue-selection" ${!s.combo.products.length || !q || s.quotePending ? 'disabled' : ''}>Continuar com esta combinação</button>
    </div><div class="eno-summary-desktop">${approvedSummary(s)}</div></div></section>`;
}

export function approvedPortal(s) {
  if (!s.summary) return '<p role="status">Carregando seu portal…</p>';
  const e = s.summary.entitlements || {};
  const active = Object.keys(names).filter(p => e[p]?.canReadExport);
  const available = Object.keys(names).filter(p => !e[p]?.canReadExport);
  const route = { ambo:'/operacao', minne:'/?modo=ao-vivo', etha:'/briefing' };
  return `<section class="eno-approved-main"><h1 class="eno-h1" tabindex="-1">Seu portal</h1><p class="eno-muted">${escape(s.summary.account.displayName)} · ${active.length ? 'Seus serviços estão prontos para começar.' : 'Sua conta está pronta. Escolha o serviço que deseja contratar.'}</p>
    <div class="eno-grid-3">${active.map(p => `<article class="eno-card eno-card-${p}"><h2 class="eno-h2">${names[p]}</h2><span class="eno-pill eno-pill-ok">Ativo</span><p>${p === 'ambo' ? 'Configure seu perfil e receba as primeiras solicitações.' : p === 'minne' ? 'Organize sua agenda, solicitações e pacientes.' : 'Conte sobre sua prática e acompanhe seu site.'}</p><button class="eno-btn" type="button" data-launch="${p}" data-path="${route[p]}">Abrir ${names[p]}</button>${p === 'ambo' ? `<button class="eno-text-button" type="button" data-launch="ambo" data-path="/?pro=${encodeURIComponent(s.summary.account.slug)}">Ver meu perfil público</button>` : ''}</article>`).join('')}</div>
    ${available.length ? `<section class="eno-other-services"><h2 class="eno-h2">Outros serviços</h2><div class="eno-grid-3">${available.map(p => `<article class="eno-card"><h3>${names[p]}</h3><p class="eno-muted">${p === 'etha' ? 'Seu site profissional com identidade própria.' : p === 'ambo' ? 'Agendamento e área do paciente.' : 'Agenda e rotina profissional.'}</p><button type="button" class="eno-text-button" data-offer="${p}">Conhecer ${names[p]}</button></article>`).join('')}</div></section>` : ''}
    <div class="eno-btn-row"><button class="eno-btn eno-btn-sec" type="button" data-tab="profile">Meu perfil e disponibilidade</button><button class="eno-btn eno-btn-sec" type="button" data-tab="billing">Minhas contratações</button></div></section>`;
}
