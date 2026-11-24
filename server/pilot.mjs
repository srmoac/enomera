// Piloto com convidados: convites únicos, registro de uso (interações, nunca conteúdo) e painel do administrador.
// Tudo fica no mesmo banco da Core (Neon no Preview, SQLite local). Sem serviço pago de analytics.
import { z } from 'zod';
import { ensureDailyDigests, listDailyDigests } from './pilot-digest.mjs';
import { listSobMedida, sobMedidaDetail, setSobMedidaStatus, serveSobMedidaFile } from './pilot-sobmedida.mjs';
import { hashPassword, nowIso, randomId, randomToken, sha256Hex } from './crypto.mjs';

export const PILOT_CONSENT_VERSION = 'piloto-uso-2026-11-22';
export const PILOT_PRODUCTS = ['enomera', 'ambo', 'minne', 'etha', 'site'];
const UNLINKED_RETENTION_HOURS = 24;
const MAX_EVENTS_PER_BATCH = 120;

// Convites iniciais (22/11/2026). Só o hash do token fica no código; os links ficam com o Marcos.
const INITIAL_INVITES = [
  { id: 'inv_piloto_t1', kind: 'tester', label: 'Convidado 1', hash: 'dd89e33c8542ab0997894c3fd8d51fcc6566262724d83a40286bf96890119b68' },
  { id: 'inv_piloto_t2', kind: 'tester', label: 'Convidado 2', hash: 'c31931f62ee85d4e25348674303d4cde4630ad49573d523abe5a2db39ddc34cf' },
  { id: 'inv_piloto_admin', kind: 'admin', label: 'Administrador (Marcos)', hash: '725845043e4479e84ae5a91196733962a4120225549dc8f5c7afe640dc5a79f6' },
];
// Conta de convidado para o próprio Marcos testar: entra no painel separada e fora dos totais (22/11/2026 23:10 UTC).
export const SELF_TEST_INVITES = [
  { id: 'inv_piloto_marcos_teste', kind: 'self_test', label: 'Teste do Marcos', hash: 'b99862e845ecfd6f8da2c40dcfce7ce9d6919c3dbeec0e5a46d04561c4c33e5d' },
];

// Convidados extras pedidos pelo Marcos para amigos (23/11/2026 01:57 UTC): contam nas métricas.
export const FRIEND_INVITES = [
  { id: 'inv_piloto_amigo_1', kind: 'tester', label: 'Amigo 1', hash: '52ea7dff98accdd86fe4c66acd5fe2f48feb758ea91b9db79b987892e2d39a28' },
  { id: 'inv_piloto_amigo_2', kind: 'tester', label: 'Amigo 2', hash: '879f6622c2660534e1fc5c1b028385e3bdeff21b789cf95faf036db487ec5a11' },
  { id: 'inv_piloto_amigo_3', kind: 'tester', label: 'Amigo 3', hash: '121211ef3b8490f9e1c2aa9f00b8fc35923cc972e537048abf1975e8641e32b1' },
  // 23/11/2026 02:49 UTC: mais uma amiga do Marcos.
  { id: 'inv_piloto_amiga_4', kind: 'tester', label: 'Amiga 4', hash: '08be889501b7cba340fd2a652990d77c57385f1ab1ed3c1d813ca9016dd4b473' },
  // 24/11/2026 00:31 UTC: mais um link de teste pedido pelo Marcos.
  { id: 'inv_piloto_teste_5', kind: 'tester', label: 'Teste 5', hash: 'a3fd31f2c1d8c4f2158e9a0c71c49fe54a4b4cf674fd32cbcbe457220f0d40ea' },
];

export async function applyPilotFriendInvitesMigration(tx) {
  const now = nowIso();
  for (const inv of FRIEND_INVITES) {
    await tx.run('INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      inv.id, inv.kind, inv.label, inv.hash, now);
  }
}

export async function applyPilotSelfTestMigration(tx) {
  const now = nowIso();
  for (const inv of SELF_TEST_INVITES) {
    await tx.run('INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      inv.id, inv.kind, inv.label, inv.hash, now);
  }
}

export async function applyPilotMigration(tx) {
  await tx.exec(`CREATE TABLE IF NOT EXISTS pilot_invites (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, expires_at TEXT, used_at TEXT, used_by_user_id TEXT, revoked_at TEXT
  )`);
  await tx.exec(`CREATE TABLE IF NOT EXISTS pilot_participants (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, invite_id TEXT, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    track_key TEXT NOT NULL UNIQUE, consent_version TEXT, consent_at TEXT, withdrawn_at TEXT, created_at TEXT NOT NULL
  )`);
  await tx.exec(`CREATE TABLE IF NOT EXISTS pilot_devices (
    id TEXT PRIMARY KEY, participant_id TEXT, product TEXT NOT NULL, browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '',
    form TEXT NOT NULL DEFAULT '', first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
  )`);
  await tx.exec(`CREATE TABLE IF NOT EXISTS pilot_events (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL, participant_id TEXT, product TEXT NOT NULL, session_key TEXT NOT NULL,
    type TEXT NOT NULL, screen TEXT NOT NULL DEFAULT '', target TEXT NOT NULL DEFAULT '', x INTEGER, y INTEGER,
    n INTEGER, meta_json TEXT NOT NULL DEFAULT '{}', form TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, received_at TEXT NOT NULL
  )`);
  await tx.exec('CREATE INDEX IF NOT EXISTS idx_pilot_events_participant ON pilot_events(participant_id, occurred_at)');
  await tx.exec('CREATE INDEX IF NOT EXISTS idx_pilot_events_device ON pilot_events(device_id, participant_id)');
  await tx.exec('CREATE INDEX IF NOT EXISTS idx_pilot_events_unlinked ON pilot_events(participant_id, received_at)');
  const now = nowIso();
  for (const inv of INITIAL_INVITES) {
    await tx.run('INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      inv.id, inv.kind, inv.label, inv.hash, now);
  }
}

// ── utilidades ──────────────────────────────────────────────────────
const clip = (v, max) => String(v ?? '').slice(0, max);
// Última barreira contra dado pessoal: e-mails, telefones/CPF/números longos e nomes próprios em sequência.
export function scrub(v, max = 160) {
  return clip(v, max * 2)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '‹e-mail›')
    .replace(/\d[\d\s.()/-]{5,}\d/g, '‹número›')
    .replace(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+(?:d[aeo]s?|e)\s+|\s+)[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)*/g, '‹nome›')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function uaSummary(ua = '') {
  const s = String(ua);
  const os = /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : 'Outro';
  const browser = /Edg\//.test(s) ? 'Edge' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /FxiOS|Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Outro';
  return { os, browser };
}

const eventSchema = z.object({
  t: z.number().int().positive(),
  type: z.enum(['view', 'click', 'time', 'error', 'console', 'api', 'load', 'scroll', 'field', 'submit', 'mark', 'leave']),
  sc: z.string().max(200).optional().default(''),
  tg: z.string().max(200).optional().default(''),
  x: z.number().int().min(0).max(1000).optional(),
  y: z.number().int().min(0).max(1000).optional(),
  n: z.number().int().min(-1).max(86_400_000).optional(),
  m: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
const batchSchema = z.object({
  d: z.string().regex(/^[A-Za-z0-9_-]{8,48}$/),
  p: z.enum(PILOT_PRODUCTS),
  s: z.string().regex(/^[A-Za-z0-9_-]{4,48}$/),
  sh: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  pu: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  f: z.enum(['celular', 'tablet', 'computador']).optional().default('computador'),
  e: z.array(z.unknown()).max(MAX_EVENTS_PER_BATCH),
});

function cleanMeta(m = {}) {
  const out = {};
  for (const [k, v] of Object.entries(m || {}).slice(0, 12)) {
    const key = clip(k, 24);
    if (typeof v === 'string') out[key] = key === 'stack' ? scrub(v, 600) : scrub(v, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean' || v === null) out[key] = v;
  }
  return JSON.stringify(out);
}

async function participantForUser(db, userId) {
  if (!userId) return null;
  return db.get('SELECT * FROM pilot_participants WHERE user_id = ?', userId);
}

// ── ingestão de eventos ──────────────────────────────────────────────
export async function ingestPilotEvents(db, { body, auth, userAgent }) {
  const batch = batchSchema.parse(body);
  const now = nowIso();

  // Quem é: sessão da Core (cookie/Bearer), hash da sessão vista pelo rastreador no produto, ou chave do participante passada entre produtos.
  let userId = auth?.user?.id || null;
  if (!userId && batch.sh) {
    const sess = await db.get('SELECT user_id, revoked_at, expires_at FROM sessions WHERE token_hash = ?', batch.sh);
    if (sess && !sess.revoked_at) userId = sess.user_id;
  }
  let participant = await participantForUser(db, userId);
  if (!participant && userId) {
    const u = await db.get('SELECT role FROM users WHERE id = ?', userId);
    if (u?.role === 'pilot_admin') return { ok: true, track: false, reason: 'admin' };
  }
  if (participant && participant.kind === 'admin') return { ok: true, track: false, reason: 'admin' };
  if (!participant && batch.pu) participant = await db.get('SELECT * FROM pilot_participants WHERE track_key = ?', batch.pu);

  const device = await db.get('SELECT * FROM pilot_devices WHERE id = ?', batch.d);
  if (!participant && device?.participant_id) participant = await db.get('SELECT * FROM pilot_participants WHERE id = ?', device.participant_id);
  if (participant?.kind === 'admin') return { ok: true, track: false, reason: 'admin' };
  if (participant?.withdrawn_at) return { ok: true, track: false, reason: 'withdrawn' };

  const { os, browser } = uaSummary(userAgent);
  if (!device) {
    await db.run('INSERT INTO pilot_devices (id, participant_id, product, browser, os, form, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      batch.d, participant?.id || null, batch.p, browser, os, batch.f, now, now);
  } else {
    await db.run('UPDATE pilot_devices SET last_seen = ?, form = ?, participant_id = COALESCE(participant_id, ?) WHERE id = ?', now, batch.f, participant?.id || null, batch.d);
  }
  if (participant && (!device || !device.participant_id)) {
    // Eventos deste aparelho antes da identificação passam a contar para a pessoa.
    await db.run('UPDATE pilot_events SET participant_id = ? WHERE device_id = ? AND participant_id IS NULL', participant.id, batch.d);
  }

  const rows = [];
  for (const raw of batch.e) {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) continue;
    const ev = parsed.data;
    const ts = new Date(ev.t);
    if (Number.isNaN(ts.getTime()) || Math.abs(Date.now() - ts.getTime()) > 7 * 864e5) continue;
    rows.push([randomId('pev'), batch.d, participant?.id || null, batch.p, batch.s, ev.type, scrub(ev.sc, 160), scrub(ev.tg, 160),
      ev.x ?? null, ev.y ?? null, ev.n ?? null, cleanMeta(ev.m), batch.f, ts.toISOString(), now]);
  }
  for (let i = 0; i < rows.length; i += 40) {
    const chunk = rows.slice(i, i + 40);
    const ph = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    await db.run(`INSERT INTO pilot_events (id, device_id, participant_id, product, session_key, type, screen, target, x, y, n, meta_json, form, occurred_at, received_at) VALUES ${ph}`, ...chunk.flat());
  }

  // Limpeza: aparelho nunca identificado não guarda nada por mais de 24 h.
  if (Math.random() < 0.08) {
    const cutoff = new Date(Date.now() - UNLINKED_RETENTION_HOURS * 3600e3).toISOString();
    await db.run('DELETE FROM pilot_events WHERE participant_id IS NULL AND received_at < ?', cutoff);
  }
  return { ok: true, track: true, stored: rows.length, identified: Boolean(participant), ref: participant && userId ? participant.track_key : undefined };
}

// ── convites ─────────────────────────────────────────────────────────
async function findInvite(db, token) {
  const t = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
  return db.get('SELECT * FROM pilot_invites WHERE token_hash = ?', sha256Hex(t));
}

function inviteState(inv) {
  if (!inv) return 'invalid';
  if (inv.revoked_at) return 'revoked';
  if (inv.used_at) return 'used';
  if (inv.expires_at && Date.parse(inv.expires_at) < Date.now()) return 'expired';
  return 'open';
}

const acceptSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(200),
  crpOrCrm: z.string().trim().max(40).optional().default(''),
  specialty: z.enum(['Psicologia', 'Psiquiatria']).optional().default('Psicologia'),
  consent: z.literal(true),
});

export async function acceptInvite(db, { token, body, createProfessionalUser, issueSession, writeAudit }) {
  const inv = await findInvite(db, token);
  const state = inviteState(inv);
  if (state !== 'open') {
    const msg = state === 'used' ? 'Este convite já foi usado. Entre com o e-mail e a senha que você cadastrou.' : 'Este convite não é válido. Peça um novo link ao Marcos.';
    throw Object.assign(new Error(msg), { status: state === 'used' ? 409 : 404, code: state === 'used' ? 'INVITE_USED' : 'INVITE_INVALID' });
  }
  const data = acceptSchema.parse(body);
  const email = data.email.toLowerCase();
  if (await db.get('SELECT id FROM users WHERE email = ?', email)) {
    throw Object.assign(new Error('Já existe uma conta com este e-mail. Use outro e-mail para o piloto.'), { status: 409, code: 'EMAIL_EXISTS' });
  }
  // Reserva o convite antes de criar a conta: dois envios ao mesmo tempo não geram duas contas.
  const now = nowIso();
  const claim = await db.run('UPDATE pilot_invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL', now, inv.id);
  if (Number(claim?.changes || 0) !== 1) throw Object.assign(new Error('Este convite já foi usado.'), { status: 409, code: 'INVITE_USED' });

  let userId; let accountId = null;
  try {
    if (inv.kind === 'admin') {
      userId = randomId('usr');
      const pwd = hashPassword(data.password);
      await db.run(`INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pilot_admin', ?, 0, ?, ?)`, userId, email, pwd.hash, pwd.salt, data.fullName, now, now, now);
    } else {
      ({ userId, accountId } = await createProfessionalUser(db, { fullName: data.fullName, email, password: data.password, crpOrCrm: data.crpOrCrm, specialty: data.specialty, emailVerifiedAt: now }));
    }
  } catch (err) {
    await db.run('UPDATE pilot_invites SET used_at = NULL WHERE id = ?', inv.id);
    throw err;
  }
  await db.run('UPDATE pilot_invites SET used_by_user_id = ? WHERE id = ?', userId, inv.id);
  const participantId = randomId('ppt');
  await db.run(`INSERT INTO pilot_participants (id, user_id, invite_id, kind, label, track_key, consent_version, consent_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, participantId, userId, inv.id, inv.kind, inv.label, randomToken(18), PILOT_CONSENT_VERSION, now, now);
  const sess = await issueSession(db, { userId, actorType: inv.kind === 'admin' ? 'pilot_admin' : 'professional', accountId, ttlMinutes: 60 * 24 * 14 });
  await writeAudit(db, { actorUserId: userId, actorType: inv.kind === 'admin' ? 'pilot_admin' : 'professional', accountId, action: 'pilot.invite_accept', resourceType: 'pilot_invite', resourceId: inv.id, meta: { consentVersion: PILOT_CONSENT_VERSION } });
  return { sess, kind: inv.kind, next: inv.kind === 'admin' ? '/piloto/painel' : '/checkout', participantId };
}

// ── painel do administrador ──────────────────────────────────────────
function requirePilotAdmin(auth) {
  if (!auth) throw Object.assign(new Error('Entre para ver o painel do piloto.'), { status: 401, code: 'UNAUTHENTICATED' });
  if (auth.user.role !== 'pilot_admin') throw Object.assign(new Error('Painel restrito ao administrador do piloto.'), { status: 403, code: 'FORBIDDEN_PILOT_ADMIN' });
  return auth;
}

const dayKey = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// Funcionalidades do ecossistema reconhecidas por chamada à Core (robusto a mudança de layout) ou por tela.
export const FEATURES = [
  { key: 'plano', product: 'enomera', label: 'Escolher plano', api: [/^PUT \/api\/v1\/commercial\/selection$/], screen: /checkout|etapa=planos/ },
  { key: 'ativar', product: 'enomera', label: 'Ativar 30 dias grátis', api: [/^POST \/api\/v1\/commercial\/(trial\/start|orders)$/, /^POST \/api\/v1\/billing\/checkout$/] },
  { key: 'perfil', product: 'enomera', label: 'Editar perfil profissional', api: [/^PATCH \/api\/v1\/professional\/profile$/, /^POST \/api\/v1\/professional\/profile\/photo$/] },
  { key: 'agenda', product: 'enomera', label: 'Definir disponibilidade', api: [/^PUT \/api\/v1\/professional\/availability$/] },
  { key: 'ambo_abrir', product: 'ambo', label: 'Abrir o Ambo', any: 'ambo' },
  { key: 'ambo_configurar', product: 'ambo', label: 'Configurar atendimento no Ambo', api: [/^PUT \/api\/v1\/ambo\/pro\/setup$/] },
  { key: 'ambo_confirmar', product: 'ambo', label: 'Confirmar solicitação no Ambo', api: [/^POST \/api\/v1\/ambo\/pro\/requests\/:id\/confirm$/] },
  { key: 'ambo_convite', product: 'ambo', label: 'Convidar paciente', api: [/^POST \/api\/v1\/ambo\/invitations$/] },
  { key: 'ambo_remarcar', product: 'ambo', label: 'Decidir remarcação', api: [/^POST \/api\/v1\/ambo\/pro\/reschedules\/:id\/decide$/] },
  { key: 'ambo_paciente', product: 'ambo', label: 'Agendar como paciente', api: [/^POST \/api\/v1\/ambo\/public\/:id\/requests$/] },
  { key: 'minne_abrir', product: 'minne', label: 'Abrir o Minne', any: 'minne' },
  { key: 'minne_paciente', product: 'minne', label: 'Cadastrar paciente', api: [/^POST \/api\/v1\/minne\/patients$/] },
  { key: 'minne_confirmar', product: 'minne', label: 'Confirmar solicitação no Minne', api: [/^POST \/api\/v1\/minne\/requests\/:id\/confirm$/] },
  { key: 'minne_agendar', product: 'minne', label: 'Agendar consulta', api: [/^POST \/api\/v1\/minne\/appointments$/] },
  { key: 'minne_nota', product: 'minne', label: 'Escrever prontuário', api: [/^POST \/api\/v1\/minne\/notes\/draft$/, /^POST \/api\/v1\/minne\/patients\/:id\/notes$/] },
  { key: 'minne_concluir', product: 'minne', label: 'Concluir registro', api: [/^POST \/api\/v1\/minne\/notes\/:id\/conclude$/] },
  { key: 'minne_importar', product: 'minne', label: 'Importar planilha', api: [/^POST \/api\/v1\/minne\/imports\/stage$/] },
  { key: 'etha_abrir', product: 'etha', label: 'Abrir a Etha', any: 'etha' },
  { key: 'etha_briefing', product: 'etha', label: 'Preencher briefing', api: [/^PUT \/api\/v1\/etha\/project\/briefing$/] },
  { key: 'etha_editor', product: 'etha', label: 'Editar o site', api: [/^POST \/api\/v1\/etha\/project\/editor$/] },
  { key: 'etha_publicar', product: 'etha', label: 'Publicar o site', api: [/^POST \/api\/v1\/etha\/project\/publish-staging$/, /^POST \/api\/v1\/etha\/project\/approve$/] },
  { key: 'site_ver', product: 'site', label: 'Ver o site publicado', any: 'site' },
];

function featureHits(ev) {
  const hits = [];
  for (const f of FEATURES) {
    if (f.any && ev.product === f.any && (ev.type === 'view' || ev.type === 'click')) hits.push(f.key);
    else if (f.api && ev.type === 'api' && f.api.some((re) => re.test(ev.target)) && Number(ev.n_status || 0) < 400) hits.push(f.key);
    else if (f.screen && ev.type === 'view' && f.screen.test(ev.screen)) hits.push(f.key);
  }
  return hits;
}

function parseMeta(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

export async function buildPilotOverview(db, { days = 14, includeSelfTest = false, since: sinceIso = null, until = null } = {}) {
  const since = sinceIso || new Date(Date.now() - days * 864e5).toISOString();
  const untilIso = until || '9999-12-31T00:00:00.000Z';
  const participants = await db.all(`SELECT pp.*, u.full_name, u.email FROM pilot_participants pp JOIN users u ON u.id = pp.user_id WHERE pp.kind IN (${includeSelfTest ? "'tester', 'self_test'" : "'tester'"}) ORDER BY pp.created_at ASC`);
  const invites = await db.all('SELECT id, kind, label, created_at, used_at, revoked_at, expires_at FROM pilot_invites ORDER BY created_at ASC');
  const events = await db.all(`SELECT e.participant_id, e.product, e.session_key, e.type, e.screen, e.target, e.x, e.y, e.n, e.meta_json, e.form, e.occurred_at, d.browser, d.os
    FROM pilot_events e LEFT JOIN pilot_devices d ON d.id = e.device_id
    WHERE e.participant_id IS NOT NULL AND e.occurred_at >= ? AND e.occurred_at < ? ORDER BY e.occurred_at ASC LIMIT 60000`, since, untilIso);
  const unlinked = await db.get('SELECT COUNT(*) AS c FROM pilot_events WHERE participant_id IS NULL');

  const byP = new Map(participants.map((p) => [p.id, {
    id: p.id, label: p.label, name: p.full_name, email: p.email, joinedAt: p.created_at, withdrawnAt: p.withdrawn_at, selfTest: p.kind === 'self_test',
    activeMs: 0, sessions: new Map(), days: new Map(), products: {}, screens: new Map(), elements: new Map(), errors: 0, apiFailures: 0,
    rage: 0, dead: 0, features: new Set(), firstSeen: null, lastSeen: null, devices: new Set(),
  }]));
  const screens = new Map(); const elements = new Map(); const errors = new Map(); const apiFail = new Map(); const featureUsers = new Map(FEATURES.map((f) => [f.key, new Set()]));
  const featureCount = new Map(FEATURES.map((f) => [f.key, 0]));

  for (const ev of events) {
    const P = byP.get(ev.participant_id); if (!P) continue;
    const m = parseMeta(ev.meta_json); ev.n_status = m.status;
    P.firstSeen = P.firstSeen || ev.occurred_at; P.lastSeen = ev.occurred_at; P.devices.add(`${ev.form} · ${ev.os} · ${ev.browser}`);
    const sKey = `${ev.session_key}`;
    let S = P.sessions.get(sKey);
    if (!S) { S = { key: sKey, start: ev.occurred_at, end: ev.occurred_at, activeMs: 0, products: new Set(), path: [], errors: 0, lastScreen: '', lastProduct: '', clicks: 0 }; P.sessions.set(sKey, S); }
    S.end = ev.occurred_at; S.products.add(ev.product);
    const day = dayKey(ev.occurred_at);
    const scKey = `${ev.product}|${ev.screen}`;
    let SC = screens.get(scKey);
    if (!SC) { SC = { product: ev.product, screen: ev.screen, views: 0, users: new Set(), activeMs: 0, clicks: 0, rage: 0, dead: 0, errors: 0, exits: 0, scrollMax: [] }; screens.set(scKey, SC); }
    if (ev.type === 'view') {
      SC.views++; SC.users.add(P.id);
      if (S.path[S.path.length - 1] !== scKey) S.path.push(scKey);
      S.lastScreen = ev.screen; S.lastProduct = ev.product;
      P.screens.set(scKey, (P.screens.get(scKey) || 0));
    }
    if (ev.type === 'time') {
      const ms = Math.max(0, Number(ev.n || 0));
      P.activeMs += ms; S.activeMs += ms; SC.activeMs += ms;
      P.days.set(day, (P.days.get(day) || 0) + ms);
      P.products[ev.product] = P.products[ev.product] || { activeMs: 0, clicks: 0 }; P.products[ev.product].activeMs += ms;
      P.screens.set(scKey, (P.screens.get(scKey) || 0) + ms);
      if (typeof m.scroll === 'number') SC.scrollMax.push(m.scroll);
    }
    if (ev.type === 'click') {
      S.clicks++; SC.clicks++;
      P.products[ev.product] = P.products[ev.product] || { activeMs: 0, clicks: 0 }; P.products[ev.product].clicks++;
      if (!P.days.has(day)) P.days.set(day, 0);
      const elKey = `${ev.product}|${ev.target}`;
      let EL = elements.get(elKey);
      if (!EL) { EL = { product: ev.product, target: ev.target, clicks: 0, users: new Set(), screens: new Set(), rage: 0, dead: 0 }; elements.set(elKey, EL); }
      EL.clicks++; EL.users.add(P.id); EL.screens.add(ev.screen);
      P.elements.set(elKey, (P.elements.get(elKey) || 0) + 1);
      if (m.rage) { P.rage++; SC.rage++; EL.rage++; }
      if (m.dead) { P.dead++; SC.dead++; EL.dead++; }
    }
    if (ev.type === 'error' || ev.type === 'console' || (ev.type === 'api' && (Number(m.status) >= 400 || m.status === 0))) {
      S.errors++; SC.errors++;
      if (ev.type === 'api') {
        P.apiFailures++;
        const k = `${ev.product}|${ev.target}|${m.status}|${m.code || ''}`;
        const A = apiFail.get(k) || { product: ev.product, endpoint: ev.target, status: m.status, code: m.code || '', count: 0, users: new Set(), lastAt: '', screen: ev.screen };
        A.count++; A.users.add(P.id); A.lastAt = ev.occurred_at; A.screen = ev.screen; apiFail.set(k, A);
      } else {
        P.errors++;
        const k = `${ev.product}|${ev.type}|${ev.target}`;
        const E = errors.get(k) || { product: ev.product, kind: ev.type, message: ev.target, count: 0, users: new Set(), screens: new Set(), lastAt: '', stack: '', source: '' };
        E.count++; E.users.add(P.id); E.screens.add(ev.screen); E.lastAt = ev.occurred_at; E.stack = m.stack || E.stack; E.source = m.src || E.source; errors.set(k, E);
      }
    }
    for (const fk of featureHits(ev)) { P.features.add(fk); featureUsers.get(fk).add(P.id); featureCount.set(fk, featureCount.get(fk) + 1); }
  }

  // Saídas: última tela de cada sessão.
  const exitCounts = new Map();
  const outParticipants = [];
  for (const P of byP.values()) {
    const sessions = [...P.sessions.values()].sort((a, b) => a.start.localeCompare(b.start));
    for (const S of sessions) {
      const k = S.path[S.path.length - 1];
      if (k) { exitCounts.set(k, (exitCounts.get(k) || 0) + 1); const SC = screens.get(k); if (SC) SC.exits++; }
    }
    const dayList = [...P.days.keys()].sort();
    const last = sessions[sessions.length - 1];
    outParticipants.push({
      id: P.id, label: P.label, name: P.name, email: P.email, joinedAt: P.joinedAt, withdrawnAt: P.withdrawnAt, selfTest: P.selfTest,
      firstSeen: P.firstSeen, lastSeen: P.lastSeen, activeMs: P.activeMs, sessionCount: sessions.length,
      avgSessionMs: sessions.length ? Math.round(P.activeMs / sessions.length) : 0,
      daysActive: dayList.length, returned: dayList.length >= 2, days: Object.fromEntries(P.days),
      products: P.products, errors: P.errors, apiFailures: P.apiFailures, rage: P.rage, dead: P.dead,
      devices: [...P.devices],
      features: FEATURES.map((f) => ({ key: f.key, product: f.product, label: f.label, used: P.features.has(f.key) })),
      topScreens: [...P.screens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, ms]) => ({ product: k.split('|')[0], screen: k.split('|').slice(1).join('|'), activeMs: ms })),
      topElements: [...P.elements.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => ({ product: k.split('|')[0], target: k.split('|').slice(1).join('|'), clicks: c })),
      lastStop: last ? { product: last.lastProduct, screen: last.lastScreen, at: last.end, hadError: last.errors > 0 } : null,
      recentSessions: sessions.slice(-12).reverse().map((S) => ({ start: S.start, end: S.end, activeMs: S.activeMs, products: [...S.products], clicks: S.clicks, errors: S.errors,
        path: S.path.slice(0, 14).map((k) => ({ product: k.split('|')[0], screen: k.split('|').slice(1).join('|') })), pathLength: S.path.length })),
    });
  }
  const totalUsers = outParticipants.filter((p) => p.sessionCount > 0).length;
  const screenList = [...screens.values()].map((s) => ({
    product: s.product, screen: s.screen, views: s.views, users: s.users.size, activeMs: s.activeMs, clicks: s.clicks, rage: s.rage, dead: s.dead, errors: s.errors, exits: s.exits,
    exitRate: s.views ? Math.round((s.exits / s.views) * 100) : 0,
    avgScroll: s.scrollMax.length ? Math.round(s.scrollMax.reduce((a, b) => a + b, 0) / s.scrollMax.length) : null,
  })).sort((a, b) => b.activeMs - a.activeMs);
  const elementList = [...elements.values()].map((e) => ({ product: e.product, target: e.target, clicks: e.clicks, users: e.users.size, screens: [...e.screens].slice(0, 3), rage: e.rage, dead: e.dead })).sort((a, b) => b.clicks - a.clicks);
  return {
    generatedAt: nowIso(), days, since, includeSelfTest,
    totals: {
      invited: invites.filter((i) => i.kind === 'tester').length,
      joined: participants.length,
      active: totalUsers,
      returned: outParticipants.filter((p) => p.returned).length,
      activeMs: outParticipants.reduce((a, p) => a + p.activeMs, 0),
      sessions: outParticipants.reduce((a, p) => a + p.sessionCount, 0),
      errors: outParticipants.reduce((a, p) => a + p.errors + p.apiFailures, 0),
      events: events.length,
      unlinkedEvents: Number(unlinked?.c || 0),
    },
    participants: outParticipants,
    features: FEATURES.map((f) => ({ key: f.key, product: f.product, label: f.label, users: featureUsers.get(f.key).size, uses: featureCount.get(f.key), reach: totalUsers ? Math.round((featureUsers.get(f.key).size / totalUsers) * 100) : 0 })),
    screens: screenList.slice(0, 80),
    elements: elementList.slice(0, 120),
    frustration: elementList.filter((e) => e.rage || e.dead).sort((a, b) => (b.rage * 3 + b.dead) - (a.rage * 3 + a.dead)).slice(0, 20),
    exits: [...exitCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, c]) => ({ product: k.split('|')[0], screen: k.split('|').slice(1).join('|'), sessions: c })),
    errors: [...errors.values()].map((e) => ({ ...e, users: e.users.size, screens: [...e.screens].slice(0, 4) })).sort((a, b) => b.count - a.count).slice(0, 60),
    apiFailures: [...apiFail.values()].map((a) => ({ ...a, users: a.users.size })).sort((a, b) => b.count - a.count).slice(0, 60),
    invites: invites.map((i) => ({ id: i.id, kind: i.kind, label: i.label, createdAt: i.created_at, usedAt: i.used_at, revokedAt: i.revoked_at, state: inviteState(i) })),
  };
}

export async function buildHeatmap(db, { product, screen, participantId = null, form = null, days = 30, includeSelfTest = false }) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const params = [product, screen, since];
  let sql = "SELECT x, y, target, form, meta_json FROM pilot_events WHERE type = 'click' AND participant_id IS NOT NULL AND product = ? AND screen = ? AND occurred_at >= ?";
  if (participantId) { sql += ' AND participant_id = ?'; params.push(participantId); }
  if (form) { sql += ' AND form = ?'; params.push(form); }
  if (!includeSelfTest) sql += " AND participant_id NOT IN (SELECT id FROM pilot_participants WHERE kind = 'self_test')";
  const rows = await db.all(`${sql} LIMIT 5000`, ...params);
  const ratios = [];
  const pts = rows.filter((r) => r.x != null && r.y != null).map((r) => { const m = parseMeta(r.meta_json); if (m.vw > 0 && m.dh > 0) ratios.push(m.dh / m.vw); return [r.x, r.y, m.rage ? 1 : 0, m.dead ? 1 : 0, r.form]; });
  ratios.sort((a, b) => a - b);
  const ratio = ratios.length ? Math.min(6, Math.max(0.5, ratios[Math.floor(ratios.length / 2)])) : (form === 'celular' ? 2.2 : 0.8);
  const targets = new Map();
  for (const r of rows) targets.set(r.target, (targets.get(r.target) || 0) + 1);
  return { product, screen, ratio, points: pts, targets: [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([target, clicks]) => ({ target, clicks })) };
}

export async function participantTimeline(db, participantId, limit = 400) {
  const rows = await db.all(`SELECT product, session_key, type, screen, target, n, meta_json, form, occurred_at FROM pilot_events
    WHERE participant_id = ? ORDER BY occurred_at DESC LIMIT ?`, participantId, limit);
  return rows.map((r) => ({ ...r, meta: parseMeta(r.meta_json), meta_json: undefined }));
}

export async function handlePilotRoutes({ db, req, res, method, pathname, url, auth, json, readJsonBody, createProfessionalUser, issueSession, writeAudit }) {
  if (!pathname.startsWith('/api/v1/pilot/')) return false;

  if (method === 'POST' && pathname === '/api/v1/pilot/events') {
    const out = await ingestPilotEvents(db, { body: await readJsonBody(req), auth, userAgent: req.headers['user-agent'] });
    await ensureDailyDigests(db).catch(() => null); // fecha o dia anterior na primeira atividade (no máximo a cada 10 min)
    json(res, 200, out); return true;
  }

  const invMatch = pathname.match(/^\/api\/v1\/pilot\/invites\/([A-Za-z0-9_-]{8,64})(\/accept)?$/);
  if (invMatch && method === 'GET' && !invMatch[2]) {
    const inv = await findInvite(db, invMatch[1]);
    const state = inviteState(inv);
    json(res, state === 'invalid' ? 404 : 200, { state, kind: inv?.kind || null, consentVersion: PILOT_CONSENT_VERSION }); return true;
  }
  if (invMatch && method === 'POST' && invMatch[2]) {
    const out = await acceptInvite(db, { token: invMatch[1], body: await readJsonBody(req), createProfessionalUser, issueSession, writeAudit });
    json(res, 201, { ok: true, kind: out.kind, next: out.next, sessionToken: out.sess.rawToken, expiresAt: out.sess.expiresAt }, { 'Set-Cookie': out.sess.cookie }); return true;
  }

  if (method === 'POST' && pathname === '/api/v1/pilot/withdraw') {
    if (!auth) throw Object.assign(new Error('Entre para retirar seu consentimento.'), { status: 401, code: 'UNAUTHENTICATED' });
    const now = nowIso();
    const p = await participantForUser(db, auth.user.id);
    if (p) {
      await db.run('UPDATE pilot_participants SET withdrawn_at = ? WHERE id = ?', now, p.id);
      await db.run('DELETE FROM pilot_events WHERE participant_id = ?', p.id);
    }
    json(res, 200, { ok: true, withdrawnAt: now }); return true;
  }

  if (pathname.startsWith('/api/v1/pilot/admin/')) {
    requirePilotAdmin(auth);
    if (method === 'GET' && pathname === '/api/v1/pilot/admin/overview') {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('dias') || 14)));
      json(res, 200, await buildPilotOverview(db, { days, includeSelfTest: url.searchParams.get('teste') === '1' })); return true;
    }
    if (method === 'GET' && pathname === '/api/v1/pilot/admin/heatmap') {
      json(res, 200, await buildHeatmap(db, {
        product: String(url.searchParams.get('produto') || ''), screen: String(url.searchParams.get('tela') || ''),
        participantId: url.searchParams.get('participante') || null, form: url.searchParams.get('formato') || null, includeSelfTest: url.searchParams.get('teste') === '1',
      })); return true;
    }
    const tl = pathname.match(/^\/api\/v1\/pilot\/admin\/participants\/([A-Za-z0-9_-]+)\/timeline$/);
    if (method === 'GET' && tl) { json(res, 200, { events: await participantTimeline(db, tl[1]) }); return true; }
    if (method === 'POST' && pathname === '/api/v1/pilot/admin/invites') {
      const body = z.object({ label: z.string().trim().min(1).max(60) }).parse(await readJsonBody(req));
      const token = randomToken(18);
      const id = randomId('inv');
      await db.run('INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?)', id, 'tester', body.label, sha256Hex(token), nowIso());
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
      json(res, 201, { id, label: body.label, link: `${proto}://${host}/convite/${token}` }); return true;
    }
    if (method === 'GET' && pathname === '/api/v1/pilot/admin/digests') {
      await ensureDailyDigests(db, { force: true }).catch(() => null);
      json(res, 200, { digests: await listDailyDigests(db, Number(url.searchParams.get('limite') || 14)) }); return true;
    }
    if (method === 'GET' && pathname === '/api/v1/pilot/admin/etha-sob-medida') {
      json(res, 200, { orders: await listSobMedida(db) }); return true;
    }
    const smDetail = pathname.match(/^\/api\/v1\/pilot\/admin\/etha-sob-medida\/([A-Za-z0-9_-]+)$/);
    if (method === 'GET' && smDetail) { json(res, 200, await sobMedidaDetail(db, smDetail[1])); return true; }
    const smFile = pathname.match(/^\/api\/v1\/pilot\/admin\/etha-sob-medida\/([A-Za-z0-9_-]+)\/arquivos\/([A-Za-z0-9_-]+)$/);
    if (method === 'GET' && smFile) { await serveSobMedidaFile(db, res, smFile[1], smFile[2], url.searchParams.get('baixar') === '1'); return true; }
    const smStatus = pathname.match(/^\/api\/v1\/pilot\/admin\/etha-sob-medida\/([A-Za-z0-9_-]+)\/(status|entrega)$/);
    if (method === 'POST' && smStatus) {
      const body = await readJsonBody(req);
      // /entrega {delivered} continua aceito (compatível com a versão anterior do painel).
      const status = smStatus[2] === 'entrega' ? (body.delivered ? 'delivered' : 'production') : z.enum(['new', 'production', 'delivered']).parse(body.status);
      const out = await setSobMedidaStatus(db, smStatus[1], status, auth.user.id);
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'pilot_admin', accountId: null, action: `etha.sob_medida_${status}`, resourceType: 'etha_project', resourceId: out.projectId, meta: {} });
      json(res, 200, { ok: true, ...out }); return true;
    }
    const rev = pathname.match(/^\/api\/v1\/pilot\/admin\/invites\/([A-Za-z0-9_-]+)\/revoke$/);
    if (method === 'POST' && rev) {
      await db.run('UPDATE pilot_invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL', nowIso(), rev[1]);
      json(res, 200, { ok: true }); return true;
    }
  }
  return false;
}
