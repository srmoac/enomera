import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  getDb,
  closeDb,
  toPostgresPlaceholders,
  getAppliedMigrations,
  isRemoteInfraRequired,
  getRemoteInfraGuard,
} from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';
import { sendTransactionalEmail } from '../server/mailer.mjs';

let server;
let baseUrl;
let tmpDir;

async function api(route, { method = 'GET', body = null, token = null, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: h,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, headers: res.headers };
}

function extractSixDigitCode(outboxRes) {
  const msg = outboxRes.data.messages[0];
  assert.ok(msg, 'Expected outbox message');
  const m = /(\d{6})/.exec(msg.body_preview);
  assert.ok(m, `Expected 6-digit code in ${msg.body_preview}`);
  return m[1];
}

// Minimal valid PDF with real extractable text
function makeSimplePdfBuffer(text = 'Evolucao clinica ficticia importada de PDF') {
  const safe = text.replace(/[()\\]/g, '');
  const stream = `BT /F1 12 Tf 50 750 Td (${safe}) Tj ET`;
  const objs = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n',
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const o of objs) {
    offsets.push(pdf.length);
    pdf += o;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

// Minimal valid DOCX (OpenXML ZIP with word/document.xml)
async function makeSimpleDocxBuffer(text = 'Prontuario ficticio extraido de DOCX via Mammoth') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return await zip.generateAsync({ type: 'nodebuffer' });
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-test-'));
  process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'test.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'private');
  const db = await getDb(process.env.ENOMERA_DB_PATH);
  server = createEnomeraServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('1. Auth lifecycle: signup, real email verification, login, recovery + session revocation, cross-domain handoff', async () => {
  const signup = await api('/api/v1/auth/signup', {
    method: 'POST',
    body: { fullName: 'Dra. Clara Teste', email: 'clara.teste@exemplo.invalid', password: 'SenhaSegura!2026', crpOrCrm: 'CRP 06/999001' },
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.data.verification.delivery.deliveryStatus, 'not_configured_local_outbox');
  const token1 = signup.data.sessionToken;

  const outbox = await api('/api/v1/dev/outbox?recipient=clara.teste@exemplo.invalid');
  const code = extractSixDigitCode(outbox);
  const ver = await api('/api/v1/auth/verify-email', { method: 'POST', token: token1, body: { email: 'clara.teste@exemplo.invalid', code } });
  assert.equal(ver.status, 200);
  assert.equal(ver.data.verified, true);

  // Cross-domain handoff code: single-use + origin checked
  const hnd = await api('/api/v1/auth/handoff', { method: 'POST', token: token1, body: { targetOrigin: 'http://127.0.0.1:3002', returnPath: '/agenda' } });
  assert.equal(hnd.status, 200);
  const badOrigin = await api('/api/v1/auth/exchange', { method: 'POST', headers: { Origin: 'http://127.0.0.1:9999' }, body: { handoffCode: hnd.data.handoffCode } });
  assert.equal(badOrigin.status, 403);
  const goodEx = await api('/api/v1/auth/exchange', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3002' }, body: { handoffCode: hnd.data.handoffCode } });
  assert.equal(goodEx.status, 200);
  assert.equal(goodEx.data.returnPath, '/agenda');
  // Single-use replay must fail
  const replayEx = await api('/api/v1/auth/exchange', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3002' }, body: { handoffCode: hnd.data.handoffCode } });
  assert.equal(replayEx.status, 401);

  // Password recovery revokes old sessions
  await api('/api/v1/auth/recovery/request', { method: 'POST', body: { email: 'clara.teste@exemplo.invalid' } });
  const outbox2 = await api('/api/v1/dev/outbox?recipient=clara.teste@exemplo.invalid');
  const resetCode = extractSixDigitCode(outbox2);
  const confirmReset = await api('/api/v1/auth/recovery/confirm', {
    method: 'POST',
    body: { email: 'clara.teste@exemplo.invalid', code: resetCode, newPassword: 'NovaSenhaSegura!2026' },
  });
  assert.equal(confirmReset.status, 200);
  const oldMe = await api('/api/v1/auth/me', { token: token1 });
  assert.equal(oldMe.status, 401);
});

test('2. Commercial simulation catalog (R$ 79 combo Ambo + Minne), idempotent checkout, declined->retry->approved, partial cancel', async () => {
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'clara.teste@exemplo.invalid', password: 'NovaSenhaSegura!2026' } });
  assert.equal(login.status, 200);
  const token = login.data.sessionToken;

  // Verify authoritative server quote for Ambo + Minne = R$ 89/mês (NOT 15% stacked)
  const quote = await api('/api/v1/catalog/quote', { method: 'POST', body: { products: ['ambo', 'minne'] } });
  assert.equal(quote.status, 200);
  assert.equal(quote.data.dueTodayCents, 0);
  assert.equal(quote.data.referenceDueTodayCents, 7900);
  assert.equal(quote.data.recurringMonthlyCents, 7900);
  assert.equal(quote.data.discountCents, 1900);

  // Declined checkout preserves order without activating entitlements
  const decl = await api('/api/v1/commercial/orders', {
    method: 'POST', token, headers: { 'X-Idempotency-Key': 'ord-clara-1' },
    body: { products: ['ambo', 'minne'], simulatedOutcome: 'declined', method: 'simulated_card' },
  });
  assert.equal(decl.status, 201);
  assert.equal(decl.data.order.status, 'declined');
  assert.equal(decl.data.entitlements.ambo, null);

  // Double-click idempotency returns same order
  const replay = await api('/api/v1/commercial/orders', {
    method: 'POST', token, headers: { 'X-Idempotency-Key': 'ord-clara-1' },
    body: { products: ['ambo', 'minne'], simulatedOutcome: 'approved' },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.idempotentReplay, true);
  assert.equal(replay.data.order.id, decl.data.order.id);

  // Retry approves and activates Ambo + Minne server-side
  const retry = await api(`/api/v1/commercial/orders/${decl.data.order.id}/retry`, {
    method: 'POST', token, body: { simulatedOutcome: 'approved', method: 'simulated_pix' },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.entitlements.ambo.status, 'active');
  assert.equal(retry.data.entitlements.minne.status, 'active');

  // Partial cancellation keeps Minne active and Ambo read-only
  const canc = await api('/api/v1/commercial/entitlements/ambo/cancel', { method: 'POST', token, body: {} });
  assert.equal(canc.data.entitlements.ambo.status, 'read_only');
  assert.equal(canc.data.entitlements.minne.status, 'active');
  await api('/api/v1/commercial/entitlements/ambo/reactivate', { method: 'POST', token, body: {} });
});

test('3. Milestone 1 End-to-End: Ambo request -> Minne confirm -> Concurrency conflict -> Patient verified tracking -> Reschedule keeping original -> Approve', async () => {
  const helenaLogin = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'helena@helenaduartepsi.com.br', password: 'HelenaDemo!2026' } });
  const helenaToken = helenaLogin.data.sessionToken;

  // Patient submits 1st consultation request on Ambo (idempotent!)
  const req1 = await api('/api/v1/ambo/public/helena-duarte/requests', {
    method: 'POST', headers: { 'X-Idempotency-Key': 'marina-req-1' },
    body: {
      modality: 'online',
      patientName: 'Marina Alves',
      patientEmail: 'marina.alves@exemplo.invalid',
      patientPhone: '(11) 98412-3091',
      preferences: { days: ['ter', 'qui'], periods: ['tarde'] },
      answers: { expectations: 'Ansiedade no trabalho' },
    },
  });
  assert.equal(req1.status, 201);
  assert.equal(req1.data.status, 'preference_sent');
  assert.equal(req1.data.slotLocked, false);
  const reqReplay = await api('/api/v1/ambo/public/helena-duarte/requests', {
    method: 'POST', headers: { 'X-Idempotency-Key': 'marina-req-1' },
    body: { modality: 'online', patientName: 'Marina Alves', patientEmail: 'marina.alves@exemplo.invalid', patientPhone: '(11) 98412-3091', preferences: { days: ['ter'], periods: ['tarde'] } },
  });
  assert.equal(reqReplay.data.idempotentReplay, true);

  // Helena opens Minne and sees Marina's request + dynamic future slots (not Nov 2026 hardcoded!)
  const ws = await api('/api/v1/minne/workspace', { token: helenaToken });
  assert.equal(ws.status, 200);
  const foundReq = ws.data.requests.find((r) => r.id === req1.data.requestId);
  assert.ok(foundReq, 'Request from Ambo must appear in Minne');
  assert.ok(ws.data.availableSlots.length >= 2);
  const slot1 = ws.data.availableSlots[0];
  const slot2 = ws.data.availableSlots[1];

  // Helena confirms Marina on slot1 (with simulatedDelayedSync to verify sync recovery!)
  const conf = await api(`/api/v1/minne/requests/${req1.data.requestId}/confirm`, {
    method: 'POST', token: helenaToken, headers: { 'X-Idempotency-Key': 'conf-marina-1' },
    body: { startAt: slot1.startAt, endAt: slot1.endAt, modality: 'online', simulateDelayedSync: true },
  });
  assert.equal(conf.status, 201);
  assert.equal(conf.data.syncEvent.status, 'pending_retry');
  // Retry sync without repeating business confirmation
  const retrySync = await api(`/api/v1/sync/events/${conf.data.syncEvent.id}/retry`, { method: 'POST', token: helenaToken, body: {} });
  assert.equal(retrySync.data.event.status, 'synced');

  // Concurrency check: second manual appointment for Ana on exact same slot1 MUST fail with 409 SLOT_CONFLICT!
  const conflict = await api('/api/v1/minne/appointments', {
    method: 'POST', token: helenaToken,
    body: { patientId: 'pat_ana_demo', startAt: slot1.startAt, endAt: slot1.endAt, modality: 'online' },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'SLOT_CONFLICT');
  assert.ok(Array.isArray(conflict.data.suggestions));

  // Unauthenticated patient CANNOT read private appointment data
  const unauthPat = await api('/api/v1/ambo/patient/me');
  assert.equal(unauthPat.status, 401);

  // Marina verifies contact via real 6-digit code
  await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { professionalSlug: 'helena-duarte', contact: 'marina.alves@exemplo.invalid' } });
  const patBox = await api('/api/v1/dev/outbox?recipient=marina.alves@exemplo.invalid');
  const patCode = extractSixDigitCode(patBox);
  const patVer = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { professionalSlug: 'helena-duarte', contact: 'marina.alves@exemplo.invalid', code: patCode } });
  assert.equal(patVer.status, 200);
  const marinaToken = patVer.data.sessionToken;
  assert.equal(patVer.data.professionalSlug, 'helena-duarte');

  // Entrada direta do Ambo (sem link da profissional): o e-mail basta, e o código leva à profissional certa.
  const unknownReq = await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { contact: 'ninguem@exemplo.invalid' } });
  assert.equal(unknownReq.status, 200);

  const patMe = await api('/api/v1/ambo/patient/me', { token: marinaToken });
  assert.equal(patMe.status, 200);
  assert.equal(patMe.data.appointments[0].id, conf.data.appointment.id);
  assert.equal(patMe.data.appointments[0].start_at, slot1.startAt);
  // Zero clinical notes in patient payload!
  assert.equal(JSON.stringify(patMe.data).includes('Registro clínico fictício'), false);

  // Marina requests reschedule to slot2 — original slot1 MUST stay confirmed until Helena approves!
  const rsc = await api(`/api/v1/ambo/patient/appointments/${conf.data.appointment.id}/reschedule`, {
    method: 'POST', token: marinaToken, headers: { 'X-Idempotency-Key': 'rsc-1' },
    body: { requestedStartAt: slot2.startAt, requestedEndAt: slot2.endAt, reason: 'Reunião no trabalho' },
  });
  assert.equal(rsc.status, 201);
  assert.equal(rsc.data.appointment.start_at, slot1.startAt);
  assert.equal(rsc.data.appointment.status, 'reschedule_requested');

  // Helena approves reschedule -> slot2 occupied, slot1 freed!
  const dec = await api(`/api/v1/minne/reschedules/${rsc.data.reschedule.id}/decide`, {
    method: 'POST', token: helenaToken, body: { decision: 'approve' },
  });
  assert.equal(dec.status, 200);
  assert.equal(dec.data.appointment.start_at, slot2.startAt);
  assert.equal(dec.data.appointment.status, 'confirmed');

  // Slot1 is now free for Ana!
  const anaOnSlot1 = await api('/api/v1/minne/appointments', {
    method: 'POST', token: helenaToken,
    body: { patientId: 'pat_ana_demo', startAt: slot1.startAt, endAt: slot1.endAt, modality: 'presencial' },
  });
  assert.equal(anaOnSlot1.status, 201);
});

test('4. Strict Isolation: Paulo (Pro 2), Marina (Patient), and Marcos (Etha Operator) CANNOT access Helena clinical notes or private files', async () => {
  const pauloToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'paulo@consultorio-exemplo.com.br', password: 'PauloDemo!2026' } })).data.sessionToken;
  const marcosToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'marcos@enomera-ops.exemplo.com.br', password: 'MarcosOps!2026' } })).data.sessionToken;

  // Paulo trying to read Helena's patient Ana -> 404 (scoped to Paulo's account)
  const pauloRead = await api('/api/v1/minne/patients/pat_ana_demo/notes', { token: pauloToken });
  assert.equal(pauloRead.status, 404);

  // Marcos (Etha Operator) trying to access Minne clinical workspace -> 403!
  const marcosMinne = await api('/api/v1/minne/workspace', { token: marcosToken });
  assert.equal(marcosMinne.status, 403);
  const marcosNotes = await api('/api/v1/minne/patients/pat_ana_demo/notes', { token: marcosToken });
  assert.equal(marcosNotes.status, 403);
});

test('5. Minne 6-mode Import Engine: text, PDF, DOCX, CSV, XLSX (no formula exec), JSON, PNG scan, ZIP batch + duplicate + partial fail + revert', async () => {
  const helenaToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'helena@helenaduartepsi.com.br', password: 'HelenaDemo!2026' } })).data.sessionToken;

  // 5a. Pasted text with unknown date/author -> preserved as external_import
  const bText = await api('/api/v1/minne/imports/stage', {
    method: 'POST', token: helenaToken,
    body: { sourceKind: 'pasted_text', targetPatientId: 'pat_ana_demo', pastedText: 'Evolucao antiga colada manualmente.', sourceKey: 'TEXT-001' },
  });
  assert.equal(bText.status, 201);
  assert.equal(bText.data.batch.items[0].occurred_at, null);
  const cText = await api(`/api/v1/minne/imports/${bText.data.batch.id}/commit`, { method: 'POST', token: helenaToken, body: { idempotencyKey: 'imp-txt-1' } });
  assert.equal(cText.data.batch.imported_count, 1);

  // Re-importing same sourceKey detects duplicate!
  const bDup = await api('/api/v1/minne/imports/stage', {
    method: 'POST', token: helenaToken,
    body: { sourceKind: 'pasted_text', targetPatientId: 'pat_ana_demo', pastedText: 'Evolucao antiga colada manualmente.', sourceKey: 'TEXT-001' },
  });
  assert.equal(bDup.data.batch.items[0].status, 'duplicate_review');
  await api(`/api/v1/minne/imports/${bDup.data.batch.id}/cancel`, { method: 'POST', token: helenaToken, body: {} });

  // 5b. Real PDF + DOCX + Legacy .doc rejection + PNG scan
  const pdfBuf = makeSimplePdfBuffer('Registro clinico ficticio no PDF');
  const docxBuf = await makeSimpleDocxBuffer('Registro clinico ficticio no DOCX');
  const pngBuf = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
  const legacyDocBuf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);

  const bDocs = await api('/api/v1/minne/imports/stage', {
    method: 'POST', token: helenaToken,
    body: {
      sourceKind: 'document',
      targetPatientId: 'pat_ana_demo',
      files: [
        { originalName: 'sessao.pdf', contentBase64: pdfBuf.toString('base64') },
        { originalName: 'evolucao.docx', contentBase64: docxBuf.toString('base64') },
        { originalName: 'digitalizacao.png', contentBase64: pngBuf.toString('base64') },
        { originalName: 'antigo.doc', contentBase64: legacyDocBuf.toString('base64') },
      ],
    },
  });
  assert.equal(bDocs.status, 201);
  const items = bDocs.data.batch.items;
  assert.ok(items.find((i) => i.detected_format === 'pdf' && i.extracted_text.includes('PDF')));
  assert.ok(items.find((i) => i.detected_format === 'docx' && i.extracted_text.includes('DOCX')));
  const pngItem = items.find((i) => i.detected_format === 'png');
  assert.ok(pngItem.file_id && pngItem.warnings.some((w) => w.includes('OCR externo')));
  assert.ok(items.find((i) => i.detected_format === 'legacy_doc' && i.status === 'failed'));

  // Commit yields partial_failed (3 imported, 1 legacy .doc failed)
  const cDocs = await api(`/api/v1/minne/imports/${bDocs.data.batch.id}/commit`, { method: 'POST', token: helenaToken, body: {} });
  assert.equal(cDocs.data.batch.status, 'partial_failed');
  assert.equal(cDocs.data.batch.imported_count, 3);
  assert.equal(cDocs.data.batch.failed_count, 1);

  // Private file downloadable by Helena, FORBIDDEN to Marcos (operator) & Paulo!
  const helenaFile = await api(`/api/v1/files/${pngItem.file_id}`, { token: helenaToken });
  assert.equal(helenaFile.status, 200);
  const marcosToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'marcos@enomera-ops.exemplo.com.br', password: 'MarcosOps!2026' } })).data.sessionToken;
  const marcosFile = await api(`/api/v1/files/${pngItem.file_id}`, { token: marcosToken });
  assert.equal(marcosFile.status, 403);

  // 5c. XLSX + CSV + JSON + ZIP batch with folder mapping & revert
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Registros');
  ws.addRow(['paciente', 'data_atendimento', 'autor', 'registro']);
  ws.addRow(['Paciente Planilha Ficticio', '2026-08-15', 'Dr. Origem Externa', 'Evolucao via XLSX']);
  const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());
  const bXlsx = await api('/api/v1/minne/imports/stage', {
    method: 'POST', token: helenaToken,
    body: { sourceKind: 'spreadsheet', files: [{ originalName: 'historico.xlsx', contentBase64: xlsxBuf.toString('base64') }] },
  });
  assert.equal(bXlsx.status, 201);
  assert.equal(bXlsx.data.batch.items[0].status, 'needs_resolution');
  // Resolve by creating new patient explicitly
  await api(`/api/v1/minne/imports/${bXlsx.data.batch.id}/items/${bXlsx.data.batch.items[0].id}`, {
    method: 'PATCH', token: helenaToken,
    body: { resolutionAction: 'create_patient', proposedPatient: { fullName: 'Paciente Planilha Ficticio', email: 'planilha@exemplo.invalid' } },
  });
  const cXlsx = await api(`/api/v1/minne/imports/${bXlsx.data.batch.id}/commit`, { method: 'POST', token: helenaToken, body: {} });
  assert.equal(cXlsx.data.batch.imported_count, 1);

  // ZIP batch with folder mapping (Ana Oliveira/ -> auto-matched; root file -> needs_resolution, never silently assigned!)
  const zip = new JSZip();
  zip.file('Ana Oliveira/nota-antiga.txt', 'Conteudo TXT dentro da pasta da paciente no ZIP.');
  zip.file('sem-paciente.txt', 'Arquivo solto na raiz sem pasta de paciente.');
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const bZip = await api('/api/v1/minne/imports/stage', {
    method: 'POST', token: helenaToken,
    body: { sourceKind: 'batch_zip', files: [{ originalName: 'lote.zip', contentBase64: zipBuf.toString('base64') }] },
  });
  assert.equal(bZip.status, 201);
  const anaZipItem = bZip.data.batch.items.find((i) => i.original_filename.includes('Ana Oliveira'));
  const rootZipItem = bZip.data.batch.items.find((i) => i.original_filename === 'sem-paciente.txt');
  assert.equal(anaZipItem.target_patient_id, 'pat_ana_demo');
  assert.equal(rootZipItem.status, 'needs_resolution');
  // Commit -> 1 imported, 1 failed (unresolved), then resolve & retryFailedOnly!
  const cZip1 = await api(`/api/v1/minne/imports/${bZip.data.batch.id}/commit`, { method: 'POST', token: helenaToken, body: {} });
  assert.equal(cZip1.data.batch.imported_count, 1);
  assert.equal(cZip1.data.batch.failed_count, 1);
  await api(`/api/v1/minne/imports/${bZip.data.batch.id}/items/${rootZipItem.id}`, {
    method: 'PATCH', token: helenaToken,
    body: { resolutionAction: 'attach_existing', targetPatientId: 'pat_bruno_demo' },
  });
  const cZip2 = await api(`/api/v1/minne/imports/${bZip.data.batch.id}/commit`, { method: 'POST', token: helenaToken, body: { retryFailedOnly: true } });
  assert.equal(cZip2.data.batch.imported_count, 2);
  assert.equal(cZip2.data.batch.failed_count, 0);

  // CSV with semicolon separator + JSON enomera-export-v1 + unsupported JSON rejection
  const csvBuf = Buffer.from('paciente;data_atendimento;autor;registro\nAna Oliveira;12/08/2026;Dra. Origem CSV;Evolucao via CSV ponto e virgula\n', 'utf8');
  const bCsv = await api('/api/v1/minne/imports/stage', {
    method: 'POST', token: helenaToken,
    body: { sourceKind: 'spreadsheet', files: [{ originalName: 'registros.csv', contentBase64: csvBuf.toString('base64') }] },
  });
  assert.equal(bCsv.status, 201);
  assert.equal(bCsv.data.batch.items[0].target_patient_id, 'pat_ana_demo');

  const badJson = await api('/api/v1/minne/imports/stage', {
    method: 'POST', token: helenaToken,
    body: { sourceKind: 'structured_json', pastedText: JSON.stringify({ unknownApp: true }) },
  });
  assert.equal(badJson.status, 422);

  // Revert ZIP batch cleanly (only notes from this batch reverted!)
  const rev = await api(`/api/v1/minne/imports/${bZip.data.batch.id}/revert`, { method: 'POST', token: helenaToken, body: {} });
  assert.equal(rev.data.revertedNotes, 2);
});

test('7. Ambo Solo -> later Minne adoption + Patient Invitation single-use + Minne Solo drafts & versions', async () => {
  // New professional starts with Ambo ONLY (R$ 39/mês)
  const su = await api('/api/v1/auth/signup', {
    method: 'POST',
    body: { fullName: 'Dr. Solo Ambo', email: 'solo.ambo@exemplo.invalid', password: 'SenhaSolo!2026', crpOrCrm: 'CRP 06/777111' },
  });
  const soloTok = su.data.sessionToken;
  const slug = su.data.account.slug;
  const soloCode = extractSixDigitCode(await api('/api/v1/dev/outbox?recipient=solo.ambo@exemplo.invalid'));
  assert.equal((await api('/api/v1/auth/verify-email', {method:'POST',token:soloTok,body:{email:'solo.ambo@exemplo.invalid',code:soloCode}})).status,200);
  await api('/api/v1/commercial/orders', {
    method: 'POST', token: soloTok, headers: { 'X-Idempotency-Key': 'solo-ambo-1' },
    body: { products: ['ambo'], simulatedOutcome: 'approved' },
  });
  // Minne MUST be blocked (403) while only Ambo is active
  const blockedMinne = await api('/api/v1/minne/workspace', { token: soloTok });
  assert.equal(blockedMinne.status, 403);

  // Página pública fechada até a profissional revisar o atendimento e abrir a agenda.
  const closedPub = await api(`/api/v1/ambo/public/${slug}`);
  assert.equal(closedPub.data.booking.open, false);
  assert.deepEqual(closedPub.data.professional.modalities, []);
  const closedReq = await api(`/api/v1/ambo/public/${slug}/requests`, {
    method: 'POST', headers: { 'X-Idempotency-Key': 'solo-req-closed' },
    body: { modality: 'online', patientName: 'Joana Solo', patientEmail: 'joana.solo@exemplo.invalid' },
  });
  assert.equal(closedReq.status, 409);
  assert.equal(closedReq.data.code, 'AMBO_NOT_OPEN');
  // Salvar sem informar valor/cidade não publica o exemplo das colunas (R$ 220, São Paulo).
  const draft = await api('/api/v1/ambo/pro/setup', { method: 'PUT', token: soloTok, body: { modalities: ['online'] } });
  assert.equal(draft.status, 200);
  assert.equal(draft.data.setup.sessionPriceCents, null);
  assert.equal(draft.data.setup.city, '');
  assert.equal(draft.data.setup.inPersonAddress, '');
  const opened = await api('/api/v1/ambo/pro/setup', {
    method: 'PUT', token: soloTok,
    body: { modalities: ['online'], sessionDurationMin: 50, sessionPriceCents: 20000, rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '08:00', endTime: '18:00' })), open: true,
      address: { cep: '01310100', street: 'Avenida Paulista', number: '1000', complement: 'sala 4', district: 'Bela Vista', city: 'São Paulo', uf: 'sp' } },
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.data.setup.open, true);
  assert.deepEqual(opened.data.setup.address, { cep: '01310-100', street: 'Avenida Paulista', number: '1000', complement: 'sala 4', district: 'Bela Vista', city: 'São Paulo', uf: 'SP' });
  assert.equal((await api(`/api/v1/ambo/public/${slug}`)).data.booking.open, true);

  // Patient submits request -> Ambo Solo confirms without Minne!
  const pReq = await api(`/api/v1/ambo/public/${slug}/requests`, {
    method: 'POST', headers: { 'X-Idempotency-Key': 'solo-req-1' },
    body: { modality: 'online', patientName: 'Joana Solo', patientEmail: 'joana.solo@exemplo.invalid', patientPhone: '(11) 97777-0001', preferences: { days: ['qua'], periods: ['manha'] } },
  });
  assert.equal(pReq.status, 201);

  // Entrada direta do Ambo (sem link da profissional): o e-mail basta, e o código leva à profissional certa.
  const directReq = await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { contact: 'joana.solo@exemplo.invalid' } });
  assert.equal(directReq.status, 200);
  assert.ok(directReq.data.expiresAt);
  const directBox = await api('/api/v1/dev/outbox?recipient=joana.solo@exemplo.invalid');
  const directVer = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { contact: 'joana.solo@exemplo.invalid', code: extractSixDigitCode(directBox) } });
  assert.equal(directVer.status, 200);
  assert.equal(directVer.data.professionalSlug, slug);

  const proOv = await api('/api/v1/ambo/pro/overview', { token: soloTok });
  const slotA = proOv.data.availableSlots[0];
  const slotB = proOv.data.availableSlots[1];
  const confSolo = await api(`/api/v1/ambo/pro/requests/${pReq.data.requestId}/confirm`, {
    method: 'POST', token: soloTok, body: { startAt: slotA.startAt, endAt: slotA.endAt, modality: 'online' },
  });
  assert.equal(confSolo.status, 201);

  // Send single-use invitation -> patient reserves slotB -> second verify returns 409 INVITE_ALREADY_USED
  const inv = await api('/api/v1/ambo/invitations', {
    method: 'POST', token: soloTok, body: { patientId: confSolo.data.appointment.patient_id, channel: 'email' },
  });
  assert.equal(inv.status, 201);
  const invVer = await api('/api/v1/ambo/invitations/verify', { method: 'POST', body: { inviteToken: inv.data.inviteToken } });
  assert.equal(invVer.status, 200);
  const invRes = await api('/api/v1/ambo/invitations/reserve', {
    method: 'POST', token: invVer.data.sessionToken,
    body: { invitationId: invVer.data.invitationId, startAt: slotB.startAt, endAt: slotB.endAt, modality: 'online' },
  });
  assert.equal(invRes.status, 201);
  const invReuse = await api('/api/v1/ambo/invitations/verify', { method: 'POST', body: { inviteToken: inv.data.inviteToken } });
  assert.equal(invReuse.status, 409);

  // Now adopts Minne later -> existing patient Joana Solo and both appointments appear automatically!
  await api('/api/v1/commercial/orders', {
    method: 'POST', token: soloTok, headers: { 'X-Idempotency-Key': 'solo-add-minne' },
    body: { products: ['ambo', 'minne'], simulatedOutcome: 'approved' },
  });
  const ws = await api('/api/v1/minne/workspace', { token: soloTok });
  assert.equal(ws.status, 200);
  assert.ok(ws.data.patients.some((p) => p.full_name === 'Joana Solo'));
  assert.equal(ws.data.appointments.length, 2);

  // Clinical draft -> conclude v1 -> edit & conclude v2 preserving v1 + archive & recover patient
  const patId = confSolo.data.appointment.patient_id;
  const d1 = await api('/api/v1/minne/notes/draft', {
    method: 'POST', token: soloTok,
    body: { patientId: patId, appointmentId: confSolo.data.appointment.id, blocks: [{ id: 'b1', type: 'paragraph', text: 'Rascunho inicial v1' }] },
  });
  const c1 = await api(`/api/v1/minne/notes/${d1.data.noteId}/conclude`, { method: 'POST', token: soloTok, body: {} });
  assert.equal(c1.data.versionNumber, 1);
  const c2 = await api(`/api/v1/minne/notes/${d1.data.noteId}/conclude`, {
    method: 'POST', token: soloTok,
    body: { blocks: [{ id: 'b1', type: 'paragraph', text: 'Revisao v2 preservando v1' }], changeReason: 'Adendo clinico' },
  });
  assert.equal(c2.data.versionNumber, 2);
  const notes = await api(`/api/v1/minne/patients/${patId}/notes`, { token: soloTok });
  assert.equal(notes.data.notes[0].versions.length, 2);
  assert.equal(notes.data.notes[0].versions[0].blocks[0].text, 'Rascunho inicial v1');

  await api(`/api/v1/minne/patients/${patId}/archive`, { method: 'POST', token: soloTok, body: {} });
  const rec = await api(`/api/v1/minne/patients/${patId}/recover`, { method: 'POST', token: soloTok, body: {} });
  assert.equal(rec.data.patient.status, 'active');
});

test('6. Etha service delivery, Marcos operator parity, draft vs published separation & Helena live staging site CTA', async () => {
  const helenaToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'helena@helenaduartepsi.com.br', password: 'HelenaDemo!2026' } })).data.sessionToken;
  const marcosToken = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'marcos@enomera-ops.exemplo.com.br', password: 'MarcosOps!2026' } })).data.sessionToken;

  // Editing in Etha panel saves DRAFT without silently changing published Helena site!
  const beforeSite = await api('/api/v1/public/sites/helena-duarte');
  assert.equal(beforeSite.status, 200);
  assert.equal(beforeSite.data.ctaMode, 'ambo');

  const draftEdit = await api('/api/v1/etha/project/editor', {
    method: 'POST', token: helenaToken,
    body: { stage: 'draft', content: { headline: 'Novo titulo em rascunho privado', displayName: 'Helena Duarte' } },
  });
  assert.equal(draftEdit.status, 201);
  assert.equal(draftEdit.data.published, false);
  const stillOldSite = await api('/api/v1/public/sites/helena-duarte');
  assert.notEqual(stillOldSite.data.headline, 'Novo titulo em rascunho privado');

  // Explicit publish-staging updates live staging site!
  const pub = await api('/api/v1/etha/project/publish-staging', {
    method: 'POST', token: helenaToken,
    body: { versionId: draftEdit.data.versionId, ctaMode: 'ambo' },
  });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.stagingSite.headline, 'Novo titulo em rascunho privado');
  assert.equal(pub.data.stagingSite.domainStatus, 'pending_owner_dns');

  // Marcos sets capacity to 0 -> waitlist active without payment
  await api('/api/v1/etha/operator/capacity', { method: 'PATCH', token: marcosToken, body: { capacityLimit: 0 } });
  const cap = await api('/api/v1/etha/capacity');
  assert.equal(cap.data.isFull, true);
  const wl = await api('/api/v1/etha/waitlist', { method: 'POST', body: { fullName: 'Interessada Lista', email: 'lista@exemplo.invalid', desiredFormat: 'one_page' } });
  assert.equal(wl.status, 201);
  assert.equal(wl.data.chargedCents, 0);
  await api('/api/v1/etha/operator/capacity', { method: 'PATCH', token: marcosToken, body: { capacityLimit: 3 } });
});

test('8. Two independent real accounts: isolation, clinical file attachment 403, expired OTP 410, expired session 401, multi-tenant Etha publish & restart persistence', async () => {
  // Postgres SQL placeholder translator preserves string literals containing '?'
  assert.equal(
    toPostgresPlaceholders("SELECT * FROM users WHERE email = ? AND note != 'why?' AND role = ?"),
    "SELECT * FROM users WHERE email = $1 AND note != 'why?' AND role = $2"
  );

  // Versioned migrations applied
  const health = await api('/api/v1/health');
  assert.equal(health.status, 200);
  assert.ok(health.data.integrations.database.appliedMigrations.includes('001_init'));
  assert.ok(health.data.integrations.database.appliedMigrations.includes('002_real_users_and_indexes'));

  // Create Account A & Account B independently
  const accA = await api('/api/v1/auth/signup', {
    method: 'POST',
    body: { fullName: 'Dra. Beatriz Real', email: 'beatriz.real@exemplo.invalid', password: 'BeatrizReal!2026', crpOrCrm: 'CRP 06/301010' },
  });
  const accB = await api('/api/v1/auth/signup', {
    method: 'POST',
    body: { fullName: 'Dr. Lucas Isolado', email: 'lucas.isolado@exemplo.invalid', password: 'LucasReal!2026', crpOrCrm: 'CRM-SP 402020', specialty: 'Psiquiatria' },
  });
  assert.equal(accA.status, 201);
  assert.equal(accB.status, 201);
  const tokenA = accA.data.sessionToken;
  const tokenB = accB.data.sessionToken;
  const slugA = accA.data.account.slug;

  // Test expired verification code returns 410 CODE_EXPIRED
  const db = await getDb(process.env.ENOMERA_DB_PATH);
  await db.run("UPDATE verification_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE target_contact = ?", 'beatriz.real@exemplo.invalid');
  const outboxA = await api('/api/v1/dev/outbox?recipient=beatriz.real@exemplo.invalid');
  const oldCode = extractSixDigitCode(outboxA);
  const expiredVer = await api('/api/v1/auth/verify-email', { method: 'POST', token: tokenA, body: { email: 'beatriz.real@exemplo.invalid', code: oldCode } });
  assert.equal(expiredVer.status, 410);
  assert.equal(expiredVer.data.code, 'CODE_EXPIRED');

  // Resend fresh code & verify
  assert.equal((await api('/api/v1/auth/resend-verification', {method:'POST',token:tokenA,body:{email:'beatriz.real@exemplo.invalid'}})).status,429);
  await db.run("UPDATE verification_tokens SET created_at = '2020-01-01T00:00:00.000Z' WHERE target_contact = ?", 'beatriz.real@exemplo.invalid');
  await api('/api/v1/auth/resend-verification', { method: 'POST', token:tokenA, body: { email: 'beatriz.real@exemplo.invalid' } });
  const freshCode = extractSixDigitCode(await api('/api/v1/dev/outbox?recipient=beatriz.real@exemplo.invalid'));
  const okVer = await api('/api/v1/auth/verify-email', { method: 'POST', token: tokenA, body: { email: 'beatriz.real@exemplo.invalid', code: freshCode } });
  assert.equal(okVer.status, 200);
  const codeB = extractSixDigitCode(await api('/api/v1/dev/outbox?recipient=lucas.isolado@exemplo.invalid'));
  assert.equal((await api('/api/v1/auth/verify-email', {method:'POST',token:tokenB,body:{email:'lucas.isolado@exemplo.invalid',code:codeB}})).status,200);

  // Activate Ambo + Minne + Etha on Account A and Minne on Account B (simulated checkout)
  const ordA = await api('/api/v1/commercial/orders', {
    method: 'POST', token: tokenA, headers: { 'X-Idempotency-Key': 'ord_a_full' },
    body: { products: ['ambo', 'minne', 'etha'], ethaFormat: 'one_page', simulatedOutcome: 'approved' },
  });
  assert.equal(ordA.status, 201);
  const ordB = await api('/api/v1/commercial/orders', {
    method: 'POST', token: tokenB, headers: { 'X-Idempotency-Key': 'ord_b_minne' },
    body: { products: ['minne'], simulatedOutcome: 'approved' },
  });
  assert.equal(ordB.status, 201);

  // Account A creates patient, clinical note, and attaches a private PDF
  const patA = await api('/api/v1/minne/patients', {
    method: 'POST', token: tokenA,
    body: { fullName: 'Paciente Sigiloso A', email: 'sigiloso.a@exemplo.invalid' },
  });
  assert.equal(patA.status, 201);
  const draftA = await api('/api/v1/minne/notes/draft', {
    method: 'POST', token: tokenA,
    body: { patientId: patA.data.patient.id, blocks: [{ id: 'b1', type: 'paragraph', text: 'Evolução sigilosa da Dra. Beatriz.' }] },
  });
  assert.equal(draftA.status, 200);
  const pdfBuf = makeSimplePdfBuffer('Laudo clinico privado da Dra Beatriz');
  const attA = await api(`/api/v1/minne/notes/${draftA.data.noteId}/attachments`, {
    method: 'POST', token: tokenA,
    body: { originalName: 'laudo-privado.pdf', contentBase64: pdfBuf.toString('base64') },
  });
  assert.equal(attA.status, 201);
  const fileIdA = attA.data.file.id;

  // Account A can download its own private file (200)
  const dlA = await api(`/api/v1/files/${fileIdA}`, { token: tokenA });
  assert.equal(dlA.status, 200);

  // Account B CANNOT read Account A's clinical notes or download Account A's private file!
  const bReadNotesA = await api(`/api/v1/minne/patients/${patA.data.patient.id}/notes`, { token: tokenB });
  assert.equal(bReadNotesA.status, 404);
  const bDlFileA = await api(`/api/v1/files/${fileIdA}`, { token: tokenB });
  assert.equal(bDlFileA.status, 403);
  const bNoAuthFileA = await api(`/api/v1/files/${fileIdA}`);
  assert.equal(bNoAuthFileA.status, 401);

  // Account A publishes its own Etha site -> public endpoint reflects Dra. Beatriz (not Helena!)
  const draftSiteA = await api('/api/v1/etha/project/editor', {
    method: 'POST', token: tokenA,
    body: { stage: 'draft', content: { displayName: 'Dra. Beatriz Real', crp: 'CRP 06/301010', headline: 'Escuta clínica dedicada em Campinas.' } },
  });
  assert.equal(draftSiteA.status, 201);
  const pubSiteA = await api('/api/v1/etha/project/publish-staging', { method: 'POST', token: tokenA, body: { ctaMode: 'ambo' } });
  assert.equal(pubSiteA.status, 200);
  const liveSiteA = await api(`/api/v1/public/sites/${slugA}`);
  assert.equal(liveSiteA.status, 200);
  assert.equal(liveSiteA.data.displayName, 'Dra. Beatriz Real');
  assert.equal(liveSiteA.data.amboProfileSlug, slugA);

  // Expired session returns 401 cleanly
  await db.run("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ?", accB.data.user.id);
  const expMeB = await api('/api/v1/auth/me', { token: tokenB });
  assert.equal(expMeB.status, 401);

  // Security regression: third-party *.vercel.app origin must NEVER get CORS credentials
  const evilCors = await api('/api/v1/health', { headers: { Origin: 'https://evil-attacker.vercel.app' } });
  assert.equal(evilCors.headers.get('access-control-allow-origin'), null);

  // Security regression: patient invitation using operator email MUST NOT escalate to operator!
  const fakeOpPat = await api('/api/v1/minne/patients', {
    method: 'POST', token: tokenA,
    body: { fullName: 'Fake Operator', email: 'marcos@enomera-ops.exemplo.com.br' },
  });
  assert.equal(fakeOpPat.status, 201);
  const fakeInv = await api('/api/v1/ambo/invitations', {
    method: 'POST', token: tokenA,
    body: { patientId: fakeOpPat.data.patient.id },
  });
  assert.equal(fakeInv.status, 201);
  const fakeVer = await api('/api/v1/ambo/invitations/verify', {
    method: 'POST',
    body: { inviteToken: fakeInv.data.inviteToken },
  });
  assert.equal(fakeVer.status, 200);
  const escOp = await api('/api/v1/etha/operator/dashboard', { token: fakeVer.data.sessionToken });
  assert.equal(escOp.status, 403);

  // Concurrency regression: simultaneous manual bookings on the exact same slot -> 1x 201 + 1x 409 (zero 500s!)
  const wsA = await api('/api/v1/minne/workspace', { token: tokenA });
  const targetSlot = wsA.data.availableSlots[0];
  const [race1, race2] = await Promise.all([
    api('/api/v1/minne/appointments', {
      method: 'POST', token: tokenA, headers: { 'X-Idempotency-Key': 'race_slot_1' },
      body: { patientId: patA.data.patient.id, startAt: targetSlot.startAt, endAt: targetSlot.endAt, modality: 'online' },
    }),
    api('/api/v1/minne/appointments', {
      method: 'POST', token: tokenA, headers: { 'X-Idempotency-Key': 'race_slot_2' },
      body: { patientId: fakeOpPat.data.patient.id, startAt: targetSlot.startAt, endAt: targetSlot.endAt, modality: 'online' },
    }),
  ]);
  const statuses = [race1.status, race2.status].sort();
  assert.deepEqual(statuses, [201, 409]);

  // Full DB close & reopen ("server restart") preserves Account A, entitlements, patient, note, and published site!
  await closeDb();
  const reopenedDb = await getDb(process.env.ENOMERA_DB_PATH);
  const migrations = await getAppliedMigrations(reopenedDb);
  assert.equal(migrations.length, 8);
  const persistedNote = await reopenedDb.get('SELECT id, attachment_file_ids_json FROM clinical_notes WHERE id = ?', draftA.data.noteId);
  assert.ok(persistedNote);
  assert.ok(JSON.parse(persistedNote.attachment_file_ids_json).includes(fileIdA));
});

test('9. Remote delivery infra guard (ENOMERA_REQUIRE_REMOTE_INFRA / VERCEL=1): 503 health + subsystem guards without silent local fallback', async () => {
  const prevEnv = {
    ENOMERA_REQUIRE_REMOTE_INFRA: process.env.ENOMERA_REQUIRE_REMOTE_INFRA,
    ENOMERA_ALLOW_LOCAL_FALLBACK: process.env.ENOMERA_ALLOW_LOCAL_FALLBACK,
    VERCEL: process.env.VERCEL,
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  };

  try {
    // 1. Default local dev/test mode: remote infra NOT required, /api/v1/health is 200 OK
    delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
    delete process.env.VERCEL;
    assert.equal(isRemoteInfraRequired(), false);
    const localHealth = await api('/api/v1/health');
    assert.equal(localHealth.status, 200);
    assert.equal(localHealth.data.ok, true);
    assert.equal(localHealth.data.requireRemoteInfra, false);

    // 2. VERCEL=1 activates remote requirement unless ENOMERA_ALLOW_LOCAL_FALLBACK=true
    process.env.VERCEL = '1';
    assert.equal(isRemoteInfraRequired(), true);
    process.env.ENOMERA_ALLOW_LOCAL_FALLBACK = 'true';
    assert.equal(isRemoteInfraRequired(), false);
    delete process.env.ENOMERA_ALLOW_LOCAL_FALLBACK;
    delete process.env.VERCEL;

    // 3. Explicit ENOMERA_REQUIRE_REMOTE_INFRA=true with missing remote vars -> 503 REMOTE_INFRA_NOT_CONFIGURED on /api/v1/health
    process.env.ENOMERA_REQUIRE_REMOTE_INFRA = 'true';
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;

    const guard = getRemoteInfraGuard();
    assert.equal(guard.required, true);
    assert.equal(guard.ready, false);
    assert.deepEqual(guard.missingEnvVars, ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'SMTP_PASSWORD']);

    const remoteHealth = await api('/api/v1/health');
    assert.equal(remoteHealth.status, 503);
    assert.equal(remoteHealth.data.ok, false);
    assert.equal(remoteHealth.data.code, 'REMOTE_INFRA_NOT_CONFIGURED');
    assert.equal(remoteHealth.data.requireRemoteInfra, true);
    assert.deepEqual(remoteHealth.data.missingEnvVars, ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'SMTP_PASSWORD']);
    assert.equal(remoteHealth.data.integrations.database.activeBackend, 'unconfigured_remote_required');
    assert.equal(remoteHealth.data.integrations.storage.backend, 'unconfigured_remote_required');
    assert.equal(remoteHealth.data.integrations.mailer.provider, 'unconfigured_remote_required');

    // 4. Subsystem guard: getDb() without customPath or DATABASE_URL throws 503 REMOTE_DB_NOT_CONFIGURED
    await assert.rejects(
      () => getDb(),
      (err) => err.status === 503 && err.code === 'REMOTE_DB_NOT_CONFIGURED' && Array.isArray(err.missingEnvVars) && err.missingEnvVars.includes('DATABASE_URL')
    );

    // 5. Subsystem guard: mailer refuses silent fallback to local outbox (503 REMOTE_MAILER_NOT_CONFIGURED)
    const mailerFail = await api('/api/v1/auth/recovery/request', {
      method: 'POST',
      body: { email: 'helena@helenaduartepsi.com.br' },
    });
    assert.equal(mailerFail.status, 200);
    assert.match(mailerFail.data.message, /Se o e-mail estiver cadastrado/);
    await assert.rejects(() => sendTransactionalEmail(null, {recipient:'teste@exemplo.invalid',subject:'Teste',textBody:'Teste',purpose:'test'}), err => err.status === 503 && err.code === 'REMOTE_MAILER_NOT_CONFIGURED');

    // 6. Subsystem guard: dev/outbox is strictly disabled (403 OUTBOX_DISABLED)
    const outboxDisabled = await api('/api/v1/dev/outbox?recipient=helena@helenaduartepsi.com.br');
    assert.equal(outboxDisabled.status, 403);
    assert.equal(outboxDisabled.data.code, 'OUTBOX_DISABLED');

    // 7. Subsystem guard: private storage refuses silent fallback to local disk (503 REMOTE_BLOB_NOT_CONFIGURED)
    const loginHelena = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'helena@helenaduartepsi.com.br', password: 'HelenaDemo!2026' },
    });
    assert.equal(loginHelena.status, 200);
    const pdfBuf = makeSimplePdfBuffer('Teste guard blob remoto');
    const wsHelena = await api('/api/v1/minne/workspace', { token: loginHelena.data.sessionToken });
    const draftNote = await api('/api/v1/minne/notes/draft', {
      method: 'POST',
      token: loginHelena.data.sessionToken,
      body: { patientId: wsHelena.data.patients[0].id, blocks: [{ id: 'g1', type: 'paragraph', text: 'Nota teste' }] },
    });
    assert.equal(draftNote.status, 200);
    const blobFail = await api(`/api/v1/minne/notes/${draftNote.data.noteId}/attachments`, {
      method: 'POST',
      token: loginHelena.data.sessionToken,
      body: { originalName: 'laudo.pdf', contentBase64: pdfBuf.toString('base64') },
    });
    assert.equal(blobFail.status, 503);
    assert.equal(blobFail.data.code, 'REMOTE_BLOB_NOT_CONFIGURED');
    assert.deepEqual(blobFail.data.missingEnvVars, ['BLOB_READ_WRITE_TOKEN']);
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
