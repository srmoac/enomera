import crypto from 'node:crypto';
import { nowIso, randomId } from './crypto.mjs';

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

export const PILOT_TRIAL_DAYS = 30;

/** Preços aprovados por Marcos em 22/11/2026 (mensal, em centavos). Anual = 10 mensalidades. */
export const PILOT_PRICES_CENTS = {
  ambo: 3900,
  etha: 4900,
  minne: 5900,
  'ambo+minne': 7900,
  'ambo+etha': 6900, // combinação não definida por Marcos; decisão reversível registrada em 22/11
  'etha+minne': 8900, // idem
  'ambo+etha+minne': 9900,
};

const ORDER = ['ambo', 'etha', 'minne'];
const NAMES = { ambo: 'Ambo', etha: 'Etha', minne: 'Minne' };

export function normalizeProducts(list) {
  const raw = Array.isArray(list) ? list : [];
  return ORDER.filter((p) => raw.includes(p));
}

export function priceFor(products, cycle = 'monthly') {
  const sel = normalizeProducts(products);
  if (!sel.length) throw Object.assign(new Error('Escolha pelo menos um produto.'), { status: 400, code: 'EMPTY_SELECTION' });
  const monthly = PILOT_PRICES_CENTS[sel.join('+')];
  const cents = cycle === 'annual' ? monthly * 10 : monthly;
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
  const url = `${base}/api/v1/billing/asaas/webhook`;
  try {
    const list = await asaasRequest(cfg, 'GET', '/webhooks');
    if (!(list?.data || []).some((w) => w.url === url)) {
      await asaasRequest(cfg, 'POST', '/webhooks', {
        name: 'Enomera Core',
        url,
        email: process.env.ASAAS_WEBHOOK_EMAIL || process.env.SMTP_USER || 'mrsaocwork@gmail.com',
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

/** Cria (ou reaproveita) o cliente e a assinatura no Asaas com 30 dias grátis. */
export async function createCheckout(db, { account, user, products, cycle, cpfCnpj }) {
  const cfg = getAsaasConfig();
  if (!cfg.configured) {
    throw Object.assign(
      new Error(cfg.mode === 'blocked_production'
        ? 'A chave do Asaas é da conta real. Cobrança real só depois da autorização para publicar.'
        : 'Pagamento ainda não configurado neste ambiente (ASAAS_API_KEY ausente).'),
      { status: 503, code: cfg.mode === 'blocked_production' ? 'REAL_PAYMENTS_BLOCKED' : 'PAYMENTS_NOT_CONFIGURED' }
    );
  }
  const doc = onlyDigits(cpfCnpj);
  if (doc.length !== 11 && doc.length !== 14) {
    throw Object.assign(new Error('Informe um CPF ou CNPJ válido para emitir a cobrança.'), { status: 400, code: 'INVALID_CPF_CNPJ' });
  }
  const price = priceFor(products, cycle);
  await ensureBillingTables(db);

  const existing = await getCurrentSubscription(db, account.id);
  if (existing && existing.status !== 'overdue') {
    return { subscription: publicSubscription(existing), reused: true };
  }

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

  const now = nowIso();
  const id = randomId('sub');
  await db.run(
    `INSERT INTO billing_subscriptions (id, account_id, provider, provider_mode, provider_customer_id, provider_subscription_id,
      products_json, cycle, value_cents, status, next_due_date, invoice_url, current_period_end, created_at, updated_at)
     VALUES (?, ?, 'asaas', ?, ?, ?, ?, ?, ?, 'trial', ?, ?, ?, ?, ?)`,
    id, account.id, cfg.mode, customer.id, subscription.id, JSON.stringify(price.products), price.cycle,
    price.valueCents, nextDueDate, invoiceUrl, nextDueDate, now, now
  );
  await upsertEntitlements(db, account.id, price.products, 'trial', nextDueDate);
  return { subscription: publicSubscription(await db.get('SELECT * FROM billing_subscriptions WHERE id = ?', id)), reused: false };
}

async function upsertEntitlements(db, accountId, products, status, periodEnd) {
  const now = nowIso();
  for (const p of products) {
    await db.run(`
      INSERT INTO entitlements (id, account_id, product, status, billing_mode, trial_ends_at, current_period_end, updated_at)
      VALUES (?, ?, ?, ?, 'monthly', ?, ?, ?)
      ON CONFLICT(account_id, product) DO UPDATE SET
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        updated_at = excluded.updated_at
    `, randomId('ent'), accountId, p, status, status === 'trial' ? periodEnd : null, periodEnd, now);
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
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
 * Vencido → status overdue (acesso mantido; aviso no portal).
 * Assinatura removida/inativada → cancelled (serviço passa a somente leitura).
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
  await db.run(
    'INSERT INTO billing_webhook_events (id, provider, event, payment_id, subscription_id, received_at) VALUES (?, ?, ?, ?, ?, ?)',
    eventId, 'asaas', rawEvent, payment?.id || null, subId, nowIso()
  );
  if (!subId) return { ok: true, ignored: true };
  const row = await db.get('SELECT * FROM billing_subscriptions WHERE provider_subscription_id = ?', subId);
  if (!row) return { ok: true, ignored: true };
  const products = JSON.parse(row.products_json || '[]');
  const now = nowIso();

  if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_RECEIVED_IN_CASH') {
    const due = String(payment?.dueDate || row.next_due_date || todaySaoPaulo()).slice(0, 10);
    const periodEnd = addDays(due, row.cycle === 'annual' ? 365 : 30);
    await db.run('UPDATE billing_subscriptions SET status = ?, current_period_end = ?, next_due_date = ?, updated_at = ? WHERE id = ?',
      'active', periodEnd, periodEnd, now, row.id);
    await upsertEntitlements(db, row.account_id, products, 'active', periodEnd);
    return { ok: true, status: 'active' };
  }
  if (event === 'PAYMENT_OVERDUE') {
    await db.run('UPDATE billing_subscriptions SET status = ?, invoice_url = COALESCE(?, invoice_url), updated_at = ? WHERE id = ?',
      'overdue', payment?.invoiceUrl || null, now, row.id);
    return { ok: true, status: 'overdue' };
  }
  if (event === 'PAYMENT_CREATED' && payment?.invoiceUrl) {
    await db.run('UPDATE billing_subscriptions SET invoice_url = ?, next_due_date = ?, updated_at = ? WHERE id = ?',
      payment.invoiceUrl, String(payment.dueDate || row.next_due_date).slice(0, 10), now, row.id);
    return { ok: true, status: row.status };
  }
  if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
    await db.run('UPDATE billing_subscriptions SET status = ?, updated_at = ? WHERE id = ?', 'cancelled', now, row.id);
    await upsertEntitlements(db, row.account_id, products, 'read_only', row.current_period_end);
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
    const result = await handleAsaasWebhook(db, req.headers, body);
    json(res, 200, result);
    return true;
  }

  if (method === 'GET' && pathname === '/api/v1/billing/status') {
    await requireProfessional(db, auth);
    await ensureBillingTables(db);
    const cfg = getAsaasConfig();
    if (cfg.configured) await ensureWebhook(cfg);
    json(res, 200, { ...getAsaasStatus(), subscription: publicSubscription(await getCurrentSubscription(db, auth.account.id)) });
    return true;
  }

  if (method === 'POST' && pathname === '/api/v1/billing/checkout') {
    await requireProfessional(db, auth);
    if (!auth.user.email_verified_at) throw Object.assign(new Error('Confirme seu e-mail antes de contratar.'), { status: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
    const body = await readJsonBody(req);
    const out = await createCheckout(db, { account: auth.account, user: auth.user, products: body.products, cycle: body.cycle, cpfCnpj: body.cpfCnpj });
    await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'billing.checkout', resourceType: 'billing_subscription', resourceId: out.subscription?.id, meta: { products: out.subscription?.products, cycle: out.subscription?.cycle, reused: out.reused } });
    json(res, out.reused ? 200 : 201, out);
    return true;
  }

  return false;
}
