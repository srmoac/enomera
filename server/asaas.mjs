import crypto from 'node:crypto';
import { nowIso, randomId } from './crypto.mjs';
import { contactEmail } from './mailer.mjs';
import { ANNUAL_MONTHS, MONTHLY_BY_COMBO } from './catalog.mjs';

/**
 * Cobrança recorrente via Asaas (Pix, boleto ou cartão na página de pagamento do Asaas).
 *
 * Segurança do piloto:
 * - Só a chave de sandbox ($aact_hmlg_...) funciona por padrão.
 * - Chave de produção ($aact_prod_...) fica bloqueada até ENOMERA_ALLOW_REAL_PAYMENTS=true,
 *   que só é definida com o "pode publicar" do Marcos.
 * - O webhook exige o token ASAAS_WEBHOOK_TOKEN no cabeçalho asaas-access-token.
 * - Nenhum dado de cartão passa pela Enomera: o cliente paga na página do Asaas (invoiceUrl).
 */

export const PILOT_TRIAL_DAYS = 14;

/** Preços mensais em centavos: vêm do catálogo (fonte única). Anual = 10 mensalidades. */
export const PILOT_PRICES_CENTS = MONTHLY_BY_COMBO;

const ORDER = ['ambo', 'etha', 'minne'];
const NAMES = { ambo: 'Agendamento', etha: 'Site', minne: 'Consultório' };

export function normalizeProducts(list) {
  const raw = Array.isArray(list) ? list : [];
  return ORDER.filter((p) => raw.includes(p));
}

export function priceFor(products, cycle = 'monthly') {
  const sel = normalizeProducts(products);
  if (!sel.length) throw Object.assign(new Error('Escolha pelo menos um produto.'), { status: 400, code: 'EMPTY_SELECTION' });
  const monthly = PILOT_PRICES_CENTS[sel.join('+')];
  const cents = cycle === 'annual' ? monthly * ANNUAL_MONTHS : monthly;
  return { products: sel, cycle: cycle === 'annual' ? 'annual' : 'monthly', monthlyCents: monthly, valueCents: cents, label: sel.map((p) => NAMES[p]).join(' + ') };
}

export function getAsaasConfig() {
  const key = (process.env.ASAAS_API_KEY || '').trim();
  if (!key) return { mode: 'off', configured: false };
  const isProd = key.startsWith('$aact_prod_');
  if (isProd && process.env.ENOMERA_ALLOW_REAL_PAYMENTS !== 'true') {
    return { mode: 'blocked_production', configured: false };
  }
  return {
    mode: isProd ? 'production' : 'sandbox',
    configured: true,
    key,
    baseUrl: isProd ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3',
  };
}

export function getAsaasStatus() {
  const cfg = getAsaasConfig();
  return {
    provider: 'asaas',
    mode: cfg.mode,
    configured: cfg.configured,
    webhookTokenConfigured: Boolean(getWebhookToken()),
    webhookRegistrationError: webhookLastError,
    realPayments: cfg.mode === 'production',
    trialDays: PILOT_TRIAL_DAYS,
  };
}

let fetchImpl = (...args) => fetch(...args);
/** Para testes: injeta um fetch falso. */
export function __setAsaasFetchForTests(f) { fetchImpl = f || ((...args) => fetch(...args)); webhookEnsured = false; }

async function asaasRequest(cfg, method, path, body) {
  let resp;
  try {
    resp = await fetchImpl(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        access_token: cfg.key,
        'Content-Type': 'application/json',
        'User-Agent': 'enomera-core',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Não foi possível falar com o Asaas agora. Tente de novo em alguns minutos.'), { status: 502, code: 'ASAAS_UNREACHABLE' });
  }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const desc = json?.errors?.[0]?.description || `HTTP ${resp.status}`;
    throw Object.assign(new Error(`Asaas recusou a operação: ${desc}`), { status: 502, code: 'ASAAS_ERROR' });
  }
  return json;
}

/**
 * Token do webhook: ASAAS_WEBHOOK_TOKEN, ou derivado da chave do Asaas (HMAC),
 * para não exigir mais uma variável. Nunca é exibido nem registrado em log.
 */
export function getWebhookToken() {
  if (process.env.ASAAS_WEBHOOK_TOKEN) return process.env.ASAAS_WEBHOOK_TOKEN;
  const key = (process.env.ASAAS_API_KEY || '').trim();
  if (!key) return '';
  return crypto.createHmac('sha256', key).update('enomera-asaas-webhook-v1').digest('hex');
}

let webhookEnsured = false;
let webhookLastError = null;
/** Registra o webhook no Asaas uma vez (URL do Core + token secreto), sem expor o token. */
async function ensureWebhook(cfg) {
  if (webhookEnsured) return;
  const token = getWebhookToken();
  const base = (process.env.ENOMERA_CORE_URL || process.env.ENOMERA_PUBLIC_URL || '').replace(/\/$/, '');
  if (!token || !base) return;
  // E-mail que o Asaas avisa quando o webhook falha: do ambiente (ASAAS_WEBHOOK_EMAIL) ou o contato da Enomera.
  const webhookEmail = (process.env.ASAAS_WEBHOOK_EMAIL || '').trim() || contactEmail();
  const url = `${base}/api/v1/billing/asaas/webhook`;
  try {
    const list = await asaasRequest(cfg, 'GET', '/webhooks');
    if (!(list?.data || []).some((w) => w.url === url)) {
      await asaasRequest(cfg, 'POST', '/webhooks', {
        name: 'Enomera Core',
        url,
        email: webhookEmail,
        enabled: true,
        interrupted: false,
        authToken: token,
        sendType: 'SEQUENTIALLY',
        events: ['PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED'],
      });
    }
    webhookEnsured = true;
    webhookLastError = null;
  } catch (err) {
    webhookLastError = err.message;
    console.error('[asaas] webhook não registrado:', err.message);
  }
}

function onlyDigits(v) { return String(v || '').replace(/\D+/g, ''); }

/** CPF (11) ou CNPJ (14) com dígitos verificadores corretos. */
export function isValidCpfCnpj(value) {
  const d = onlyDigits(value);
  if (/^(\d)\1+$/.test(d)) return false;
  const check = (base, weights) => {
    const sum = base.split('').reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    const d1 = check(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = check(d.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d1 === Number(d[9]) && d2 === Number(d[10]);
  }
  if (d.length === 14) {
    const d1 = check(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = check(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return d1 === Number(d[12]) && d2 === Number(d[13]);
  }
  return false;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todaySaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export async function ensureBillingTables(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS billing_subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_mode TEXT NOT NULL,
    provider_customer_id TEXT NOT NULL,
    provider_subscription_id TEXT NOT NULL UNIQUE,
    products_json TEXT NOT NULL,
    cycle TEXT NOT NULL,
    value_cents INTEGER NOT NULL,
    status TEXT NOT NULL,
    next_due_date TEXT,
    invoice_url TEXT,
    current_period_end TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS billing_webhook_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    event TEXT NOT NULL,
    payment_id TEXT,
    subscription_id TEXT,
    received_at TEXT NOT NULL
  )`);
}

/** Dias de tolerância depois do vencimento antes de o serviço ficar só para leitura. */
export const OVERDUE_GRACE_DAYS = 7;
/** Prazo do direito de arrependimento (art. 49 do CDC). */
export const REFUND_WINDOW_DAYS = 7;
/** Implantação única do Site sob medida, em centavos. */
export const SOB_MEDIDA_SETUP_CENTS = 79000;
const PENDING_PREFIX = 'pending:';
const PENDING_STALE_MS = 2 * 60_000;

async function getCurrentSubscription(db, accountId) {
  return db.get(
    "SELECT * FROM billing_subscriptions WHERE account_id = ? AND status NOT IN ('cancelled') ORDER BY created_at DESC LIMIT 1",
    accountId
  );
}

function publicSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    products: JSON.parse(row.products_json || '[]'),
    cycle: row.cycle,
    valueCents: Number(row.value_cents),
    status: row.status,
    nextDueDate: row.next_due_date,
    invoiceUrl: row.invoice_url,
    currentPeriodEnd: row.current_period_end,
    sandbox: row.provider_mode !== 'production',
  };
}

function notConfiguredError(cfg) {
  if (cfg.mode !== 'blocked_production') console.error('[asaas] ASAAS_API_KEY ausente: contratação com pagamento indisponível.');
  return Object.assign(
    new Error(cfg.mode === 'blocked_production'
      ? 'A cobrança ainda não foi liberada. Avisaremos por e-mail quando a contratação abrir.'
      : 'A contratação com pagamento ainda não está disponível. Tente de novo mais tarde ou fale com a Enomera.'),
    { status: 503, code: cfg.mode === 'blocked_production' ? 'REAL_PAYMENTS_BLOCKED' : 'PAYMENTS_NOT_CONFIGURED' }
  );
}

function sameSelection(row, price) {
  return row.cycle === price.cycle && JSON.parse(row.products_json || '[]').join('+') === price.products.join('+');
}

/**
 * Cria a assinatura no Asaas com 2 semanas grátis, ou ajusta a que já existe.
 * - Uma conta tem no máximo uma assinatura viva: duplo clique ou reenvio não cria outra
 *   (a linha "pending:<conta>" funciona como trava, pela restrição UNIQUE).
 * - Se a escolha mudou (produtos ou ciclo), a assinatura existente é atualizada no Asaas.
 * - Assinatura vencida não gera outra: devolvemos a mesma, com o link para regularizar.
 */
export async function createCheckout(db, { account, user, products, cycle, cpfCnpj, ethaService = null }) {
  const cfg = getAsaasConfig();
  if (!cfg.configured) throw notConfiguredError(cfg);
  const doc = onlyDigits(cpfCnpj);
  if (!isValidCpfCnpj(doc)) {
    throw Object.assign(new Error('Informe um CPF ou CNPJ válido para emitir a cobrança.'), { status: 400, code: 'INVALID_CPF_CNPJ' });
  }
  const price = priceFor(products, cycle);
  await ensureBillingTables(db);

  const existing = await getCurrentSubscription(db, account.id);
  if (existing && String(existing.provider_subscription_id).startsWith(PENDING_PREFIX)) {
    if (Date.now() - Date.parse(existing.created_at) < PENDING_STALE_MS) {
      throw Object.assign(new Error('Sua contratação já está sendo processada. Aguarde alguns segundos.'), { status: 409, code: 'CHECKOUT_IN_PROGRESS' });
    }
    await db.run('DELETE FROM billing_subscriptions WHERE id = ?', existing.id);
  } else if (existing) {
    if (sameSelection(existing, price)) return { subscription: publicSubscription(existing), reused: true };
    return { subscription: await changeSubscription(db, cfg, existing, price), reused: true, changed: true };
  }

  // Trava por conta: a segunda chamada simultânea falha na restrição UNIQUE e não chega ao Asaas.
  const now = nowIso();
  const id = randomId('sub');
  try {
    await db.run(
      `INSERT INTO billing_subscriptions (id, account_id, provider, provider_mode, provider_customer_id, provider_subscription_id,
        products_json, cycle, value_cents, status, created_at, updated_at)
       VALUES (?, ?, 'asaas', ?, '', ?, ?, ?, ?, 'creating', ?, ?)`,
      id, account.id, cfg.mode, `${PENDING_PREFIX}${account.id}`, JSON.stringify(price.products), price.cycle, price.valueCents, now, now
    );
  } catch {
    throw Object.assign(new Error('Sua contratação já está sendo processada. Aguarde alguns segundos.'), { status: 409, code: 'CHECKOUT_IN_PROGRESS' });
  }

  try {
    await ensureWebhook(cfg);
    const customer = await asaasRequest(cfg, 'POST', '/customers', {
      name: user.full_name || account.display_name,
      email: user.email,
      cpfCnpj: doc,
      externalReference: account.id,
      notificationDisabled: false,
    });

    const nextDueDate = addDays(todaySaoPaulo(), PILOT_TRIAL_DAYS);
    const subscription = await asaasRequest(cfg, 'POST', '/subscriptions', {
      customer: customer.id,
      billingType: 'UNDEFINED',
      value: price.valueCents / 100,
      nextDueDate,
      cycle: price.cycle === 'annual' ? 'YEARLY' : 'MONTHLY',
      description: `Enomera · ${price.label} (${price.cycle === 'annual' ? 'anual' : 'mensal'})`,
      externalReference: account.id,
    });

    let invoiceUrl = null;
    try {
      const payments = await asaasRequest(cfg, 'GET', `/subscriptions/${encodeURIComponent(subscription.id)}/payments`);
      invoiceUrl = payments?.data?.[0]?.invoiceUrl || null;
    } catch { /* a primeira cobrança pode demorar a existir; o e-mail do Asaas leva o link */ }

    // Implantação única do Site sob medida: cobrança avulsa, com o mesmo vencimento da primeira mensalidade.
    let setupPaymentId = null;
    if (ethaService === 'sob_medida' && price.products.includes('etha')) {
      const setup = await asaasRequest(cfg, 'POST', '/payments', {
        customer: customer.id,
        billingType: 'UNDEFINED',
        value: SOB_MEDIDA_SETUP_CENTS / 100,
        dueDate: nextDueDate,
        description: 'Enomera · Site sob medida (implantação única)',
        externalReference: `${account.id}:setup`,
      });
      setupPaymentId = setup?.id || null;
    }

    await db.run(
      `UPDATE billing_subscriptions SET provider_customer_id = ?, provider_subscription_id = ?, status = 'trial',
         next_due_date = ?, invoice_url = ?, current_period_end = ?, setup_payment_id = ?, updated_at = ? WHERE id = ?`,
      customer.id, subscription.id, nextDueDate, invoiceUrl, nextDueDate, setupPaymentId, nowIso(), id
    );
    await upsertEntitlements(db, account.id, price.products, 'trial', nextDueDate, price.cycle);
  } catch (err) {
    await db.run("DELETE FROM billing_subscriptions WHERE id = ? AND status = 'creating'", id);
    throw err;
  }
  return { subscription: publicSubscription(await db.get('SELECT * FROM billing_subscriptions WHERE id = ?', id)), reused: false };
}

/** Troca de plano ou de ciclo: atualiza o valor da assinatura existente no Asaas. */
async function changeSubscription(db, cfg, row, price) {
  await asaasRequest(cfg, 'POST', `/subscriptions/${encodeURIComponent(row.provider_subscription_id)}`, {
    value: price.valueCents / 100,
    cycle: price.cycle === 'annual' ? 'YEARLY' : 'MONTHLY',
    description: `Enomera · ${price.label} (${price.cycle === 'annual' ? 'anual' : 'mensal'})`,
    updatePendingPayments: true,
  });
  const before = JSON.parse(row.products_json || '[]');
  await db.run('UPDATE billing_subscriptions SET products_json = ?, cycle = ?, value_cents = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(price.products), price.cycle, price.valueCents, nowIso(), row.id);
  const entStatus = row.status === 'trial' ? 'trial' : 'active';
  await upsertEntitlements(db, row.account_id, price.products, entStatus, row.current_period_end, price.cycle);
  const removed = before.filter((p) => !price.products.includes(p));
  if (removed.length) await endEntitlements(db, row.account_id, removed, row);
  return publicSubscription(await db.get('SELECT * FROM billing_subscriptions WHERE id = ?', row.id));
}

function paidPeriodEnd(row) {
  if (!row || row.status !== 'active' || !row.current_period_end) return null;
  const end = Date.parse(`${String(row.current_period_end).slice(0, 10)}T23:59:59-03:00`);
  return Number.isFinite(end) && end > Date.now() ? row.current_period_end : null;
}

/**
 * Encerra serviços: se há período já pago, o serviço segue até o fim dele (cancelled_grace,
 * como dizem os Termos); sem período pago, fica só para leitura na hora.
 */
async function endEntitlements(db, accountId, products, row) {
  const now = nowIso();
  const paidUntil = paidPeriodEnd(row);
  for (const p of products) {
    await db.run('UPDATE entitlements SET status = ?, cancelled_at = ?, current_period_end = COALESCE(?, current_period_end), updated_at = ? WHERE account_id = ? AND product = ?',
      paidUntil ? 'cancelled_grace' : 'read_only', now, paidUntil, now, accountId, p);
  }
  return paidUntil;
}

/**
 * Cancelamento de um serviço pelo profissional. Primeiro o Asaas (cancela a assinatura, ou
 * reduz o valor quando sobram outros serviços); só depois o serviço muda de situação aqui.
 * Sem assinatura no Asaas (piloto, teste), só a situação local muda.
 * Retorna { paidUntil } quando o serviço continua até o fim do período pago.
 */
export async function cancelProductBilling(db, { accountId, product }) {
  await ensureBillingTables(db);
  const row = await getCurrentSubscription(db, accountId);
  const covered = row && !String(row.provider_subscription_id).startsWith(PENDING_PREFIX) && JSON.parse(row.products_json || '[]').includes(product);
  if (!covered) {
    await endEntitlements(db, accountId, [product], null);
    return { paidUntil: null, provider: false };
  }
  const cfg = getAsaasConfig();
  if (!cfg.configured || cfg.mode !== row.provider_mode) {
    throw Object.assign(new Error('Não foi possível cancelar a cobrança agora. Tente de novo em alguns minutos ou fale com a Enomera.'), { status: 503, code: 'PAYMENTS_NOT_CONFIGURED' });
  }
  const remaining = JSON.parse(row.products_json || '[]').filter((p) => p !== product);
  if (remaining.length) {
    const price = priceFor(remaining, row.cycle);
    await asaasRequest(cfg, 'POST', `/subscriptions/${encodeURIComponent(row.provider_subscription_id)}`, {
      value: price.valueCents / 100,
      description: `Enomera · ${price.label} (${price.cycle === 'annual' ? 'anual' : 'mensal'})`,
      updatePendingPayments: true,
    });
    await db.run('UPDATE billing_subscriptions SET products_json = ?, value_cents = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(price.products), price.valueCents, nowIso(), row.id);
  } else {
    await asaasRequest(cfg, 'DELETE', `/subscriptions/${encodeURIComponent(row.provider_subscription_id)}`);
    await db.run("UPDATE billing_subscriptions SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), row.id);
  }
  const paidUntil = await endEntitlements(db, accountId, [product], row);
  return { paidUntil, provider: true };
}

/**
 * Direito de arrependimento: até 7 dias depois do primeiro pagamento, devolve o valor integral
 * (estorno no Asaas), cancela a assinatura e deixa os serviços só para leitura.
 */
export async function refundFirstPayment(db, { accountId }) {
  await ensureBillingTables(db);
  const cfg = getAsaasConfig();
  if (!cfg.configured) throw notConfiguredError(cfg);
  const row = await getCurrentSubscription(db, accountId);
  if (!row || row.provider_mode !== cfg.mode || String(row.provider_subscription_id).startsWith(PENDING_PREFIX)) {
    throw Object.assign(new Error('Não há pagamento para devolver nesta conta.'), { status: 404, code: 'NO_PAYMENT_TO_REFUND' });
  }
  const list = await asaasRequest(cfg, 'GET', `/subscriptions/${encodeURIComponent(row.provider_subscription_id)}/payments`);
  const paid = (list?.data || [])
    .filter((p) => ['CONFIRMED', 'RECEIVED'].includes(p.status))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  if (paid.length !== 1) {
    throw Object.assign(new Error(paid.length ? 'O prazo de 7 dias vale para o primeiro pagamento. Para os demais, fale com a Enomera.' : 'Não há pagamento para devolver nesta conta.'), { status: 409, code: 'REFUND_NOT_AVAILABLE' });
  }
  const first = paid[0];
  const paidAt = Date.parse(`${String(first.paymentDate || first.confirmedDate || first.clientPaymentDate || first.dueDate).slice(0, 10)}T00:00:00-03:00`);
  if (!Number.isFinite(paidAt) || Date.now() - paidAt > (REFUND_WINDOW_DAYS + 1) * 86_400_000) {
    throw Object.assign(new Error('O prazo de 7 dias para desistir com devolução integral já passou.'), { status: 409, code: 'REFUND_WINDOW_EXPIRED' });
  }
  await asaasRequest(cfg, 'POST', `/payments/${encodeURIComponent(first.id)}/refund`, {});
  await asaasRequest(cfg, 'DELETE', `/subscriptions/${encodeURIComponent(row.provider_subscription_id)}`);
  const now = nowIso();
  await db.run("UPDATE billing_subscriptions SET status = 'cancelled', updated_at = ? WHERE id = ?", now, row.id);
  for (const p of JSON.parse(row.products_json || '[]')) {
    await db.run("UPDATE entitlements SET status = 'read_only', cancelled_at = ?, updated_at = ? WHERE account_id = ? AND product = ?", now, now, accountId, p);
  }
  return { refundedCents: Math.round(Number(first.value || 0) * 100), paymentId: first.id };
}

async function upsertEntitlements(db, accountId, products, status, periodEnd, cycle = null) {
  const now = nowIso();
  const mode = cycle === 'annual' ? 'annual' : 'monthly';
  for (const p of products) {
    await db.run(`
      INSERT INTO entitlements (id, account_id, product, status, billing_mode, trial_ends_at, current_period_end, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, product) DO UPDATE SET
        status = excluded.status,
        billing_mode = ${cycle ? 'excluded.billing_mode' : 'entitlements.billing_mode'},
        cancelled_at = ${status === 'read_only' ? 'entitlements.cancelled_at' : 'NULL'},
        current_period_end = excluded.current_period_end,
        updated_at = excluded.updated_at
    `, randomId('ent'), accountId, p, status, mode, status === 'trial' ? periodEnd : null, periodEnd, now);
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/**
 * Reconciliação ao abrir a Cobrança: se um pagamento foi confirmado e o aviso não chegou
 * (webhook ainda não cadastrado ou fora do ar), ativa os serviços do mesmo jeito.
 */
async function syncSubscriptionFromAsaas(db, cfg, row) {
  if (!row || row.provider_mode !== cfg.mode || row.status === 'cancelled' || String(row.provider_subscription_id).startsWith(PENDING_PREFIX)) return;
  try {
    const list = await asaasRequest(cfg, 'GET', `/subscriptions/${encodeURIComponent(row.provider_subscription_id)}/payments`);
    const paid = (list?.data || [])
      .filter((p) => ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(p.status))
      .sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate)))[0];
    if (!paid) return;
    const periodEnd = addDays(String(paid.dueDate).slice(0, 10), row.cycle === 'annual' ? 365 : 30);
    if (row.status === 'active' && row.current_period_end >= periodEnd) return;
    await db.run('UPDATE billing_subscriptions SET status = ?, current_period_end = ?, next_due_date = ?, updated_at = ? WHERE id = ?',
      'active', periodEnd, periodEnd, nowIso(), row.id);
    await upsertEntitlements(db, row.account_id, JSON.parse(row.products_json || '[]'), 'active', periodEnd, row.cycle);
  } catch (err) {
    console.error('[asaas] reconciliação falhou:', err.message);
  }
}

/** Situação real do pagamento no Asaas → evento equivalente. */
function paymentStatusToEvent(status, fallback) {
  if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(status)) return 'PAYMENT_RECEIVED';
  if (status === 'OVERDUE') return 'PAYMENT_OVERDUE';
  if (status === 'PENDING') return 'PAYMENT_CREATED';
  return fallback === 'PAYMENT_DELETED' ? 'IGNORED' : 'IGNORED';
}

/**
 * Webhook do Asaas. Idempotente pelo id do evento.
 * Pagamento confirmado/recebido → serviços ativos até o próximo vencimento.
 * Vencido → status overdue; acesso mantido por 7 dias de carência, com aviso por e-mail.
 * Assinatura removida/inativada → cancelled (serviço segue até o fim do período pago, depois só leitura).
 */
export async function handleAsaasWebhook(db, headers, payload) {
  await ensureBillingTables(db);
  const eventId = String(payload?.id || '');
  const rawEvent = String(payload?.event || '');
  if (!eventId || !rawEvent) throw Object.assign(new Error('Evento inválido.'), { status: 400, code: 'INVALID_EVENT' });

  // Autenticidade: com o token certo no cabeçalho, confiamos no corpo. Sem token (webhook
  // cadastrado à mão no painel do Asaas), consultamos o Asaas com a nossa chave e usamos
  // só o que ele responder; um evento forjado não muda nada.
  const expected = getWebhookToken();
  const trusted = Boolean(expected) && safeEqual(headers['asaas-access-token'], expected);
  let payment = payload.payment || null;
  let event = rawEvent;
  if (!trusted) {
    const cfg = getAsaasConfig();
    if (!cfg.configured) throw Object.assign(new Error('Pagamentos não configurados.'), { status: 503, code: 'PAYMENTS_NOT_CONFIGURED' });
    if (payment?.id) {
      payment = await asaasRequest(cfg, 'GET', `/payments/${encodeURIComponent(payment.id)}`);
      event = paymentStatusToEvent(payment.status, rawEvent);
    } else if (payload.subscription?.id) {
      const sub = await asaasRequest(cfg, 'GET', `/subscriptions/${encodeURIComponent(payload.subscription.id)}`);
      event = sub.deleted || sub.status === 'INACTIVE' ? 'SUBSCRIPTION_DELETED' : 'IGNORED';
    } else {
      return { ok: true, ignored: true };
    }
  }

  const seen = await db.get('SELECT id FROM billing_webhook_events WHERE id = ?', eventId);
  if (seen) return { ok: true, duplicate: true };

  const subId = payment?.subscription || payload.subscription?.id || null;
  // O evento só é dado como recebido DEPOIS de processado: se algo falhar no meio,
  // o reenvio do Asaas é processado de novo (as mudanças abaixo são idempotentes).
  const result = await processAsaasEvent(db, { event, payment, subId });
  await db.run(
    'INSERT INTO billing_webhook_events (id, provider, event, payment_id, subscription_id, received_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    eventId, 'asaas', rawEvent, payment?.id || null, subId, nowIso()
  );
  return result;
}

async function processAsaasEvent(db, { event, payment, subId }) {
  if (!subId) return { ok: true, ignored: true };
  const row = await db.get('SELECT * FROM billing_subscriptions WHERE provider_subscription_id = ?', subId);
  if (!row) return { ok: true, ignored: true };
  const products = JSON.parse(row.products_json || '[]');
  const now = nowIso();

  if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_RECEIVED_IN_CASH') {
    const due = String(payment?.dueDate || row.next_due_date || todaySaoPaulo()).slice(0, 10);
    const periodEnd = addDays(due, row.cycle === 'annual' ? 365 : 30);
    await db.run('UPDATE billing_subscriptions SET status = ?, current_period_end = ?, next_due_date = ?, overdue_since = NULL, updated_at = ? WHERE id = ?',
      'active', periodEnd, periodEnd, now, row.id);
    await upsertEntitlements(db, row.account_id, products, 'active', periodEnd, row.cycle);
    return { ok: true, status: 'active' };
  }
  if (event === 'PAYMENT_OVERDUE') {
    // Carência: o acesso continua por OVERDUE_GRACE_DAYS depois do vencimento; passado o prazo,
    // getAccountEntitlements deixa os serviços só para leitura. O profissional é avisado uma vez.
    const firstNotice = !row.overdue_since;
    const since = row.overdue_since || now;
    await db.run('UPDATE billing_subscriptions SET status = ?, invoice_url = COALESCE(?, invoice_url), overdue_since = ?, updated_at = ? WHERE id = ?',
      'overdue', payment?.invoiceUrl || null, since, now, row.id);
    const due = String(payment?.dueDate || row.next_due_date || todaySaoPaulo()).slice(0, 10);
    // O período pago termina no vencimento não pago: é dele que a carência conta.
    for (const p of products) {
      await db.run("UPDATE entitlements SET current_period_end = ?, updated_at = ? WHERE account_id = ? AND product = ? AND status = 'active'",
        due, now, row.account_id, p);
    }
    return { ok: true, status: 'overdue', notify: firstNotice ? { accountId: row.account_id, invoiceUrl: payment?.invoiceUrl || row.invoice_url || null, suspendOn: addDays(due, OVERDUE_GRACE_DAYS) } : null };
  }
  if (event === 'PAYMENT_CREATED' && payment?.invoiceUrl) {
    await db.run('UPDATE billing_subscriptions SET invoice_url = ?, next_due_date = ?, updated_at = ? WHERE id = ?',
      payment.invoiceUrl, String(payment.dueDate || row.next_due_date).slice(0, 10), now, row.id);
    return { ok: true, status: row.status };
  }
  if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
    await db.run('UPDATE billing_subscriptions SET status = ?, updated_at = ? WHERE id = ?', 'cancelled', now, row.id);
    // Quem já pagou o período segue até o fim dele; quem não pagou fica só para leitura.
    const stillOn = (await db.all("SELECT product FROM entitlements WHERE account_id = ? AND status IN ('active', 'trial')", row.account_id)).map((e) => e.product);
    await endEntitlements(db, row.account_id, products.filter((p) => stillOn.includes(p)), row);
    return { ok: true, status: 'cancelled' };
  }
  return { ok: true, ignored: true };
}

/**
 * Rotas de cobrança. Retorna true quando tratou a requisição.
 * helpers: { json, readJsonBody, requireProfessional, writeAudit }
 */
export async function handleBillingRoutes({ db, req, res, method, pathname, auth }, helpers) {
  const { json, readJsonBody, requireProfessional, writeAudit } = helpers;

  if (method === 'GET' && pathname === '/api/v1/billing/prices') {
    const list = Object.entries(PILOT_PRICES_CENTS).map(([k, v]) => ({ products: k.split('+'), monthlyCents: v, annualCents: v * 10 }));
    json(res, 200, { trialDays: PILOT_TRIAL_DAYS, prices: list });
    return true;
  }

  if (method === 'POST' && pathname === '/api/v1/billing/asaas/webhook') {
    const body = await readJsonBody(req);
    const { notify, ...result } = await handleAsaasWebhook(db, req.headers, body);
    if (notify && helpers.notifyOverdue) await helpers.notifyOverdue(notify).catch((err) => console.error('[asaas] aviso de atraso não enviado:', err.message));
    json(res, 200, result);
    return true;
  }

  if (method === 'GET' && pathname === '/api/v1/billing/status') {
    await requireProfessional(db, auth);
    await ensureBillingTables(db);
    const cfg = getAsaasConfig();
    if (cfg.configured) {
      await ensureWebhook(cfg);
      await syncSubscriptionFromAsaas(db, cfg, await getCurrentSubscription(db, auth.account.id));
    }
    json(res, 200, { ...getAsaasStatus(), subscription: publicSubscription(await getCurrentSubscription(db, auth.account.id)) });
    return true;
  }

  if (method === 'POST' && pathname === '/api/v1/billing/checkout') {
    await requireProfessional(db, auth);
    if (!auth.user.email_verified_at) throw Object.assign(new Error('Confirme seu e-mail antes de contratar.'), { status: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
    const body = await readJsonBody(req);
    const out = await createCheckout(db, { account: auth.account, user: auth.user, products: body.products, cycle: body.cycle, cpfCnpj: body.cpfCnpj, ethaService: body.ethaService });
    await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'billing.checkout', resourceType: 'billing_subscription', resourceId: out.subscription?.id, meta: { products: out.subscription?.products, cycle: out.subscription?.cycle, reused: out.reused } });
    json(res, out.reused ? 200 : 201, out);
    return true;
  }

  if (method === 'POST' && pathname === '/api/v1/billing/refund') {
    await requireProfessional(db, auth);
    const out = await refundFirstPayment(db, { accountId: auth.account.id });
    await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'billing.refund', resourceType: 'billing_subscription', meta: { refundedCents: out.refundedCents } });
    json(res, 200, { ok: true, refundedCents: out.refundedCents, message: 'Devolução integral pedida ao Asaas. O valor volta pelo mesmo meio de pagamento. Seus serviços ficaram só para leitura e exportação.' });
    return true;
  }

  return false;
}
