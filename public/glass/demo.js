import { initLiquidGlass, supportsRefraction } from './liquid-glass.js';

const root = document.documentElement;

// Kit de interface: a mesma marcação com o vidro atual e com o novo.
function kit(v) {
  const n = v === 'new';
  const add = (base, oldClass, glass, tint, extra = '') => n
    ? `class="${base} lg" data-glass="${glass}"${tint ? ` data-glass-tint="${tint}"` : ''}${extra}`
    : `class="${base} ${oldClass}"`;
  return `
  <div ${add('k-topbar', 'old-topbar', 'regular', 'enomera')}>
    <span class="k-brand">enomera</span>
    <span class="k-links"><span>Produtos</span><span>Preços</span><span>Ajuda</span></span>
    <button type="button" class="k-cta">Entrar</button>
  </div>
  <div class="k-choice" role="group" aria-label="Modalidade da consulta">
    <button type="button" data-choice aria-pressed="true">Online</button>
    <button type="button" data-choice aria-pressed="false">Presencial</button>
  </div>
  <div ${add('k-product', 'old-glass', 'regular', 'ambo')}>
    <p class="sig">ambo</p>
    <h3>Agendamento e área do paciente</h3>
    <p>Solicitações, reservas e confirmações num percurso só.</p>
    <button type="button" ${add('k-go', 'old-cta', 'clear', 'ambo', ' data-glass-interactive')}>Conhecer o Ambo</button>
  </div>
  <form ${add('k-form', 'old-glass', 'reading', 'enomera')} onsubmit="return false">
    <h4>Criar acesso</h4>
    <label>E-mail profissional<input type="email" autocomplete="off" placeholder="nome@clinica.com.br" value="helena@exemplo.com.br"></label>
    <label>Produto<select><option>Ambo e Minne</option><option>Só Ambo</option><option>Etha</option></select></label>
    <label class="k-check"><input type="checkbox" checked>Receber o resumo por e-mail</label>
    <div class="k-actions"><button type="submit" class="k-primary">Continuar</button><button type="button" disabled>Voltar</button></div>
  </form>
  <article ${add('k-record', 'old-card', 'reading', 'minne')}>
    <p class="meta">Registro · dados fictícios</p>
    <h4>Sessão de 24 de novembro</h4>
    <p>Paciente relata melhora do sono nas duas últimas semanas e retomada das caminhadas. Combinado manter o registro diário e rever a frequência das sessões no próximo encontro.</p>
  </article>`;
}

document.querySelectorAll('[data-kit]').forEach(node => {
  const v = node.dataset.kit;
  node.innerHTML = kit(v);
  const buttons = [...node.querySelectorAll('[data-choice]')];
  const paint = () => buttons.forEach(b => {
    const on = b.getAttribute('aria-pressed') === 'true';
    if (v === 'new') {
      b.classList.toggle('lg', on);
      on ? (b.dataset.glass = 'clear', b.dataset.glassTint = 'ambo') : (delete b.dataset.glass, delete b.dataset.glassTint);
    } else {
      b.classList.toggle('old-lens', on);
    }
  });
  buttons.forEach(b => b.addEventListener('click', () => {
    buttons.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    paint();
  }));
  paint();
});

const glass = initLiquidGlass();

// Estado do navegador
const status = document.getElementById('status');
function describe() {
  const solid = root.dataset.lgForce === 'solid'
    || matchMedia('(prefers-reduced-transparency: reduce)').matches
    || matchMedia('(prefers-contrast: more)').matches;
  if (solid) {
    status.dataset.level = 'solid';
    status.textContent = 'Transparência reduzida: superfícies sólidas.';
  } else if (supportsRefraction()) {
    status.dataset.level = 'refract';
    status.textContent = 'Refração real ativa neste navegador.';
  } else {
    status.dataset.level = 'compat';
    status.textContent = 'Este navegador recebe o vidro de compatibilidade, sem a curvatura da borda.';
  }
}
describe();

document.getElementById('simulate').addEventListener('change', e => {
  const v = e.target.value;
  delete root.dataset.lgForce;
  delete root.dataset.lgRefraction;
  if (v === 'compat') root.dataset.lgRefraction = 'off';
  if (v === 'solid') root.dataset.lgForce = 'solid';
  glass.refresh();
  describe();
});

const pause = document.getElementById('pause');
pause.addEventListener('click', () => {
  const on = pause.getAttribute('aria-pressed') !== 'true';
  pause.setAttribute('aria-pressed', String(on));
  pause.textContent = on ? 'Retomar pétalas' : 'Pausar pétalas';
  document.body.classList.toggle('paused', on);
});

document.querySelectorAll('[data-show-btn]').forEach(b => b.addEventListener('click', () => {
  document.body.dataset.show = b.dataset.showBtn;
  document.querySelectorAll('[data-show-btn]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
}));

// Lente arrastável (ponteiro e teclado)
const field = document.getElementById('lens-field');
const lens = document.getElementById('lens');
const pos = { x: 40, y: 40 };
function place(x, y) {
  pos.x = Math.max(0, Math.min(field.clientWidth - lens.offsetWidth, x));
  pos.y = Math.max(0, Math.min(field.clientHeight - lens.offsetHeight, y));
  lens.style.setProperty('--x', `${pos.x}px`);
  lens.style.setProperty('--y', `${pos.y}px`);
}
place(field.clientWidth * .12, field.clientHeight * .12);
let grab = null;
lens.addEventListener('pointerdown', e => {
  grab = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  lens.setPointerCapture(e.pointerId);
});
lens.addEventListener('pointermove', e => { if (grab) place(e.clientX - grab.dx, e.clientY - grab.dy); });
const release = () => { grab = null; };
lens.addEventListener('pointerup', release);
lens.addEventListener('pointercancel', release);
lens.addEventListener('keydown', e => {
  const step = e.shiftKey ? 40 : 14;
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!move) return;
  e.preventDefault();
  place(pos.x + move[0], pos.y + move[1]);
});
addEventListener('resize', () => place(pos.x, pos.y));
