// Configuração em um fluxo só (Figma "09 · Configuração por plano e Vidro").
// Cada plano vê só as etapas dos produtos que tem. Cada etapa salva no servidor ao avançar.
const TOKEN_KEY = 'enomera_session_token_v1';
const tok = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
async function api(path, { method = 'GET', body } = {}) {
  const h = {}; if (body !== undefined) h['Content-Type'] = 'application/json';
  if (tok()) h.Authorization = `Bearer ${tok()}`;
  const r = await fetch(path, { method, headers: h, credentials: 'include', body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
function sibling(override, port, project, prod) {
  if (override) return override;
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') return `http://127.0.0.1:${port}`;
  const m = location.hostname.match(/^enomera(-git-.+\.vercel\.app)$/);
  return m ? `https://${project}${m[1]}` : prod;
}
const ORIGIN = {
  ambo: sibling(window.__ENOMERA_AMBO_URL, 3001, 'lotus-app', 'https://ambo-enomera.vercel.app'),
  minne: sibling(window.__ENOMERA_MINNE_URL, 3002, 'compasso-app', 'https://compasso-app-seven.vercel.app'),
  etha: sibling(window.__ENOMERA_ETHA_URL, 3003, 'etha-enomera', 'https://etha-enomera.vercel.app'),
};
const COLOR = { enomera: '#5b70b2', ambo: '#235d94', minne: '#1e625e', etha: '#53459a' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
const chip = (attrs, label, on, extra = '') => `<button type="button" class="eg-chip ${extra}" ${attrs} aria-pressed="${on ? 'true' : 'false'}">${CHECK}${esc(label)}</button>`;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const toast = (o) => window.EnoFeedback && window.EnoFeedback.toast(o);

const stage = document.getElementById('stage');
const nextBtn = document.getElementById('next');
const backBtn = document.getElementById('back');
const S = { me: null, profile: null, setup: null, patients: [], steps: [], i: 0, busy: false, form: {}, mode: 'wizard', view: '' };

const DAYS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [0, 'Dom']];
const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const has = (p) => { const e = S.me?.entitlements?.[p]; return Boolean(e && e.canWrite); };

const STEP_DEFS = {
  voce: { prod: 'enomera', label: 'Você' },
  consultorio: { prod: 'ambo', label: 'Consultório' },
  horarios: { prod: 'ambo', label: 'Horários' },
  link: { prod: 'ambo', label: 'Link do Ambo' },
  pacientes: { prod: 'minne', label: 'Pacientes' },
  site: { prod: 'etha', label: 'Site' },
  pronto: { prod: 'enomera', label: 'Pronto' },
  hub: { prod: 'enomera', label: 'Configurações' },
};

// Etapas obrigatórias e o que conta como feito. Quem já terminou não refaz o passo a passo:
// cai no painel de configurações (hub) e abre só o item que quer mudar (feedback do Flay, 24 nov).
const REQUIRED = ['voce', 'consultorio', 'horarios', 'link'];
function isDone(key) {
  const f = S.form;
  if (key === 'voce') return (f.displayName || '').trim().length >= 3;
  if (key === 'consultorio') return Boolean(S.setup && S.setup.sessionPriceCents != null);
  if (key === 'horarios') return Object.values(f.hours).some((set) => set && set.size);
  if (key === 'link') return Boolean(f.open);
  return true;
}
const missing = () => S.steps.filter((k) => REQUIRED.includes(k) && !isDone(k));
function summary(key) {
  const f = S.form;
  if (key === 'voce') return [f.displayName, f.crpOrCrm, f.specialty].filter(Boolean).join(' · ');
  if (key === 'consultorio') return [[...f.modalities].map((m) => (m === 'online' ? 'Online' : 'Presencial')).join(' e '), `${f.duration} min`, f.price === '' ? '' : (Number(f.price) ? 'R$ ' + f.price : 'valor a combinar')].filter(Boolean).join(' · ');
  if (key === 'horarios') { const n = Object.values(f.hours).reduce((a, set) => a + (set ? set.size : 0), 0); const d = Object.values(f.hours).filter((set) => set && set.size).length; const b = (S.blocks || []).length; return n ? `${n} ${n === 1 ? 'horário' : 'horários'} em ${d} ${d === 1 ? 'dia' : 'dias'}${b ? ` · ${b} ${b === 1 ? 'folga' : 'folgas'}` : ''}` : 'Nenhum horário liberado'; }
  if (key === 'link') return f.open ? 'Agenda aberta para pedidos' : 'Agenda fechada';
  if (key === 'pacientes') return 'Importar ou adicionar pacientes no Minne';
  if (key === 'site') return 'Perguntas do seu site na Etha';
  return '';
}

function computeSteps() {
  const s = ['voce'];
  if (has('ambo')) s.push('consultorio', 'horarios', 'link');
  if (has('minne')) s.push('pacientes');
  if (has('etha')) s.push('site');
  s.push('pronto');
  return s;
}

// ---------- Estado do formulário (vem do servidor; nada de valores de exemplo) ----------
function initForm() {
  const p = S.profile || {}; const st = S.setup || {};
  const name = p.displayName || S.me?.user?.fullName || '';
  const addr = st.address || {};
  const byDay = {};
  for (const r of (st.rules || [])) { const h = Number(String(r.startTime).slice(0, 2)); (byDay[r.weekday] = byDay[r.weekday] || new Set()).add(h); }
  S.form = {
    displayName: name,
    crpOrCrm: p.crpOrCrm || '',
    specialty: p.specialty || 'Psicologia',
    photoUrl: p.photoUrl || '',
    modalities: new Set(st.modalities || p.modalities || ['online']),
    cep: addr.cep || '', street: addr.street || '', number: addr.number || '', complement: addr.complement || '', district: addr.district || '', city: addr.city || st.city || '', uf: addr.uf || '',
    duration: st.sessionDurationMin || p.sessionDurationMin || 50,
    price: st.sessionPriceCents ? Math.round(st.sessionPriceCents / 100) : '',
    days: new Set(Object.keys(byDay).map(Number)),
    hours: Object.fromEntries(Object.entries(byDay).map(([d, set]) => [d, set])),
    open: Boolean(st.open),
    meetUrl: p.onlineMeetingUrl || '',
  };
}

// ---------- Etapas ----------
const VIEWS = {
  voce() {
    const f = S.form;
    return { title: 'Primeiro, você', lead: 'Isso aparece no Ambo, no Minne e no seu site. Você muda quando quiser.', body: `
      <div class="cf-photo"><span class="cf-avatar" id="avatar" style="${f.photoUrl ? `background-image:url('${esc(f.photoUrl)}')` : ''}"></span>
        <div style="display:grid;gap:6px"><span class="cf-label">Sua foto</span><label class="eg-btn is-glass is-sm" style="cursor:pointer">${f.photoUrl ? 'Trocar foto' : 'Escolher foto'}<input type="file" accept="image/png,image/jpeg,image/webp" id="photo" hidden></label></div></div>
      <div class="cf-field"><label class="cf-label" for="f-name">Nome profissional</label><input class="cf-input" id="f-name" autocomplete="name" placeholder="Ex.: Dra. Helena Duarte" value="${esc(f.displayName)}"><span class="cf-hint" id="h-name"></span></div>
      <div class="cf-field"><label class="cf-label" for="f-crp">CRP ou CRM</label><input class="cf-input" id="f-crp" inputmode="text" autocomplete="off" placeholder="06/123456" value="${esc(f.crpOrCrm)}"><span class="cf-hint" id="h-crp"></span></div>
      <div class="cf-row" role="group" aria-label="Área">${['Psicologia', 'Psiquiatria'].map((s) => chip(`data-spec="${s}"`, s, f.specialty === s)).join('')}</div>` };
  },
  consultorio() {
    const f = S.form; const pres = f.modalities.has('presencial');
    return { title: 'Seu consultório', lead: 'Como você atende, onde e por quanto.', body: `
      <div class="cf-row" role="group" aria-label="Modalidade">${chip('data-mod="online"', 'Online', f.modalities.has('online'))}${chip('data-mod="presencial"', 'Presencial', pres)}</div>
      <div id="addr" ${pres ? '' : 'hidden'} style="display:${pres ? 'grid' : 'none'};gap:12px">
        <div class="cf-field cf-cep"><label class="cf-label" for="f-cep">CEP do consultório</label><input class="cf-input" id="f-cep" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" maxlength="9" value="${esc(f.cep)}"><span class="st" id="cep-st" aria-hidden="true"></span><span class="cf-hint" id="h-cep">Digite o CEP e a gente preenche o endereço.</span></div>
        <div class="cf-field"><label class="cf-label" for="f-street">Rua</label><input class="cf-input" id="f-street" autocomplete="address-line1" value="${esc(f.street)}"></div>
        <div class="cf-two"><div class="cf-field"><label class="cf-label" for="f-number">Número</label><input class="cf-input" id="f-number" inputmode="numeric" value="${esc(f.number)}"></div>
          <div class="cf-field"><label class="cf-label" for="f-comp">Sala <span class="muted">(opcional)</span></label><input class="cf-input" id="f-comp" value="${esc(f.complement)}"></div></div>
        <div class="cf-two"><div class="cf-field"><label class="cf-label" for="f-district">Bairro</label><input class="cf-input" id="f-district" value="${esc(f.district)}"></div>
          <div class="cf-field"><label class="cf-label" for="f-city">Cidade</label><input class="cf-input" id="f-city" value="${esc(f.city ? f.city + (f.uf ? ', ' + f.uf : '') : '')}"></div></div>
      </div>
      <div id="meet" ${f.modalities.has('online') ? '' : 'hidden'} style="display:${f.modalities.has('online') ? 'grid' : 'none'};gap:12px">
        <div class="cf-field"><label class="cf-label" for="f-meet">Link da sua sala online <span class="muted">(opcional)</span></label><input class="cf-input" id="f-meet" type="url" inputmode="url" autocomplete="off" placeholder="meet.google.com/abc-defg-hij" value="${esc(f.meetUrl)}"><span class="cf-hint" id="h-meet">Use o link fixo do seu Google Meet, Zoom ou Jitsi. O paciente vê no Ambo 15 minutos antes de cada consulta online.</span></div>
      </div>
      <span class="cf-label">Duração da sessão</span>
      <div class="cf-row" role="group" aria-label="Duração">${[30, 45, 50, 60].map((d) => chip(`data-dur="${d}"`, `${d} min`, Number(f.duration) === d)).join('')}</div>
      <div class="cf-field"><label class="cf-label" for="f-price">Valor da sessão (R$)</label><input class="cf-input" id="f-price" inputmode="numeric" placeholder="Ex.: 220" value="${esc(f.price)}"><span class="cf-hint" id="h-price"></span></div>` };
  },
  horarios() {
    const f = S.form;
    const full = (d) => HOURS.every((h) => f.hours[d] && f.hours[d].has(h));
    const dayRows = DAYS.map(([d, n]) => `<div class="cf-day" data-dayrow="${d}" ${f.days.has(d) ? '' : 'hidden'}><button type="button" class="cf-dayall" data-dayall="${d}" aria-pressed="${full(d)}"><b>${n}</b><span>${full(d) ? 'Dia inteiro marcado' : 'Toque para marcar o dia inteiro'}</span></button><div class="cf-row">${HOURS.map((h) => chip(`data-hour="${h}" data-d="${d}"`, `${h}h`, Boolean(f.hours[d] && f.hours[d].has(h)), 'is-sm')).join('')}</div></div>`).join('');
    return { title: 'Seus horários', lead: `Toque nos dias e escolha a hora de início de cada sessão de ${f.duration} min. O paciente só vê o que você liberar.`, body: `
      <div class="cf-row" role="group" aria-label="Dias">${DAYS.map(([d, n]) => chip(`data-day="${d}"`, n, f.days.has(d))).join('')}</div>
      ${dayRows}
      <button type="button" class="cf-skip" id="copy-hours" style="justify-self:start">Repetir os horários do primeiro dia nos outros</button>
      <span class="cf-hint" id="h-hours"></span>
      ${blocksHtml()}` };
  },
  link() {
    const url = `${ORIGIN.ambo}/?pro=${encodeURIComponent(S.me?.account?.slug || '')}`;
    const total = Object.values(S.form.hours).reduce((n, s) => n + s.size, 0);
    const mods = [...S.form.modalities].map((m) => (m === 'online' ? 'online' : 'presencial')).join(' e ');
    return { title: 'Seu link do Ambo', lead: 'É por aqui que o paciente pede consulta. Compartilhe no WhatsApp ou no Instagram.', body: `
      <div class="cf-link eg-surface"><code>${esc(url.replace(/^https?:\/\//, ''))}</code><button type="button" class="eg-btn is-glass is-sm" id="copy" data-url="${esc(url)}">Copiar</button></div>
      <div class="cf-row"><a class="eg-btn is-glass is-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Agende sua consulta comigo: ' + url)}">WhatsApp</a><a class="eg-btn is-glass is-sm" target="_blank" rel="noopener" href="${esc(url)}&visao=profissional">Ver como o paciente vê ↗</a></div>
      ${S.form.open ? '<p class="cf-ok">✓ Sua agenda está aberta para pedidos.</p>' : `<p class="cf-ok">✓ Pronto para abrir: ${total} ${total === 1 ? 'horário' : 'horários'} na semana, ${esc(mods)}, ${S.form.price ? 'R$ ' + esc(S.form.price) : 'valor a combinar'}.</p>`}
      <p class="muted small">${has('minne') ? 'Os pedidos chegam no Ambo, na aba Pedidos, e quando você confirma o paciente entra no Minne.' : 'Os pedidos chegam no próprio Ambo, na aba Pedidos, e você confirma por lá.'}</p>` };
  },
  pacientes() {
    return { title: 'Seus pacientes', lead: 'Traga quem você já atende. Cada pedido confirmado no Ambo também vira paciente aqui.', body: `
      <button type="button" class="eg-btn is-glass" data-launch="minne" data-path="/?modo=ao-vivo&aba=importar">Importar planilha ou prontuários</button>
      <span class="cf-label">Ou adicione um por um</span>
      <div class="cf-field"><label class="cf-label" for="p-name">Nome do paciente</label><input class="cf-input" id="p-name" autocomplete="off" placeholder="Nome completo"></div>
      <div class="cf-field"><label class="cf-label" for="p-phone">WhatsApp <span class="muted">(opcional)</span></label><input class="cf-input" id="p-phone" inputmode="tel" autocomplete="off" placeholder="(11) 9 0000-0000"></div>
      <button type="button" class="eg-btn is-glass" id="add-patient" style="justify-self:start">Adicionar paciente</button>
      <div class="cf-list" id="plist">${S.patients.map((p) => `<div><span>${esc(p.full_name)}</span><span class="muted">${esc(p.phone || '')}</span></div>`).join('')}</div>` };
  },
  site() {
    return { title: 'Seu site', lead: 'Você responde algumas perguntas e envia suas fotos. A gente monta o site no modelo da Etha com as suas informações.', body: `
      <p>Já preenchemos com o que você contou aqui: nome, CRP, foto${has('ambo') ? ', atendimento e endereço' : ''}. Faltam a sua abordagem, para quem você atende e a frase de abertura.</p>
      <button type="button" class="eg-btn" data-launch="etha" data-path="/?modo=ao-vivo">Responder as perguntas do site</button>
      <p class="muted small">Abre a Etha numa nova aba. Quando terminar, volte aqui para concluir.</p>` };
  },
  hub() {
    const rows = S.steps.filter((k) => k !== 'pronto').map((k) => {
      const done = isDone(k); const opt = !REQUIRED.includes(k);
      return `<button type="button" class="cf-hubrow eg-surface" data-edit="${k}" data-produto="${STEP_DEFS[k].prod}"><span class="dot" aria-hidden="true"></span><span class="cf-hubtxt"><b>${STEP_DEFS[k].label}</b><span>${esc(summary(k))}</span></span><span class="cf-hubst ${done ? 'ok' : 'todo'}">${opt ? 'Abrir' : done ? '✓' : 'Falta'}</span><svg class="cf-hubgo" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>`;
    }).join('');
    const left = missing();
    return { title: 'Suas configurações', lead: left.length ? `Falta ${left.length === 1 ? '1 item' : left.length + ' itens'} para tudo funcionar. O resto já está salvo.` : 'Está tudo configurado. Toque num item para mudar.', body: `<div class="cf-hub">${rows}</div>` };
  },
  pronto() {
    const name = (S.form.displayName || '').split(' ').filter((w) => !/^dr[a]?\.?$/i.test(w))[0] || '';
    const rows = [];
    if (has('ambo')) rows.push(['ambo', 'Ambo', S.form.open ? 'Agenda aberta · link pronto' : 'Agenda configurada, ainda fechada', '/operacao']);
    if (has('minne')) rows.push(['minne', 'Minne', 'Pacientes, agenda e prontuário', '/?modo=ao-vivo']);
    if (has('etha')) rows.push(['etha', 'Etha', 'Seu site', '/?modo=ao-vivo']);
    return { title: `Tudo pronto${name ? ', ' + esc(name) : ''}`, lead: rows.length > 1 ? 'Seus serviços estão configurados e conversando entre si.' : 'Seu serviço está configurado.', body: rows.map(([k, n, t, path]) => `
      <div class="cf-sum eg-surface" data-produto="${k}"><span class="dot" aria-hidden="true"></span><div><b>${n}</b><span>${esc(t)}</span></div><button type="button" class="eg-btn is-glass is-sm" data-launch="${k}" data-path="${path}">Abrir</button></div>`).join('') };
  },
};

// ---------- Render e transição (só a etapa entra; topo e barra ficam parados) ----------
function paint() {
  const key = S.view; const prod = STEP_DEFS[key].prod;
  const hub = S.mode === 'hub'; const edit = S.mode === 'edit';
  document.body.setAttribute('data-produto', prod);
  document.body.setAttribute('data-mode', S.mode);
  document.getElementById('pill').textContent = prod.toUpperCase();
  document.getElementById('count').textContent = hub ? (missing().length ? 'Quase lá' : 'Tudo configurado') : edit ? `Configurações · ${STEP_DEFS[key].label}` : `Etapa ${S.i + 1} de ${S.steps.length} · ${STEP_DEFS[key].label}`;
  const later = document.getElementById('later'); if (later) later.textContent = hub || edit ? 'Voltar ao portal' : 'Terminar depois';
  const bar = document.getElementById('bar');
  if (bar.children.length !== S.steps.length) bar.innerHTML = S.steps.map((k) => `<i style="--seg:${COLOR[STEP_DEFS[k].prod]}"></i>`).join('');
  [...bar.children].forEach((el, k) => el.classList.toggle('on', hub || edit ? isDone(S.steps[k]) : k <= S.i));
  backBtn.hidden = hub || (!edit && S.i === 0);
  backBtn.textContent = edit ? 'Cancelar' : 'Voltar';
  nextBtn.textContent = hub ? 'Ir para o portal' : edit ? 'Salvar' : key === 'pronto' ? 'Ir para o portal' : key === 'link' ? (S.form.open ? 'Continuar' : 'Abrir agenda') : key === 'site' ? 'Já respondi, continuar' : 'Continuar';
  // Abrir a agenda é um compromisso com pacientes: vira um gesto de deslizar (padrao-ux-motion §20).
  const slideMode = !hub && key === 'link' && !S.form.open && Boolean(window.EnoSlide);
  let slot = document.getElementById('dock-slide');
  if (slideMode && !slot) {
    slot = document.createElement('div'); slot.id = 'dock-slide';
    nextBtn.after(slot);
    window.EnoSlide.mount(slot, { label: 'Deslize para abrir', busyLabel: 'Abrindo…', doneLabel: 'Agenda aberta', onConfirm: async () => {
      const ok = await save('link');
      if (ok) setTimeout(() => { if (S.mode === 'edit') showHub('prev', 'link'); else show(S.i + 1, 'next'); }, 900);
      return ok;
    } });
  }
  nextBtn.hidden = slideMode;
  if (slot) slot.hidden = !slideMode;
  if (slot && !slideMode && S.form.open) slot.remove();
}
function stepHtml(key) {
  const v = VIEWS[key]();
  return `<section class="cf-step" data-step="${key}"><h1 tabindex="-1">${v.title}</h1><p class="lead">${v.lead}</p><div class="cf-card eg-surface">${v.body}</div>${S.mode === 'wizard' && ['pacientes', 'site'].includes(key) ? '<button type="button" class="cf-skip" data-skip style="justify-self:start">Pular por agora</button>' : ''}</section>`;
}
function show(k, dir) {
  const old = stage.firstElementChild;
  const h0 = stage.offsetHeight;
  const key = typeof k === 'string' ? k : S.steps[k];
  if (typeof k === 'number') S.i = k;
  S.view = key;
  const tmp = document.createElement('div'); tmp.innerHTML = stepHtml(key); const nu = tmp.firstElementChild;
  if (!old || reduce() || !dir) { stage.innerHTML = ''; stage.appendChild(nu); }
  else {
    old.classList.add(`out-${dir}`); stage.appendChild(nu); nu.classList.add(`in-${dir}`);
    const h1 = nu.offsetHeight; if (stage.animate && Math.abs(h1 - h0) > 1) stage.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' });
    setTimeout(() => old.remove(), 170);
  }
  paint(); wire(nu);
  if (key === 'pronto' && dir && !reduce()) flyDots(nu);
  if (dir) { nu.querySelector('h1').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }); }
  try { history.replaceState(null, '', key === 'hub' ? location.pathname : `?etapa=${key}`); } catch {}
}
function showHub(dir, savedKey) {
  S.mode = 'hub'; show('hub', dir);
  if (!savedKey) return;
  const row = stage.querySelector(`.cf-step:last-child [data-edit="${savedKey}"]`);
  if (row) { row.classList.add('is-saved'); setTimeout(() => row.classList.remove('is-saved'), 1400); }
  toast({ title: 'Salvo', text: STEP_DEFS[savedKey].label.toLowerCase() + ' atualizado' });
}
function openEdit(key) { S.mode = 'edit'; show(S.steps.indexOf(key), 'next'); }

// Pronto: cada ponto de produto sai do seu trecho da barra de progresso e pousa na linha dele.
function flyDots(root) {
  const segs = [...document.getElementById('bar').children];
  root.querySelectorAll('.cf-sum').forEach((row, n) => {
    const prod = row.dataset.produto; const dot = row.querySelector('.dot');
    const seg = segs[S.steps.findIndex((s) => STEP_DEFS[s].prod === prod)]; if (!dot || !seg) return;
    requestAnimationFrame(() => {
      const a = seg.getBoundingClientRect(); const b = dot.getBoundingClientRect();
      dot.animate([
        { transform: `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(.18)`, opacity: .6 },
        { opacity: 1, offset: .3 },
        { transform: 'none', opacity: 1 },
      ], { duration: 720, delay: 160 + n * 110, easing: 'linear(0, .009, .035 2.1%, .141 4.4%, .723 12.9%, .938 16.7%, 1.017 20.4%, 1.041 24.6%, 1.035 28.5%, 1.004 38.3%, .997 46.7%, 1)', fill: 'backwards' });
    });
  });
}

// ---------- Interações: cada toque muda só o próprio elemento ----------
function toggle(btn, on) { btn.setAttribute('aria-pressed', String(on)); }
function wire(root) {
  const f = S.form;
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
  root.querySelectorAll('[data-spec]').forEach((b) => b.addEventListener('click', () => { f.specialty = b.dataset.spec; root.querySelectorAll('[data-spec]').forEach((x) => toggle(x, x === b)); }));
  root.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', () => {
    const m = b.dataset.mod; const on = !f.modalities.has(m);
    if (!on && f.modalities.size === 1) { window.EnoFeedback?.flash(b.parentElement); return; }
    on ? f.modalities.add(m) : f.modalities.delete(m); toggle(b, on);
    if (m === 'presencial') revealAddr(root.querySelector('#addr'), on);
    if (m === 'online') revealAddr(root.querySelector('#meet'), on, '#f-meet');
  }));
  root.querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => { f.duration = Number(b.dataset.dur); root.querySelectorAll('[data-dur]').forEach((x) => toggle(x, x === b)); }));
  root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.day); const on = !f.days.has(d); on ? f.days.add(d) : f.days.delete(d); toggle(b, on);
    revealRow(root.querySelector(`[data-dayrow="${d}"]`), on);
  }));
  root.querySelectorAll('[data-hour]').forEach((b) => b.addEventListener('click', () => {
    const d = b.dataset.d; const h = Number(b.dataset.hour); const set = f.hours[d] || (f.hours[d] = new Set());
    const on = !set.has(h); on ? set.add(h) : set.delete(h); toggle(b, on);
    syncDayAll(root, d);
  }));
  // Como no Google Fotos: tocar no dia marca (ou desmarca) todas as horas dele, em cascata.
  root.querySelectorAll('[data-dayall]').forEach((b) => b.addEventListener('click', () => {
    const d = b.dataset.dayall; const set = f.hours[d] || (f.hours[d] = new Set());
    const on = !HOURS.every((h) => set.has(h));
    HOURS.forEach((h) => (on ? set.add(h) : set.delete(h)));
    root.querySelectorAll(`[data-hour][data-d="${d}"]`).forEach((x, i) => {
      if (reduce()) { toggle(x, on); return; }
      setTimeout(() => { toggle(x, on); x.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.04)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' }); }, i * 18);
    });
    syncDayAll(root, d);
  }));
  wireBlocks(root);
  const copy = root.querySelector('#copy-hours');
  if (copy) copy.addEventListener('click', () => {
    const order = DAYS.map(([d]) => d).filter((d) => f.days.has(d)); if (order.length < 2) return;
    const src = f.hours[order[0]] || new Set();
    order.slice(1).forEach((d) => { f.hours[d] = new Set(src); root.querySelectorAll(`[data-hour][data-d="${d}"]`).forEach((x) => toggle(x, src.has(Number(x.dataset.hour)))); });
    toast({ title: 'Horários repetidos', text: `${order.length - 1} ${order.length - 1 === 1 ? 'dia' : 'dias'}` });
  });
  const photo = root.querySelector('#photo');
  if (photo) photo.addEventListener('change', () => { const file = photo.files[0]; photo.value = ''; if (file) openCropper(file, root); });
  const cep = root.querySelector('#f-cep');
  if (cep) cep.addEventListener('input', () => { let v = cep.value.replace(/\D/g, '').slice(0, 8); if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5); cep.value = v; if (v.length === 9) lookupCep(v, root); });
  const cp = root.querySelector('#copy');
  if (cp) cp.addEventListener('click', async () => { try { await navigator.clipboard.writeText(cp.dataset.url); window.EnoFeedback?.done(cp, 'Copiado'); } catch { toast({ tone: 'warn', text: 'Não deu para copiar. Toque e segure o link.' }); } });
  const add = root.querySelector('#add-patient');
  if (add) add.addEventListener('click', () => addPatient(root, add));
  root.querySelectorAll('[data-launch]').forEach((b) => b.addEventListener('click', () => launch(b.dataset.launch, b.dataset.path)));
  root.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', () => go(+1, true)));
  root.querySelectorAll('.cf-input').forEach((i) => i.addEventListener('input', () => { if (i.getAttribute('aria-invalid') === 'true') { i.removeAttribute('aria-invalid'); const h = root.querySelector('#h-' + i.id.slice(2)); if (h) { h.textContent = ''; h.className = 'cf-hint'; } } }));
}
function syncDayAll(root, d) {
  const b = root.querySelector(`[data-dayall="${d}"]`); if (!b) return;
  const on = HOURS.every((h) => S.form.hours[d] && S.form.hours[d].has(h));
  if (b.getAttribute('aria-pressed') === String(on)) return;
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('span').textContent = on ? 'Dia inteiro marcado' : 'Toque para marcar o dia inteiro';
}
function revealAddr(el, on, focusSel = '#f-cep') {
  if (!el) return;
  if (reduce()) { el.style.display = on ? 'grid' : 'none'; el.hidden = !on; return; }
  if (on) { el.hidden = false; el.style.display = 'grid'; el.animate([{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' }); setTimeout(() => el.querySelector(focusSel)?.focus({ preventScroll: true }), 60); }
  else { const a = el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 160, easing: 'cubic-bezier(.23,1,.32,1)' }); a.onfinish = () => { el.hidden = true; el.style.display = 'none'; }; }
}
function revealRow(el, on) {
  if (!el) return;
  if (reduce()) { el.hidden = !on; return; }
  if (on) { el.hidden = false; el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' }); }
  else { const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }); a.onfinish = () => { el.hidden = true; }; }
}

async function lookupCep(v, root) {
  const st = root.querySelector('#cep-st'); const h = root.querySelector('#h-cep');
  st.innerHTML = '<span class="pl-spin" style="color:rgb(var(--eg-c))"></span>'; h.className = 'cf-hint'; h.textContent = 'Procurando o endereço…';
  try {
    const r = await fetch(`https://viacep.com.br/ws/${v.replace('-', '')}/json/`);
    const d = await r.json();
    if (d.erro) throw new Error('nf');
    const fill = (id, val) => { const i = root.querySelector(id); if (i && val) { i.value = val; i.classList.remove('cf-filled'); void i.offsetWidth; i.classList.add('cf-filled'); } };
    fill('#f-street', d.logradouro); fill('#f-district', d.bairro); fill('#f-city', d.localidade + (d.uf ? ', ' + d.uf : ''));
    S.form.uf = d.uf || '';
    st.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="9" fill="#1b653e"/><path d="M6 10.3l2.6 2.5L14 7.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    h.className = 'cf-hint ok'; h.textContent = `Encontramos: ${[d.logradouro, d.bairro, d.localidade + '/' + d.uf].filter(Boolean).join(' · ')}`;
    root.querySelector(d.logradouro ? '#f-number' : '#f-street')?.focus();
  } catch {
    st.innerHTML = ''; h.className = 'cf-hint bad'; h.textContent = 'Não achamos esse CEP. Confira os números ou preencha o endereço abaixo.';
  }
}

async function uploadPhoto(blob, root) {
  if (!blob) return;
  const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob); });
  const av = root.querySelector('#avatar'); av.style.backgroundImage = `url('${URL.createObjectURL(blob)}')`; av.animate?.([{ transform: 'scale(.9)', filter: 'blur(4px)' }, { transform: 'none', filter: 'none' }], { duration: 320, easing: 'cubic-bezier(.23,1,.32,1)' });
  const lbl = root.querySelector('label.eg-btn'); if (lbl && lbl.firstChild) lbl.firstChild.textContent = 'Trocar foto';
  const r = await api('/api/v1/professional/profile/photo', { method: 'POST', body: { contentBase64: b64, originalName: 'foto.jpg' } });
  if (!r.ok) { toast({ tone: 'err', text: r.data.error || 'Não deu para salvar a foto.' }); return; }
  S.form.photoUrl = r.data.photoUrl || S.form.photoUrl;
  toast({ title: 'Foto salva', text: 'aparece em todos os serviços' });
}

async function addPatient(root, btn) {
  const n = root.querySelector('#p-name'); const ph = root.querySelector('#p-phone');
  if (n.value.trim().length < 2) { n.setAttribute('aria-invalid', 'true'); n.focus(); return; }
  btn.setAttribute('aria-busy', 'true');
  const r = await api('/api/v1/minne/patients', { method: 'POST', body: { fullName: n.value.trim(), phone: ph.value.trim(), preferredContact: ph.value.trim() ? 'whatsapp' : 'email' } });
  btn.removeAttribute('aria-busy');
  if (!r.ok) { toast({ tone: 'err', text: r.data.error || 'Não deu para adicionar agora.' }); return; }
  S.patients.push(r.data.patient);
  const row = document.createElement('div'); row.innerHTML = `<span>${esc(r.data.patient.full_name)}</span><span class="muted">${esc(r.data.patient.phone || '')}</span>`;
  root.querySelector('#plist').appendChild(row); row.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
  window.EnoFeedback?.done(btn, 'Adicionado'); n.value = ''; ph.value = ''; n.focus();
}

async function launch(app, path) {
  const origin = ORIGIN[app]; if (!origin) return;
  const w = window.open('about:blank', '_blank');
  const r = await api('/api/v1/auth/handoff', { method: 'POST', body: { targetOrigin: origin, returnPath: path || '/' } });
  const sep = (path || '/').includes('?') ? '&' : '?';
  const url = r.ok ? `${origin}${path || '/'}${sep}handoff=${encodeURIComponent(r.data.handoffCode)}` : origin + (path || '/');
  if (w) w.location.href = url; else location.href = url;
}

// ---------- Folgas e férias (calendário próprio em vidro, sem campo nativo) ----------
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const REASONS = ['Férias', 'Folga', 'Supervisão', 'Compromisso'];
function fmtBlock(b) {
  const d = (v) => { const [y, m, dd] = String(v).slice(0, 10).split('-'); return `${Number(dd)} ${MES[Number(m) - 1]}`; };
  const t = (v) => String(v).slice(11, 16);
  const sd = String(b.startAt).slice(0, 10), ed = String(b.endAt).slice(0, 10);
  const allDay = t(b.startAt) === '00:00' && t(b.endAt) >= '23:59';
  const days = sd === ed ? d(sd) : `${d(sd)} a ${d(ed)}`;
  return `${esc(b.reason || 'Folga')} · ${days}${allDay ? '' : `, ${t(b.startAt)} às ${t(b.endAt)}`}`;
}
function blockRow(b, i) { return `<div data-bi="${i}"><span>${fmtBlock(b)}</span><button type="button" class="cf-x" data-bdel="${i}" aria-label="Remover ${esc(b.reason || 'folga')}">×</button></div>`; }
function blocksHtml() {
  const hourChips = (attr, from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k).map((h) => chip(`${attr}="${h}"`, `${h}h`, false, 'is-sm')).join('');
  return `
    <section class="cf-blocks">
      <div class="cf-blocks-head"><div><span class="cf-label">Folgas e férias</span><span class="cf-hint" style="display:block">Dias em que o Ambo não oferece horário.</span></div>
        <button type="button" class="eg-btn is-glass is-sm" id="b-new">Adicionar</button></div>
      <div class="cf-list" id="b-list">${(S.blocks || []).map(blockRow).join('')}</div>
      <div class="cf-bnew" id="b-panel" hidden>
        <div id="b-cal"></div>
        <p class="cf-hint" id="b-range">Toque no primeiro dia. Para um período, toque também no último.</p>
        <div class="cf-row">${chip('id="b-all"', 'Dia inteiro', true)}</div>
        <div id="b-hours" hidden style="display:none;gap:10px">
          <span class="cf-label">Das</span><div class="cf-row">${hourChips('data-bfrom', 7, 20)}</div>
          <span class="cf-label">Até</span><div class="cf-row">${hourChips('data-bto', 8, 22)}</div>
        </div>
        <span class="cf-label">Motivo</span>
        <div class="cf-row">${REASONS.map((r, i) => chip(`data-breason="${r}"`, r, i === 0)).join('')}</div>
        <div class="cf-row"><button type="button" class="eg-btn is-sm" id="b-save">Salvar folga</button><button type="button" class="eg-btn is-glass is-sm" id="b-cancel">Cancelar</button></div>
      </div>
    </section>`;
}
async function putBlocks() {
  const r = await api('/api/v1/professional/availability', { method: 'PUT', body: { blocks: S.blocks } });
  if (!r.ok) toast({ tone: 'err', text: r.data.error || 'Não deu para salvar a folga agora.' });
  return r.ok;
}
function wireBlocks(root) {
  const panel = root.querySelector('#b-panel'); if (!panel) return;
  const B = { start: '', end: '', all: true, from: null, to: null, reason: REASONS[0] };
  let cal = null;
  const rangeHint = root.querySelector('#b-range');
  const open = (on) => {
    if (on && !cal && window.EnoCalendar) {
      cal = window.EnoCalendar.mount(root.querySelector('#b-cal'), { mode: 'range', onChange: (v) => {
        B.start = v.start; B.end = v.end;
        rangeHint.className = 'cf-hint ok';
        rangeHint.textContent = v.start === v.end ? `${window.EnoCalendar.label(v.start)}. Toque em outro dia para virar um período.` : `De ${window.EnoCalendar.label(v.start)} até ${window.EnoCalendar.label(v.end)}.`;
      } });
    }
    revealRow(panel, on);
    root.querySelector('#b-new').hidden = on;
  };
  root.querySelector('#b-new').addEventListener('click', () => open(true));
  root.querySelector('#b-cancel').addEventListener('click', () => open(false));
  root.querySelector('#b-all').addEventListener('click', (e) => {
    B.all = !B.all; toggle(e.currentTarget, B.all);
    revealAddr(root.querySelector('#b-hours'), !B.all);
  });
  const single = (attr, key) => root.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', () => {
    B[key] = key === 'reason' ? b.getAttribute(attr) : Number(b.getAttribute(attr));
    root.querySelectorAll(`[${attr}]`).forEach((x) => toggle(x, x === b));
  }));
  single('data-bfrom', 'from'); single('data-bto', 'to'); single('data-breason', 'reason');
  root.querySelector('#b-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!B.start) { rangeHint.className = 'cf-hint bad'; rangeHint.textContent = 'Escolha o dia da folga no calendário.'; window.EnoFeedback?.flash(root.querySelector('#b-cal')); return; }
    if (!B.all && (B.from == null || B.to == null || B.to <= B.from)) { rangeHint.className = 'cf-hint bad'; rangeHint.textContent = 'Escolha o horário de início e um fim depois dele.'; return; }
    const hh = (h) => `${String(h).padStart(2, '0')}:00`;
    const block = { startAt: `${B.start}T${B.all ? '00:00' : hh(B.from)}:00-03:00`, endAt: `${B.end || B.start}T${B.all ? '23:59' : hh(B.to)}:00-03:00`, reason: B.reason };
    btn.setAttribute('aria-busy', 'true');
    S.blocks.push(block);
    const ok = await putBlocks();
    btn.removeAttribute('aria-busy');
    if (!ok) { S.blocks.pop(); return; }
    const list = root.querySelector('#b-list');
    list.insertAdjacentHTML('beforeend', blockRow(block, S.blocks.length - 1));
    list.lastElementChild.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' });
    toast({ title: 'Folga salva', text: 'esses horários somem do Ambo' });
    B.start = ''; B.end = ''; cal?.set({ start: '' }); rangeHint.className = 'cf-hint'; rangeHint.textContent = 'Toque no primeiro dia. Para um período, toque também no último.';
    open(false);
  });
  // Remover com Desfazer, sem "tem certeza?".
  root.querySelector('#b-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-bdel]'); if (!del) return;
    const i = Number(del.dataset.bdel); const removed = S.blocks[i]; const row = del.parentElement;
    S.blocks.splice(i, 1);
    const repaint = () => { const list = root.querySelector('#b-list'); list.innerHTML = S.blocks.map(blockRow).join(''); };
    const a = row.animate?.([{ opacity: 1 }, { opacity: 0, transform: 'translateX(-12px)' }], { duration: 160, easing: 'cubic-bezier(.23,1,.32,1)' });
    if (a) a.onfinish = repaint; else repaint();
    if (!(await putBlocks())) { S.blocks.splice(i, 0, removed); repaint(); return; }
    toast({ title: 'Folga removida', action: { label: 'Desfazer', onClick: async () => { S.blocks.splice(i, 0, removed); repaint(); await putBlocks(); } } });
  });
}

// ---------- Foto: recorte em círculo, como no Minne (arrastar, zoom e pinça) ----------
function openCropper(file, root) {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast({ tone: 'warn', text: 'Use uma foto em JPG, PNG ou WebP.' }); return; }
  const url = URL.createObjectURL(file);
  const wrap = document.createElement('div');
  wrap.className = 'cf-crop';
  wrap.innerHTML = `<div class="cf-crop-panel eg-surface" role="dialog" aria-modal="true" aria-labelledby="crop-t">
      <h2 id="crop-t" style="margin:0;font-size:20px">Ajustar foto</h2>
      <p class="cf-hint" style="margin:0">Arraste para enquadrar. Use o controle ou dois dedos para aproximar.</p>
      <div class="cf-crop-stage"><img alt="" draggable="false"><i class="cf-crop-ring" aria-hidden="true"></i></div>
      <label class="cf-zoom"><span aria-hidden="true">−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Aproximar"><span aria-hidden="true">+</span></label>
      <div class="cf-row" style="justify-content:flex-end"><button type="button" class="eg-btn is-glass is-sm" data-c="no">Cancelar</button><button type="button" class="eg-btn is-sm" data-c="ok">Aplicar</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const img = wrap.querySelector('img'); const stageEl = wrap.querySelector('.cf-crop-stage'); const range = wrap.querySelector('input');
  const C = () => stageEl.clientWidth;
  const st = { x: 0, y: 0, z: 1, w: 0, h: 0 };
  const scale = () => Math.max(C() / st.w, C() / st.h) * st.z;
  const clamp = () => { const s = scale(); const mx = Math.max(0, (st.w * s - C()) / 2); const my = Math.max(0, (st.h * s - C()) / 2); st.x = Math.min(mx, Math.max(-mx, st.x)); st.y = Math.min(my, Math.max(-my, st.y)); };
  const paint = () => { clamp(); const s = scale(); img.style.width = `${st.w * s}px`; img.style.height = `${st.h * s}px`; img.style.transform = `translate(calc(-50% + ${st.x}px), calc(-50% + ${st.y}px))`; };
  img.onload = () => { st.w = img.naturalWidth; st.h = img.naturalHeight; paint(); };
  img.src = url;
  if (!reduce()) { wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'linear' }); wrap.firstElementChild.animate([{ opacity: 0, transform: 'scale(.96) translateY(8px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 320, easing: 'cubic-bezier(.23,1,.32,1)' }); }
  const pts = new Map(); let pinch0 = null;
  stageEl.addEventListener('pointerdown', (e) => { stageEl.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: st.z }; } });
  stageEl.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 2 && pinch0) { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [a, b] = [...pts.values()]; st.z = Math.min(4, Math.max(1, pinch0.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d)); range.value = st.z; paint(); return; }
    st.x += e.clientX - p.x; st.y += e.clientY - p.y; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); paint();
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; };
  stageEl.addEventListener('pointerup', up); stageEl.addEventListener('pointercancel', up);
  stageEl.addEventListener('wheel', (e) => { e.preventDefault(); st.z = Math.min(4, Math.max(1, st.z * (e.deltaY < 0 ? 1.08 : 0.93))); range.value = st.z; paint(); }, { passive: false });
  range.addEventListener('input', () => { st.z = Number(range.value); paint(); });
  const close = () => {
    document.removeEventListener('keydown', onKey);
    const done = () => { wrap.remove(); URL.revokeObjectURL(url); };
    if (reduce()) { done(); return; }
    wrap.firstElementChild.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { duration: 160, easing: 'cubic-bezier(.23,1,.32,1)' });
    wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).onfinish = done;
  };
  const apply = () => {
    const out = 512; const k = out / C(); const s = scale();
    const cv = document.createElement('canvas'); cv.width = out; cv.height = out;
    const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (C() / 2 + st.x - st.w * s / 2) * k, (C() / 2 + st.y - st.h * s / 2) * k, st.w * s * k, st.h * s * k);
    cv.toBlob((blob) => { close(); uploadPhoto(blob, root); }, 'image/jpeg', 0.9);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); const b = e.target.closest('[data-c]'); if (b) (b.dataset.c === 'ok' ? apply() : close()); });
  setTimeout(() => wrap.querySelector('[data-c="ok"]').focus({ preventScroll: true }), 50);
}

// ---------- Salvar ao avançar ----------
function invalid(id, msg) { const i = stage.querySelector('#' + id); const h = stage.querySelector('#h-' + id.slice(2)); if (i) { i.setAttribute('aria-invalid', 'true'); i.focus(); } if (h) { h.className = 'cf-hint bad'; h.textContent = msg; } return false; }
async function save(key) {
  const f = S.form; const q = (id) => stage.querySelector(id)?.value?.trim() ?? '';
  if (key === 'voce') {
    f.displayName = q('#f-name'); f.crpOrCrm = q('#f-crp');
    if (f.displayName.length < 3) return invalid('f-name', 'Escreva seu nome como os pacientes conhecem.');
    const r = await api('/api/v1/professional/profile', { method: 'PATCH', body: { displayName: f.displayName, crpOrCrm: f.crpOrCrm, specialty: f.specialty } });
    if (!r.ok) { toast({ tone: 'err', text: r.data.error || 'Não deu para salvar agora.' }); return false; }
    return true;
  }
  if (key === 'consultorio') {
    const pres = f.modalities.has('presencial');
    const cityRaw = q('#f-city'); const [city, uf] = cityRaw.split(',').map((s) => s.trim());
    Object.assign(f, { cep: q('#f-cep'), street: q('#f-street'), number: q('#f-number'), complement: q('#f-comp'), district: q('#f-district'), city: city || '', uf: uf || f.uf });
    const priceStr = q('#f-price').replace(/[^\d]/g, ''); f.price = priceStr;
    if (pres && (!f.street || !f.number)) return invalid(f.street ? 'f-number' : (f.cep ? 'f-street' : 'f-cep'), 'Precisamos do endereço completo para quem vai ao consultório.');
    if (!priceStr) return invalid('f-price', 'Informe o valor. Se for a combinar, digite 0.');
    let meet = q('#f-meet');
    if (meet && !/^https?:\/\//i.test(meet)) meet = 'https://' + meet;
    if (meet && !/^https:\/\/[^\s.]+\.[^\s]{2,}/i.test(meet)) return invalid('f-meet', 'Cole o endereço completo da sala, como meet.google.com/abc-defg-hij.');
    if (f.modalities.has('online') && meet !== (f.meetUrl || '')) {
      const pr = await api('/api/v1/professional/profile', { method: 'PATCH', body: { onlineMeetingUrl: meet } });
      if (!pr.ok) { toast({ tone: 'err', text: pr.data.error || 'Não deu para salvar o link da sala agora.' }); return false; }
      f.meetUrl = meet;
    }
    const address = pres ? { cep: f.cep, street: f.street, number: f.number, complement: f.complement, district: f.district, city: f.city, uf: f.uf } : null;
    const line = pres ? `${f.street}, ${f.number}${f.complement ? ' · ' + f.complement : ''} · ${f.district ? f.district + ' · ' : ''}${f.city}${f.uf ? '/' + f.uf : ''}` : '';
    const r = await api('/api/v1/ambo/pro/setup', { method: 'PUT', body: { modalities: [...f.modalities], address, inPersonAddress: line, city: f.city || (pres ? '' : 'Online'), sessionDurationMin: f.duration, sessionPriceCents: Number(priceStr) * 100 } });
    if (!r.ok) { toast({ tone: 'err', text: r.data.error || 'Não deu para salvar agora.' }); return false; }
    S.setup = { ...(S.setup || {}), sessionPriceCents: Number(priceStr) * 100, modalities: [...f.modalities] };
    return true;
  }
  if (key === 'horarios') {
    const rules = [];
    for (const d of f.days) for (const h of (f.hours[d] || [])) {
      const end = h * 60 + Number(f.duration); if (end >= 24 * 60) continue;
      rules.push({ weekday: Number(d), startTime: `${String(h).padStart(2, '0')}:00`, endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`, modality: 'both' });
    }
    if (!rules.length) { const h = stage.querySelector('#h-hours'); h.className = 'cf-hint bad'; h.textContent = 'Escolha ao menos um dia e um horário.'; return false; }
    const r = await api('/api/v1/ambo/pro/setup', { method: 'PUT', body: { rules } });
    if (!r.ok) { toast({ tone: 'err', text: r.data.error || 'Não deu para salvar agora.' }); return false; }
    return true;
  }
  if (key === 'link' && !f.open) {
    const r = await api('/api/v1/ambo/pro/setup', { method: 'PUT', body: { open: true } });
    if (!r.ok) { toast({ tone: 'err', text: r.data.error || 'Não deu para abrir a agenda agora.' }); return false; }
    f.open = true; toast({ title: 'Agenda aberta', text: 'pacientes já podem pedir horário' });
    return true;
  }
  if (key === 'pronto') { location.href = '/portal'; return false; }
  return true;
}

async function go(delta, skip = false) {
  if (S.busy) return;
  if (S.mode === 'hub') { if (delta > 0) location.href = '/portal'; return; }
  if (S.mode === 'edit') {
    if (delta < 0) { showHub('prev'); return; }
    S.busy = true; nextBtn.setAttribute('aria-busy', 'true');
    const slow = setTimeout(() => { nextBtn.innerHTML = '<span class="pl-spin" aria-hidden="true"></span>Salvando'; }, 300);
    let ok = false; try { ok = await save(S.view); } finally { clearTimeout(slow); S.busy = false; nextBtn.removeAttribute('aria-busy'); nextBtn.textContent = 'Salvar'; }
    if (!ok) return;
    showHub('prev', S.view);
    return;
  }
  const k = S.i + delta; if (k < 0 || k >= S.steps.length) { if (delta > 0) location.href = '/portal'; return; }
  if (delta > 0 && !skip) {
    S.busy = true; nextBtn.setAttribute('aria-busy', 'true'); const label = nextBtn.textContent;
    const slow = setTimeout(() => { nextBtn.innerHTML = '<span class="pl-spin" aria-hidden="true"></span>Salvando'; }, 300);
    let ok = false; try { ok = await save(S.steps[S.i]); } finally { clearTimeout(slow); S.busy = false; nextBtn.removeAttribute('aria-busy'); nextBtn.textContent = label; }
    if (!ok) return;
  }
  show(k, delta > 0 ? 'next' : 'prev');
}
nextBtn.addEventListener('click', () => go(+1));
backBtn.addEventListener('click', () => go(-1));

// ---------- Início ----------
(async () => {
  const me = await api('/api/v1/auth/me');
  if (!me.ok) { location.href = '/conta?voltar=' + encodeURIComponent('/configurar'); return; }
  S.me = me.data;
  const jobs = [api('/api/v1/professional/profile')];
  if (has('ambo')) jobs.push(api('/api/v1/ambo/pro/overview'));
  const [prof, amb] = await Promise.all(jobs);
  S.profile = prof?.ok ? prof.data.profile : {};
  S.blocks = prof?.ok ? (prof.data.availabilityBlocks || []).map((b) => ({ startAt: b.start_at, endAt: b.end_at, reason: b.reason })) : [];
  S.setup = amb?.ok ? amb.data.setup : null;
  initForm();
  S.steps = computeSteps();
  const want = new URLSearchParams(location.search).get('etapa');
  const left = missing();
  if (!left.length && want !== 'pronto') {
    // Já configurou tudo: painel de configurações; com ?etapa= abre direto aquele item para editar.
    if (want && S.steps.includes(want)) { S.mode = 'edit'; show(S.steps.indexOf(want), null); }
    else { S.mode = 'hub'; show('hub', null); }
    return;
  }
  // Ainda falta algo: o passo a passo começa no primeiro item que falta, não do zero.
  const start = S.steps.includes(want) ? S.steps.indexOf(want) : Math.max(0, S.steps.indexOf(left[0]));
  show(start, null);
})();
