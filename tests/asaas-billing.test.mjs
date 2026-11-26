import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getDb, closeDb } from '../server/db.mjs';
import { priceFor, getAsaasConfig, createCheckout, handleAsaasWebhook, cancelProductBilling, refundFirstPayment, isValidCpfCnpj, __setAsaasFetchForTests } from '../server/asaas.mjs';

test('preços aprovados: mensal e anual = 10x', () => {
  assert.equal(priceFor(['ambo']).valueCents, 3900);
  assert.equal(priceFor(['etha']).valueCents, 4900);
  assert.equal(priceFor(['minne']).valueCents, 5900);
  assert.equal(priceFor(['minne', 'ambo']).valueCents, 7900);
  assert.equal(priceFor(['ambo', 'etha', 'minne']).valueCents, 9900);
  assert.equal(priceFor(['ambo', 'etha', 'minne'], 'annual').valueCents, 99000);
  assert.throws(() => priceFor([]), /produto/);
});

test('chave de produção fica bloqueada sem autorização explícita', () => {
  const prev = { k: process.env.ASAAS_API_KEY, a: process.env.ENOMERA_ALLOW_REAL_PAYMENTS };
  try {
    delete process.env.ENOMERA_ALLOW_REAL_PAYMENTS;
    process.env.ASAAS_API_KEY = '$aact_prod_xxx';
    assert.equal(getAsaasConfig().mode, 'blocked_production');
    assert.equal(getAsaasConfig().configured, false);
    process.env.ASAAS_API_KEY = '$aact_hmlg_xxx';
    assert.equal(getAsaasConfig().mode, 'sandbox');
    assert.equal(getAsaasConfig().baseUrl, 'https://api-sandbox.asaas.com/v3');
  } finally {
    if (prev.k === undefined) delete process.env.ASAAS_API_KEY; else process.env.ASAAS_API_KEY = prev.k;
    if (prev.a !== undefined) process.env.ENOMERA_ALLOW_REAL_PAYMENTS = prev.a;
  }
});

test('checkout cria assinatura com 30 dias grátis; webhook ativa e é idempotente', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asaas-'));
  const prev = { ...process.env };
  process.env.ENOMERA_DB_PATH = path.join(tmp, 'db.sqlite');
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL; delete process.env.VERCEL; delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
  process.env.ASAAS_API_KEY = '$aact_hmlg_test';
  process.env.ASAAS_WEBHOOK_TOKEN = 'tok_test_123';
  process.env.ENOMERA_PUBLIC_URL = 'https://core.example';
  const calls = [];
  const state = { paid: false };
  __setAsaasFetchForTests(async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, key: opts.headers.access_token });
    const r = (d) => ({ ok: true, status: 200, json: async () => d });
    if (url.endsWith('/webhooks') && opts.method === 'GET') return r({ data: [] });
    if (url.endsWith('/webhooks')) return r({ id: 'wh_1' });
    if (url.endsWith('/customers')) return r({ id: 'cus_1' });
    if (url.endsWith('/subscriptions')) return r({ id: JSON.parse(opts.body).externalReference === 'acc1' ? 'sub_asaas_1' : 'sub_asaas_2' });
    if (url.endsWith('/subscriptions/sub_asaas_1') && opts.method === 'POST') return r({ id: 'sub_asaas_1' });
    if (url.endsWith('/subscriptions/sub_asaas_1') && opts.method === 'DELETE') return r({ deleted: true });
    if (url.endsWith('/payments/pay_1/refund')) return r({ id: 'pay_1', status: 'REFUNDED' });
    if (url.endsWith('/subscriptions/sub_asaas_1/payments') && state.paid) return r({ data: [{ id: 'pay_1', status: 'RECEIVED', value: 39, dueDate: '2026-12-22', paymentDate: new Date().toISOString().slice(0, 10) }] });
    if (url.endsWith('/payments') && opts.method === 'POST') return r({ id: 'pay_setup_1' });
    if (url.endsWith('/payments/pay_1')) return r({ id: 'pay_1', subscription: 'sub_asaas_1', status: 'PENDING', dueDate: '2026-12-22' });
    if (url.includes('/payments')) return r({ data: [{ id: 'pay_1', invoiceUrl: 'https://sandbox.asaas.com/i/abc' }] });
    return { ok: false, status: 404, json: async () => ({}) };
  });
  const db = await getDb(process.env.ENOMERA_DB_PATH);
  try {
    const now = new Date().toISOString();
    await db.run("INSERT INTO users (id,email,password_hash,password_salt,full_name,email_verified_at,created_at,updated_at) VALUES ('u1','ana@example.com','x','x','Ana Teste',?,?,?)", now, now, now);
    await db.run("INSERT INTO professional_accounts (id,owner_user_id,slug,display_name,created_at,updated_at) VALUES ('acc1','u1','ana-teste','Ana Teste',?,?)", now, now);
    const user = await db.get("SELECT * FROM users WHERE id='u1'");
    const account = await db.get("SELECT * FROM professional_accounts WHERE id='acc1'");

    await assert.rejects(createCheckout(db, { account, user, products: ['ambo'], cycle: 'monthly', cpfCnpj: '123' }), /CPF/);

    const out = await createCheckout(db, { account, user, products: ['minne', 'ambo'], cycle: 'monthly', cpfCnpj: '529.982.247-25' });
    assert.equal(out.subscription.valueCents, 7900);
    assert.equal(out.subscription.status, 'trial');
    assert.equal(out.subscription.invoiceUrl, 'https://sandbox.asaas.com/i/abc');
    const sub = calls.find((c) => c.url.endsWith('/subscriptions'));
    assert.equal(sub.body.value, 79);
    assert.equal(sub.body.cycle, 'MONTHLY');
    assert.equal(sub.body.billingType, 'UNDEFINED');
    const due = new Date(`${sub.body.nextDueDate}T12:00:00Z`);
    const days = Math.round((due - Date.now()) / 86_400_000);
    assert.ok(days >= 29 && days <= 31, `vencimento em ~30 dias, veio ${days}`);
    const wh = calls.find((c) => c.url.endsWith('/webhooks') && c.method === 'POST');
    assert.equal(wh.body.url, 'https://core.example/api/v1/billing/asaas/webhook');
    assert.ok(calls.every((c) => c.url.startsWith('https://api-sandbox.asaas.com/v3')));

    // CPF com tamanho certo e dígito verificador errado é recusado antes de chegar ao Asaas.
    await assert.rejects(createCheckout(db, { account, user, products: ['ambo'], cycle: 'monthly', cpfCnpj: '52998224724' }), /CPF/);

    // Mesma escolha de novo (duplo clique, reenvio): reaproveita, sem criar cliente nem assinatura.
    const before = calls.length;
    const again = await createCheckout(db, { account, user, products: ['ambo', 'minne'], cycle: 'monthly', cpfCnpj: '52998224725' });
    assert.equal(again.reused, true);
    assert.equal(calls.length, before);
    // Duas chamadas ao mesmo tempo numa conta nova: só uma cria assinatura no Asaas.
    await db.run("INSERT INTO users (id,email,password_hash,password_salt,full_name,email_verified_at,created_at,updated_at) VALUES ('u2','bia@example.com','x','x','Bia Teste',?,?,?)", now, now, now);
    await db.run("INSERT INTO professional_accounts (id,owner_user_id,slug,display_name,created_at,updated_at) VALUES ('acc2','u2','bia-teste','Bia Teste',?,?)", now, now);
    const user2 = await db.get("SELECT * FROM users WHERE id='u2'");
    const account2 = await db.get("SELECT * FROM professional_accounts WHERE id='acc2'");
    const race = await Promise.allSettled([1, 2].map(() => createCheckout(db, { account: account2, user: user2, products: ['etha'], cycle: 'annual', cpfCnpj: '52998224725', ethaService: 'sob_medida' })));
    assert.equal(race.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(race.filter((x) => x.status === 'rejected' && x.reason.code === 'CHECKOUT_IN_PROGRESS').length, 1);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS c FROM billing_subscriptions WHERE account_id='acc2'")).c), 1);
    // Site sob medida: a implantação única (R$ 790) vira cobrança avulsa; o ciclo anual fica gravado.
    const setup = calls.find((c) => c.url.endsWith('/payments') && c.method === 'POST');
    assert.equal(setup.body.value, 790);
    assert.equal((await db.get("SELECT billing_mode FROM entitlements WHERE account_id='acc2' AND product='etha'")).billing_mode, 'annual');

    // Sem token válido: o corpo é ignorado e vale a situação real consultada no Asaas (aqui, PENDING).
    const forged = await handleAsaasWebhook(db, { 'asaas-access-token': 'errado' }, { id: 'evt_forjado', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', subscription: 'sub_asaas_1' } });
    assert.notEqual(forged.status, 'active');
    const evt = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', subscription: 'sub_asaas_1', dueDate: '2026-12-22' } };
    const ok = await handleAsaasWebhook(db, { 'asaas-access-token': 'tok_test_123' }, evt);
    assert.equal(ok.status, 'active');
    const dup = await handleAsaasWebhook(db, { 'asaas-access-token': 'tok_test_123' }, evt);
    assert.equal(dup.duplicate, true);
    const ents = await db.all("SELECT product, status, current_period_end FROM entitlements WHERE account_id='acc1' ORDER BY product");
    assert.deepEqual(ents.map((e) => [e.product, e.status]), [['ambo', 'active'], ['minne', 'active']]);
    assert.equal(ents[0].current_period_end, '2027-01-21');

    // Troca de plano: a assinatura existente tem o valor atualizado no Asaas (não cria outra).
    const changed = await createCheckout(db, { account, user, products: ['ambo', 'minne', 'etha'], cycle: 'monthly', cpfCnpj: '52998224725' });
    assert.equal(changed.changed, true);
    assert.equal(changed.subscription.valueCents, 9900);
    const upd = calls.filter((c) => c.url.endsWith('/subscriptions/sub_asaas_1') && c.method === 'POST').at(-1);
    assert.equal(upd.body.value, 99);
    assert.equal(calls.filter((c) => c.url.endsWith('/subscriptions') && c.method === 'POST' && c.body.externalReference === 'acc1').length, 1);

    // Atraso: assinatura fica "overdue", o aviso sai uma vez, e não nasce assinatura nova ao tentar contratar de novo.
    const late = await handleAsaasWebhook(db, { 'asaas-access-token': 'tok_test_123' }, { id: 'evt_2', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_2', subscription: 'sub_asaas_1', dueDate: '2027-01-21', invoiceUrl: 'https://sandbox.asaas.com/i/atraso' } });
    assert.equal(late.status, 'overdue');
    assert.ok(late.notify && late.notify.suspendOn === '2027-01-28');
    const late2 = await handleAsaasWebhook(db, { 'asaas-access-token': 'tok_test_123' }, { id: 'evt_3', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_2', subscription: 'sub_asaas_1', dueDate: '2027-01-21' } });
    assert.equal(late2.notify, null);
    const regular = await createCheckout(db, { account, user, products: ['ambo', 'minne', 'etha'], cycle: 'monthly', cpfCnpj: '52998224725' });
    assert.equal(regular.reused, true);
    assert.equal(regular.subscription.invoiceUrl, 'https://sandbox.asaas.com/i/atraso');
    assert.equal(Number((await db.get("SELECT COUNT(*) AS c FROM billing_subscriptions WHERE account_id='acc1'")).c), 1);

    // Cancelar um serviço: o valor cai no Asaas; cancelar o último remove a assinatura lá.
    await handleAsaasWebhook(db, { 'asaas-access-token': 'tok_test_123' }, { id: 'evt_4', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_2', subscription: 'sub_asaas_1', dueDate: '2099-01-21' } });
    const c1 = await cancelProductBilling(db, { accountId: 'acc1', product: 'etha' });
    assert.equal(c1.paidUntil, '2099-02-20');
    assert.equal((await db.get("SELECT status FROM entitlements WHERE account_id='acc1' AND product='etha'")).status, 'cancelled_grace');
    assert.equal(calls.filter((c) => c.url.endsWith('/subscriptions/sub_asaas_1') && c.method === 'POST').at(-1).body.value, 79);
    await cancelProductBilling(db, { accountId: 'acc1', product: 'ambo' });
    await cancelProductBilling(db, { accountId: 'acc1', product: 'minne' });
    assert.ok(calls.some((c) => c.url.endsWith('/subscriptions/sub_asaas_1') && c.method === 'DELETE'));
    assert.equal((await db.get("SELECT status FROM billing_subscriptions WHERE account_id='acc1'")).status, 'cancelled');

    // Arrependimento em até 7 dias do primeiro pagamento: estorno integral no Asaas.
    await db.run("UPDATE billing_subscriptions SET status = 'active' WHERE account_id='acc1'");
    state.paid = true;
    const refund = await refundFirstPayment(db, { accountId: 'acc1' });
    assert.equal(refund.refundedCents, 3900);
    assert.ok(calls.some((c) => c.url.endsWith('/payments/pay_1/refund')));
    assert.equal((await db.get("SELECT status FROM entitlements WHERE account_id='acc1' AND product='minne'")).status, 'read_only');
  } finally {
    __setAsaasFetchForTests(null);
    await closeDb();
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('token do webhook derivado da chave quando não há variável própria', async () => {
  const { getWebhookToken } = await import('../server/asaas.mjs');
  const prev = { k: process.env.ASAAS_API_KEY, t: process.env.ASAAS_WEBHOOK_TOKEN };
  try {
    delete process.env.ASAAS_WEBHOOK_TOKEN;
    process.env.ASAAS_API_KEY = '$aact_hmlg_abc';
    const a = getWebhookToken();
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(getWebhookToken(), a);
    process.env.ASAAS_API_KEY = '$aact_hmlg_def';
    assert.notEqual(getWebhookToken(), a);
  } finally {
    if (prev.k === undefined) delete process.env.ASAAS_API_KEY; else process.env.ASAAS_API_KEY = prev.k;
    if (prev.t !== undefined) process.env.ASAAS_WEBHOOK_TOKEN = prev.t;
  }
});
