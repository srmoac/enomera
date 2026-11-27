// Integração de 27/11: homônimos no Agendamento, ações da profissional (recusar, cancelar, propor
// outro horário) com autorização, e conta nova sem o link fictício da sala online.
import { DEMO_PASSWORD } from './demo-credentials.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDb, getDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';
import { findDuplicatePatientCandidate } from '../server/scheduling.mjs';
import * as migration011 from '../server/migrations/011_integracao_2711.mjs';

let server;
let baseUrl;
let tmpDir;

async function api(route, { method = 'GET', body = null, token = null, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${route}`, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function outbox(recipient) {
  return (await api(`/api/v1/dev/outbox?recipient=${encodeURIComponent(recipient)}`)).data.messages || [];
}

async function patientToken(email) {
  await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { professionalSlug: 'helena-duarte', contact: email } });
  const code = /(\d{6})/.exec((await outbox(email))[0].body_preview)[1];
  const v = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { professionalSlug: 'helena-duarte', contact: email, code } });
  assert.equal(v.status, 200);
  return v.data.sessionToken;
}

async function login(email) {
  const r = await api('/api/v1/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.sessionToken;
}

async function newRequest(name, email, key) {
  const r = await api('/api/v1/ambo/public/helena-duarte/requests', {
    method: 'POST', headers: { 'X-Idempotency-Key': key },
    body: { modality: 'online', patientName: name, patientEmail: email, patientPhone: '(11) 90000-0000', consent: true, preferences: { days: ['seg'], periods: ['manha'] }, answers: {} },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.requestId;
}

let helena;
async function confirm(requestId, body = {}) {
  const ov = await api('/api/v1/ambo/pro/overview', { token: helena });
  const slot = ov.data.availableSlots[0];
  const r = await api(`/api/v1/ambo/pro/requests/${requestId}/confirm`, { method: 'POST', token: helena, body: { startAt: slot.startAt, endAt: slot.endAt, modality: 'online', ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.appointment;
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-integ-'));
  process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'test.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'storage');
  delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
  delete process.env.VERCEL;
  // Este arquivo cria muitos pedidos públicos do mesmo IP; o limite por IP tem teste próprio (security.test.mjs).
  process.env.ENOMERA_RATE_LIMIT = 'off';
  server = createEnomeraServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  helena = await login('helena@helenaduartepsi.com.br');
});

test.after(async () => {
  delete process.env.ENOMERA_RATE_LIMIT;
  await new Promise((r) => server.close(r));
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Homônimos com e-mails diferentes não viram um cadastro só e cada e-mail vê a própria consulta', async () => {
  const r1 = await newRequest('Carla Nunes Teste', 'carla.um@exemplo.invalid', 'hom-1');
  await confirm(r1);
  const r2 = await newRequest('Carla Nunes Teste', 'carla.dois@exemplo.invalid', 'hom-2');

  const ov = await api('/api/v1/ambo/pro/overview', { token: helena });
  const req2 = ov.data.requests.find((r) => r.id === r2);
  assert.equal(req2.duplicateCandidate, null, 'nome igual sozinho não sugere junção');
  // O Agendamento manda link_existing só quando há candidato: sem candidato, cria cadastro novo.
  const a2 = await confirm(r2, { patientResolution: 'create_new' });

  const ov2 = await api('/api/v1/ambo/pro/overview', { token: helena });
  const carlas = ov2.data.patients.filter((p) => p.full_name === 'Carla Nunes Teste');
  assert.equal(carlas.length, 2, 'dois cadastros distintos');

  const me2 = await api('/api/v1/ambo/patient/me', { token: await patientToken('carla.dois@exemplo.invalid') });
  assert.equal(me2.status, 200);
  assert.deepEqual(me2.data.appointments.map((a) => a.id), [a2.id], 'o segundo e-mail vê só a própria consulta');
  const me1 = await api('/api/v1/ambo/patient/me', { token: await patientToken('carla.um@exemplo.invalid') });
  assert.ok(!me1.data.appointments.some((a) => a.id === a2.id), 'o primeiro e-mail não vê a consulta do homônimo');

  // Mesmo nome e mesmo e-mail continua sendo a mesma pessoa (sugere juntar).
  const r3 = await newRequest('Carla  Núnes teste', 'CARLA.UM@exemplo.invalid', 'hom-3');
  const ov3 = await api('/api/v1/ambo/pro/overview', { token: helena });
  assert.ok(ov3.data.requests.find((r) => r.id === r3).duplicateCandidate, 'mesmo e-mail e mesmo nome: candidato');
});

test('Regra do candidato: telefone igual não junta quando os e-mails são diferentes; contato igual com outro nome também não', async () => {
  const db = await getDb();
  const acc = await db.get("SELECT id FROM professional_accounts WHERE slug = 'helena-duarte'");
  const now = new Date().toISOString();
  await db.run(`INSERT INTO operational_patients (id, account_id, full_name, email, phone, birth_date, preferred_contact, status, origin, created_at, updated_at)
    VALUES ('pat_regra_1', ?, 'Joana Prado', 'joana@exemplo.invalid', '(11) 97777-1234', '', 'email', 'active', 'teste', ?, ?)`, acc.id, now, now);
  assert.equal(await findDuplicatePatientCandidate(db, acc.id, { fullName: 'Joana Prado', email: 'outra@exemplo.invalid', phone: '11977771234' }), null);
  assert.equal(await findDuplicatePatientCandidate(db, acc.id, { fullName: 'Pedro Prado', email: 'joana@exemplo.invalid' }), null, 'irmão com o e-mail do responsável');
  assert.equal((await findDuplicatePatientCandidate(db, acc.id, { fullName: 'joana prado', email: 'joana@exemplo.invalid' }))?.id, 'pat_regra_1');
  assert.equal((await findDuplicatePatientCandidate(db, acc.id, { fullName: 'Joana Prado', email: '', phone: '11 97777-1234' }))?.id, 'pat_regra_1');
});

test('Cadastro juntado antes da correção: o e-mail do pedido continua vendo a consulta', async () => {
  const r1 = await newRequest('Davi Lopes Teste', 'davi.um@exemplo.invalid', 'leg-1');
  const a1 = await confirm(r1);
  const r2 = await newRequest('Davi Lopes Teste', 'davi.dois@exemplo.invalid', 'leg-2');
  const a2 = await confirm(r2, { patientResolution: 'link_existing', linkPatientId: a1.patient_id });
  assert.equal(a2.patient_id, a1.patient_id);
  const me = await api('/api/v1/ambo/patient/me', { token: await patientToken('davi.dois@exemplo.invalid') });
  assert.ok(me.data.appointments.some((a) => a.id === a2.id));
  assert.ok(!me.data.appointments.some((a) => a.id === a1.id), 'não vê a consulta pedida pelo outro e-mail');
});

test('Overview oferece capabilities e o fuso da conta', async () => {
  const ov = await api('/api/v1/ambo/pro/overview', { token: helena });
  assert.deepEqual(ov.data.capabilities, { declineRequest: true, cancelAppointment: true, proposeReschedule: true });
  assert.equal(ov.data.account.timezone, 'America/Sao_Paulo');
});

test('Recusar pedido: só a dona da agenda, aviso por e-mail e o paciente vê "não foi possível atender"', async () => {
  const email = 'eva.recusa@exemplo.invalid';
  const rid = await newRequest('Eva Recusa Teste', email, 'dec-1');
  const paulo = await login('paulo@consultorio-exemplo.com.br');
  const other = await api(`/api/v1/ambo/pro/requests/${rid}/decline`, { method: 'POST', token: paulo, body: { message: 'x' } });
  assert.ok([403, 404].includes(other.status), `outra profissional não recusa (${other.status})`);
  assert.equal((await api(`/api/v1/ambo/pro/requests/${rid}/decline`, { method: 'POST', body: {} })).status, 401);
  const patTok = await patientToken(email);
  assert.equal((await api(`/api/v1/ambo/pro/requests/${rid}/decline`, { method: 'POST', token: patTok, body: {} })).status, 403);

  const before = (await outbox(email)).length;
  const ok = await api(`/api/v1/ambo/pro/requests/${rid}/decline`, { method: 'POST', token: helena, body: { message: 'Sem horários no momento; posso indicar colegas.' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.request.status, 'declined');
  assert.ok(ok.data.patientNotification);
  const mails = await outbox(email);
  assert.equal(mails.length, before + 1);
  assert.match(mails[0].body_preview, /posso indicar colegas/);

  const again = await api(`/api/v1/ambo/pro/requests/${rid}/decline`, { method: 'POST', token: helena, body: {} });
  assert.equal(again.status, 200);
  assert.equal(again.data.idempotentReplay, true);
  assert.equal((await outbox(email)).length, before + 1, 'repetir não manda outro e-mail');

  const me = await api('/api/v1/ambo/patient/me', { token: patTok });
  const r = me.data.requests.find((x) => x.id === rid);
  assert.equal(r.status, 'declined');
  assert.equal(r.decline_message, 'Sem horários no momento; posso indicar colegas.');

  const ov = await api('/api/v1/ambo/pro/overview', { token: helena });
  assert.equal(ov.data.requests.find((x) => x.id === rid).status, 'declined');

  // Pedido já confirmado não pode ser recusado.
  const rid2 = await newRequest('Eva Confirmada Teste', 'eva2@exemplo.invalid', 'dec-2');
  await confirm(rid2);
  assert.equal((await api(`/api/v1/ambo/pro/requests/${rid2}/decline`, { method: 'POST', token: helena, body: {} })).status, 409);
});

test('Cancelar consulta pela profissional: libera o horário, avisa o paciente e outra conta não cancela', async () => {
  const email = 'fabio.cancela@exemplo.invalid';
  const rid = await newRequest('Fábio Cancela Teste', email, 'can-1');
  const appt = await confirm(rid);
  const paulo = await login('paulo@consultorio-exemplo.com.br');
  const other = await api(`/api/v1/ambo/pro/appointments/${appt.id}/cancel`, { method: 'POST', token: paulo, body: {} });
  assert.ok([403, 404].includes(other.status));
  const before = (await outbox(email)).length;
  const r = await api(`/api/v1/ambo/pro/appointments/${appt.id}/cancel`, { method: 'POST', token: helena, body: { reason: 'Imprevisto' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.appointment.status, 'cancelled');
  assert.equal(r.data.appointment.cancelled_by, 'professional');
  assert.equal((await outbox(email)).length, before + 1);
  const ov = await api('/api/v1/ambo/pro/overview', { token: helena });
  assert.ok(ov.data.availableSlots.some((s) => s.startAt === appt.start_at), 'horário voltou a ficar livre');
});

test('Propor outro horário: consulta fica no horário atual até o paciente aceitar; recusar mantém', async () => {
  const email = 'gina.proposta@exemplo.invalid';
  const rid = await newRequest('Gina Proposta Teste', email, 'prop-1');
  const appt = await confirm(rid);
  await confirm(await newRequest('Ivo Intruso Teste', 'ivo.intruso@exemplo.invalid', 'prop-intruso'));
  const ov = await api('/api/v1/ambo/pro/overview', { token: helena });
  const target = ov.data.availableSlots.find((s) => s.startAt !== appt.start_at);
  const paulo = await login('paulo@consultorio-exemplo.com.br');
  assert.ok([403, 404].includes((await api(`/api/v1/ambo/pro/appointments/${appt.id}/reschedule`, { method: 'POST', token: paulo, body: { startAt: target.startAt, endAt: target.endAt } })).status));

  const p = await api(`/api/v1/ambo/pro/appointments/${appt.id}/reschedule`, { method: 'POST', token: helena, headers: { 'X-Idempotency-Key': 'prop-a' }, body: { startAt: target.startAt, endAt: target.endAt, reason: 'Congresso' } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal(p.data.appointment.start_at, appt.start_at, 'horário atual continua');
  assert.equal(p.data.reschedule.status, 'proposed');
  const replay = await api(`/api/v1/ambo/pro/appointments/${appt.id}/reschedule`, { method: 'POST', token: helena, headers: { 'X-Idempotency-Key': 'prop-a' }, body: { startAt: target.startAt, endAt: target.endAt } });
  assert.equal(replay.status, 200);
  const ovP = await api('/api/v1/ambo/pro/overview', { token: helena });
  assert.equal(ovP.data.appointments.find((a) => a.id === appt.id).proposedReschedule.requested_start_at, target.startAt);

  const tok = await patientToken(email);
  const me = await api('/api/v1/ambo/patient/me', { token: tok });
  const proposal = me.data.appointments.find((a) => a.id === appt.id).reschedules.find((r) => r.status === 'proposed');
  assert.equal(proposal.initiated_by, 'professional');
  assert.equal(proposal.requested_start_at, target.startAt);

  // Outro paciente não responde por ela.
  const intruso = await patientToken('ivo.intruso@exemplo.invalid');
  assert.equal((await api(`/api/v1/ambo/patient/reschedules/${proposal.id}/respond`, { method: 'POST', token: intruso, body: { decision: 'accept' } })).status, 404);

  const acc = await api(`/api/v1/ambo/patient/reschedules/${proposal.id}/respond`, { method: 'POST', token: tok, body: { decision: 'accept' } });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.appointment.start_at, target.startAt);
  assert.equal(acc.data.reschedule.status, 'approved');

  // Segunda proposta, recusada pelo paciente: o horário fica como está.
  const ov2 = await api('/api/v1/ambo/pro/overview', { token: helena });
  const t2 = ov2.data.availableSlots.find((s) => s.startAt !== target.startAt);
  const p2 = await api(`/api/v1/ambo/pro/appointments/${appt.id}/reschedule`, { method: 'POST', token: helena, body: { startAt: t2.startAt, endAt: t2.endAt } });
  assert.equal(p2.status, 201);
  const dec = await api(`/api/v1/ambo/patient/reschedules/${p2.data.reschedule.id}/respond`, { method: 'POST', token: tok, body: { decision: 'decline' } });
  assert.equal(dec.status, 200);
  assert.equal(dec.data.appointment.start_at, target.startAt);

  // Horário ocupado não pode ser proposto.
  const busy = await api(`/api/v1/ambo/pro/appointments/${appt.id}/reschedule`, { method: 'POST', token: helena, body: { startAt: target.startAt, endAt: target.endAt } });
  assert.equal(busy.status, 201, 'propor o próprio horário atual não conflita com ela mesma');
  const otherRid = await newRequest('Hugo Ocupa Teste', 'hugo@exemplo.invalid', 'prop-2');
  const otherAppt = await confirm(otherRid);
  const clash = await api(`/api/v1/ambo/pro/appointments/${appt.id}/reschedule`, { method: 'POST', token: helena, body: { startAt: otherAppt.start_at, endAt: otherAppt.end_at } });
  assert.equal(clash.status, 409);
});

test('Conta nova não herda o link fictício da sala online; a migração limpa contas reais antigas', async () => {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(`INSERT INTO users (id, email, password_hash, password_salt, full_name, role, created_at, updated_at) VALUES ('usr_sala', 'sala@exemplo.invalid', 'x', 'y', 'Sala', 'professional', ?, ?)`, now, now);
  await db.run(`INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, created_at, updated_at) VALUES ('acc_sala_real', 'usr_sala', 'sala-real', 'Sala Real', ?, ?)`, now, now);
  await db.run(`INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, is_demo_sandbox, created_at, updated_at) VALUES ('acc_sala_demo', 'usr_sala', 'sala-demo', 'Sala Demo', 1, ?, ?)`, now, now);
  assert.equal((await db.get("SELECT online_meeting_url u FROM professional_accounts WHERE id = 'acc_sala_real'")).u, migration011.DEMO_MEETING_URL, 'padrão antigo da coluna');
  await migration011.apply(db);
  assert.equal((await db.get("SELECT online_meeting_url u FROM professional_accounts WHERE id = 'acc_sala_real'")).u, '');
  assert.equal((await db.get("SELECT online_meeting_url u FROM professional_accounts WHERE id = 'acc_sala_demo'")).u, migration011.DEMO_MEETING_URL);

  const email = 'nova.sala@exemplo.invalid';
  await api('/api/v1/auth/email-code/request', { method: 'POST', body: { email } });
  const code = /(\d{6})/.exec((await outbox(email))[0].body_preview)[1];
  const v = await api('/api/v1/auth/email-code/verify', { method: 'POST', body: { email, code, fullName: 'Nova Sala', password: 'Sol-de-inverno-2026', acceptTerms: true } });
  assert.ok([200, 201].includes(v.status), JSON.stringify(v.data));
  const row = await db.get('SELECT pa.online_meeting_url u FROM professional_accounts pa JOIN users us ON us.id = pa.owner_user_id WHERE us.email = ?', email);
  assert.equal(row?.u, '');
});

test('Passagem para produto no mesmo domínio (origem + caminho) é trocada pela página do produto', async () => {
  process.env.ENOMERA_PUBLIC_URL = 'https://enomera.exemplo.invalid';
  try {
    const target = 'https://enomera.exemplo.invalid/consultorio';
    const h = await api('/api/v1/auth/handoff', { method: 'POST', token: helena, body: { targetOrigin: target, returnPath: '/?aba=dia' } });
    assert.equal(h.status, 200, JSON.stringify(h.data));
    const other = await api('/api/v1/auth/exchange', { method: 'POST', headers: { Origin: 'https://outro.exemplo.invalid' }, body: { handoffCode: h.data.handoffCode } });
    assert.equal(other.status, 403);
    const ex = await api('/api/v1/auth/exchange', { method: 'POST', headers: { Origin: 'https://enomera.exemplo.invalid' }, body: { handoffCode: h.data.handoffCode } });
    assert.equal(ex.status, 200, JSON.stringify(ex.data));
    assert.equal(ex.data.returnPath, '/?aba=dia');
    const bad = await api('/api/v1/auth/handoff', { method: 'POST', token: helena, body: { targetOrigin: 'https://enomera.exemplo.invalid/outra-coisa' } });
    assert.equal(bad.status, 400, 'só /agendamento, /consultorio e /site');
  } finally {
    delete process.env.ENOMERA_PUBLIC_URL;
  }
});

test('"Ver site publicado" no portal leva ao endereço dos sites publicados, não à vitrine de demonstração', async () => {
  const { productOrigin } = await import('../public/eno-origins.js');
  const prod = { hostname: 'enomera.vercel.app', origin: 'https://enomera.vercel.app' };
  assert.equal(productOrigin('sites', prod, {}), 'https://enomera-sites.vercel.app');
  assert.equal(productOrigin('sites', prod, { __ENOMERA_SITES_URL: 'https://sites.exemplo.com.br/' }), 'https://sites.exemplo.com.br');
  // Em máquina local, mesma porta que o Enomera Site usa para os sites (3005).
  assert.equal(productOrigin('sites', { hostname: '127.0.0.1', origin: 'http://127.0.0.1:4319' }, {}), 'http://127.0.0.1:3005');
  const platform = fs.readFileSync('public/platform.js', 'utf8');
  assert.match(platform, /APP_ORIGINS\.sites\}\/\$\{encodeURIComponent\(s\.account\.slug\)\}/);
  assert.doesNotMatch(platform, /APP_ORIGINS\.helena\}\/\?site=/);
  assert.doesNotMatch(fs.readFileSync('public/piloto/painel.js', 'utf8'), /etha-enomera-sites/);
});
