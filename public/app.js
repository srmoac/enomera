import { services, billingFor, serviceById, comboPrice } from './services.js';
import { mountEnomeraPlatform } from './platform.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const miniAppointments = [
  { id: 'ana', time: '14h–14h50', shortTime: '14h', name: 'Ana Oliveira', mode: 'Online', status: 'Confirmado', note: 'Continuidade semanal · acompanhamento em andamento' },
  { id: 'bruno', time: '15h–15h50', shortTime: '15h', name: 'Bruno Costa', mode: 'Presencial', status: 'Confirmado', note: 'Retorno quinzenal · consultório em Santos' },
  { id: 'clara', time: '16h–16h50', shortTime: '16h', name: 'Clara Mendes', mode: 'Online', status: 'Confirmado', note: 'Sessão de acompanhamento · link enviado' }
];

const state = {
  selected: ['ambo', 'minne', 'etha'],
  billing: 'subscription',
  amboStep: 0,
  mode: 'Online',
  days: ['Ter', 'Qui'],
  period: 'Tarde',
  mini: 'Meu dia',
  miniPatient: 'ana',
  portal: 'Meu dia',
  active: ['ambo', 'minne', 'etha'],
  requests: ['Marina Alves', 'Pedro Santos', 'Luiza Rocha'],
  recordDone: false,
  note: ''
};

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pulseService(service, el) {
  window.dispatchEvent(new CustomEvent('enomera:service-pulse', { detail: { service, el } }));
}

function showDetail(title, body) {
  $('#dialog-content').innerHTML = `<h2>${title}</h2>${body}`;
  $('#detail-dialog').showModal();
}
$('#detail-dialog').addEventListener('click', e => {
  if (e.target === $('#detail-dialog')) e.target.close();
});

let renderedAmboStep = -1;
function renderAmbo() {
  const box = $('#ambo-demo');
  if (state.amboStep === 1 && renderedAmboStep === 1 && box.children.length) {
    box.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(state.mode === b.dataset.mode)));
    box.querySelectorAll('[data-day]').forEach(b => b.setAttribute('aria-pressed', String(state.days.includes(b.dataset.day))));
    const next = box.querySelector('[data-ambo="next"]');
    if (next) next.disabled = !state.days.length;
    const hint = box.querySelector('.ambo-hint');
    if (hint) hint.hidden = state.days.length > 0;
    return;
  }
  renderedAmboStep = state.amboStep;
  const glow = '<span class="ambo-dock-glow" aria-hidden="true"></span>';
  const signature = '<p class="signature">ambo</p>';
  if (state.amboStep === 0) {
    box.innerHTML = `${glow}${signature}<h4 class="piece">Consulta com<br>Helena Duarte</h4><div class="profile lg piece"><div class="initials">HD</div><b>Helena Duarte</b><small>Psicóloga · adultos e adolescentes</small></div><p>Online · Presencial</p><p><b>50 min · R$ 220</b></p><p>Primeira consulta por solicitação.</p><button class="button" data-ambo="next">Solicitar primeira consulta</button>`;
  } else if (state.amboStep === 1) {
    box.innerHTML = `${glow}${signature}<p class="eyebrow">PRIMEIRA CONSULTA · 01 / 03</p><h4>Como prefere<br>ser atendido?</h4><div class="choice-group" aria-label="Modalidade">${['Online', 'Presencial'].map(x => `<button data-mode="${x}" aria-pressed="${state.mode === x}">${x}</button>`).join('')}</div><b>Seus dias</b><div class="choice-group" aria-label="Dias">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(x => `<button data-day="${x}" aria-pressed="${state.days.includes(x)}">${x}</button>`).join('')}</div><label for="period">Seu período</label><select id="period">${['Manhã', 'Tarde', 'Noite'].map(x => `<option ${state.period === x ? 'selected' : ''}>${x}</option>`).join('')}</select><p>Nenhum horário será reservado nesta etapa.</p><p class="ambo-hint" role="status" ${state.days.length ? 'hidden' : ''}>Selecione ao menos um dia para continuar.</p><button class="button" data-ambo="next" ${state.days.length ? '' : 'disabled'}>Continuar</button><button class="back" data-ambo="back">Voltar</button>`;
  } else if (state.amboStep === 2) {
    box.innerHTML = `${glow}${signature}<p class="eyebrow">PRIMEIRA CONSULTA · 02 / 03</p><h4>Confira suas<br>preferências</h4><div class="profile lg"><b>Helena Duarte</b><p>${state.mode} · ${state.days.join(' e ')} · ${state.period}</p><p>50 min · R$ 220<br>Valor fictício do atendimento demonstrado.</p></div><p>Uma solicitação depende da confirmação do profissional.</p><button class="button" data-ambo="next">Concluir demonstração</button><button class="back" data-ambo="back">Editar preferências</button>`;
  } else {
    box.innerHTML = `${glow}${signature}<p class="eyebrow">PRIMEIRA CONSULTA · 03 / 03</p><h4>Preferências registradas</h4><p role="status">Esta é uma simulação local. Nenhuma solicitação foi enviada e nenhum horário foi reservado.</p><div class="profile lg"><b>${state.mode}</b><p>${state.days.join(' e ')} · ${state.period}</p></div><button class="button" data-ambo="restart">Explorar novamente</button>`;
  }

  box.querySelectorAll('[data-ambo]').forEach(b => {
    b.onclick = () => {
      state.amboStep = b.dataset.ambo === 'restart' ? 0 : state.amboStep + (b.dataset.ambo === 'back' ? -1 : 1);
      renderAmbo();
      pulseService('ambo', box);
      const heading = box.querySelector('h4');
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    };
  });
  box.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      renderAmbo();
      pulseService('ambo', b);
    };
  });
  box.querySelectorAll('[data-day]').forEach(b => {
    b.onclick = () => {
      const d = b.dataset.day;
      state.days = state.days.includes(d) ? state.days.filter(x => x !== d) : [...state.days, d];
      renderAmbo();
      pulseService('ambo', b);
    };
  });
  if ($('#period')) $('#period').onchange = e => { state.period = e.target.value; pulseService('ambo', e.target); };
}

function activeAppointment() {
  return miniAppointments.find(a => a.id === state.miniPatient) || miniAppointments[0];
}

function renderMiniDetailMarkup(item) {
  return `<p>Atendimento selecionado</p><p>${item.time} · ${item.mode} <span class="state-confirmed">${item.status}</span></p><h5>${item.name}</h5><p>${item.note}</p><button data-consult>Ver consulta ↗</button>`;
}

let renderedMiniTab = '';
function bindConsultButton(c) {
  c.querySelector('[data-consult]')?.addEventListener('click', () => {
    const item = activeAppointment();
    const minne = serviceById('minne');
    showDetail(
      `Consulta de ${item.name}`,
      `<p>24 de novembro de 2026 · ${item.time}</p><p>${item.mode} · confirmado · dados fictícios.</p><p>O acompanhamento clínico detalhado pertence ao Minne. Nenhuma chamada real está disponível nesta amostra.</p><div class="product-links"><a class="button" href="/portal">Conhecer o portal</a>${minne?.externalDestination ? `<a class="text-link" href="${minne.externalDestination}" target="_blank" rel="noopener">${minne.externalLabel}</a>` : ''}</div>`
    );
  });
}

function renderMini(rowOnly = false) {
  const c = $('#mini-content');
  const item = activeAppointment();

  // Preserve the list DOM when switching appointment rows so the mineral lens glides cleanly.
  if (rowOnly && (state.mini === 'Meu dia' || state.mini === 'Agenda') && renderedMiniTab === state.mini && c.querySelector('#minne-detail')) {
    c.querySelectorAll('[data-minne-row]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.minneRow === state.miniPatient)));
    const detail = c.querySelector('#minne-detail');
    detail.innerHTML = renderMiniDetailMarkup(item);
    bindConsultButton(c);
    window.dispatchEvent(new CustomEvent('enomera:minne-detail-updated', { detail: { el: detail } }));
    return;
  }

  renderedMiniTab = state.mini;
  const rowsMarkup = `<div class="minne-list" role="group" aria-label="Atendimentos do dia">${miniAppointments.map(a => `<button class="minne-row" data-minne-row="${a.id}" aria-pressed="${a.id === state.miniPatient}"><span><b>${a.shortTime}</b> ${a.name}</span><span>${a.mode}</span></button>`).join('')}</div>`;

  if (state.mini === 'Meu dia') {
    c.innerHTML = `<h4 class="piece">Meu dia</h4><p>Terça-feira, 24 de novembro · dados fictícios</p><div class="mini-cards"><div class="lg piece" id="minne-detail" aria-live="polite">${renderMiniDetailMarkup(item)}</div><div class="lg piece"><p>Solicitações</p><p>3 aguardando resposta</p><b>Marina Alves</b><p>Terças e quintas · tarde</p></div></div><h5>Atendimentos do dia</h5>${rowsMarkup}`;
  } else if (state.mini === 'Agenda') {
    c.innerHTML = `<h4>Agenda</h4><p>Terça-feira, 24 de novembro · dados fictícios</p><div class="mini-cards"><div class="lg" id="minne-detail" aria-live="polite">${renderMiniDetailMarkup(item)}</div><div class="lg"><p>Próximo horário livre</p><b>17h · disponível</b><p>Online ou presencial</p></div></div><h5>Selecionar consulta</h5>${rowsMarkup}`;
  } else if (state.mini === 'Pacientes') {
    c.innerHTML = '<h4>Pacientes</h4><p>Dados fictícios · sem informações clínicas</p>' + miniAppointments.map(a => `<p><b>${a.name}</b> · ${a.mode} · ${a.shortTime}</p>`).join('');
  } else {
    c.innerHTML = '<h4>Solicitações</h4><p>3 aguardando resposta · dados fictícios</p>' + state.requests.map(x => `<p>${x} · primeira consulta</p>`).join('') + '<a class="text-link" href="/portal">Explorar no portal ↗</a>';
  }

  c.querySelectorAll('[data-minne-row]').forEach(b => {
    b.onclick = () => {
      if (state.miniPatient === b.dataset.minneRow) return;
      state.miniPatient = b.dataset.minneRow;
      renderMini(true);
      pulseService('minne', c.querySelector('#minne-detail') || b);
    };
  });
  bindConsultButton(c);
  $$('[data-mini]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mini === state.mini)));
}

$$('[data-mini]').forEach(b => {
  b.onclick = () => {
    state.mini = b.dataset.mini;
    renderMini(false);
    pulseService('minne', b);
  };
});

function renderCombination() {
  const opts = $('#service-options');
  if (!opts.children.length) {
    opts.innerHTML = services.map(s => `<button class="service-option lg" data-service="${s.id}" aria-pressed="${state.selected.includes(s.id)}"><span class="check">${state.selected.includes(s.id) ? '✓' : '○'}</span><strong>${s.name[0].toUpperCase() + s.name.slice(1)}</strong><span>${s.description}</span><small>${s.billing}</small></button>`).join('');
    opts.querySelectorAll('[data-service]').forEach(b => {
      b.onclick = () => {
        const id = b.dataset.service;
        state.selected = state.selected.includes(id) ? state.selected.filter(x => x !== id) : [...state.selected, id];
        renderCombination();
      };
    });
  } else {
    opts.querySelectorAll('[data-service]').forEach(b => {
      const on = state.selected.includes(b.dataset.service);
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.check').textContent = on ? '✓' : '○';
    });
  }
  $('#billing-summary').innerHTML = state.selected.length
    ? billingFor(state.selected, state.billing).map(row => `<div class="billing-row" data-service="${row.id}"><b>${row.id}</b><span>${row.text}</span></div>`).join('')
      + (() => { const c = comboPrice(state.selected, state.billing); return `<div class="billing-row billing-total"><b>Total</b><span>${c.total}${c.savings ? ` · economia de ${c.savings}` : ''}</span></div>`; })()
    : '<p>Selecione um serviço para conhecer a estrutura de contratação.</p>';
  $$('[data-billing]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.billing === state.billing)));
}

$$('[data-billing]').forEach(b => {
  b.onclick = () => {
    state.billing = b.dataset.billing;
    renderCombination();
  };
});

const appointments = [['14h', 'Ana Oliveira', 'Online'], ['15h', 'Bruno Costa', 'Presencial'], ['16h', 'Clara Mendes', 'Online'], ['17h', 'Daniel Lima', 'Presencial']];
const portalTabs = ['Meu dia', 'Agenda', 'Pacientes', 'Solicitações', 'Registros', 'Outros serviços'];

function renderPortal() {
  const portal = $('#portal');
  const has = id => state.active.includes(id);
  const nav = ['Meu dia', ...(has('ambo') || has('minne') ? ['Agenda'] : []), ...(has('minne') ? ['Pacientes'] : []), ...(has('ambo') ? ['Solicitações'] : []), ...(has('minne') ? ['Registros'] : []), 'Outros serviços'];
  if (!nav.includes(state.portal)) state.portal = 'Meu dia';
  if (!portal.querySelector('.portal-shell')) {
    portal.innerHTML = `<div class="portal-shell"><img class="substrate" src="/assets/portal-substrate.svg" width="1440" height="1000" alt=""><aside class="portal-side lg"><a href="/" class="brand">enomera</a><nav aria-label="Portal profissional">${portalTabs.map(n => `<button data-portal="${n}" aria-current="false">${n}</button>`).join('')}</nav><div class="portal-account">Helena Duarte<br>Psicologia</div></aside><main class="portal-main"><div class="portal-banner"><span>Demonstração local · sem autenticação ou integração real</span><a href="/">Voltar ao site ↗</a></div><h1></h1><p class="date">Terça-feira, 24 de novembro de 2026 · dados fictícios</p><div id="portal-content" tabindex="-1"></div><img class="portal-flower" src="/assets/flower.svg" width="480" height="396" alt=""></main></div>`;
  }
  $$('[data-portal]').forEach(b => {
    const n = b.dataset.portal;
    b.hidden = !nav.includes(n);
    b.textContent = n === 'Solicitações' ? `${n} · ${state.requests.length}` : n;
    b.setAttribute('aria-current', state.portal === n ? 'page' : 'false');
  });
  $('.portal-main h1').textContent = state.portal;
  const c = $('#portal-content');
  const schedule = () => appointments.map(([time, name, mode]) => `<div class="schedule-row"><span>${time}　${name}</span><span>${mode} · 50 min</span></div>`).join('');
  if (state.portal === 'Meu dia') {
    c.innerHTML = `<div class="stats">${has('ambo') || has('minne') ? '<button class="stat lg" data-goto="Agenda"><strong>04</strong><span>Consultas hoje</span></button>' : ''}${has('ambo') ? `<button class="stat lg" data-goto="Solicitações"><strong>0${state.requests.length}</strong><span>Solicitações pendentes</span></button>` : ''}${has('minne') ? `<button class="stat lg" data-goto="Registros"><strong>0${state.recordDone ? 0 : 1}</strong><span>Registro a concluir</span></button>` : ''}</div>${has('ambo') || has('minne') ? '<div class="next-appointment lg"><p class="eyebrow">Próximo atendimento · 14h–14h50</p><h2>Ana Oliveira</h2><p>Online · confirmado</p><button class="back" data-appointment>Ver consulta ↗</button></div><h3>Depois, no seu dia</h3>' + schedule().replace(/<div class="schedule-row">.*?<\/div>/, '') : '<div class="portal-panel lg"><h3>Seu acesso aos serviços</h3><p>Ative Ambo ou Minne no cenário demonstrativo para explorar a visão geral da rotina.</p><button class="button" data-goto="Outros serviços">Explorar outros serviços</button></div>'}<p class="notice">O portal reúne acesso e visão geral. A rotina clínica detalhada está no Minne.</p>`;
  } else if (state.portal === 'Agenda') {
    c.innerHTML = '<div class="portal-panel lg"><h3>Consultas do dia</h3>' + schedule() + '</div><p class="notice">Agenda fictícia. Não há calendário externo conectado.</p>';
  } else if (state.portal === 'Pacientes') {
    c.innerHTML = '<div class="portal-panel lg"><h3>Pacientes no cenário</h3>' + appointments.map(([, name]) => `<div class="schedule-row"><span>${name}</span><span>Cadastro fictício</span></div>`).join('') + '</div><p class="notice">Dados clínicos ficam na aplicação Minne. O portal não exibe prontuários.</p>';
  } else if (state.portal === 'Solicitações') {
    c.innerHTML = '<p>Preferências recebidas no cenário fictício. As respostas alteram apenas esta sessão.</p>' + state.requests.map(name => `<div class="portal-panel lg"><h3>${name}</h3><p>Primeira consulta · Online<br>Terças e quintas · tarde</p><button class="button" data-respond="${name}">Responder na demonstração</button></div>`).join('') + (state.requests.length ? '' : '<div class="portal-panel lg"><p role="status">Todas as solicitações desta amostra foram respondidas.</p></div>');
  } else if (state.portal === 'Registros') {
    c.innerHTML = `<div class="portal-panel lg"><h3>${state.recordDone ? 'Registro concluído na amostra' : 'Um registro a concluir'}</h3><p>Ana Oliveira · consulta de 24 de novembro. Esta área demonstra o acesso ao Minne.</p><label for="demo-note">Anotação fictícia</label><textarea id="demo-note" placeholder="Texto fictício para experimentar a edição">${escape(state.note)}</textarea><button class="button" id="save-note">${state.recordDone ? 'Atualizar amostra local' : 'Marcar como concluído na amostra'}</button><p class="notice" id="note-feedback">O conteúdo fica apenas na memória desta aba e desaparece ao recarregar.</p></div>`;
  } else {
    c.innerHTML = `<div class="portal-panel lg"><h3>Serviços ativos no cenário</h3><p>Altere a combinação para explorar como o resumo se adapta.</p><div class="active-products">${services.map(s => `<label><input type="checkbox" data-active="${s.id}" ${has(s.id) ? 'checked' : ''}>${s.name}</label>`).join('')}</div></div>${services.map(s => `<div class="portal-panel lg"><h3>${s.name}</h3><p>${s.description}</p><div class="product-links"><button class="back" data-offer="${s.id}">Conhecer ${s.name} ↗</button>${s.externalDestination ? `<a class="text-link" href="${s.externalDestination}" target="_blank" rel="noopener">${s.externalLabel}</a>` : ''}${s.exampleDestination ? `<a class="text-link" href="${s.exampleDestination}" target="_blank" rel="noopener">${s.exampleLabel}</a>` : ''}</div></div>`).join('')}`;
  }
  $$('[data-portal],[data-goto]').forEach(b => {
    b.onclick = () => {
      state.portal = b.dataset.portal || b.dataset.goto;
      renderPortal();
      $('.portal-main h1').tabIndex = -1;
      $('.portal-main h1').focus({ preventScroll: true });
    };
  });
  $$('[data-active]').forEach(i => {
    i.onchange = () => {
      const id = i.dataset.active;
      state.active = i.checked ? [...state.active, id] : state.active.filter(x => x !== id);
      renderPortal();
      $(`[data-active="${id}"]`)?.focus({ preventScroll: true });
    };
  });
  $$('[data-offer]').forEach(b => {
    b.onclick = () => {
      const s = services.find(x => x.id === b.dataset.offer);
      const primary = s.externalDestination ? `<a href="${s.externalDestination}" target="_blank" rel="noopener" class="button">${s.externalLabel}</a>` : `<a href="/${s.section}" target="_blank" rel="noopener" class="button">Explorar no site ↗</a>`;
      const secondary = [s.exampleDestination ? `<a href="${s.exampleDestination}" target="_blank" rel="noopener" class="text-link">${s.exampleLabel}</a>` : '', s.externalDestination ? `<a href="/${s.section}" target="_blank" rel="noopener" class="text-link">Explorar na Enomera ↗</a>` : ''].filter(Boolean).join('');
      showDetail(s.name, `<p>${s.description}.</p><p>${s.billing}. Valores em definição.</p><p>Esta apresentação preserva o contexto do portal. Não há contratação nesta amostra.</p><div class="product-links">${primary}${secondary}</div><p class="notice">Abre em outra aba.</p>`);
    };
  });
  $$('[data-respond]').forEach(b => {
    b.onclick = () => {
      state.requests = state.requests.filter(n => n !== b.dataset.respond);
      renderPortal();
      const next = $('#portal-content [data-respond]') || $('#portal-content [role="status"]');
      if (next) {
        if (!next.matches('button')) next.tabIndex = -1;
        next.focus({ preventScroll: true });
      }
    };
  });
  $('[data-appointment]')?.addEventListener('click', () => showDetail('Consulta de Ana Oliveira', '<p>24 de novembro de 2026 · 14h–14h50</p><p>Online · confirmado · dados fictícios.</p><p>A rotina clínica detalhada pertence ao Minne. Esta amostra não inicia uma chamada real.</p>'));
  if ($('#demo-note')) $('#demo-note').oninput = e => { state.note = e.target.value; };
  if ($('#save-note')) $('#save-note').onclick = () => {
    state.recordDone = true;
    $('#note-feedback').textContent = 'Amostra atualizada nesta aba. Nenhum registro clínico foi enviado.';
    $('#save-note').textContent = 'Atualizar amostra local';
  };
}

function syncServiceLinks() {
  for (const s of services) {
    const box = document.querySelector(`[data-service-links="${s.id}"]`);
    const link = document.querySelector(`[data-service-link="${s.id}"]`);
    const example = document.querySelector(`[data-service-example="${s.id}"]`);
    if (link) {
      if (s.externalDestination) { link.href = s.externalDestination; link.hidden = false; }
      else { link.removeAttribute('href'); link.hidden = true; }
    }
    if (example) {
      if (s.exampleDestination) { example.href = s.exampleDestination; example.hidden = false; }
      else { example.removeAttribute('href'); example.hidden = true; }
    }
    if (box) box.hidden = !(s.externalDestination || s.exampleDestination);
  }
}

const cleanPath = location.pathname.replace(/\/$/, '') || '/';
const isPortal = ['/portal', '/conta', '/checkout'].includes(cleanPath);
if (isPortal) {
  $('.nav').hidden = true;
  $('#main').hidden = true;
  $('.skip').href = '#portal-content';
  $('#portal').hidden = false;
  document.title = 'Portal profissional | Enomera';
  mountEnomeraPlatform($('#portal'));
} else {
  syncServiceLinks();
  renderAmbo();
  renderMini();
  renderCombination();
  $('#combo-continue-cta')?.addEventListener('click', (e) => {
    const sel = state.selected.length ? state.selected.join(',') : 'ambo,minne';
    // A combinação e a periodicidade escolhidas no site seguem para o percurso de contratação.
    const periodicidade = state.billing === 'license' ? 'anual' : 'mensal';
    e.currentTarget.href = `/checkout?selecao=${encodeURIComponent(sel)}&periodicidade=${periodicidade}`;
  });
}

$('.skip').addEventListener('click', () => {
  const t = $($('.skip').getAttribute('href'));
  requestAnimationFrame(() => t?.focus({ preventScroll: true }));
});
$('.menu-toggle').onclick = () => {
  const open = $('.nav').classList.toggle('menu-open');
  $('.menu-toggle').setAttribute('aria-expanded', String(open));
  $('.menu-toggle').setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
};
$$('#nav-links a').forEach(a => {
  a.onclick = () => {
    $('.menu-toggle').dataset.closeReason = 'link';
    $('.nav').classList.remove('menu-open', 'is-hidden');
    $('.menu-toggle').setAttribute('aria-expanded', 'false');
  };
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('.nav').classList.remove('menu-open');
    $('.menu-toggle').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('pointerdown', e => {
  if ($('.nav').classList.contains('menu-open') && !e.target.closest('.nav')) {
    $('.nav').classList.remove('menu-open');
    $('.menu-toggle').setAttribute('aria-expanded', 'false');
  }
});

// One native scroll owner. No wheel/touch interception, snapping, or queued actions.
let previousY = scrollY, current = 0, target = 0, raf = 0, lastTime = 0, navHoldUntil = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
$$('a[href*="#"]').forEach(a => a.addEventListener('click', () => {
  navHoldUntil = performance.now() + 1200;
  $('.nav').classList.remove('is-hidden');
}));
function animate(time) {
  const dt = Math.min(time - lastTime || 16, 32);
  lastTime = time;
  current += (target - current) * (1 - Math.exp(-dt / 90));
  if (Math.abs(target - current) < .0001) current = target;
  $('.connection-track').style.transform = `translate3d(${-current * 66.6667}%,0,0)`;
  if (current !== target) raf = requestAnimationFrame(animate);
  else { raf = 0; lastTime = 0; }
}
function onScroll() {
  if (isPortal) return;
  const y = scrollY;
  $('.nav').classList.toggle('is-hidden', y > 150 && y > previousY && performance.now() > navHoldUntil);
  previousY = y;
  const connection = $('.connection');
  const rect = connection.getBoundingClientRect();
  target = Math.max(0, Math.min(1, -rect.top / Math.max(1, connection.offsetHeight - innerHeight)));
  if (!reduced.matches && !raf) raf = requestAnimationFrame(animate);
  for (const product of $$('.product')) {
    const r = product.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (innerHeight - r.top) / (innerHeight * .58)));
    product.querySelectorAll('.piece').forEach((piece, i) => {
      const t = Math.min(1, Math.max(0, (p - i * .045) / .70));
      piece.style.transform = reduced.matches ? 'none' : `translate3d(${(1 - t) * (i % 2 ? -32 : 28)}px,${(1 - t) * (24 + i * 9)}px,0)`;
    });
  }
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
reduced.addEventListener('change', onScroll);
onScroll();
