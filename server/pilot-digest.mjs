// Resumo diário do piloto (pedido do Marcos em 23/11/2026): fecha cada dia (horário de Brasília),
// compara com o dia anterior e guarda o histórico. Só o administrador vê. Sem cron pago: o resumo
// do dia que fechou é gerado na primeira atividade depois da meia-noite (evento de uso ou painel aberto),
// e cada dia sai por e-mail uma única vez para os administradores.
import { buildPilotOverview } from './pilot.mjs';
import { nowIso, randomId } from './crypto.mjs';
import { sendTransactionalEmail } from './mailer.mjs';

const TZ_OFFSET_H = 3; // America/Sao_Paulo sem horário de verão desde 2019 (UTC−3).
const DAY_MS = 864e5;
const MAX_BACKFILL = 7;
const CHECK_EVERY_MS = 10 * 60 * 1000;
let lastCheck = 0;

export async function applyPilotDigestMigration(tx) {
  await tx.exec(`CREATE TABLE IF NOT EXISTS pilot_daily_digests (
    day TEXT PRIMARY KEY, summary_json TEXT NOT NULL, created_at TEXT NOT NULL, emailed_at TEXT
  )`);
}

/** 'AAAA-MM-DD' do dia em Brasília para um instante. */
export function spDay(ms = Date.now()) {
  return new Date(ms - TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);
}
function dayStartMs(day) { return Date.parse(`${day}T00:00:00.000Z`) + TZ_OFFSET_H * 3600e3; }
function addDays(day, n) { return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10); }

function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return ms > 0 ? 'menos de 1 min' : '0 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
const PNAME = { enomera: 'Enomera', ambo: 'Agendamento', minne: 'Consultório', etha: 'Site', site: 'site' };
const pn = (k) => PNAME[k] || k;
const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const delta = (a, b) => (b == null ? null : a - b);
const names = (list) => {
  if (list.length <= 1) return list[0] || '';
  return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
};

export async function buildDailyDigest(db, day, prev = null) {
  const start = dayStartMs(day);
  const since = new Date(start).toISOString();
  const until = new Date(start + DAY_MS).toISOString();
  const ov = await buildPilotOverview(db, { since, until, days: 1 });
  const hist = await buildPilotOverview(db, { since: new Date(start - 13 * DAY_MS).toISOString(), until, days: 14 });
  const histBy = new Map(hist.participants.map((p) => [p.id, p]));

  const active = ov.participants.filter((p) => p.sessionCount > 0);
  const people = active.map((p) => {
    const h = histBy.get(p.id);
    const before = h ? Object.keys(h.days).filter((d) => d < day) : [];
    const prods = Object.entries(p.products).sort((a, b) => b[1].activeMs - a[1].activeMs).map(([k]) => k);
    return { id: p.id, name: p.name, activeMs: p.activeMs, sessions: p.sessionCount, products: prods, returning: before.length > 0, errors: p.errors + p.apiFailures, lastStop: p.lastStop };
  }).sort((a, b) => b.activeMs - a.activeMs);
  const joinedToday = ov.participants.filter((p) => p.joinedAt >= since && p.joinedAt < until).map((p) => p.name);
  const goneCut = start + DAY_MS - 3 * DAY_MS;
  const gone = hist.participants.filter((p) => !p.withdrawnAt && p.lastSeen && Date.parse(p.lastSeen) < goneCut).map((p) => ({ name: p.name, lastSeen: p.lastSeen }));
  const never = hist.participants.filter((p) => !p.lastSeen && p.joinedAt < since).map((p) => p.name);
  const neverUsed = hist.participants.some((p) => p.sessionCount > 0) ? hist.features.filter((f) => f.users === 0).map((f) => ({ key: f.key, product: f.product, label: f.label })) : [];
  const featuresToday = ov.features.filter((f) => f.uses > 0).sort((a, b) => b.uses - a.uses).slice(0, 6).map((f) => ({ label: f.label, product: f.product, users: f.users, uses: f.uses }));

  const errorItems = [
    ...ov.errors.map((e) => ({ key: `${e.product}|${e.kind}|${e.message}`, product: e.product, text: e.message, count: e.count, users: e.users, screen: e.screens[0] || '' })),
    ...ov.apiFailures.map((a) => ({ key: `${a.product}|api|${a.endpoint}|${a.status}`, product: a.product, text: `${a.endpoint} → ${a.status}${a.code ? ` ${a.code}` : ''}`, count: a.count, users: a.users, screen: a.screen || '' })),
  ].sort((a, b) => b.count - a.count);
  const prevKeys = new Set(prev?.errorKeys || []);
  const newErrors = errorItems.filter((e) => !prevKeys.has(e.key)).slice(0, 8);
  const stuck = ov.frustration.slice(0, 4).map((e) => ({ product: e.product, target: e.target, rage: e.rage, dead: e.dead }));
  const exits = ov.exits.slice(0, 4);

  const totals = { active: active.length, activeMs: ov.totals.activeMs, sessions: ov.totals.sessions, errors: ov.totals.errors, joined: hist.totals.joined, invited: hist.totals.invited };
  const p = prev?.totals || null;
  const deltas = p ? { active: delta(totals.active, p.active), activeMs: delta(totals.activeMs, p.activeMs), sessions: delta(totals.sessions, p.sessions), errors: delta(totals.errors, p.errors) } : null;

  const highlights = [];
  if (!active.length) highlights.push(['Sem uso', 'Ninguém usou os produtos neste dia.']);
  else {
    const ret = people.filter((x) => x.returning).map((x) => x.name);
    const first = people.filter((x) => !x.returning).map((x) => x.name);
    if (ret.length) highlights.push(['Voltaram', `${names(ret)}.`]);
    if (first.length) highlights.push(['Primeiro uso', `${names(first)}.`]);
    highlights.push(['Mais tempo', `${people[0].name}, ${fmtDur(people[0].activeMs)}${people[0].products[0] ? ` (mais no ${pn(people[0].products[0])})` : ''}.`]);
  }
  if (joinedToday.length) highlights.push(['Entraram', `${names(joinedToday)} ${joinedToday.length === 1 ? 'aceitou' : 'aceitaram'} o convite.`]);
  if (gone.length) highlights.push(['Sumiram', `${names(gone.map((g) => g.name))} não ${gone.length === 1 ? 'abre' : 'abrem'} nada há mais de 3 dias.`]);
  if (never.length) highlights.push(['Ainda não usaram', `${names(never)} ${never.length === 1 ? 'criou a conta e não voltou' : 'criaram a conta e não voltaram'}.`]);
  if (stuck.length) highlights.push(['Travaram', `${stuck[0].target} (${pn(stuck[0].product)}): ${pl(stuck[0].rage, 'toque repetido', 'toques repetidos')}, ${pl(stuck[0].dead, 'sem efeito', 'sem efeito')}.`]);
  if (newErrors.length) highlights.push(['Erros novos', `${newErrors.length}: ${newErrors.slice(0, 2).map((e) => e.text).join('; ')}${newErrors.length > 2 ? '…' : ''}`]);
  if (neverUsed.length) highlights.push(['Ninguém usou', `${neverUsed.slice(0, 4).map((f) => f.label).join(', ')}${neverUsed.length > 4 ? ` e mais ${neverUsed.length - 4}` : ''} (últimos 14 dias).`]);

  return {
    day, generatedAt: nowIso(), totals, deltas, people, joinedToday, gone, never, neverUsed, featuresToday,
    newErrors, errorKeys: errorItems.map((e) => e.key), errorsTop: errorItems.slice(0, 6), stuck, exits, highlights,
  };
}

async function readDigest(db, day) {
  const row = await db.get('SELECT summary_json, emailed_at FROM pilot_daily_digests WHERE day = ?', day);
  if (!row) return null;
  try { return JSON.parse(row.summary_json); } catch { return null; }
}

/** Gera os dias fechados que faltam (até 7). Retorna os dias criados. */
export async function ensureDailyDigests(db, { force = false, mail = true } = {}) {
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return [];
  lastCheck = Date.now();
  const yesterday = spDay(Date.now() - DAY_MS);
  const first = await db.get("SELECT MIN(created_at) AS t FROM pilot_participants WHERE kind = 'tester'");
  if (!first?.t) return [];
  const firstDay = spDay(Date.parse(first.t));
  const created = [];
  for (let i = MAX_BACKFILL - 1; i >= 0; i--) {
    const day = addDays(yesterday, -i);
    if (day < firstDay) continue;
    if (await db.get('SELECT day FROM pilot_daily_digests WHERE day = ?', day)) continue;
    const prev = await readDigest(db, addDays(day, -1));
    const summary = await buildDailyDigest(db, day, prev);
    await db.run('INSERT INTO pilot_daily_digests (day, summary_json, created_at) VALUES (?, ?, ?) ON CONFLICT(day) DO NOTHING', day, JSON.stringify(summary), nowIso());
    created.push(day);
  }
  if (mail && created.includes(yesterday)) await mailDigest(db, yesterday).catch(() => null);
  return created;
}

export async function listDailyDigests(db, limit = 14) {
  const rows = await db.all('SELECT day, summary_json, emailed_at FROM pilot_daily_digests ORDER BY day DESC LIMIT ?', Math.min(60, Math.max(1, limit)));
  return rows.map((r) => { let s = {}; try { s = JSON.parse(r.summary_json); } catch { s = {}; } return { ...s, emailedAt: r.emailed_at }; });
}

function panelUrl() {
  // Endereço público único; sem a variável, vale o domínio de produção.
  const base = String(process.env.ENOMERA_PUBLIC_URL || 'https://enomera.com.br').replace(/\/+$/, '');
  return `${base}/piloto/painel#resumo-dia`;
}

export function digestEmail(s) {
  const d = new Date(`${s.day}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const bpl = (n, one, many) => `<b>${n}</b> ${n === 1 ? one : many}`;
  const sign = (n) => (n == null ? '' : n > 0 ? ` (+${n})` : n < 0 ? ` (${n})` : ' (=)');
  const lines = [
    `Piloto Enomera · ${d}`,
    '',
    `${pl(s.totals.active, 'pessoa usou', 'pessoas usaram')}${sign(s.deltas?.active)} · ${fmtDur(s.totals.activeMs)} de uso ativo · ${pl(s.totals.sessions, 'sessão', 'sessões')}${sign(s.deltas?.sessions)} · ${pl(s.totals.errors, 'erro', 'erros')}${sign(s.deltas?.errors)}`,
    '',
    ...s.highlights.map(([k, v]) => `${k}: ${v}`),
    '',
    `Painel completo: ${panelUrl()}`,
  ];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div style="font:15px/1.5 Manrope,Arial,sans-serif;color:#1C2240;max-width:560px">
    <p style="font-size:13px;color:#56607F;margin:0 0 6px">Piloto Enomera · resumo do dia</p>
    <h1 style="font-size:22px;margin:0 0 12px;font-weight:600">${esc(d)}</h1>
    <p style="margin:0 0 16px">${bpl(s.totals.active, 'pessoa usou', 'pessoas usaram')}${esc(sign(s.deltas?.active))} · <b>${esc(fmtDur(s.totals.activeMs))}</b> de uso ativo · ${bpl(s.totals.sessions, 'sessão', 'sessões')} · ${bpl(s.totals.errors, 'erro', 'erros')}</p>
    <ul style="padding-left:18px;margin:0 0 18px">${s.highlights.map(([k, v]) => `<li style="margin:0 0 6px"><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>
    <p><a href="${esc(panelUrl())}" style="display:inline-block;background:#3B4FB8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">Abrir o painel</a></p>
    <p style="font-size:12px;color:#8A93B2">Só administradores do piloto recebem este e-mail.</p></div>`;
  return { subject: `Piloto · ${pl(s.totals.active, 'pessoa usou', 'pessoas usaram')} · ${d.split(',')[0]}`, textBody: lines.join('\n'), htmlBody: html };
}

/** Envia o resumo de um dia uma única vez (marca emailed_at antes de enviar). */
export async function mailDigest(db, day) {
  const mark = `${nowIso()}#${randomId('m')}`;
  await db.run('UPDATE pilot_daily_digests SET emailed_at = ? WHERE day = ? AND emailed_at IS NULL', mark, day);
  const row = await db.get('SELECT summary_json, emailed_at FROM pilot_daily_digests WHERE day = ?', day);
  if (!row || row.emailed_at !== mark) return { sent: false, reason: 'already_sent' };
  const s = JSON.parse(row.summary_json);
  const admins = await db.all("SELECT email FROM users WHERE role = 'pilot_admin' AND email IS NOT NULL");
  const mail = digestEmail(s);
  let sent = 0;
  for (const a of admins) {
    try { await sendTransactionalEmail(db, { recipient: a.email, ...mail, purpose: 'pilot_daily_digest' }); sent++; } catch { /* segue para o próximo */ }
  }
  return { sent: sent > 0, recipients: sent };
}
