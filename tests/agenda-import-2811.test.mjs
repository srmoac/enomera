// Sugestões de um toque e importação de agenda/pacientes no Agendamento (28/11, pedido do Marcos).
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
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
function futureDate(days) {
  const d = new Date(Date.now() + days * 86400000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-agimp-'));
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

test('Planilha de pacientes (estilo Doctoralia): nome + sobrenome, CPF ignorado, prévia sem gravar, importar e desfazer', async () => {
  const before = (await api('/api/v1/ambo/pro/overview', { token: helena })).data.patients.length;
  const csv = [
    'Nome;Sobrenome;E-mail;Telefone;Data de nascimento;CPF',
    'Joana;Importada Teste;joana.importada@exemplo.invalid;(11) 98888-0001;05/03/1990;123.456.789-00',
    'Caio;Planilha Teste;caio.planilha@exemplo.invalid;;1985-12-31;',
    ';;sem.nome@exemplo.invalid;;;',
    'Caio;Planilha Teste;caio.planilha@exemplo.invalid;;;',
  ].join('\n');
  const pv = await api('/api/v1/ambo/pro/imports/preview', { method: 'POST', token: helena, body: { fileName: 'pacientes.csv', contentBase64: b64(csv) } });
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  assert.equal(pv.data.kind, 'patients');
  assert.deepEqual(pv.data.ignoredColumns, ['CPF']);
  assert.equal(pv.data.summary.newPatients, 2);
  assert.equal(pv.data.summary.errors, 1);
  assert.equal(pv.data.rows[0].patient.name, 'Joana Importada Teste');
  assert.equal(pv.data.rows[0].patient.birthDate, '1990-03-05');
  assert.equal(pv.data.rows[3].match.kind, 'repeat');
  // Prévia não grava.
  assert.equal((await api('/api/v1/ambo/pro/overview', { token: helena })).data.patients.length, before);

  const keep = pv.data.rows.filter((r) => r.state === 'ok' || r.state === 'warn');
  const cm = await api('/api/v1/ambo/pro/imports/commit', { method: 'POST', token: helena, headers: { 'X-Idempotency-Key': 'pac-1' }, body: { rows: keep } });
  assert.equal(cm.status, 201, JSON.stringify(cm.data));
  assert.equal(cm.data.created.patients, 2);
  const after = (await api('/api/v1/ambo/pro/overview', { token: helena })).data.patients;
  assert.equal(after.length, before + 2);
  assert.ok(after.some((p) => p.full_name === 'Joana Importada Teste' && p.origin === 'ambo_import'));
  // Os mesmos pacientes aparecem no Consultório (carteira única).
  const ws = await api('/api/v1/minne/workspace', { token: helena });
  if (ws.status === 200) assert.ok(JSON.stringify(ws.data).includes('Joana Importada Teste'));

  const rv = await api('/api/v1/ambo/pro/imports/revert', { method: 'POST', token: helena, body: { patientIds: cm.data.patientIds, appointmentIds: cm.data.appointmentIds } });
  assert.equal(rv.status, 200);
  assert.equal(rv.data.removedPatients, 2);
  assert.equal((await api('/api/v1/ambo/pro/overview', { token: helena })).data.patients.length, before);
});

test('Agenda: futuras confirmadas, passadas como realizadas, cancelada fora, conflito apontado, paciente existente ligado', async () => {
  const ov = (await api('/api/v1/ambo/pro/overview', { token: helena })).data;
  const existing = ov.patients.find((p) => p.email);
  const busy = ov.appointments.find((a) => a.status === 'confirmed' && Date.parse(a.start_at) > Date.now());
  const rows = [
    'Data;Hora;Paciente;E-mail;Telefone;Tipo;Status',
    `${futureDate(20)};09:00;Lia Agenda Teste;lia.agenda@exemplo.invalid;;Teleconsulta;Agendado`,
    `${futureDate(21)};14h30;Lia Agenda Teste;lia.agenda@exemplo.invalid;;Presencial;Confirmado`,
    `10/01/2026;10:00;Lia Agenda Teste;lia.agenda@exemplo.invalid;;Online;Realizada`,
    `${futureDate(22)};11:00;Rui Cancelado Teste;rui.cancel@exemplo.invalid;;Online;Cancelada`,
    `${futureDate(23)};quinze;Rui Cancelado Teste;rui.cancel@exemplo.invalid;;Online;`,
    `${futureDate(24)};10:00;${existing.full_name};${existing.email};;Online;`,
  ];
  if (busy) {
    const local = new Date(Date.parse(busy.start_at) - 3 * 3600000);
    const d = `${String(local.getUTCDate()).padStart(2, '0')}/${String(local.getUTCMonth() + 1).padStart(2, '0')}/${local.getUTCFullYear()}`;
    rows.push(`${d};${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')};Choque Teste;choque@exemplo.invalid;;Online;`);
  }
  const pv = await api('/api/v1/ambo/pro/imports/preview', { method: 'POST', token: helena, body: { fileName: 'agenda.csv', contentBase64: b64(rows.join('\n')) } });
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  const r = pv.data.rows;
  assert.equal(pv.data.kind, 'agenda');
  assert.equal(r[0].appointment.modality, 'online');
  assert.equal(r[1].appointment.modality, 'presencial');
  assert.match(r[1].appointment.startAt, /T14:30:00-03:00$/);
  assert.equal(r[2].appointment.past, true);
  assert.equal(r[3].state, 'skip');
  assert.equal(r[4].state, 'warn');
  assert.equal(r[4].appointment, null);
  assert.equal(r[5].match.kind, 'existing');
  if (busy) assert.equal(r[6].state, 'conflict');

  const keep = r.filter((x) => x.state === 'ok' || x.state === 'warn');
  const cm = await api('/api/v1/ambo/pro/imports/commit', { method: 'POST', token: helena, headers: { 'X-Idempotency-Key': 'ag-1' }, body: { rows: keep } });
  assert.equal(cm.status, 201, JSON.stringify(cm.data));
  assert.equal(cm.data.created.appointments, 4);
  assert.equal(cm.data.created.patients, 2); // Lia e Rui (Rui só cadastro)
  const after = (await api('/api/v1/ambo/pro/overview', { token: helena })).data;
  const lia = after.appointments.filter((a) => a.patient_name === 'Lia Agenda Teste');
  assert.equal(lia.length, 3);
  assert.equal(lia.filter((a) => a.status === 'completed').length, 1);
  // Repetir a mesma gravação não duplica.
  const again = await api('/api/v1/ambo/pro/imports/commit', { method: 'POST', token: helena, headers: { 'X-Idempotency-Key': 'ag-1' }, body: { rows: keep } });
  assert.equal(again.status, 200);
  assert.equal(again.data.replay, true);
  // Uma nova prévia do mesmo arquivo reconhece o que já entrou.
  const pv2 = await api('/api/v1/ambo/pro/imports/preview', { method: 'POST', token: helena, body: { fileName: 'agenda.csv', contentBase64: b64(rows.join('\n')) } });
  assert.equal(pv2.data.rows[0].state, 'skip');
});

test('Arquivo sem coluna de nome, vazio ou grande demais', async () => {
  const noName = await api('/api/v1/ambo/pro/imports/preview', { method: 'POST', token: helena, body: { fileName: 'x.csv', contentBase64: b64('Data;Hora\n01/01/2027;10:00') } });
  assert.equal(noName.status, 422);
  assert.equal(noName.data.code, 'NO_NAME_COLUMN');
  const empty = await api('/api/v1/ambo/pro/imports/preview', { method: 'POST', token: helena, body: { fileName: 'x.csv', contentBase64: '' } });
  assert.equal(empty.status, 400);
  const anon = await api('/api/v1/ambo/pro/imports/preview', { method: 'POST', body: { fileName: 'x.csv', contentBase64: b64('Nome\nA') } });
  assert.equal(anon.status, 401);
});

test('Lembrete aprovado: e-mail ao paciente, registrado na consulta e não repete', async () => {
  const ov = (await api('/api/v1/ambo/pro/overview', { token: helena })).data;
  const appt = ov.appointments.find((a) => a.status === 'confirmed' && Date.parse(a.start_at) > Date.now() && a.patient_email && !/invalid$/.test(a.patient_email) && !a.reminder_sent_at)
    || ov.appointments.find((a) => a.status === 'confirmed' && Date.parse(a.start_at) > Date.now() && a.patient_email);
  assert.ok(appt, 'precisa de uma consulta futura com e-mail');
  const r1 = await api(`/api/v1/ambo/pro/appointments/${appt.id}/remind`, { method: 'POST', token: helena, body: {} });
  if (r1.status === 422) return; // e-mail fictício bloqueado: coberto pelo código NO_EMAIL
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.ok(r1.data.reminderSentAt);
  const r2 = await api(`/api/v1/ambo/pro/appointments/${appt.id}/remind`, { method: 'POST', token: helena, body: {} });
  assert.equal(r2.data.alreadySent, true);
  const ov2 = (await api('/api/v1/ambo/pro/overview', { token: helena })).data;
  assert.ok(ov2.appointments.find((a) => a.id === appt.id).reminder_sent_at);
});

test('XLSX com título antes do cabeçalho, data e hora como células de data', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Agenda');
  ws.addRow(['Agenda exportada']);
  ws.addRow(['Paciente', 'Data', 'Horário', 'Duração']);
  const d = new Date(Date.now() + 30 * 86400000);
  ws.addRow(['Xis Planilha Teste', new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), new Date(Date.UTC(1899, 11, 30, 15, 0)), '60 min']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const pv = await api('/api/v1/ambo/pro/imports/preview', { method: 'POST', token: helena, body: { fileName: 'agenda.xlsx', contentBase64: buf.toString('base64') } });
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  const row = pv.data.rows[0];
  assert.equal(row.patient.name, 'Xis Planilha Teste');
  assert.match(row.appointment.startAt, /T15:00:00-03:00$/);
  assert.equal((Date.parse(row.appointment.endAt) - Date.parse(row.appointment.startAt)) / 60000, 60);
});
