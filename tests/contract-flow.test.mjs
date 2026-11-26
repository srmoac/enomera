import './demo-credentials.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildContractSummary } from '../server/catalog.mjs';
import { closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';

const n = (s) => String(s).replace(/\u00a0/g, ' ');

let server;
let baseUrl;
let tmpDir;

async function api(route, { method = 'GET', body = null, token = null } = {}) {
  const h = {};
  if (body !== null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${route}`, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function latestCode(email) {
  const r = await api(`/api/v1/dev/outbox?recipient=${encodeURIComponent(email)}`);
  return /(\d{6})/.exec(r.data.messages[0].body_preview)[1];
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-contract-'));
  process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'test.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'storage');
  delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
  delete process.env.VERCEL;
  server = createEnomeraServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Resumo aprovado: produtos, desconto como linha, periodicidade e cobrança hoje R$ 0', () => {
  const combo = buildContractSummary({ products: ['minne', 'ambo'] });
  assert.equal(combo.label, 'Agendamento + Consultório');
  assert.equal(combo.billingLabel, 'Mensal');
  assert.deepEqual(combo.lines.map((l) => l.amountCents), [3900, 5900]);
  assert.equal(combo.discount.amountCents, -1900);
  assert.equal(n(combo.total), 'R$ 79,00/mês');
  assert.equal(combo.chargedTodayCents, 0);
  assert.ok(!JSON.stringify(combo).includes('sim-v2'), 'versão interna do catálogo não aparece');

  const solo = buildContractSummary({ products: ['ambo'] });
  assert.equal(solo.discount, null);
  assert.match(solo.discountHint, /Consultório/);
  assert.equal(n(solo.total), 'R$ 39,00/mês');

  const lic = buildContractSummary({ products: ['ambo', 'minne'], billing: 'permanent' });
  assert.equal(lic.totalCents, 79000, 'anual = 10 mensalidades do combo');
  assert.equal(lic.totalLabel, 'Total anual');
  assert.equal(lic.billingLabel, 'Anual');
  assert.equal(lic.discount.amountCents, -19000);

  const etha = buildContractSummary({ products: ['etha', 'ambo', 'minne'] });
  assert.equal(etha.totalCents, 9900, 'os três por R$ 99/mês');
  assert.equal(buildContractSummary({ products: ['etha'] }).totalCents, 4900);
  assert.equal(buildContractSummary({ products: ['ambo', 'etha'] }).totalCents, 6900);
  assert.equal(buildContractSummary({ products: ['etha', 'minne'] }).totalCents, 8900);
});

test('Combinação segue por conta: e-mail → código → checkout → retorno → portal', async () => {
  const email = 'nova.profissional@exemplo.invalid';
  const req = await api('/api/v1/auth/email-code/request', { method: 'POST', body: { email } });
  assert.equal(req.status, 200);
  assert.equal(req.data.resendAfterSec, 60);

  const tooSoon = await api('/api/v1/auth/email-code/request', { method: 'POST', body: { email } });
  assert.equal(tooSoon.status, 429);

  const wrong = await api('/api/v1/auth/email-code/verify', { method: 'POST', body: { email, code: '000000' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.code, 'CODE_INVALID');

  const code = await latestCode(email);
  const ok = await api('/api/v1/auth/email-code/verify', {
    method: 'POST',
    body: { email, code, selection: { products: ['ambo'], billing: 'monthly' } },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.isNewAccount, true);
  assert.equal(ok.data.user.emailVerified, true);
  assert.deepEqual(ok.data.selection.products, ['ambo'], 'só Ambo continua só Ambo depois do código');
  assert.equal(n(ok.data.contract.total), 'R$ 39,00/mês');
  const token = ok.data.sessionToken;

  // Código não pode ser reutilizado.
  const replay = await api('/api/v1/auth/email-code/verify', { method: 'POST', body: { email, code } });
  assert.notEqual(replay.status, 200);

  // Retorno: altera para anual do combo, a conta continua verificada.
  const put = await api('/api/v1/commercial/selection', { method: 'PUT', token, body: { products: ['ambo', 'minne'], billing: 'permanent' } });
  assert.equal(put.status, 200);
  const get = await api('/api/v1/commercial/selection', { token });
  assert.equal(get.data.selection.billing, 'permanent');
  assert.equal(n(get.data.contract.total), 'R$ 790,00/ano');

  // Checkout: ativa sem cobrança hoje, com a periodicidade escolhida.
  const order = await api('/api/v1/commercial/orders', {
    method: 'POST',
    token,
    body: { products: ['ambo', 'minne'], billing: 'permanent', acceptTerms: true, simulatedOutcome: 'approved', idempotencyKey: 'chk_contract_1' },
  });
  assert.equal(order.status, 201);
  assert.equal(order.data.order.due_today_cents, 0);
  assert.equal(order.data.summary.contract.billing, 'permanent');
  assert.equal(order.data.entitlements.ambo.billingMode, 'annual');
  assert.equal(order.data.entitlements.minne.status, 'active');

  // Novo login no mesmo e-mail (outro dispositivo) recupera a combinação da conta.
  await new Promise((r) => setTimeout(r, 20));
  const db = (await import('../server/db.mjs'));
  const conn = await db.getDb();
  await conn.run("UPDATE verification_tokens SET created_at = '2000-01-01T00:00:00.000Z' WHERE target_contact = ?", email);
  await api('/api/v1/auth/email-code/request', { method: 'POST', body: { email } });
  const again = await api('/api/v1/auth/email-code/verify', { method: 'POST', body: { email, code: await latestCode(email) } });
  assert.equal(again.status, 200);
  assert.equal(again.data.isNewAccount, false);
  assert.deepEqual(again.data.selection.products, ['ambo', 'minne']);
  assert.equal(again.data.selection.billing, 'permanent');
});

test('Seleção exige conta profissional e ao menos um produto', async () => {
  const anon = await api('/api/v1/commercial/selection');
  assert.equal(anon.status, 401);
  const bad = await api('/api/v1/auth/email-code/request', { method: 'POST', body: { email: 'sem-arroba' } });
  assert.equal(bad.status, 400);
});
