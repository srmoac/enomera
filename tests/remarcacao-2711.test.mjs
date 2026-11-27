// Remarcação de 27/11 (relato do Marcos): o paciente pediu só terças; a profissional confirmou numa quarta;
// o paciente pediu outro horário e a profissional não conseguia confirmar nem propor outro (só cancelar).
import { DEMO_PASSWORD } from './demo-credentials.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';

let server;
let baseUrl;
let tmpDir;
let helena;

async function api(route, { method = 'GET', body = null, token = null, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${route}`, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function patientToken(email) {
  await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { professionalSlug: 'helena-duarte', contact: email } });
  const msgs = (await api(`/api/v1/dev/outbox?recipient=${encodeURIComponent(email)}`)).data.messages || [];
  const code = /(\d{6})/.exec(msgs[0].body_preview)[1];
  const v = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { professionalSlug: 'helena-duarte', contact: email, code } });
  assert.equal(v.status, 200);
  return v.data.sessionToken;
}
const weekday = (s) => new Date(`${s.date}T12:00:00`).getDay(); // 2 = terça, 3 = quarta, 1 = segunda

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-remarc-'));
  process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'test.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'storage');
  delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
  delete process.env.VERCEL;
  process.env.ENOMERA_RATE_LIMIT = 'off';
  server = createEnomeraServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const r = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'helena@helenaduartepsi.com.br', password: DEMO_PASSWORD } });
  assert.equal(r.status, 200);
  helena = r.data.sessionToken;
});

test.after(async () => {
  delete process.env.ENOMERA_RATE_LIMIT;
  await new Promise((r) => server.close(r));
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Pedido só às terças: preferências acompanham a consulta, a remarcação e a resposta da profissional', async () => {
  const email = 'tereza.tercas@exemplo.invalid';
  const req = await api('/api/v1/ambo/public/helena-duarte/requests', {
    method: 'POST', headers: { 'X-Idempotency-Key': 'tercas-1' },
    body: { modality: 'online', patientName: 'Tereza Terças Teste', patientEmail: email, patientPhone: '(11) 90000-0001', consent: true, preferences: { days: ['ter'], periods: ['manha', 'tarde'] }, answers: {} },
  });
  assert.equal(req.status, 201, JSON.stringify(req.data));

  // A profissional confirma fora do pedido (o caso relatado): uma quarta.
  const ov0 = await api('/api/v1/ambo/pro/overview', { token: helena });
  const wed = ov0.data.availableSlots.find((s) => weekday(s) === 3);
  assert.ok(wed, 'a agenda de teste tem quartas');
  const conf = await api(`/api/v1/ambo/pro/requests/${req.data.requestId}/confirm`, { method: 'POST', token: helena, body: { startAt: wed.startAt, endAt: wed.endAt, modality: 'online' } });
  assert.equal(conf.status, 201, JSON.stringify(conf.data));
  const appt = conf.data.appointment;

  const ov1 = await api('/api/v1/ambo/pro/overview', { token: helena });
  assert.deepEqual(ov1.data.appointments.find((a) => a.id === appt.id).requestPreferences.days, ['ter'], 'a consulta lembra o que foi pedido');

  // Paciente: a lista de remarcação traz os 14 dias (não só os primeiros 20 horários, que caíam todos na segunda).
  const tok = await patientToken(email);
  const me = await api('/api/v1/ambo/patient/me', { token: tok });
  assert.ok(me.data.availableSlots.length > 20, `lista completa (${me.data.availableSlots.length})`);
  assert.ok(me.data.availableSlots.some((s) => weekday(s) === 2), 'terças aparecem para remarcar');
  assert.deepEqual(me.data.requests.find((r) => r.appointment_id === appt.id).preferences.days, ['ter']);

  // Paciente pede segunda 14h (ou o primeiro horário de segunda).
  const mon = me.data.availableSlots.find((s) => weekday(s) === 1 && s.startTime === '14:00') || me.data.availableSlots.find((s) => weekday(s) === 1);
  const rr = await api(`/api/v1/ambo/patient/appointments/${appt.id}/reschedule`, { method: 'POST', token: tok, headers: { 'X-Idempotency-Key': 'tercas-r1' }, body: { requestedStartAt: mon.startAt, requestedEndAt: mon.endAt } });
  assert.equal(rr.status, 201, JSON.stringify(rr.data));

  const ov2 = await api('/api/v1/ambo/pro/overview', { token: helena });
  const a2 = ov2.data.appointments.find((a) => a.id === appt.id);
  assert.equal(a2.pendingReschedule?.requested_start_at, mon.startAt, 'a Agenda mostra o pedido para responder ali mesmo');

  // Propor outro horário em resposta ao pedido do paciente: antes dava "horário acabou de ser ocupado".
  const tue = ov2.data.availableSlots.find((s) => weekday(s) === 2 && s.startAt !== mon.startAt);
  const prop = await api(`/api/v1/ambo/pro/appointments/${appt.id}/reschedule`, { method: 'POST', token: helena, headers: { 'X-Idempotency-Key': 'tercas-p1' }, body: { startAt: tue.startAt, endAt: tue.endAt } });
  assert.equal(prop.status, 201, JSON.stringify(prop.data));
  assert.equal(prop.data.reschedule.status, 'proposed');
  assert.equal(prop.data.appointment.status, 'confirmed', 'vale o horário atual até o paciente responder');
  const ov3 = await api('/api/v1/ambo/pro/overview', { token: helena });
  assert.equal(ov3.data.pendingReschedules.filter((r) => r.appointment_id === appt.id).length, 0, 'o pedido do paciente foi respondido');

  // Paciente aceita a terça proposta.
  const me2 = await api('/api/v1/ambo/patient/me', { token: tok });
  const proposal = me2.data.appointments.find((a) => a.id === appt.id).reschedules.find((r) => r.status === 'proposed');
  const acc = await api(`/api/v1/ambo/patient/reschedules/${proposal.id}/respond`, { method: 'POST', token: tok, body: { decision: 'accept' } });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal(acc.data.appointment.start_at, tue.startAt);

  // Novo pedido do paciente e a profissional confirma o horário pedido (ação principal).
  const me3 = await api('/api/v1/ambo/patient/me', { token: tok });
  const tue2 = me3.data.availableSlots.find((s) => weekday(s) === 2 && s.startAt !== tue.startAt);
  const rr2 = await api(`/api/v1/ambo/patient/appointments/${appt.id}/reschedule`, { method: 'POST', token: tok, headers: { 'X-Idempotency-Key': 'tercas-r2' }, body: { requestedStartAt: tue2.startAt, requestedEndAt: tue2.endAt } });
  assert.equal(rr2.status, 201);
  const pend = (await api('/api/v1/ambo/pro/overview', { token: helena })).data.pendingReschedules.find((r) => r.appointment_id === appt.id);
  assert.deepEqual(pend.requestPreferences.days, ['ter']);
  const ok = await api(`/api/v1/ambo/pro/reschedules/${pend.id}/decide`, { method: 'POST', token: helena, body: { decision: 'approve', newStartAt: pend.requested_start_at, newEndAt: pend.requested_end_at } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.appointment.start_at, tue2.startAt);
  assert.equal(ok.data.appointment.status, 'confirmed');
});
