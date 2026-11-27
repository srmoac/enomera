import { services, billingFor, serviceById, comboPrice } from './services.js';
import { mountEnomeraPlatform } from './platform.js';
import { motionAutoInnerHTML } from './motion-flip.js';

motionAutoInnerHTML();

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
  requests: ['Marina Alves', 'Pedro Santos', 'Luiza Rocha']
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
  const signature = '<p class="signature">Agendamento</p>';
  if (state.amboStep === 0) {
    box.innerHTML = `${glow}${signature}<h4 class="piece">Consulta com<br>Helena Duarte</h4><div class="profile lg piece"><div class="initials">HD</div><b>Helena Duarte</b><small>Psicóloga · adultos e adolescentes</small></div><p>Online · Presencial</p><p><b>50 min · R$ 220</b></p><p>Primeira consulta por solicitação.</p><button class="button" data-ambo="next">Solicitar primeira consulta</button>`;
  } else if (state.amboStep === 1) {
    box.innerHTML = `${glow}${signature}<p class="eyebrow">PRIMEIRA CONSULTA · 01 / 03</p><h4>Como prefere<br>ser atendido?</h4><div class="choice-group" aria-label="Modalidade">${['Online', 'Presencial'].map(x => `<button data-mode="${x}" aria-pressed="${state.mode === x}">${x}</button>`).join('')}</div><b>Seus dias</b><div class="choice-group" aria-label="Dias">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(x => `<button data-day="${x}" aria-pressed="${state.days.includes(x)}">${x}</button>`).join('')}</div><b>Seu período</b><div class="choice-group" aria-label="Período">${['Manhã', 'Tarde', 'Noite'].map(x => `<button data-period="${x}" aria-pressed="${state.period === x}">${x}</button>`).join('')}</div><p>Nenhum horário será reservado nesta etapa.</p><p class="ambo-hint" role="status" ${state.days.length ? 'hidden' : ''}>Selecione ao menos um dia para continuar.</p><button class="button" data-ambo="next" ${state.days.length ? '' : 'disabled'}>Continuar</button><button class="back" data-ambo="back">Voltar</button>`;
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
  // Período em escolhas de vidro, sem lista nativa (padrão: nada de dropdown nativo).
  box.querySelectorAll('[data-period]').forEach(b => {
    b.onclick = () => {
      state.period = b.dataset.period;
      box.querySelectorAll('[data-period]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      pulseService('ambo', b);
    };
  });
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
      `<p>24 de novembro de 2026 · ${item.time}</p><p>${item.mode} · confirmado · dados fictícios.</p><p>O acompanhamento clínico detalhado pertence ao Consultório. Nenhuma chamada real está disponível nesta amostra.</p><div class="product-links"><a class="button" href="/portal">Conhecer o portal</a>${minne?.externalDestination ? `<a class="text-link" href="${minne.externalDestination}" target="_blank" rel="noopener">${minne.externalLabel}</a>` : ''}</div>`
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
    opts.innerHTML = services.map(s => `<button class="service-option lg" data-service="${s.id}" aria-pressed="${state.selected.includes(s.id)}"><span class="check">${state.selected.includes(s.id) ? '✓' : '○'}</span><strong>${s.name}</strong><span>${s.description}</span><small>${s.billing}</small></button>`).join('');
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
    ? billingFor(state.selected, state.billing).map(row => `<div class="billing-row" data-service="${row.id}"><b>${serviceById(row.id)?.name || ''}</b><span>${row.text}</span></div>`).join('')
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

// Âncoras da home sem "#" na URL: rola suave até a seção e mantém o endereço limpo (feedback do Flay, 24 nov).
function wireSmoothAnchors() {
  const reduceMo = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const goTo = (id, smooth) => {
    const el = id && document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ behavior: smooth && !reduceMo() ? 'smooth' : 'auto', block: 'start' });
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    return true;
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"], a[href^="/#"]');
    if (!a || a.classList.contains('skip') || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
    const id = a.getAttribute('href').split('#')[1];
    if (id === 'inicio' || id === '') { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMo() ? 'auto' : 'smooth' }); return; }
    if (goTo(id, true)) e.preventDefault();
  });
  // Quem chega com /#secao (link antigo ou de outra página) rola até ela e o "#" sai da barra.
  if (location.hash) {
    const id = decodeURIComponent(location.hash.slice(1));
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch {}
    requestAnimationFrame(() => goTo(id, false));
  }
}

// Já logado: some o "Entrar" e o "Experimentar" vira "Acessar painel".
function reflectSession() {
  const TOKEN = 'enomera_session_token_v1';
  let tok = '';
  try { tok = sessionStorage.getItem(TOKEN) || ''; } catch {}
  const apply = (on) => {
    document.documentElement.classList.toggle('is-signed-in', on);
    const cta = $('#nav-links a.button');
    const mob = $('.nav-login-mobile');
    if (cta) {
      if (!cta.dataset.anon) cta.dataset.anon = cta.textContent + '|' + cta.getAttribute('href');
      const [t, h] = on ? ['Acessar painel', '/portal'] : cta.dataset.anon.split('|');
      if (cta.textContent !== t) { cta.textContent = t; cta.setAttribute('href', h); cta.animate?.([{ opacity: 0, filter: 'blur(4px)', transform: 'scale(.96)' }, { opacity: 1, filter: 'none', transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.23,1,.32,1)' }); }
    }
    if (mob) mob.textContent = on ? 'Painel' : 'Entrar';
  };
  if (tok) apply(true);
  fetch('/api/v1/auth/me', { credentials: 'include', headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
    .then((r) => apply(r.ok))
    .catch(() => {});
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
  wireSmoothAnchors();
  reflectSession();
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
  // Lê todas as posições antes de escrever: intercalar leitura e escrita forçava um
  // layout por produto a cada evento de rolagem (pesado em celular fraco).
  const products = [...$$('.product')].map(product => [product, product.getBoundingClientRect()]);
  for (const [product, r] of products) {
    if (r.bottom < -innerHeight || r.top > innerHeight * 2) continue; // longe da tela: nada muda
    const p = Math.max(0, Math.min(1, (innerHeight - r.top) / (innerHeight * .58)));
    product.querySelectorAll('.piece').forEach((piece, i) => {
      const t = Math.min(1, Math.max(0, (p - i * .045) / .70));
      const tf = reduced.matches ? 'none' : `translate3d(${(1 - t) * (i % 2 ? -32 : 28)}px,${(1 - t) * (24 + i * 9)}px,0)`;
      if (piece.style.transform !== tf) piece.style.transform = tf;
    });
  }
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
reduced.addEventListener('change', onScroll);
onScroll();
