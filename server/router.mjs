import { z } from 'zod';
import { COMMERCIAL_CATALOG, buildContractSummary, calculateSimulatedQuote, normalizeSelection } from './catalog.mjs';
import {
  addDaysIso,
  addMinutesIso,
  hashPassword,
  nowIso,
  randomDigits,
  randomId,
  randomToken,
  sha256Hex,
  verifyPassword,
} from './crypto.mjs';
import {
  getAppliedMigrations,
  getDb,
  getRemoteInfraGuard,
  isRemoteInfraRequired,
  queueDevOutbox,
  runTransaction,
  writeAudit,
} from './db.mjs';
import { getMailerStatus, sendTransactionalEmail } from './mailer.mjs';
import { getAsaasStatus, handleBillingRoutes } from './asaas.mjs';
import { profilePhotoUrl, savePortrait, requireOwnedPortrait, servePortrait } from './profile-media.mjs';
import {
  SUPPORTED_IMPORT_FORMATS,
  cancelImportBatch,
  commitImportBatch,
  generateSpreadsheetTemplateBuffer,
  getImportBatchDetail,
  resolveImportItem,
  revertImportBatch,
  stageImportBatch,
} from './importer.mjs';
import {
  cancelAppointmentTx,
  confirmConsultationRequest,
  createManualAppointment,
  decideRescheduleRequest,
  findDuplicatePatientCandidate,
  generateAvailableSlots,
  requestAppointmentReschedule,
  reserveSlotByInvitation,
} from './scheduling.mjs';
import { seedDatabase } from './seed.mjs';
import {
  getStorageBackendStatus,
  readPrivateFileBinary,
  savePrivateFile,
} from './storage.mjs';

const COOKIE_NAME = 'enomera_sid';
const MAX_BODY_BYTES = 35 * 1024 * 1024; // allows base64-encoded 25 MB ZIP

const ENOMERA_VERCEL_HOST_RE = /^(enomera|lotus|lotus-app|ambo-enomera|compasso|compasso-app|minne-enomera|etha-enomera|clara-azevedo-site|helenaduartepsi|mrsaoc-portfolio)(-[a-z0-9-]+)?\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (!isRemoteInfraRequired() && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    const extra = [process.env.ALLOWED_ORIGINS || '', process.env.ENOMERA_AMBO_URL, process.env.ENOMERA_MINNE_URL,
      process.env.ENOMERA_ETHA_URL, process.env.ENOMERA_HELENA_URL, process.env.ENOMERA_PUBLIC_URL]
      .filter(Boolean).flatMap((s) => s.split(',')).map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
    if (extra.includes(origin)) return true;
  } catch {}
  return false;
}

// Aviso ao paciente quando a solicitação é confirmada. O envio é à parte da confirmação:
// se o e-mail falhar, a consulta continua confirmada e a resposta diz que o aviso não saiu.
async function notifyPatientOfConfirmation(db, account, out) {
  const recipient = String(out?.request?.patient_email || '').trim();
  if (!recipient || out?.idempotentReplay || !out?.appointment) return { sent: false, recipient: recipient || null, reason: recipient ? 'already_notified' : 'no_email' };
  const tz = account.timezone || 'America/Sao_Paulo';
  const when = new Date(out.appointment.start_at).toLocaleString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  const modality = out.appointment.modality === 'presencial' ? 'presencial' : 'online';
  const amboBase = String(process.env.ENOMERA_AMBO_URL || '').replace(/\/+$/, '');
  const link = amboBase ? `${amboBase}/?pro=${encodeURIComponent(account.slug)}` : '';
  const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  try {
    const delivery = await sendTransactionalEmail(db, {
      recipient,
      subject: `Consulta confirmada com ${account.display_name} · Ambo`,
      textBody: `${account.display_name} confirmou sua consulta ${modality}: ${when}.${link ? ` Acompanhe ou peça remarcação em ${link}` : ''}`,
      htmlBody: `<p><b>${escHtml(account.display_name)}</b> confirmou sua consulta ${modality}.</p><p><b>${escHtml(when)}</b></p>${link ? `<p><a href="${escHtml(link)}">Acompanhar ou pedir remarcação no Ambo</a></p>` : ''}`,
      purpose: 'ambo_request_confirmed',
    });
    return { sent: Boolean(delivery.sentExternally), recipient, reason: delivery.sentExternally ? null : delivery.deliveryStatus };
  } catch (err) {
    return { sent: false, recipient, reason: err.code || 'delivery_failed' };
  }
}

// A própria origem do deployment é sempre aceita (alias de branch, URL do deployment ou domínio atribuído).
function isRequestOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    if (host && new URL(origin).host.toLowerCase() === host) return true;
  } catch {}
  return isAllowedOrigin(origin);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isRequestOriginAllowed(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Idempotency-Key');
}

function json(res, status, data, extraHeaders = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Corpo da requisição excede o limite permitido.'), { status: 413, code: 'BODY_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('JSON inválido no corpo da requisição.'), { status: 400, code: 'INVALID_JSON' });
  }
}

async function getSessionFromRequest(db, req) {
  const authHeader = req.headers.authorization || '';
  let rawToken = null;
  if (authHeader.startsWith('Bearer ')) rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    const cookies = parseCookies(req);
    rawToken = cookies[COOKIE_NAME] || null;
  }
  if (!rawToken) return null;

  const tokenHash = sha256Hex(rawToken);
  const sess = (await db.get('SELECT * FROM sessions WHERE token_hash = ?', tokenHash));
  if (!sess) return null;
  if (sess.revoked_at || Date.parse(sess.expires_at) <= Date.now()) return null;

  const user = (await db.get('SELECT id, email, full_name, role, email_verified_at, mfa_enabled FROM users WHERE id = ?', sess.user_id));
  if (!user) return null;

  let account = null;
  let membership = null;
  if (sess.account_id) {
    account = (await db.get('SELECT * FROM professional_accounts WHERE id = ?', sess.account_id));
    if (sess.actor_type === 'professional') {
      membership = (await db.get('SELECT * FROM account_memberships WHERE account_id = ? AND user_id = ?', sess.account_id, user.id));
    }
  }
  return { session: sess, user, account, membership, rawToken };
}

async function issueSession(db, { userId, actorType, accountId = null, patientId = null, ttlMinutes = 60 * 24 }) {
  const rawToken = randomToken(32);
  const id = randomId('ses');
  const now = nowIso();
  const expiresAt = addMinutesIso(ttlMinutes);
  (await db.run(`
    INSERT INTO sessions (id, token_hash, user_id, actor_type, account_id, patient_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, id, sha256Hex(rawToken), userId, actorType, accountId, patientId, expiresAt, now));
  const secure = process.env.VERCEL ? '; Secure; SameSite=None' : '; SameSite=Lax';
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Max-Age=${ttlMinutes * 60}${secure}`;
  return { id, rawToken, expiresAt, cookie };
}

async function getAccountEntitlements(db, accountId) {
  const rows = (await db.all('SELECT * FROM entitlements WHERE account_id = ?', accountId));
  const now = Date.now();
  const map = { ambo: null, minne: null, etha: null };
  for (const r of rows) {
    let effectiveStatus = r.status;
    if (r.status === 'trial' && r.trial_ends_at && Date.parse(r.trial_ends_at) <= now) {
      effectiveStatus = 'read_only';
      (await db.run("UPDATE entitlements SET status = 'read_only', updated_at = ? WHERE id = ?", nowIso(), r.id));
    }
    map[r.product] = {
      product: r.product,
      status: effectiveStatus,
      billingMode: r.billing_mode,
      trialEndsAt: r.trial_ends_at,
      currentPeriodEnd: r.current_period_end,
      cancelledAt: r.cancelled_at,
      canWrite: ['active', 'trial', 'cancelled_grace'].includes(effectiveStatus),
      canReadExport: ['active', 'trial', 'cancelled_grace', 'read_only'].includes(effectiveStatus),
    };
  }
  return map;
}

function requireAuth(auth) {
  if (!auth) throw Object.assign(new Error('Sessão ausente ou expirada. Faça login novamente.'), { status: 401, code: 'UNAUTHENTICATED' });
  return auth;
}

async function requireProfessional(db, auth, { product = null, write = false, clinical = false } = {}) {
  requireAuth(auth);
  if (auth.session.actor_type !== 'professional' || !auth.account || !auth.membership) {
    throw Object.assign(new Error('Acesso restrito a profissionais autorizados desta conta.'), { status: 403, code: 'FORBIDDEN_ACTOR' });
  }
  if (clinical && !auth.membership.can_access_clinical) {
    throw Object.assign(new Error('Seu vínculo nesta conta não autoriza acesso ao conteúdo clínico.'), { status: 403, code: 'FORBIDDEN_CLINICAL' });
  }
  if (product && !auth.user.email_verified_at) {
    throw Object.assign(new Error('Confirme seu e-mail para usar os serviços desta conta.'), { status: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
  }
  if (product) {
    const ents = await getAccountEntitlements(db, auth.account.id);
    const e = ents[product];
    const ok = write ? e?.canWrite : e?.canReadExport;
    if (!ok) {
      throw Object.assign(new Error(`Serviço "${product}" não está ativo nesta conta profissional.`), { status: 403, code: 'ENTITLEMENT_REQUIRED', product });
    }
  }
  return auth;
}

function requireOperator(auth) {
  requireAuth(auth);
  if (auth.user.role !== 'operator' || auth.session.actor_type !== 'operator') {
    throw Object.assign(new Error('Acesso restrito à operação da Etha.'), { status: 403, code: 'FORBIDDEN_OPERATOR' });
  }
  return auth;
}

function requirePatient(auth) {
  requireAuth(auth);
  if (auth.session.actor_type !== 'patient' || !auth.session.patient_id || !auth.session.account_id) {
    throw Object.assign(new Error('Verifique seu acesso de paciente para consultar ou alterar sua agenda.'), { status: 401, code: 'PATIENT_AUTH_REQUIRED' });
  }
  return auth;
}

function slugify(name) {
  return String(name || 'profissional')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profissional';
}

async function buildPublicSiteDto(db, account) {
  const ents = await getAccountEntitlements(db, account.id);
  const amboActive = Boolean(ents.ambo?.canWrite);
  const proj = (await db.get('SELECT * FROM etha_projects WHERE account_id = ?', account.id));
  let published = null;
  if (proj?.published_version_id) {
    const v = (await db.get("SELECT * FROM etha_content_versions WHERE id = ? AND stage = 'published'", proj.published_version_id));
    if (v) published = { versionNumber: v.version_number, publishedAt: v.published_at, content: JSON.parse(v.content_json) };
  }
  const ctaMode = amboActive && (!proj || proj.cta_mode === 'ambo') ? 'ambo' : 'custom';
  return {
    slug: account.slug,
    displayName: published?.content?.displayName || account.display_name,
    crp: published?.content?.crp || account.crp_or_crm,
    specialty: account.specialty,
    headline: published?.content?.headline || `${account.display_name} · ${account.specialty}`,
    subheadline: published?.content?.subheadline || account.bio,
    about: published?.content?.about || account.bio,
    photoAssetId: published?.content?.photoAssetId || null,
    photoUrl: published?.content?.photoAssetId ? `/api/v1/public-sites/${encodeURIComponent(account.slug)}/photo/${encodeURIComponent(published.content.photoAssetId)}` : null,
    audience: account.audience || '',
    ctaLabel: published?.content?.ctaLabel || (ctaMode === 'ambo' ? 'Solicitar primeira consulta' : 'Entrar em contato'),
    ctaMode,
    amboActive,
    amboProfileSlug: amboActive ? account.slug : null,
    customContactUrl: ctaMode === 'custom' ? (proj?.custom_contact_url || published?.content?.customContactUrl || '') : null,
    contactUrl: proj?.custom_contact_url || published?.content?.customContactUrl || null,
    authorship: 'Site por Etha',
    versionNumber: published?.versionNumber || null,
    publishedAt: published?.publishedAt || null,
    domainStatus: proj?.domain_status || 'staging_only',
  };
}

async function issueVerificationCode(db, { purpose, targetContact, userId = null, accountId = null, patientId = null, subject, ttlMinutes = 15 }) {
  const previous = await db.get('SELECT created_at FROM verification_tokens WHERE purpose = ? AND target_contact = ? ORDER BY created_at DESC LIMIT 1', purpose, targetContact.toLowerCase());
  if (previous && Date.now() - Date.parse(previous.created_at) < 30_000) {
    throw Object.assign(new Error('Aguarde 30 segundos antes de solicitar outro código.'), { status: 429, code: 'RESEND_RATE_LIMITED' });
  }
  const code = randomDigits(6);
  const id = randomId('ver');
  const now = nowIso();
  const expiresAt = addMinutesIso(ttlMinutes);
  // Invalidate any prior unconsumed OTPs for this purpose + contact so older codes can never be replayed
  await db.run(
    'UPDATE verification_tokens SET consumed_at = ? WHERE purpose = ? AND target_contact = ? AND consumed_at IS NULL',
    now, purpose, targetContact.toLowerCase()
  );
  await db.run(
    `INSERT INTO verification_tokens (id, purpose, target_contact, user_id, account_id, patient_id, code_hash, attempts, max_attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 5, ?, ?)`,
    id, purpose, targetContact.toLowerCase(), userId, accountId, patientId, sha256Hex(code), expiresAt, now
  );

  const delivery = await sendTransactionalEmail(db, {
    channel: targetContact.includes('@') ? 'email' : 'whatsapp',
    recipient: targetContact,
    subject,
    textBody: `Seu código de uso único (expira em ${ttlMinutes} min): ${code}`,
    htmlBody: `<p>Seu código de uso único na Enomera (expira em ${ttlMinutes} minutos):</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>`,
    purpose,
  });

  return {
    tokenId: id,
    expiresAt,
    delivery,
    devCode: delivery.sentExternally || isRemoteInfraRequired() ? undefined : code,
  };
}

async function consumeVerificationCode(db, { purpose, targetContact, code }) {
  const row = await db.get(
    `SELECT * FROM verification_tokens
     WHERE purpose = ? AND target_contact = ? AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    purpose, targetContact.toLowerCase()
  );
  if (!row) throw Object.assign(new Error('Nenhum código pendente encontrado. Solicite um novo código.'), { status: 400, code: 'CODE_NOT_FOUND' });
  if (Date.parse(row.expires_at) <= Date.now()) {
    throw Object.assign(new Error('Este código expirou. Solicite um reenvio para continuar.'), { status: 410, code: 'CODE_EXPIRED' });
  }
  if (row.attempts >= row.max_attempts) {
    throw Object.assign(new Error('Limite de tentativas atingido. Solicite um novo código.'), { status: 429, code: 'CODE_RATE_LIMITED' });
  }
  if (row.code_hash !== sha256Hex(String(code || '').trim())) {
    await db.run('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL', row.id);
    throw Object.assign(new Error('Código incorreto. Confira os 6 dígitos e tente novamente.'), { status: 400, code: 'CODE_INVALID' });
  }
  const claimed = await db.run(
    'UPDATE verification_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND attempts < max_attempts',
    nowIso(), row.id
  );
  if (!claimed || Number(claimed.changes || 0) !== 1) {
    throw Object.assign(new Error('Este código já foi utilizado ou atingiu o limite de tentativas.'), { status: 409, code: 'CODE_ALREADY_USED' });
  }
  return row;
}

function displayNameFromEmail(email) {
  const local = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
  const name = local.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return name.length >= 2 ? name : 'Profissional';
}

async function createProfessionalUser(db, { fullName, email, password, crpOrCrm = '', specialty = 'Psicologia', emailVerifiedAt = null }) {
  const userId = randomId('usr');
  const accountId = randomId('acc');
  const now = nowIso();
  const pwd = hashPassword(password);
  const cleanName = String(fullName || '').trim();
  let slug = slugify(cleanName);
  if ((await db.get('SELECT id FROM professional_accounts WHERE slug = ?', slug))) {
    slug = `${slug}-${randomDigits(4)}`;
  }
  await runTransaction(db, async (db) => {
    (await db.run(`
      INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'professional', ?, 1, ?, ?)
    `, userId, email, pwd.hash, pwd.salt, cleanName, emailVerifiedAt, now, now));

    (await db.run(`
      INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, crp_or_crm, specialty, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, accountId, userId, slug, cleanName, String(crpOrCrm || '').trim(), specialty, now, now));

    (await db.run(`
      INSERT INTO account_memberships (id, account_id, user_id, role, can_access_clinical, created_at)
      VALUES (?, ?, ?, 'owner', 1, ?)
    `, randomId('mem'), accountId, userId, now));

    // Sensible default availability Mon-Fri 09:00-18:00 (editable by professional)
    for (const wd of [1, 2, 3, 4, 5]) {
      (await db.run(`
        INSERT INTO availability_rules (id, account_id, weekday, start_time, end_time, modality, active, created_at)
        VALUES (?, ?, ?, '09:00', '18:00', 'both', 1, ?)
      `, randomId('avr'), accountId, wd, now));
    }
    await writeAudit(db, { actorUserId: userId, actorType: 'professional', accountId, action: 'auth.signup', resourceType: 'user', resourceId: userId });
  });
  return { userId, accountId, slug };
}

async function findPrimaryAccountForUser(db, userId) {
  return db.get(`
    SELECT pa.* FROM professional_accounts pa
    JOIN account_memberships am ON am.account_id = pa.id
    WHERE am.user_id = ? LIMIT 1
  `, userId);
}

async function readAccountSelection(db, accountId) {
  const row = await db.get('SELECT ui_preferences_json FROM professional_accounts WHERE id = ?', accountId);
  let prefs = {};
  try { prefs = JSON.parse(row?.ui_preferences_json || '{}') || {}; } catch { prefs = {}; }
  return prefs.commercialSelection || null;
}

async function writeAccountSelection(db, accountId, input) {
  const sel = normalizeSelection(input);
  if (!sel.products.length) throw Object.assign(new Error('Escolha ao menos um serviço.'), { status: 400, code: 'EMPTY_SELECTION' });
  const row = await db.get('SELECT ui_preferences_json FROM professional_accounts WHERE id = ?', accountId);
  let prefs = {};
  try { prefs = JSON.parse(row?.ui_preferences_json || '{}') || {}; } catch { prefs = {}; }
  const stage = ['selection', 'verification', 'review', 'confirmed'].includes(input?.stage) ? input.stage : (prefs.commercialSelection?.stage === 'confirmed' ? 'selection' : prefs.commercialSelection?.stage || 'selection');
  const selection = { ...sel, stage, updatedAt: nowIso() };
  prefs.commercialSelection = selection;
  await db.run('UPDATE professional_accounts SET ui_preferences_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(prefs), selection.updatedAt, accountId);
  return selection;
}

function sessionPayload(u, account) {
  return {
    user: { id: u.id, email: u.email, fullName: u.full_name, role: u.role, emailVerified: Boolean(u.email_verified_at) },
    account: account ? { id: account.id, slug: account.slug, displayName: account.display_name, crpOrCrm: account.crp_or_crm, specialty: account.specialty } : null,
  };
}

export async function handleApiRequest(req, res, customDb = null) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  try {
    if (!isRequestOriginAllowed(req)) {
      return json(res,403,{error:'Origem não autorizada para este ambiente.',code:'ORIGIN_NOT_ALLOWED'});
    }
    // ── HEALTH & CATALOG ──────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/v1/health') {
      const guard = getRemoteInfraGuard();
      if (guard.required && !guard.ready) {
        return json(res, 503, {
          ok: false,
          code: 'REMOTE_INFRA_NOT_CONFIGURED',
          error: `Ambiente de entrega requer infraestrutura remota completa (Neon Postgres, Vercel Blob Private e Resend). Variáveis ausentes: ${guard.missingEnvVars.join(', ')}.`,
          service: 'enomera-core-api',
          catalogVersion: COMMERCIAL_CATALOG.version,
          time: nowIso(),
          requireRemoteInfra: true,
          missingEnvVars: guard.missingEnvVars,
          integrations: {
            database: {
              dialect: guard.components.database.configured ? 'postgres' : 'unconfigured',
              activeBackend: guard.components.database.configured ? 'neon_postgres' : 'unconfigured_remote_required',
              neonUrlPresent: guard.components.database.configured,
              configured: guard.components.database.configured,
              missingEnvVars: guard.components.database.configured ? [] : ['DATABASE_URL'],
              appliedMigrations: [],
            },
            storage: getStorageBackendStatus(),
            mailer: getMailerStatus(),
          },
        });
      }

      const db = (customDb && !customDb.closed) ? customDb : await getDb(customDb ? process.env.ENOMERA_DB_PATH : undefined);
      await seedDatabase(db);
      const appliedMigrations = await getAppliedMigrations(db);
      return json(res, 200, {
        ok: true,
        service: 'enomera-core-api',
        catalogVersion: COMMERCIAL_CATALOG.version,
        time: nowIso(),
        requireRemoteInfra: guard.required,
        missingEnvVars: guard.missingEnvVars,
        integrations: {
          database: {
            dialect: db.dialect,
            activeBackend: db.dialect === 'postgres' ? 'neon_postgres' : 'sqlite_local',
            neonUrlPresent: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
            configured: db.dialect === 'postgres' || !guard.required,
            missingEnvVars: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL) ? [] : ['DATABASE_URL'],
            appliedMigrations: appliedMigrations.map((m) => m.version),
          },
          storage: getStorageBackendStatus(),
          mailer: getMailerStatus(),
          payments: getAsaasStatus(),
        },
      });
    }

    const db = (customDb && !customDb.closed) ? customDb : await getDb(customDb ? process.env.ENOMERA_DB_PATH : undefined);
    await seedDatabase(db);
    const auth = await getSessionFromRequest(db, req);

    if (method === 'GET' && pathname === '/api/v1/catalog') {
      return json(res, 200, COMMERCIAL_CATALOG);
    }
    if (method === 'POST' && pathname === '/api/v1/catalog/quote') {
      const body = await readJsonBody(req);
      const quote = calculateSimulatedQuote(body);
      return json(res, 200, { ...quote, contract: buildContractSummary(body) });
    }

    // ── COBRANÇA (Asaas; sandbox até autorização de cobrança real) ─────────
    if (pathname.startsWith('/api/v1/billing/')) {
      if (await handleBillingRoutes({ db, req, res, method, pathname, auth }, { json, readJsonBody, requireProfessional, writeAudit })) return;
    }

    // ── CONTRATAÇÃO: E-MAIL COM CÓDIGO (sem senha) E COMBINAÇÃO POR CONTA ─
    if (method === 'POST' && pathname === '/api/v1/auth/email-code/request') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      if (!z.string().email().safeParse(email).success) {
        throw Object.assign(new Error('Informe um e-mail válido.'), { status: 400, code: 'INVALID_EMAIL' });
      }
      const recent = await db.get(
        "SELECT created_at FROM verification_tokens WHERE purpose = 'email_login' AND target_contact = ? ORDER BY created_at DESC LIMIT 1",
        email
      );
      if (recent && Date.now() - Date.parse(recent.created_at) < 20_000) {
        throw Object.assign(new Error('Aguarde alguns segundos antes de pedir outro código.'), { status: 429, code: 'CODE_REQUEST_TOO_SOON' });
      }
      const u = await db.get('SELECT id FROM users WHERE email = ?', email);
      const ver = await issueVerificationCode(db, {
        purpose: 'email_login',
        targetContact: email,
        userId: u?.id || null,
        subject: 'Seu código de acesso · Enomera',
      });
      // Mesma resposta para conta nova ou existente (sem revelar cadastro).
      return json(res, 200, { ok: true, expiresAt: ver.expiresAt, resendAfterSec: 60, delivery: ver.delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/email-code/verify') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      await consumeVerificationCode(db, { purpose: 'email_login', targetContact: email, code: body.code });
      const now = nowIso();
      let u = await db.get('SELECT * FROM users WHERE email = ?', email);
      let isNewAccount = false;
      if (!u) {
        await createProfessionalUser(db, {
          fullName: displayNameFromEmail(email),
          email,
          password: randomToken(24),
          emailVerifiedAt: now,
        });
        isNewAccount = true;
        u = await db.get('SELECT * FROM users WHERE email = ?', email);
      } else if (!u.email_verified_at) {
        await db.run('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?', now, now, u.id);
        u = await db.get('SELECT * FROM users WHERE id = ?', u.id);
      }
      const account = u.role === 'professional' ? await findPrimaryAccountForUser(db, u.id) : null;
      const sess = await issueSession(db, { userId: u.id, actorType: u.role, accountId: account?.id || null });
      await writeAudit(db, { actorUserId: u.id, actorType: u.role, accountId: account?.id || null, action: 'auth.email_code_login', resourceType: 'session', resourceId: sess.id, meta: { isNewAccount } });
      let selection = account ? await readAccountSelection(db, account.id) : null;
      const incoming = body.selection ? normalizeSelection(body.selection) : null;
      if (account && incoming?.products.length) {
        // A escolha feita antes da verificação é a mais recente: passa a ser a da conta.
        selection = await writeAccountSelection(db, account.id, incoming);
      }
      return json(res, 200, {
        ...sessionPayload(u, account),
        entitlements: account ? await getAccountEntitlements(db, account.id) : null,
        sessionToken: sess.rawToken,
        expiresAt: sess.expiresAt,
        isNewAccount,
        selection,
        contract: selection?.products?.length ? buildContractSummary(selection) : null,
      }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'GET' && pathname === '/api/v1/commercial/selection') {
      await requireProfessional(db, auth);
      const selection = await readAccountSelection(db, auth.account.id);
      return json(res, 200, { selection, contract: selection?.products?.length ? buildContractSummary(selection) : null });
    }

    if (method === 'PUT' && pathname === '/api/v1/commercial/selection') {
      await requireProfessional(db, auth);
      const selection = await writeAccountSelection(db, auth.account.id, await readJsonBody(req));
      return json(res, 200, { selection, contract: buildContractSummary(selection) });
    }

    // ── AUTHENTICATION & VERIFICATION ─────────────────────────────────
    if (method === 'POST' && pathname === '/api/v1/auth/signup') {
      const schema = z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        crpOrCrm: z.string().optional().default(''),
        specialty: z.enum(['Psicologia', 'Psiquiatria']).optional().default('Psicologia'),
        selection: z.object({ products: z.array(z.enum(['ambo', 'minne', 'etha'])).min(1), ethaFormat: z.enum(['one_page', 'multi_page']).optional() }).optional(),
      });
      const data = schema.parse(await readJsonBody(req));
      const normEmail = data.email.trim().toLowerCase();
      const exists = (await db.get('SELECT * FROM users WHERE email = ?', normEmail));
      let userId; let accountId; let slug; let resumed = false;
      if (exists) {
        // Cadastro pendente (e-mail nunca confirmado): quem tem a senha retoma a
        // conta e recebe um novo código, em vez de ficar preso no "já existe".
        const pending = !exists.email_verified_at && exists.role === 'professional';
        if (!pending || !verifyPassword(data.password, exists.password_hash, exists.password_salt)) {
          const msg = pending
            ? 'Já existe um cadastro pendente com este e-mail. Use a mesma senha para continuar ou entre em "Já tenho conta".'
            : 'Já existe uma conta com este e-mail. Entre para recuperar sua combinação.';
          throw Object.assign(new Error(msg), { status: 409, code: pending ? 'EMAIL_PENDING' : 'EMAIL_EXISTS' });
        }
        const acc = await db.get('SELECT pa.id, pa.slug FROM professional_accounts pa JOIN account_memberships am ON am.account_id = pa.id WHERE am.user_id = ? LIMIT 1', exists.id);
        if (!acc) throw Object.assign(new Error('Já existe uma conta com este e-mail. Entre para recuperar sua combinação.'), { status: 409, code: 'EMAIL_EXISTS' });
        ({ id: userId } = exists); ({ id: accountId, slug } = acc); resumed = true;
      } else {
        ({ userId, accountId, slug } = await createProfessionalUser(db, {
          fullName: data.fullName,
          email: normEmail,
          password: data.password,
          crpOrCrm: data.crpOrCrm,
          specialty: data.specialty,
        }));
      }
      if (data.selection) await writeAccountSelection(db, accountId, data.selection);

      // A sessão vem antes do envio: se o e-mail falhar, a pessoa continua na
      // conta pendente e pode pedir outro código ou corrigir o endereço.
      const sess = await issueSession(db, { userId, actorType: 'professional', accountId });
      let verification;
      try {
        const ver = await issueVerificationCode(db, {
          purpose: 'email_verify',
          targetContact: normEmail,
          userId,
          accountId,
          subject: 'Verifique seu e-mail na Enomera',
        });
        verification = { required: true, expiresAt: ver.expiresAt, delivery: ver.delivery };
      } catch (err) {
        if (err?.code === 'RESEND_RATE_LIMITED') verification = { required: true, alreadySent: true };
        else if (err?.code === 'MAIL_DELIVERY_FAILED') verification = { required: true, deliveryFailed: true, error: 'Não conseguimos entregar o código neste endereço. Confira o e-mail, corrija se precisar e peça um novo código.' };
        else throw err;
      }
      const user = await db.get('SELECT full_name FROM users WHERE id = ?', userId);
      const account = await db.get('SELECT display_name, crp_or_crm, specialty FROM professional_accounts WHERE id = ?', accountId);

      return json(res, resumed ? 200 : 201, {
        user: { id: userId, email: normEmail, fullName: user?.full_name || data.fullName.trim(), emailVerified: false, role: 'professional' },
        account: { id: accountId, slug, displayName: account?.display_name || data.fullName.trim(), crpOrCrm: account?.crp_or_crm || '', specialty: account?.specialty || data.specialty },
        entitlements: await getAccountEntitlements(db, accountId),
        sessionToken: sess.rawToken,
        expiresAt: sess.expiresAt,
        resumed,
        verification,
      }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/verify-email') {
      const body = await readJsonBody(req);
      const email = String(body.email || auth?.user?.email || '').trim().toLowerCase();
      const row = await consumeVerificationCode(db, { purpose: 'email_verify', targetContact: email, code: body.code });
      const now = nowIso();
      (await db.run('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?', now, now, row.user_id));
      const account = await db.get('SELECT id FROM professional_accounts WHERE owner_user_id = ?', row.user_id);
      const selection = account && await db.get('SELECT selection_json FROM checkout_selections WHERE account_id = ?', account.id);
      if (selection) await db.run('UPDATE checkout_selections SET selection_json = ?, updated_at = ? WHERE account_id = ?', JSON.stringify({...JSON.parse(selection.selection_json),stage:'review'}), now, account.id);
      await writeAudit(db, { actorUserId: row.user_id, actorType: 'professional', accountId: row.account_id, action: 'auth.verify_email', resourceType: 'user', resourceId: row.user_id });
      return json(res, 200, { verified: true, verifiedAt: now });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/resend-verification') {
      await requireProfessional(db, auth);
      const body = await readJsonBody(req);
      const email = String(body.email || auth?.user?.email || '').trim().toLowerCase();
      if (email !== auth.user.email) throw Object.assign(new Error('Use Corrigir e-mail para atualizar o endereço da sua conta.'), { status: 400, code: 'EMAIL_MISMATCH' });
      const u = (await db.get('SELECT id FROM users WHERE email = ?', email));
      if (!u) return json(res, 200, { ok: true, delivery: { deliveryStatus: 'ignored_unknown_account' } });
      const ver = await issueVerificationCode(db, { purpose: 'email_verify', targetContact: email, userId: u.id, subject: 'Novo código de verificação · Enomera' });
      return json(res, 200, { ok: true, expiresAt: ver.expiresAt, delivery: ver.delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/change-email') {
      await requireProfessional(db, auth);
      if (auth.user.email_verified_at) throw Object.assign(new Error('O e-mail desta conta já foi confirmado.'), { status: 409, code: 'EMAIL_ALREADY_VERIFIED' });
      const { email } = z.object({ email: z.string().trim().email() }).parse(await readJsonBody(req));
      const normalized = email.toLowerCase();
      const existing = await db.get('SELECT id FROM users WHERE email = ?', normalized);
      if (existing && existing.id !== auth.user.id) throw Object.assign(new Error('Este endereço já está em uso. Entre com ele ou use outro e-mail.'), { status: 409, code: 'EMAIL_EXISTS' });
      if (normalized === auth.user.email) return json(res, 200, { ok: true, email: normalized });
      const ver = await issueVerificationCode(db, { purpose: 'email_verify', targetContact: normalized, userId: auth.user.id, accountId: auth.account.id, subject: 'Confirme o endereço corrigido · Enomera' });
      await db.run('UPDATE users SET email = ?, updated_at = ? WHERE id = ? AND email_verified_at IS NULL', normalized, nowIso(), auth.user.id);
      await db.run("UPDATE verification_tokens SET consumed_at = ? WHERE purpose = 'email_verify' AND user_id = ? AND target_contact <> ? AND consumed_at IS NULL", nowIso(), auth.user.id, normalized);
      return json(res, 200, { ok: true, email: normalized, expiresAt: ver.expiresAt, delivery: ver.delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/login') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const u = (await db.get('SELECT * FROM users WHERE email = ?', email));
      if (!u || !verifyPassword(password, u.password_hash, u.password_salt)) {
        await writeAudit(db, { actorType: 'anonymous', action: 'auth.login', resourceType: 'user', outcome: 'deny', meta: { email } });
        throw Object.assign(new Error('E-mail ou senha inválidos.'), { status: 401, code: 'INVALID_CREDENTIALS' });
      }
      let account = null;
      if (u.role === 'professional') {
        account = (await db.get(`
          SELECT pa.* FROM professional_accounts pa
          JOIN account_memberships am ON am.account_id = pa.id
          WHERE am.user_id = ? LIMIT 1
        `, u.id));
      }
      const sess = await issueSession(db, { userId: u.id, actorType: u.role, accountId: account?.id || null });
      await writeAudit(db, { actorUserId: u.id, actorType: u.role, accountId: account?.id || null, action: 'auth.login', resourceType: 'session', resourceId: sess.id });
      return json(res, 200, {
        user: { id: u.id, email: u.email, fullName: u.full_name, role: u.role, emailVerified: Boolean(u.email_verified_at) },
        account: account ? { id: account.id, slug: account.slug, displayName: account.display_name, crpOrCrm: account.crp_or_crm, specialty: account.specialty } : null,
        entitlements: account ? await getAccountEntitlements(db, account.id) : null,
        sessionToken: sess.rawToken,
        expiresAt: sess.expiresAt,
      }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/logout') {
      const body = await readJsonBody(req);
      if (auth) {
        const now = nowIso();
        if (body.revokeAll) {
          await db.run(
            'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND actor_type = ? AND revoked_at IS NULL',
            now, auth.user.id, auth.session.actor_type
          );
        } else {
          await db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', now, auth.session.id);
        }
        await writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: auth.session.account_id, action: 'auth.logout', resourceType: 'session', resourceId: auth.session.id });
      }
      const secureClear = process.env.VERCEL ? '; Secure; SameSite=None' : '; SameSite=Lax';
      return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0${secureClear}` });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/recovery/request') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const u = (await db.get('SELECT id FROM users WHERE email = ?', email));
      if (!u) {
        return json(res, 200, { ok: true, message: 'Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.' });
      }
      try {
        await issueVerificationCode(db, { purpose: 'password_reset', targetContact: email, userId: u.id, subject: 'Recuperação de acesso · Enomera' });
      } catch (err) {
        if (![429,503].includes(err.status)) throw err;
      }
      return json(res, 200, { ok: true, message: 'Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.' });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/recovery/confirm') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 8) throw Object.assign(new Error('A nova senha precisa ter ao menos 8 caracteres.'), { status: 400, code: 'PASSWORD_TOO_SHORT' });
      const row = await consumeVerificationCode(db, { purpose: 'password_reset', targetContact: email, code: body.code });
      const pwd = hashPassword(newPassword);
      const now = nowIso();
      (await db.run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?', pwd.hash, pwd.salt, now, row.user_id));
      // Revoke all old sessions on password reset!
      (await db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, row.user_id));
      await writeAudit(db, { actorUserId: row.user_id, actorType: 'professional', action: 'auth.password_reset', resourceType: 'user', resourceId: row.user_id });
      return json(res, 200, { ok: true, message: 'Senha redefinida e sessões anteriores encerradas.' });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/stepup/request') {
      await requireProfessional(db, auth);
      const ver = await issueVerificationCode(db, {
        purpose: 'clinical_stepup',
        targetContact: auth.user.email,
        userId: auth.user.id,
        accountId: auth.account.id,
        subject: 'Verificação reforçada · Acesso clínico Minne',
        ttlMinutes: 10,
      });
      return json(res, 200, { ok: true, expiresAt: ver.expiresAt, delivery: ver.delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/stepup/verify') {
      await requireProfessional(db, auth);
      const body = await readJsonBody(req);
      await consumeVerificationCode(db, { purpose: 'clinical_stepup', targetContact: auth.user.email, code: body.code });
      const now = nowIso();
      (await db.run('UPDATE sessions SET mfa_verified_at = ? WHERE id = ?', now, auth.session.id));
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'auth.stepup_verified', resourceType: 'session', resourceId: auth.session.id });
      return json(res, 200, { verified: true, mfaVerifiedAt: now });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/handoff') {
      requireAuth(auth);
      const body = await readJsonBody(req);
      const targetOrigin = String(body.targetOrigin || '');
      if (auth.session.actor_type !== 'professional') throw Object.assign(new Error('Use o acesso do paciente no Ambo.'), { status: 403, code: 'FORBIDDEN_ACTOR' });
      if (!isAllowedOrigin(targetOrigin)) {
        throw Object.assign(new Error('Origem de destino não autorizada para passagem autenticada.'), { status: 400, code: 'INVALID_TARGET_ORIGIN' });
      }
      const code = `hc_${randomToken(24)}`;
      const expiresAt = addMinutesIso(1); // 60 seconds single-use
      (await db.run(`
        INSERT INTO auth_handoff_codes (id, code_hash, session_id, target_origin, return_path, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, randomId('hnd'), sha256Hex(code), auth.session.id, targetOrigin, /^\/(?!\/)/.test(body.returnPath || '/') ? String(body.returnPath || '/') : '/', expiresAt, nowIso()));
      await writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: auth.session.account_id, action: 'auth.handoff_issue', resourceType: 'handoff', meta: { targetOrigin } });
      return json(res, 200, { handoffCode: code, expiresAt, targetOrigin });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/exchange') {
      const body = await readJsonBody(req);
      const code = String(body.handoffCode || '').trim();
      const row = (await db.get('SELECT * FROM auth_handoff_codes WHERE code_hash = ?', sha256Hex(code)));
      if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
        throw Object.assign(new Error('Código de passagem inválido ou expirado. Entre novamente pela Enomera.'), { status: 401, code: 'HANDOFF_INVALID' });
      }
      const reqOrigin = req.headers.origin;
      if (reqOrigin && reqOrigin !== row.target_origin) {
        throw Object.assign(new Error('Origem da troca não corresponde ao destino autorizado.'), { status: 403, code: 'HANDOFF_ORIGIN_MISMATCH' });
      }
      const sourceSess = (await db.get('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL', row.session_id));
      if (!sourceSess || Date.parse(sourceSess.expires_at) <= Date.now()) {
        throw Object.assign(new Error('Sessão original revogada ou expirada.'), { status: 401, code: 'SESSION_REVOKED' });
      }
      const claimedHandoff = await db.run(
        'UPDATE auth_handoff_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
        nowIso(), row.id
      );
      if (!claimedHandoff || Number(claimedHandoff.changes || 0) !== 1) {
        throw Object.assign(new Error('Código de passagem já utilizado. Entre novamente pela Enomera.'), { status: 401, code: 'HANDOFF_ALREADY_USED' });
      }
      const newSess = await issueSession(db, {
        userId: sourceSess.user_id,
        actorType: sourceSess.actor_type,
        accountId: sourceSess.account_id,
        patientId: sourceSess.patient_id,
      });
      if (sourceSess.mfa_verified_at) {
        (await db.run('UPDATE sessions SET mfa_verified_at = ? WHERE id = ?', sourceSess.mfa_verified_at, newSess.id));
      }
      const user = (await db.get('SELECT id, email, full_name, role, email_verified_at FROM users WHERE id = ?', sourceSess.user_id));
      const account = sourceSess.account_id ? (await db.get('SELECT * FROM professional_accounts WHERE id = ?', sourceSess.account_id)) : null;
      return json(res, 200, {
        user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, emailVerified: Boolean(user.email_verified_at) },
        account: account ? { id: account.id, slug: account.slug, displayName: account.display_name, crpOrCrm: account.crp_or_crm, specialty: account.specialty } : null,
        entitlements: account ? await getAccountEntitlements(db, account.id) : null,
        sessionToken: newSess.rawToken,
        returnPath: row.return_path,
      }, { 'Set-Cookie': newSess.cookie });
    }

    if (method === 'GET' && pathname === '/api/v1/auth/me') {
      requireAuth(auth);
      return json(res, 200, {
        actorType: auth.session.actor_type,
        mfaVerified: Boolean(auth.session.mfa_verified_at),
        user: { id: auth.user.id, email: auth.user.email, fullName: auth.user.full_name, role: auth.user.role, emailVerified: Boolean(auth.user.email_verified_at) },
        account: auth.account ? {
          id: auth.account.id,
          slug: auth.account.slug,
          displayName: auth.account.display_name,
          crpOrCrm: auth.account.crp_or_crm,
          specialty: auth.account.specialty,
          city: auth.account.city,
          timezone: auth.account.timezone,
          sessionDurationMin: auth.account.session_duration_min,
          sessionPriceCents: auth.account.session_price_cents,
          modalities: JSON.parse(auth.account.modalities_json || '["online","presencial"]'),
          uiPreferences: JSON.parse(auth.account.ui_preferences_json || '{}'),
        } : null,
        entitlements: auth.account ? await getAccountEntitlements(db, auth.account.id) : null,
      });
    }

    // Dev/Homologation Outbox inspection (ONLY when SMTP is unconfigured — honest inspection for verification flows!)
    if (method === 'GET' && pathname === '/api/v1/dev/outbox') {
      const realMailerOn = Boolean(process.env.SMTP_URL || (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL));
      if (isRemoteInfraRequired() || process.env.ENOMERA_ENABLE_DEV_OUTBOX === 'false' || (realMailerOn && process.env.ENOMERA_ENABLE_DEV_OUTBOX !== 'true')) {
        throw Object.assign(new Error('Caixa local de homologação indisponível quando o envio real de e-mail ou o modo de infraestrutura remota está ativo.'), { status: 403, code: 'OUTBOX_DISABLED' });
      }
      const recipient = url.searchParams.get('recipient');
      if (!recipient) throw Object.assign(new Error('Informe recipient para consultar a caixa de homologação.'), { status: 400, code: 'RECIPIENT_REQUIRED' });
      const rows = await db.all(
        "SELECT id, channel, recipient, subject, body_preview, purpose, delivery_status, created_at FROM dev_outbox_messages WHERE lower(recipient) = lower(?) AND delivery_status NOT IN ('sent_resend', 'sent_smtp') ORDER BY created_at DESC LIMIT 10",
        recipient
      );
      return json(res, 200, {
        notice: 'Caixa de homologação (canal real SMTP/WhatsApp não configurado).',
        messages: rows,
      });
    }

    // ── ENOMERA COMMERCIAL, TRIAL, PILOT, SIMULATED CHECKOUT & PORTAL ──
    if (method === 'POST' && pathname === '/api/v1/commercial/trial/start') {
      await requireProfessional(db, auth);
      if (!auth.user.email_verified_at) throw Object.assign(new Error('Confirme seu e-mail antes de iniciar o teste.'), { status: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      const body = await readJsonBody(req);
      const products = (Array.isArray(body.products) ? body.products : ['ambo', 'minne']).filter((p) => ['ambo', 'minne'].includes(p));
      if (products.length === 0) throw Object.assign(new Error('Selecione Ambo e/ou Minne para os 30 dias grátis.'), { status: 400, code: 'INVALID_TRIAL_PRODUCTS' });
      const now = nowIso();
      const trialEndsAt = addDaysIso(COMMERCIAL_CATALOG.trialDays);
      await runTransaction(db, async (db) => {
        for (const p of products) {
          (await db.run(`
            INSERT INTO entitlements (id, account_id, product, status, billing_mode, trial_ends_at, updated_at)
            VALUES (?, ?, ?, 'trial', 'trial', ?, ?)
            ON CONFLICT(account_id, product) DO UPDATE SET
              status = CASE WHEN entitlements.status = 'active' THEN 'active' ELSE 'trial' END,
              trial_ends_at = COALESCE(entitlements.trial_ends_at, excluded.trial_ends_at),
              updated_at = excluded.updated_at
          `, randomId('ent'), auth.account.id, p, trialEndsAt, now));
        }
        await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'commercial.trial_start', resourceType: 'entitlement', meta: { products } });
      });
      return json(res, 200, { ok: true, trialEndsAt, entitlements: await getAccountEntitlements(db, auth.account.id) });
    }

    if (method === 'POST' && pathname === '/api/v1/commercial/pilot/apply') {
      const body = await readJsonBody(req);
      const fullName = String(body.fullName || auth?.user?.full_name || '').trim();
      const email = String(body.email || auth?.user?.email || '').trim().toLowerCase();
      if (!fullName || !email.includes('@')) throw Object.assign(new Error('Informe nome e e-mail válidos para solicitar vaga no piloto.'), { status: 400, code: 'INVALID_PILOT_DATA' });
      const id = randomId('plt');
      (await db.run(`
        INSERT INTO pilot_applications (id, user_id, full_name, email, specialty, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
      `, id, auth?.user?.id || null, fullName, email, String(body.specialty || 'Psicologia'), String(body.notes || ''), nowIso()));
      return json(res, 201, { id, status: 'received', pilotDays: COMMERCIAL_CATALOG.trialDays, message: 'Interesse no piloto de 30 dias grátis registrado sem cobrança.' });
    }

    if (method === 'POST' && pathname === '/api/v1/commercial/orders') {
      await requireProfessional(db, auth);
      if (!auth.user.email_verified_at) throw Object.assign(new Error('Confirme seu e-mail antes de ativar os serviços.'), { status: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      const body = await readJsonBody(req);
      const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || '').trim();
      if (!idempotencyKey) throw Object.assign(new Error('Chave de idempotência obrigatória no checkout simulado.'), { status: 400, code: 'IDEMPOTENCY_REQUIRED' });

      const existing = (await db.get('SELECT * FROM commercial_orders WHERE account_id = ? AND idempotency_key = ?', auth.account.id, idempotencyKey));
      if (existing) {
        const attempts = (await db.all('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt_number ASC', existing.id));
        return json(res, 200, { order: existing, summary: JSON.parse(existing.summary_json), attempts, entitlements: await getAccountEntitlements(db, auth.account.id), idempotentReplay: true });
      }

      const quote = calculateSimulatedQuote({ products: body.products, ethaFormat: body.ethaFormat, mode: 'monthly' });
      // Percurso aprovado (22 nov): a ativação informa a periodicidade e não cobra nada hoje.
      const isContractFlow = body.billing === 'monthly' || body.billing === 'permanent';
      if (isContractFlow) {
        const contract = buildContractSummary({ products: body.products, ethaFormat: body.ethaFormat, billing: body.billing });
        quote.billing = contract.billing;
        quote.contract = contract;
        quote.dueTodayCents = 0;
        quote.chargedTodayCents = 0;
        await writeAccountSelection(db, auth.account.id, contract);
      }
      const simulatedOutcome = ['approved', 'pending', 'declined'].includes(body.simulatedOutcome) ? body.simulatedOutcome : 'approved';
      const methodUsed = body.method === 'simulated_card' ? 'simulated_card' : 'simulated_pix';

      const result = await runTransaction(db, async (db) => {
        const replay = await db.get('SELECT * FROM commercial_orders WHERE account_id = ? AND idempotency_key = ?', auth.account.id, idempotencyKey);
        if (replay) return { order: replay, attempts: await db.all('SELECT * FROM payment_attempts WHERE order_id = ?', replay.id), idempotentReplay: true };
        const orderId = randomId('ord');
        const receiptCode = `SIM-ENO-${randomDigits(6)}`;
        const now = nowIso();
        (await db.run(`
          INSERT INTO commercial_orders (
            id, account_id, idempotency_key, catalog_version, items_json, due_today_cents,
            recurring_monthly_cents, balance_on_approval_cents, discount_cents, summary_json,
            status, is_simulated, receipt_code, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `, orderId, auth.account.id, idempotencyKey, quote.catalogVersion, JSON.stringify(quote.selectedProducts),
          quote.dueTodayCents, quote.recurringMonthlyCents, quote.balanceOnApprovalCents, quote.discountCents,
          JSON.stringify(quote), simulatedOutcome, receiptCode, now, now));

        const failReason = simulatedOutcome === 'declined'
          ? 'Autorização recusada pelo simulador (nenhum valor real foi cobrado). Sua combinação foi preservada.'
          : null;
        (await db.run(`
          INSERT INTO payment_attempts (id, order_id, attempt_number, method, status, failure_reason, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        `, randomId('pay'), orderId, methodUsed, simulatedOutcome, failReason, now, now));

        if (simulatedOutcome === 'approved') {
          await activateOrderEntitlementsTx(db, auth.account.id, quote);
          await db.run('INSERT INTO checkout_selections (account_id, selection_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET selection_json = excluded.selection_json, updated_at = excluded.updated_at', auth.account.id,
            JSON.stringify({products:quote.selectedProducts,ethaFormat:quote.ethaFormat || 'one_page',stage:'confirmed'}),now);
          await writeAccountSelection(db, auth.account.id, { ...(await readAccountSelection(db, auth.account.id) || {}), products: quote.selectedProducts, ethaFormat: quote.ethaFormat || 'one_page', stage: 'confirmed' });
        }
        await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'commercial.checkout_simulated', resourceType: 'order', resourceId: orderId, meta: { outcome: simulatedOutcome, products: quote.selectedProducts } });
        return {
          order: (await db.get('SELECT * FROM commercial_orders WHERE id = ?', orderId)),
          attempts: (await db.all('SELECT * FROM payment_attempts WHERE order_id = ?', orderId)),
        };
      }, `checkout:${auth.account.id}:${idempotencyKey}`);

      return json(res, result.idempotentReplay ? 200 : 201, {
        ...result,
        summary: quote,
        entitlements: await getAccountEntitlements(db, auth.account.id),
        idempotentReplay: false,
      });
    }

    const orderRetryMatch = pathname.match(/^\/api\/v1\/commercial\/orders\/([^/]+)\/retry$/);
    if (method === 'POST' && orderRetryMatch) {
      await requireProfessional(db, auth);
      const orderId = orderRetryMatch[1];
      const body = await readJsonBody(req);
      const nextOutcome = ['approved', 'pending', 'declined'].includes(body.simulatedOutcome) ? body.simulatedOutcome : 'approved';
      const methodUsed = body.method === 'simulated_card' ? 'simulated_card' : 'simulated_pix';

      const result = await runTransaction(db, async (db) => {
        const order = (await db.get('SELECT * FROM commercial_orders WHERE id = ? AND account_id = ?', orderId, auth.account.id));
        if (!order) throw Object.assign(new Error('Pedido não encontrado.'), { status: 404, code: 'ORDER_NOT_FOUND' });
        if (order.status === 'approved') {
          return { order, attempts: (await db.all('SELECT * FROM payment_attempts WHERE order_id = ?', orderId)), alreadyApproved: true };
        }
        const count = Number(((await db.get('SELECT COUNT(*) as c FROM payment_attempts WHERE order_id = ?', orderId)))?.c || 0);
        const now = nowIso();
        (await db.run(`
          INSERT INTO payment_attempts (id, order_id, attempt_number, method, status, failure_reason, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, randomId('pay'), orderId, count + 1, methodUsed, nextOutcome, nextOutcome === 'declined' ? 'Recusado na nova tentativa simulada.' : null, now, now));
        (await db.run('UPDATE commercial_orders SET status = ?, updated_at = ? WHERE id = ?', nextOutcome, now, orderId));
        if (nextOutcome === 'approved') {
          const quote = JSON.parse(order.summary_json);
          await activateOrderEntitlementsTx(db, auth.account.id, quote);
          await db.run('UPDATE checkout_selections SET selection_json = ?, updated_at = ? WHERE account_id = ?',
            JSON.stringify({products:quote.selectedProducts,ethaFormat:quote.ethaFormat || 'one_page',stage:'confirmed'}), now, auth.account.id);
          await writeAccountSelection(db, auth.account.id, { ...(await readAccountSelection(db, auth.account.id) || {}), products: quote.selectedProducts, ethaFormat: quote.ethaFormat || 'one_page', stage: 'confirmed' });
        }
        return {
          order: (await db.get('SELECT * FROM commercial_orders WHERE id = ?', orderId)),
          attempts: (await db.all('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt_number ASC', orderId)),
          alreadyApproved: false,
        };
      });
      return json(res, 200, { ...result, entitlements: await getAccountEntitlements(db, auth.account.id) });
    }

    if (method === 'GET' && pathname === '/api/v1/commercial/orders') {
      await requireProfessional(db, auth);
      const rawOrders = await db.all('SELECT * FROM commercial_orders WHERE account_id = ? ORDER BY created_at DESC', auth.account.id);
      const orders = await Promise.all(rawOrders.map(async (o) => ({
        ...o,
        items: JSON.parse(o.items_json),
        summary: JSON.parse(o.summary_json),
        attempts: await db.all('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt_number ASC', o.id),
      })));
      return json(res, 200, { orders, entitlements: await getAccountEntitlements(db, auth.account.id) });
    }

    const entCancelMatch = pathname.match(/^\/api\/v1\/commercial\/entitlements\/(ambo|minne|etha)\/(cancel|reactivate)$/);
    if (method === 'POST' && entCancelMatch) {
      await requireProfessional(db, auth);
      const [, product, action] = entCancelMatch;
      const now = nowIso();
      const ent = (await db.get('SELECT * FROM entitlements WHERE account_id = ? AND product = ?', auth.account.id, product));
      if (!ent) throw Object.assign(new Error('Serviço não encontrado na conta.'), { status: 404, code: 'ENTITLEMENT_NOT_FOUND' });
      if (action === 'cancel') {
        (await db.run("UPDATE entitlements SET status = 'read_only', cancelled_at = ?, updated_at = ? WHERE id = ?", now, now, ent.id));
      } else {
        (await db.run("UPDATE entitlements SET status = 'active', cancelled_at = NULL, current_period_end = ?, updated_at = ? WHERE id = ?", addDaysIso(30), now, ent.id));
      }
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: `entitlement.${action}`, resourceType: 'entitlement', resourceId: ent.id, meta: { product } });
      return json(res, 200, {
        ok: true,
        entitlements: await getAccountEntitlements(db, auth.account.id),
        note: action === 'cancel'
          ? `${({ ambo: 'Ambo', minne: 'Minne', etha: 'Etha' })[product] || product} ficou só para leitura e exportação. Os outros serviços continuam ativos e nenhum dado foi apagado.`
          : `${({ ambo: 'Ambo', minne: 'Minne', etha: 'Etha' })[product] || product} reativado.`,
      });
    }

    if (method === 'GET' && pathname === '/api/v1/portal/summary') {
      await requireProfessional(db, auth);
      const entitlements = await getAccountEntitlements(db, auth.account.id);
      const hasAmbo = Boolean(entitlements.ambo?.canWrite);
      const hasMinne = Boolean(entitlements.minne?.canWrite);
      const hasEtha = Boolean(entitlements.etha?.canReadExport);

      const pendingRequests = (hasAmbo || hasMinne)
        ? Number(((await db.get("SELECT COUNT(*) as c FROM consultation_requests WHERE account_id = ? AND status = 'preference_sent'", auth.account.id)))?.c || 0)
        : null;
      const confirmedAppointments = (hasAmbo || hasMinne)
        ? Number((await db.get("SELECT COUNT(*) as c FROM appointments WHERE account_id = ? AND status IN ('confirmed','reschedule_requested')", auth.account.id))?.c || 0)
        : null;
      const clinicalDrafts = hasMinne
        ? Number(((await db.get('SELECT COUNT(*) as c FROM clinical_drafts WHERE account_id = ?', auth.account.id)))?.c || 0)
        : null;
      const ethaProject = hasEtha
        ? (await db.get('SELECT id, format, status, briefing_step, domain_name, domain_status, published_at FROM etha_projects WHERE account_id = ?', auth.account.id))
        : null;
      const pendingSyncs = (await db.all("SELECT * FROM sync_events WHERE account_id = ? AND status != 'synced' ORDER BY created_at DESC LIMIT 10", auth.account.id));

      let nextAction = { label: 'Escolher serviços ou começar 30 dias grátis', product: 'enomera' };
      if (hasAmbo && !hasMinne) nextAction = { label: 'Configurar disponibilidade e link no Ambo', product: 'ambo' };
      else if (hasMinne && pendingRequests > 0) nextAction = { label: `Responder ${pendingRequests} solicitação(ões) no Minne`, product: 'minne' };
      else if (hasAmbo && hasMinne) nextAction = { label: 'Abrir Ambo para compartilhar perfil ou Minne para agenda', product: 'ambo' };
      else if (hasEtha && !hasAmbo && !hasMinne) nextAction = { label: 'Acompanhar seu site na Etha', product: 'etha' };

      return json(res, 200, {
        account: { id: auth.account.id, slug: auth.account.slug, displayName: auth.account.display_name, crpOrCrm: auth.account.crp_or_crm },
        entitlements,
        nextAction,
        routine: { pendingRequests, confirmedAppointments, clinicalDrafts, ethaProject },
        pendingSyncs,
      });
    }

    if (method === 'GET' && pathname === '/api/v1/account/export') {
      await requireProfessional(db, auth, { clinical: true });
      const patients = (await db.all('SELECT * FROM operational_patients WHERE account_id = ?', auth.account.id));
      const appointments = (await db.all('SELECT * FROM appointments WHERE account_id = ?', auth.account.id));
      const notes = await Promise.all((await db.all("SELECT * FROM clinical_notes WHERE account_id = ? AND status != 'reverted'", auth.account.id)).map(async (n) => ({
        ...n,
        versions: (await db.all('SELECT version_number, author_display_name, blocks_json, change_reason, created_at FROM clinical_note_versions WHERE note_id = ? ORDER BY version_number ASC', n.id)),
      })));
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'account.export', resourceType: 'account', resourceId: auth.account.id });
      return json(res, 200, {
        schemaVersion: 'enomera-export-v1',
        exportedAt: nowIso(),
        account: { slug: auth.account.slug, displayName: auth.account.display_name, crpOrCrm: auth.account.crp_or_crm },
        patients,
        appointments,
        records: notes.map((n) => {
          const p = patients.find((x) => x.id === n.patient_id);
          const latest = n.versions.at(-1);
          return {
            id: n.id,
            sourceKey: n.id,
            patient: p ? { fullName: p.full_name, email: p.email, phone: p.phone } : null,
            occurredAt: n.occurred_at,
            declaredAuthor: n.source_author_declared || latest?.author_display_name || auth.account.display_name,
            blocks: latest ? JSON.parse(latest.blocks_json) : [],
            versionsCount: n.versions.length,
          };
        }),
      });
    }

    // ── PROFESSIONAL PROFILE & AVAILABILITY (SHARED BY AMBO SOLO & MINNE) ──
    if (method === 'GET' && pathname === '/api/v1/professional/profile') {
      await requireProfessional(db, auth);
      const rules = (await db.all('SELECT * FROM availability_rules WHERE account_id = ? ORDER BY weekday, start_time', auth.account.id));
      const blocks = (await db.all('SELECT * FROM availability_blocks WHERE account_id = ? ORDER BY start_at', auth.account.id));
      return json(res, 200, {
        profile: {
          id: auth.account.id,
          slug: auth.account.slug,
          displayName: auth.account.display_name,
          crpOrCrm: auth.account.crp_or_crm,
          specialty: auth.account.specialty,
          bio: auth.account.bio,
          audience: auth.account.audience || '',
          contactEmail: auth.user.email,
          photoAssetId: auth.account.photo_file_id || null,
          photoUrl: profilePhotoUrl(auth.account),
          city: auth.account.city,
          timezone: auth.account.timezone,
          sessionDurationMin: auth.account.session_duration_min,
          sessionPriceCents: auth.account.session_price_cents,
          modalities: JSON.parse(auth.account.modalities_json || '["online","presencial"]'),
          onlineMeetingUrl: auth.account.online_meeting_url,
          onlineInstructions: auth.account.online_instructions,
          onlineUnlockMinutes: auth.account.online_unlock_minutes,
          inPersonAddress: auth.account.in_person_address,
          uiPreferences: JSON.parse(auth.account.ui_preferences_json || '{}'),
        },
        availabilityRules: rules,
        availabilityBlocks: blocks,
      });
    }

    if (method === 'PATCH' && pathname === '/api/v1/professional/profile') {
      await requireProfessional(db, auth);
      const body = await readJsonBody(req);
      const now = nowIso();
      (await db.run(`
        UPDATE professional_accounts SET
          display_name = COALESCE(?, display_name),
          crp_or_crm = COALESCE(?, crp_or_crm),
          specialty = COALESCE(?, specialty),
          bio = COALESCE(?, bio),
          audience = COALESCE(?, audience),
          city = COALESCE(?, city),
          session_duration_min = COALESCE(?, session_duration_min),
          session_price_cents = COALESCE(?, session_price_cents),
          modalities_json = COALESCE(?, modalities_json),
          online_meeting_url = COALESCE(?, online_meeting_url),
          online_instructions = COALESCE(?, online_instructions),
          online_unlock_minutes = COALESCE(?, online_unlock_minutes),
          in_person_address = COALESCE(?, in_person_address),
          ui_preferences_json = COALESCE(?, ui_preferences_json),
          updated_at = ?
        WHERE id = ?
      `, body.displayName ?? null, body.crpOrCrm ?? null, body.specialty ?? null, body.bio ?? null, body.audience ?? null, body.city ?? null,
        body.sessionDurationMin ?? null, body.sessionPriceCents ?? null,
        body.modalities ? JSON.stringify(body.modalities) : null,
        body.onlineMeetingUrl ?? null, body.onlineInstructions ?? null, body.onlineUnlockMinutes ?? null,
        body.inPersonAddress ?? null,
        body.uiPreferences ? JSON.stringify(body.uiPreferences) : null,
        now, auth.account.id));
      return json(res, 200, { ok: true, updatedAt: now });
    }

    if (pathname === '/api/v1/professional/profile/photo' && ['POST', 'DELETE'].includes(method)) {
      await requireProfessional(db, auth);
      const photo = method === 'POST' ? await savePortrait(db, auth, await readJsonBody(req)) : null;
      await db.run('UPDATE professional_accounts SET photo_file_id = ?, updated_at = ? WHERE id = ?', photo?.photoAssetId || null, nowIso(), auth.account.id);
      return json(res, 200, { photoAssetId: photo?.photoAssetId || null, photoUrl: profilePhotoUrl({ ...auth.account, photo_file_id: photo?.photoAssetId || null }) });
    }

    const publicPhoto = pathname.match(/^\/api\/v1\/(ambo\/public|public-sites)\/([^/]+)\/photo\/([^/]+)$/);
    if (method === 'GET' && publicPhoto) {
      const account = await db.get('SELECT * FROM professional_accounts WHERE slug = ?', publicPhoto[2]);
      if (!account) throw Object.assign(new Error('Foto não encontrada.'), { status: 404 });
      let allowed = publicPhoto[1] === 'ambo/public' && account.photo_file_id === publicPhoto[3];
      if (publicPhoto[1] === 'public-sites') {
        const published = await db.get("SELECT v.content_json FROM etha_projects p JOIN etha_content_versions v ON v.id = p.published_version_id WHERE p.account_id = ? AND v.stage = 'published'", account.id);
        allowed = Boolean(published && JSON.parse(published.content_json).photoAssetId === publicPhoto[3]);
      }
      if (!allowed) throw Object.assign(new Error('Foto não publicada.'), { status: 404 });
      const file = await requireOwnedPortrait(db, account.id, publicPhoto[3]);
      return await servePortrait(res, file);
    }

    if (method === 'PUT' && pathname === '/api/v1/professional/availability') {
      await requireProfessional(db, auth);
      const body = await readJsonBody(req);
      const now = nowIso();
      await runTransaction(db, async (db) => {
        if (Array.isArray(body.rules)) {
          (await db.run('DELETE FROM availability_rules WHERE account_id = ?', auth.account.id));
          for (const r of body.rules) {
            (await db.run(`
              INSERT INTO availability_rules (id, account_id, weekday, start_time, end_time, modality, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            `, randomId('avr'), auth.account.id, Number(r.weekday), String(r.startTime || '09:00'), String(r.endTime || '18:00'), String(r.modality || 'both'), now));
          }
        }
        if (Array.isArray(body.blocks)) {
          (await db.run('DELETE FROM availability_blocks WHERE account_id = ?', auth.account.id));
          for (const b of body.blocks) {
            (await db.run(`
              INSERT INTO availability_blocks (id, account_id, start_at, end_at, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `, randomId('avb'), auth.account.id, String(b.startAt), String(b.endAt), String(b.reason || 'Bloqueio'), now));
          }
        }
      });
      return json(res, 200, {
        ok: true,
        slotsPreview: await generateAvailableSlots(db, auth.account.id, { daysAhead: 7 }),
      });
    }

    // ── AMBO PUBLIC, PATIENT VERIFIED, INVITATIONS & AMBO SOLO ────────
    const amboPubMatch = pathname.match(/^\/api\/v1\/ambo\/public\/([^/]+)$/);
    if (method === 'GET' && amboPubMatch) {
      const slug = amboPubMatch[1];
      const acc = (await db.get('SELECT * FROM professional_accounts WHERE slug = ?', slug));
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      const ents = await getAccountEntitlements(db, acc.id);
      if (!ents.ambo?.canWrite) {
        throw Object.assign(new Error('O agendamento Ambo não está ativo para este perfil.'), { status: 404, code: 'AMBO_INACTIVE' });
      }
      return json(res, 200, {
        professional: {
          slug: acc.slug,
          displayName: acc.display_name,
          crpOrCrm: acc.crp_or_crm,
          specialty: acc.specialty,
          bio: acc.bio,
          audience: acc.audience || '',
          photoUrl: profilePhotoUrl(acc),
          city: acc.city,
          timezone: acc.timezone,
          sessionDurationMin: acc.session_duration_min,
          sessionPriceCents: acc.session_price_cents,
          modalities: JSON.parse(acc.modalities_json || '["online","presencial"]'),
          inPersonHint: acc.city,
        },
        note: 'Valor e condições do atendimento são combinados diretamente com a profissional. Enviar preferências não bloqueia horário na agenda.',
      });
    }

    const amboReqMatch = pathname.match(/^\/api\/v1\/ambo\/public\/([^/]+)\/requests$/);
    if (method === 'POST' && amboReqMatch) {
      const slug = amboReqMatch[1];
      const acc = (await db.get('SELECT * FROM professional_accounts WHERE slug = ?', slug));
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      const ents = await getAccountEntitlements(db, acc.id);
      if (!ents.ambo?.canWrite) throw Object.assign(new Error('Agendamento indisponível para este perfil.'), { status: 403, code: 'AMBO_INACTIVE' });

      const body = await readJsonBody(req);
      const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || randomId('idem'));
      const existing = (await db.get('SELECT * FROM consultation_requests WHERE account_id = ? AND idempotency_key = ?', acc.id, idempotencyKey));
      if (existing) {
        return json(res, 200, {
          requestId: existing.id,
          protocolCode: existing.protocol_code,
          status: existing.status,
          idempotentReplay: true,
        });
      }

      const name = String(body.patientName || '').trim();
      const email = String(body.patientEmail || '').trim().toLowerCase();
      const phone = String(body.patientPhone || '').trim();
      if (!name || !email.includes('@')) throw Object.assign(new Error('Informe nome completo e e-mail válido.'), { status: 400, code: 'INVALID_PATIENT_FIELDS' });

      const candidate = await findDuplicatePatientCandidate(db, acc.id, { email, phone, fullName: name });
      const id = randomId('req');
      const protocol = `AMB-${randomDigits(4)}`;
      const now = nowIso();
      (await db.run(`
        INSERT INTO consultation_requests (
          id, account_id, idempotency_key, protocol_code, source, modality, patient_name, patient_email,
          patient_phone, patient_birth, guardian_json, preferences_json, answers_json, status, duplicate_candidate_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ambo', ?, ?, ?, ?, ?, ?, ?, ?, 'preference_sent', ?, ?, ?)
      `, id, acc.id, idempotencyKey, protocol, body.modality === 'presencial' ? 'presencial' : 'online',
        name, email, phone, String(body.patientBirth || ''),
        body.guardian ? JSON.stringify(body.guardian) : null,
        JSON.stringify(body.preferences || { days: [], periods: [] }),
        JSON.stringify(body.answers || {}),
        candidate?.id || null, now, now));

      await writeAudit(db, { actorType: 'patient_public', accountId: acc.id, action: 'ambo.request_create', resourceType: 'consultation_request', resourceId: id });
      // NEVER expose candidate patient details back to the public submitter!
      return json(res, 201, {
        requestId: id,
        protocolCode: protocol,
        status: 'preference_sent',
        slotLocked: false,
        nextStep: 'Para acompanhar a confirmação ou pedir alteração, verifique seu e-mail no acesso do paciente.',
      });
    }

    if (method === 'POST' && pathname === '/api/v1/ambo/patient-access/request') {
      const body = await readJsonBody(req);
      const slug = String(body.professionalSlug || '').trim();
      const contact = String(body.contact || '').trim().toLowerCase();
      const acc = (await db.get('SELECT * FROM professional_accounts WHERE slug = ?', slug));
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      if (!contact) throw Object.assign(new Error('Informe o e-mail ou telefone usado na solicitação.'), { status: 400, code: 'CONTACT_REQUIRED' });

      const pat = (await db.get('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)', acc.id, contact, contact));
      const reqRow = (await db.get('SELECT id FROM consultation_requests WHERE account_id = ? AND (lower(patient_email) = ? OR patient_phone = ?)', acc.id, contact, contact));
      if (!pat && !reqRow) {
        return json(res, 200, { ok: true, message: 'Se houver solicitação ou cadastro associado a este contato, um código de verificação será gerado.' });
      }
      const ver = await issueVerificationCode(db, {
        purpose: 'patient_access',
        targetContact: contact,
        accountId: acc.id,
        patientId: pat?.id || null,
        subject: `Código de acesso ao Ambo · ${acc.display_name}`,
        ttlMinutes: 15,
      });
      return json(res, 200, { ok: true, expiresAt: ver.expiresAt, delivery: ver.delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/ambo/patient-access/verify') {
      const body = await readJsonBody(req);
      const slug = String(body.professionalSlug || '').trim();
      const contact = String(body.contact || '').trim().toLowerCase();
      const acc = (await db.get('SELECT * FROM professional_accounts WHERE slug = ?', slug));
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });

      const verRow = await consumeVerificationCode(db, { purpose: 'patient_access', targetContact: contact, code: body.code });
      if (verRow.account_id !== acc.id) {
        throw Object.assign(new Error('Código não corresponde a este profissional.'), { status: 403, code: 'ACCOUNT_MISMATCH' });
      }

      // Ensure patient identity user exists (strictly namespaced & role='patient' — NEVER collides with professional or operator!)
      const syntheticEmail = `pat.${acc.id}.${sha256Hex(contact).slice(0, 16)}@patient.enomera.invalid`;
      let user = await db.get("SELECT id FROM users WHERE email = ? AND role = 'patient'", syntheticEmail);
      if (!user) {
        const uid = randomId('pusr');
        const pwd = hashPassword(randomToken(24));
        await db.run(
          `INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Paciente Verificado', 'patient', ?, 0, ?, ?)`,
          uid, syntheticEmail, pwd.hash, pwd.salt, nowIso(), nowIso(), nowIso()
        );
        user = { id: uid };
      }

      const pat = (await db.get('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)', acc.id, contact, contact));
      const patientId = pat?.id || `contact:${contact}`;
      const sess = await issueSession(db, { userId: user.id, actorType: 'patient', accountId: acc.id, patientId, ttlMinutes: 120 });
      await writeAudit(db, { actorUserId: user.id, actorType: 'patient', accountId: acc.id, action: 'ambo.patient_verified', resourceType: 'session', resourceId: sess.id });
      return json(res, 200, { verified: true, sessionToken: sess.rawToken, expiresAt: sess.expiresAt }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'GET' && pathname === '/api/v1/ambo/patient/me') {
      requirePatient(auth);
      const acc = (await db.get('SELECT * FROM professional_accounts WHERE id = ?', auth.session.account_id));
      const isContactOnly = auth.session.patient_id.startsWith('contact:');
      const contactVal = isContactOnly ? auth.session.patient_id.slice('contact:'.length) : null;
      const patientRow = isContactOnly
        ? (await db.get('SELECT id, full_name, email, phone FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)', acc.id, contactVal, contactVal))
        : (await db.get('SELECT id, full_name, email, phone FROM operational_patients WHERE id = ? AND account_id = ?', auth.session.patient_id, acc.id));

      const requests = patientRow
        ? (await db.all('SELECT id, protocol_code, modality, preferences_json, status, appointment_id, created_at, updated_at FROM consultation_requests WHERE account_id = ? AND (patient_id = ? OR lower(patient_email) = lower(?)) ORDER BY created_at DESC', acc.id, patientRow.id, patientRow.email))
        : (await db.all('SELECT id, protocol_code, modality, preferences_json, status, appointment_id, created_at, updated_at FROM consultation_requests WHERE account_id = ? AND (lower(patient_email) = ? OR patient_phone = ?) ORDER BY created_at DESC', acc.id, contactVal, contactVal));

      const rawAppts = patientRow
        ? (await db.all('SELECT id, modality, start_at, end_at, timezone, status, price_cents, version, updated_at FROM appointments WHERE account_id = ? AND patient_id = ? ORDER BY start_at DESC', acc.id, patientRow.id))
        : [];

      const unlockMin = acc.online_unlock_minutes || 15;
      const appointments = await Promise.all(rawAppts.map(async (a) => {
        const reschedules = (await db.all('SELECT id, original_start_at, original_end_at, requested_start_at, requested_end_at, preferences_json, status, created_at FROM reschedule_requests WHERE appointment_id = ? ORDER BY created_at DESC', a.id));
        const startMs = Date.parse(a.start_at);
        const endMs = Date.parse(a.end_at);
        const nowMs = Date.now();
        const canAccessOnline = a.modality === 'online' && ['confirmed', 'reschedule_requested'].includes(a.status) && nowMs >= (startMs - unlockMin * 60_000) && nowMs <= (endMs + 30 * 60_000);
        return {
          ...a,
          onlineAccess: a.modality === 'online' ? {
            unlocked: canAccessOnline,
            unlocksAt: new Date(startMs - unlockMin * 60_000).toISOString(),
            instructions: acc.online_instructions,
            meetingUrl: canAccessOnline ? acc.online_meeting_url : null,
          } : null,
          inPersonAddress: a.modality === 'presencial' && ['confirmed', 'reschedule_requested'].includes(a.status) ? acc.in_person_address : null,
          reschedules,
        };
      }));

      return json(res, 200, {
        professional: { slug: acc.slug, displayName: acc.display_name, crpOrCrm: acc.crp_or_crm, specialty: acc.specialty, timezone: acc.timezone },
        patient: patientRow ? { id: patientRow.id, fullName: patientRow.full_name, email: patientRow.email } : { fullName: null, contact: contactVal },
        requests: requests.map((r) => ({ ...r, preferences: JSON.parse(r.preferences_json || '{}') })),
        appointments,
        availableSlots: (await generateAvailableSlots(db, acc.id, { daysAhead: 14 })).slice(0, 20),
      });
    }

    const patReschedMatch = pathname.match(/^\/api\/v1\/ambo\/patient\/appointments\/([^/]+)\/reschedule$/);
    if (method === 'POST' && patReschedMatch) {
      requirePatient(auth);
      const body = await readJsonBody(req);
      let patientId = auth.session.patient_id;
      if (patientId.startsWith('contact:')) {
        const c = patientId.slice('contact:'.length);
        const p = (await db.get('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)', auth.session.account_id, c, c));
        if (!p) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
        patientId = p.id;
      }
      const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || randomId('idem'));
      const resData = await requestAppointmentReschedule(db, {
        accountId: auth.session.account_id,
        appointmentId: patReschedMatch[1],
        patientId,
        requestedStartAt: body.requestedStartAt || null,
        requestedEndAt: body.requestedEndAt || null,
        preferences: body.preferences || {},
        reason: body.reason || '',
        idempotencyKey,
      });
      return json(res, resData.idempotentReplay ? 200 : 201, resData);
    }

    const patCancelMatch = pathname.match(/^\/api\/v1\/ambo\/patient\/appointments\/([^/]+)\/cancel$/);
    if (method === 'POST' && patCancelMatch) {
      requirePatient(auth);
      const body = await readJsonBody(req);
      let patientId = auth.session.patient_id;
      if (patientId.startsWith('contact:')) {
        const c = patientId.slice('contact:'.length);
        const p = (await db.get('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)', auth.session.account_id, c, c));
        if (!p) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
        patientId = p.id;
      }
      const resData = await cancelAppointmentTx(db, {
        accountId: auth.session.account_id,
        appointmentId: patCancelMatch[1],
        actorType: 'patient',
        patientId,
        reason: body.reason || '',
      });
      return json(res, 200, resData);
    }

    // Invitations (returning patients)
    if (method === 'POST' && pathname === '/api/v1/ambo/invitations') {
      await requireProfessional(db, auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const pat = (await db.get('SELECT * FROM operational_patients WHERE id = ? AND account_id = ?', body.patientId, auth.account.id));
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      const rawToken = `inv_${randomToken(18)}`;
      const id = randomId('inv');
      const expiresAt = addDaysIso(Number(body.expiresInDays || 7));
      const targetContact = body.targetContact || pat.email || pat.phone;
      (await db.run(`
        INSERT INTO patient_invitations (id, account_id, patient_id, token_hash, channel, target_contact, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `, id, auth.account.id, pat.id, sha256Hex(rawToken), body.channel || 'email', targetContact, expiresAt, nowIso()));

      const amboBase = String(process.env.ENOMERA_AMBO_URL || '').replace(/\/+$/, '');
      const inviteUrl = amboBase ? `${amboBase}/?pro=${encodeURIComponent(auth.account.slug)}&convite=${encodeURIComponent(rawToken)}` : null;
      const escHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const expiresLabel = new Date(expiresAt).toLocaleDateString('pt-BR', { timeZone: auth.account.timezone || 'America/Sao_Paulo' });
      const proName = auth.account.display_name;
      const delivery = await sendTransactionalEmail(db, {
        channel: body.channel || 'email',
        recipient: targetContact,
        subject: `Convite para agendar com ${proName} · Ambo`,
        textBody: inviteUrl
          ? `${proName} convidou você para escolher um horário. Abra o link (uso único, válido até ${expiresLabel}): ${inviteUrl}`
          : `Use seu convite de uso único para escolher um horário com ${proName} (válido até ${expiresLabel}): ${rawToken}`,
        htmlBody: inviteUrl
          ? `<p><b>${escHtml(proName)}</b> convidou você para escolher um horário.</p><p><a href="${escHtml(inviteUrl)}">Escolher horário no Ambo</a></p><p>O convite é de uso único e vale até ${expiresLabel}.</p>`
          : `<p>Use seu convite de uso único para escolher um horário com <b>${escHtml(proName)}</b> (válido até ${expiresLabel}):</p><p><code>${rawToken}</code></p>`,
        purpose: 'ambo_invitation',
      });
      return json(res, 201, { invitationId: id, inviteToken: rawToken, inviteUrl, expiresAt, delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/ambo/invitations/verify') {
      const body = await readJsonBody(req);
      const inv = (await db.get('SELECT * FROM patient_invitations WHERE token_hash = ?', sha256Hex(String(body.inviteToken || '').trim())));
      if (!inv) throw Object.assign(new Error('Convite inválido.'), { status: 404, code: 'INVITE_NOT_FOUND' });
      if (inv.status === 'used') throw Object.assign(new Error('Este convite já foi utilizado.'), { status: 409, code: 'INVITE_ALREADY_USED' });
      if (inv.status !== 'active' || Date.parse(inv.expires_at) <= Date.now()) {
        throw Object.assign(new Error('Este convite expirou. Peça um reenvio à profissional.'), { status: 410, code: 'INVITE_EXPIRED' });
      }
      const pat = (await db.get('SELECT id, full_name, email FROM operational_patients WHERE id = ?', inv.patient_id));
      const acc = (await db.get('SELECT id, slug, display_name, session_price_cents, session_duration_min, timezone FROM professional_accounts WHERE id = ?', inv.account_id));
      // Strictly namespaced patient identity (NEVER collides with professional or operator users!)
      const syntheticEmail = `pat.${acc.id}.${pat.id}@patient.enomera.invalid`;
      let u = await db.get("SELECT id FROM users WHERE email = ? AND role = 'patient'", syntheticEmail);
      if (!u) {
        const uid = randomId('pusr');
        const pwd = hashPassword(randomToken(24));
        await db.run(
          `INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'patient', ?, 0, ?, ?)`,
          uid, syntheticEmail, pwd.hash, pwd.salt, pat.full_name, nowIso(), nowIso(), nowIso()
        );
        u = { id: uid };
      }
      const sess = await issueSession(db, { userId: u.id, actorType: 'patient', accountId: acc.id, patientId: pat.id, ttlMinutes: 120 });
      return json(res, 200, {
        invitationId: inv.id,
        professional: acc,
        patient: pat,
        availableSlots: await generateAvailableSlots(db, acc.id, { daysAhead: 14 }),
        sessionToken: sess.rawToken,
      }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'POST' && pathname === '/api/v1/ambo/invitations/reserve') {
      requirePatient(auth);
      const body = await readJsonBody(req);
      const resData = await reserveSlotByInvitation(db, {
        accountId: auth.session.account_id,
        patientId: auth.session.patient_id,
        invitationId: body.invitationId,
        startAt: body.startAt,
        endAt: body.endAt,
        modality: body.modality || 'online',
        idempotencyKey: req.headers['x-idempotency-key'] || body.idempotencyKey || null,
      });
      return json(res, resData.idempotentReplay ? 200 : 201, resData);
    }

    // Ambo Solo Professional Console (works WITHOUT Minne!)
    if (method === 'GET' && pathname === '/api/v1/ambo/pro/overview') {
      await requireProfessional(db, auth, { product: 'ambo', write: false });
      const requests = await Promise.all((await db.all('SELECT * FROM consultation_requests WHERE account_id = ? ORDER BY created_at DESC', auth.account.id)).map(async (r) => ({
        ...r,
        preferences: JSON.parse(r.preferences_json || '{}'),
        answers: JSON.parse(r.answers_json || '{}'),
        duplicateCandidate: r.duplicate_candidate_id ? (await db.get('SELECT id, full_name, email, phone, status FROM operational_patients WHERE id = ?', r.duplicate_candidate_id)) : null,
      })));
      const appointments = (await db.all(`
        SELECT a.*, p.full_name as patient_name, p.email as patient_email
        FROM appointments a JOIN operational_patients p ON p.id = a.patient_id
        WHERE a.account_id = ? ORDER BY a.start_at ASC
      `, auth.account.id));
      const reschedules = (await db.all(`
        SELECT r.*, p.full_name as patient_name
        FROM reschedule_requests r JOIN operational_patients p ON p.id = r.patient_id
        WHERE r.account_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC
      `, auth.account.id));
      const patients = (await db.all('SELECT id, full_name, email, phone, status, origin FROM operational_patients WHERE account_id = ? ORDER BY full_name', auth.account.id));
      const invitations = (await db.all('SELECT id, patient_id, channel, target_contact, status, expires_at, used_at, created_at FROM patient_invitations WHERE account_id = ? ORDER BY created_at DESC LIMIT 20', auth.account.id));
      return json(res, 200, {
        account: { id: auth.account.id, slug: auth.account.slug, displayName: auth.account.display_name },
        requests,
        appointments,
        pendingReschedules: reschedules,
        patients,
        invitations,
        availableSlots: await generateAvailableSlots(db, auth.account.id, { daysAhead: 14 }),
      });
    }

    const amboProConfirm = pathname.match(/^\/api\/v1\/ambo\/pro\/requests\/([^/]+)\/confirm$/);
    if (method === 'POST' && amboProConfirm) {
      await requireProfessional(db, auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const out = await confirmConsultationRequest(db, {
        accountId: auth.account.id,
        actorUserId: auth.user.id,
        requestId: amboProConfirm[1],
        startAt: body.startAt,
        endAt: body.endAt,
        modality: body.modality,
        patientResolution: body.patientResolution || 'create_new',
        linkPatientId: body.linkPatientId || null,
        idempotencyKey: req.headers['x-idempotency-key'] || body.idempotencyKey || null,
        sourceProduct: 'ambo',
        simulateDelayedSync: Boolean(body.simulateDelayedSync),
      });
      out.patientNotification = await notifyPatientOfConfirmation(db, auth.account, out);
      return json(res, out.idempotentReplay ? 200 : 201, out);
    }

    const amboProDecideResch = pathname.match(/^\/api\/v1\/ambo\/pro\/reschedules\/([^/]+)\/decide$/);
    if (method === 'POST' && amboProDecideResch) {
      await requireProfessional(db, auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const out = await decideRescheduleRequest(db, {
        accountId: auth.account.id,
        actorUserId: auth.user.id,
        rescheduleId: amboProDecideResch[1],
        decision: body.decision === 'decline' ? 'decline' : 'approve',
        newStartAt: body.newStartAt || null,
        newEndAt: body.newEndAt || null,
      });
      return json(res, 200, out);
    }

    // ── MINNE CLINICAL WORKSPACE & IMPORT ENGINE ──────────────────────
    if (method === 'GET' && pathname === '/api/v1/minne/workspace') {
      await requireProfessional(db, auth, { product: 'minne', write: false, clinical: true });
      const entitlements = await getAccountEntitlements(db, auth.account.id);
      const patients = (await db.all('SELECT * FROM operational_patients WHERE account_id = ? ORDER BY full_name', auth.account.id));
      const appointments = (await db.all(`
        SELECT a.*, p.full_name as patient_name
        FROM appointments a JOIN operational_patients p ON p.id = a.patient_id
        WHERE a.account_id = ? ORDER BY a.start_at ASC
      `, auth.account.id));
      const requests = await Promise.all((await db.all('SELECT * FROM consultation_requests WHERE account_id = ? ORDER BY created_at DESC', auth.account.id)).map(async (r) => ({
        ...r,
        preferences: JSON.parse(r.preferences_json || '{}'),
        answers: JSON.parse(r.answers_json || '{}'),
        duplicateCandidate: r.duplicate_candidate_id ? (await db.get('SELECT id, full_name, email, phone, status FROM operational_patients WHERE id = ?', r.duplicate_candidate_id)) : null,
      })));
      const pendingReschedules = (await db.all(`
        SELECT r.*, p.full_name as patient_name
        FROM reschedule_requests r JOIN operational_patients p ON p.id = r.patient_id
        WHERE r.account_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC
      `, auth.account.id));
      const drafts = (await db.all(`
        SELECT d.id, d.note_id, d.revision, d.updated_at, n.patient_id, n.appointment_id, p.full_name as patient_name
        FROM clinical_drafts d
        JOIN clinical_notes n ON n.id = d.note_id
        JOIN operational_patients p ON p.id = n.patient_id
        WHERE d.account_id = ? ORDER BY d.updated_at DESC
      `, auth.account.id));
      const syncEvents = (await db.all('SELECT * FROM sync_events WHERE account_id = ? ORDER BY created_at DESC LIMIT 15', auth.account.id));
      return json(res, 200, {
        account: { id: auth.account.id, slug: auth.account.slug, displayName: auth.account.display_name, crpOrCrm: auth.account.crp_or_crm, specialty: auth.account.specialty },
        entitlements,
        patients,
        appointments,
        requests,
        pendingReschedules,
        drafts,
        availableSlots: await generateAvailableSlots(db, auth.account.id, { daysAhead: 14 }),
        syncEvents,
      });
    }

    if (method === 'POST' && pathname === '/api/v1/minne/patients') {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const fullName = String(body.fullName || '').trim();
      if (!fullName) throw Object.assign(new Error('Informe o nome completo do paciente.'), { status: 400, code: 'PATIENT_NAME_REQUIRED' });
      const id = randomId('pat');
      const now = nowIso();
      (await db.run(`
        INSERT INTO operational_patients (id, account_id, full_name, email, phone, birth_date, preferred_contact, status, origin, summary_operational, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'minne_manual', ?, ?, ?)
      `, id, auth.account.id, fullName, String(body.email || '').trim().toLowerCase(), String(body.phone || '').trim(), String(body.birthDate || ''), body.preferredContact || 'email', String(body.summary || ''), now, now));
      return json(res, 201, { patient: (await db.get('SELECT * FROM operational_patients WHERE id = ?', id)) });
    }

    const patArchMatch = pathname.match(/^\/api\/v1\/minne\/patients\/([^/]+)\/(archive|recover)$/);
    if (method === 'POST' && patArchMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const [, patientId, action] = patArchMatch;
      const p = (await db.get('SELECT id FROM operational_patients WHERE id = ? AND account_id = ?', patientId, auth.account.id));
      if (!p) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      const now = nowIso();
      (await db.run('UPDATE operational_patients SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?', action === 'archive' ? 'archived' : 'active',
        action === 'archive' ? now : null,
        now,
        patientId));
      return json(res, 200, { patient: (await db.get('SELECT * FROM operational_patients WHERE id = ?', patientId)) });
    }

    const minneConfirmMatch = pathname.match(/^\/api\/v1\/minne\/requests\/([^/]+)\/confirm$/);
    if (method === 'POST' && minneConfirmMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = await confirmConsultationRequest(db, {
        accountId: auth.account.id,
        actorUserId: auth.user.id,
        requestId: minneConfirmMatch[1],
        startAt: body.startAt,
        endAt: body.endAt,
        modality: body.modality,
        patientResolution: body.patientResolution || 'create_new',
        linkPatientId: body.linkPatientId || null,
        idempotencyKey: req.headers['x-idempotency-key'] || body.idempotencyKey || null,
        sourceProduct: 'minne',
        simulateDelayedSync: Boolean(body.simulateDelayedSync),
      });
      out.patientNotification = await notifyPatientOfConfirmation(db, auth.account, out);
      return json(res, out.idempotentReplay ? 200 : 201, out);
    }

    if (method === 'POST' && pathname === '/api/v1/minne/appointments') {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = await createManualAppointment(db, {
        accountId: auth.account.id,
        actorUserId: auth.user.id,
        patientId: body.patientId,
        startAt: body.startAt,
        endAt: body.endAt,
        modality: body.modality || 'online',
        idempotencyKey: req.headers['x-idempotency-key'] || body.idempotencyKey || null,
      });
      return json(res, out.idempotentReplay ? 200 : 201, out);
    }

    const minneReschDecide = pathname.match(/^\/api\/v1\/minne\/reschedules\/([^/]+)\/decide$/);
    if (method === 'POST' && minneReschDecide) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = await decideRescheduleRequest(db, {
        accountId: auth.account.id,
        actorUserId: auth.user.id,
        rescheduleId: minneReschDecide[1],
        decision: body.decision === 'decline' ? 'decline' : 'approve',
        newStartAt: body.newStartAt || null,
        newEndAt: body.newEndAt || null,
      });
      return json(res, 200, out);
    }

    const minneCancelMatch = pathname.match(/^\/api\/v1\/minne\/appointments\/([^/]+)\/cancel$/);
    if (method === 'POST' && minneCancelMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = await cancelAppointmentTx(db, {
        accountId: auth.account.id,
        appointmentId: minneCancelMatch[1],
        actorType: 'professional',
        actorUserId: auth.user.id,
        reason: body.reason || '',
      });
      return json(res, 200, out);
    }

    // Clinical Notes, Drafts & Version History
    const patNotesMatch = pathname.match(/^\/api\/v1\/minne\/patients\/([^/]+)\/notes$/);
    if (method === 'GET' && patNotesMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: false, clinical: true });
      const patientId = patNotesMatch[1];
      const pat = (await db.get('SELECT id, full_name FROM operational_patients WHERE id = ? AND account_id = ?', patientId, auth.account.id));
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });

      const notes = await Promise.all((await db.all("SELECT * FROM clinical_notes WHERE account_id = ? AND patient_id = ? AND status != 'reverted' ORDER BY COALESCE(occurred_at, created_at) DESC", auth.account.id, patientId)).map(async (n) => {
        const draft = (await db.get('SELECT * FROM clinical_drafts WHERE note_id = ?', n.id));
        const versions = (await db.all('SELECT * FROM clinical_note_versions WHERE note_id = ? ORDER BY version_number ASC', n.id)).map((v) => ({
          ...v,
          blocks: JSON.parse(v.blocks_json),
        }));
        const fileIds = JSON.parse(n.attachment_file_ids_json || '[]');
        const attachments = (await Promise.all(fileIds.map((fid) => db.get('SELECT id, original_name, detected_mime, size_bytes, created_at FROM private_files WHERE id = ? AND account_id = ?', fid, auth.account.id)))).filter(Boolean);
        return {
          ...n,
          draft: draft ? { ...draft, blocks: JSON.parse(draft.blocks_json) } : null,
          versions,
          attachments,
        };
      }));
      return json(res, 200, { patient: pat, notes });
    }

    if (method === 'POST' && pathname === '/api/v1/minne/notes/draft') {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const pat = (await db.get('SELECT id FROM operational_patients WHERE id = ? AND account_id = ?', body.patientId, auth.account.id));
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      if (body.appointmentId) {
        const ownedAppt = await db.get(
          'SELECT id FROM appointments WHERE id = ? AND account_id = ? AND patient_id = ?',
          body.appointmentId, auth.account.id, pat.id
        );
        if (!ownedAppt) throw Object.assign(new Error('Consulta vinculada não pertence a esta conta/paciente.'), { status: 404, code: 'APPOINTMENT_NOT_FOUND' });
      }

      const blocks = Array.isArray(body.blocks) ? body.blocks : [];
      const now = nowIso();
      let noteId = body.noteId || null;

      const out = await runTransaction(db, async (db) => {
        if (noteId) {
          const existing = (await db.get('SELECT * FROM clinical_notes WHERE id = ? AND account_id = ?', noteId, auth.account.id));
          if (!existing) throw Object.assign(new Error('Registro não encontrado.'), { status: 404, code: 'NOTE_NOT_FOUND' });
        } else {
          noteId = randomId('note');
          (await db.run(`
            INSERT INTO clinical_notes (id, account_id, patient_id, appointment_id, record_origin, occurred_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'minne_session', ?, 'draft', ?, ?)
          `, noteId, auth.account.id, pat.id, body.appointmentId || null, body.occurredAt || now, now, now));
        }
        const existingDraft = (await db.get('SELECT * FROM clinical_drafts WHERE note_id = ?', noteId));
        if (existingDraft) {
          (await db.run('UPDATE clinical_drafts SET revision = revision + 1, blocks_json = ?, updated_by_user_id = ?, updated_at = ? WHERE note_id = ?', JSON.stringify(blocks), auth.user.id, now, noteId));
        } else {
          (await db.run(`
            INSERT INTO clinical_drafts (id, note_id, account_id, revision, base_version_id, blocks_json, updated_by_user_id, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?)
          `, randomId('drf'), noteId, auth.account.id, body.baseVersionId || null, JSON.stringify(blocks), auth.user.id, now));
        }
        (await db.run('UPDATE clinical_notes SET updated_at = ? WHERE id = ?', now, noteId));
        return {
          noteId,
          draft: (await db.get('SELECT * FROM clinical_drafts WHERE note_id = ?', noteId)),
        };
      });
      return json(res, 200, { noteId: out.noteId, draft: { ...out.draft, blocks: JSON.parse(out.draft.blocks_json) } });
    }

    const concludeMatch = pathname.match(/^\/api\/v1\/minne\/notes\/([^/]+)\/conclude$/);
    if (method === 'POST' && concludeMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const noteId = concludeMatch[1];
      const body = await readJsonBody(req);
      const out = await runTransaction(db, async (db) => {
        const note = (await db.get('SELECT * FROM clinical_notes WHERE id = ? AND account_id = ?', noteId, auth.account.id));
        if (!note) throw Object.assign(new Error('Registro não encontrado.'), { status: 404, code: 'NOTE_NOT_FOUND' });
        const draft = (await db.get('SELECT * FROM clinical_drafts WHERE note_id = ?', noteId));
        const blocks = Array.isArray(body.blocks) ? body.blocks : (draft ? JSON.parse(draft.blocks_json) : []);
        const lastVer = Number(((await db.get('SELECT MAX(version_number) as m FROM clinical_note_versions WHERE note_id = ?', noteId)))?.m || 0) || 0;
        const nextVer = lastVer + 1;
        const verId = randomId('ver');
        const now = nowIso();
        // NEVER overwrites previous versions or original imported metadata/occurred_at!
        (await db.run(`
          INSERT INTO clinical_note_versions (id, note_id, account_id, version_number, author_user_id, author_display_name, blocks_json, change_reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, verId, noteId, auth.account.id, nextVer, auth.user.id, auth.account.display_name, JSON.stringify(blocks), String(body.changeReason || (nextVer === 1 ? 'Conclusão do registro' : `Adendo / revisão v${nextVer}`)), now));
        (await db.run('DELETE FROM clinical_drafts WHERE note_id = ?', noteId));
        (await db.run("UPDATE clinical_notes SET status = 'concluded', updated_at = ? WHERE id = ?", now, noteId));
        await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'clinical_note.conclude', resourceType: 'clinical_note', resourceId: noteId, meta: { versionNumber: nextVer } });
        return { noteId, versionId: verId, versionNumber: nextVer };
      });
      return json(res, 200, out);
    }

    const attachNoteMatch = pathname.match(/^\/api\/v1\/minne\/notes\/([^/]+)\/attachments$/);
    if (method === 'POST' && attachNoteMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const noteId = attachNoteMatch[1];
      const note = await db.get('SELECT * FROM clinical_notes WHERE id = ? AND account_id = ?', noteId, auth.account.id);
      if (!note) throw Object.assign(new Error('Registro clínico não encontrado.'), { status: 404, code: 'NOTE_NOT_FOUND' });
      const body = await readJsonBody(req);
      const buf = Buffer.from(String(body.contentBase64 || ''), 'base64');
      const saved = await savePrivateFile(db, {
        accountId: auth.account.id,
        ownerUserId: auth.user.id,
        scope: 'minne_clinical',
        originalName: body.originalName || 'anexo-clinico.pdf',
        buffer: buf,
      });
      const currentIds = JSON.parse(note.attachment_file_ids_json || '[]');
      currentIds.push(saved.id);
      await db.run('UPDATE clinical_notes SET attachment_file_ids_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(currentIds), nowIso(), noteId);
      await writeAudit(db, {
        actorUserId: auth.user.id,
        actorType: 'professional',
        accountId: auth.account.id,
        action: 'clinical_note.attach_file',
        resourceType: 'private_file',
        resourceId: saved.id,
        meta: { noteId },
      });
      return json(res, 201, { file: saved, noteId });
    }

    // ── MINNE 6-MODE IMPORT ENGINE ────────────────────────────────────
    if (method === 'GET' && pathname === '/api/v1/minne/imports/formats') {
      await requireProfessional(db, auth, { product: 'minne', write: false, clinical: true });
      return json(res, 200, { formats: SUPPORTED_IMPORT_FORMATS, maxFileMb: 10, maxZipMb: 25, maxZipEntries: 50 });
    }

    if (method === 'GET' && pathname === '/api/v1/minne/imports/template') {
      await requireProfessional(db, auth, { product: 'minne', write: false, clinical: true });
      const fmt = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
      const tpl = await generateSpreadsheetTemplateBuffer(fmt);
      res.writeHead(200, {
        'Content-Type': tpl.mime,
        'Content-Disposition': `attachment; filename="${tpl.filename}"`,
      });
      res.end(tpl.buffer);
      return;
    }

    if (method === 'GET' && pathname === '/api/v1/minne/imports') {
      await requireProfessional(db, auth, { product: 'minne', write: false, clinical: true });
      const batches = (await db.all('SELECT * FROM import_batches WHERE account_id = ? ORDER BY created_at DESC LIMIT 30', auth.account.id));
      return json(res, 200, { batches });
    }

    if (method === 'POST' && pathname === '/api/v1/minne/imports/stage') {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const files = (Array.isArray(body.files) ? body.files : []).map((f) => ({
        originalName: String(f.originalName || 'arquivo'),
        buffer: Buffer.from(String(f.contentBase64 || ''), 'base64'),
      }));
      const batch = await stageImportBatch(db, {
        accountId: auth.account.id,
        userId: auth.user.id,
        sourceKind: body.sourceKind,
        targetPatientId: body.targetPatientId || null,
        pastedText: body.pastedText ?? null,
        declaredAuthor: body.declaredAuthor ?? null,
        occurredAtRaw: body.occurredAt ?? null,
        sourceSystem: body.sourceSystem ?? null,
        sourceKey: body.sourceKey ?? null,
        adapterId: body.adapterId || 'auto',
        columnMapping: body.columnMapping || null,
        files,
      });
      return json(res, 201, { batch });
    }

    const impGetMatch = pathname.match(/^\/api\/v1\/minne\/imports\/([^/]+)$/);
    if (method === 'GET' && impGetMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: false, clinical: true });
      const batch = await getImportBatchDetail(db, auth.account.id, impGetMatch[1]);
      if (!batch) throw Object.assign(new Error('Lote de importação não encontrado.'), { status: 404, code: 'BATCH_NOT_FOUND' });
      return json(res, 200, { batch });
    }

    const impItemMatch = pathname.match(/^\/api\/v1\/minne\/imports\/([^/]+)\/items\/([^/]+)$/);
    if (method === 'PATCH' && impItemMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const batch = await resolveImportItem(db, {
        accountId: auth.account.id,
        batchId: impItemMatch[1],
        itemId: impItemMatch[2],
        resolutionAction: body.resolutionAction,
        targetPatientId: body.targetPatientId || null,
        proposedPatient: body.proposedPatient || null,
        occurredAt: body.occurredAt,
        declaredAuthor: body.declaredAuthor,
        extractedText: body.extractedText,
      });
      return json(res, 200, { batch });
    }

    const impActionMatch = pathname.match(/^\/api\/v1\/minne\/imports\/([^/]+)\/(commit|cancel|revert)$/);
    if (method === 'POST' && impActionMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: true, clinical: true });
      const [, batchId, action] = impActionMatch;
      const body = await readJsonBody(req);
      if (action === 'commit') {
        const resData = await commitImportBatch(db, {
          accountId: auth.account.id,
          userId: auth.user.id,
          userDisplayName: auth.account.display_name,
          batchId,
          idempotencyKey: req.headers['x-idempotency-key'] || body.idempotencyKey || null,
          retryFailedOnly: Boolean(body.retryFailedOnly),
        });
        return json(res, 200, resData);
      }
      if (action === 'cancel') {
        return json(res, 200, { batch: await cancelImportBatch(db, { accountId: auth.account.id, userId: auth.user.id, batchId }) });
      }
      if (action === 'revert') {
        return json(res, 200, await revertImportBatch(db, { accountId: auth.account.id, userId: auth.user.id, batchId }));
      }
    }

    // ── SYNC EVENTS RECOVERY ──────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/v1/sync/events') {
      await requireProfessional(db, auth);
      const events = (await db.all('SELECT * FROM sync_events WHERE account_id = ? ORDER BY created_at DESC LIMIT 20', auth.account.id));
      return json(res, 200, { events });
    }

    const syncRetryMatch = pathname.match(/^\/api\/v1\/sync\/events\/([^/]+)\/retry$/);
    if (method === 'POST' && syncRetryMatch) {
      await requireProfessional(db, auth);
      const ev = (await db.get('SELECT * FROM sync_events WHERE id = ? AND account_id = ?', syncRetryMatch[1], auth.account.id));
      if (!ev) throw Object.assign(new Error('Evento de sincronização não encontrado.'), { status: 404, code: 'SYNC_NOT_FOUND' });
      const now = nowIso();
      (await db.run("UPDATE sync_events SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?", now, ev.id));
      return json(res, 200, { event: (await db.get('SELECT * FROM sync_events WHERE id = ?', ev.id)) });
    }

    // ── PRIVATE FILES STREAMING (ZERO PUBLIC CLINICAL URLS!) ──────────
    const fileMatch = pathname.match(/^\/api\/v1\/files\/([^/]+)$/);
    if (method === 'GET' && fileMatch) {
      requireAuth(auth);
      const fileRow = (await db.get('SELECT * FROM private_files WHERE id = ?', fileMatch[1]));
      if (!fileRow) throw Object.assign(new Error('Arquivo não encontrado.'), { status: 404, code: 'FILE_NOT_FOUND' });

      if (fileRow.scope === 'minne_clinical') {
        // STRICTLY professional with clinical membership on THAT account — NEVER patient or Etha operator!
        if (auth.session.actor_type !== 'professional' || auth.account?.id !== fileRow.account_id || !auth.membership?.can_access_clinical) {
          await writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: fileRow.account_id, action: 'file.download', resourceType: 'private_file', resourceId: fileRow.id, outcome: 'deny' });
          throw Object.assign(new Error('Acesso negado ao arquivo clínico privado.'), { status: 403, code: 'FORBIDDEN_CLINICAL_FILE' });
        }
      } else if (fileRow.scope === 'etha_briefing') {
        const isOwner = auth.session.actor_type === 'professional' && auth.account?.id === fileRow.account_id;
        const isOp = auth.user.role === 'operator' && auth.session.actor_type === 'operator';
        if (!isOwner && !isOp) {
          throw Object.assign(new Error('Acesso negado ao anexo do briefing.'), { status: 403, code: 'FORBIDDEN_BRIEFING_FILE' });
        }
      } else {
        // Fail-closed for any other scope (e.g. profile_photo or future scopes)
        const isOwner = auth.session.actor_type === 'professional' && auth.account?.id === fileRow.account_id;
        if (!isOwner) {
          throw Object.assign(new Error('Acesso negado ao arquivo privado.'), { status: 403, code: 'FORBIDDEN_PRIVATE_FILE' });
        }
      }

      const bin = await readPrivateFileBinary(fileRow);
      if (!bin) throw Object.assign(new Error('Conteúdo do arquivo indisponível no armazenamento.'), { status: 404, code: 'FILE_MISSING_DISK' });
      await writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: fileRow.account_id, action: 'file.download', resourceType: 'private_file', resourceId: fileRow.id, outcome: 'allow' });
      res.writeHead(200, {
        'Content-Type': fileRow.detected_mime,
        'Content-Disposition': `attachment; filename="${fileRow.original_name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(bin);
      return;
    }

    // ── ETHA SERVICE DELIVERY + MARCOS OPERATOR + PUBLIC STAGING SITE ──
    if (method === 'GET' && pathname === '/api/v1/etha/capacity') {
      const settings = (await db.get("SELECT capacity_limit, updated_at FROM etha_settings WHERE id = 'default'"));
      const activeCount = Number((await db.get("SELECT COUNT(*) as c FROM etha_projects WHERE status IN ('briefing','blocked_materials','in_production','awaiting_approval','revision_submitted')"))?.c || 0);
      return json(res, 200, {
        capacityLimit: settings.capacity_limit,
        activeProjects: activeCount,
        availableSlots: Math.max(0, settings.capacity_limit - activeCount),
        isFull: activeCount >= settings.capacity_limit,
        updatedAt: settings.updated_at,
      });
    }

    if (method === 'POST' && pathname === '/api/v1/etha/waitlist') {
      const body = await readJsonBody(req);
      const fullName = String(body.fullName || auth?.user?.full_name || '').trim();
      const email = String(body.email || auth?.user?.email || '').trim().toLowerCase();
      if (!fullName || !email.includes('@')) throw Object.assign(new Error('Informe nome e e-mail para a lista de espera sem pagamento.'), { status: 400, code: 'INVALID_WAITLIST' });
      const id = randomId('wtl');
      (await db.run(`
        INSERT INTO etha_waitlist (id, user_id, full_name, email, desired_format, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)
      `, id, auth?.user?.id || null, fullName, email, body.desiredFormat === 'multi_page' ? 'multi_page' : 'one_page', String(body.notes || ''), nowIso()));
      return json(res, 201, { id, status: 'waiting', chargedCents: 0, message: 'Você entrou na lista de espera da Etha sem qualquer cobrança.' });
    }

    if (method === 'GET' && pathname === '/api/v1/etha/project') {
      await requireProfessional(db, auth, { product: 'etha', write: false });
      const proj = await ensureEthaProject(db, auth.account.id);
      return json(res, 200, await buildEthaProjectDetail(db, proj));
    }

    if (pathname === '/api/v1/etha/project/photo' && ['POST', 'DELETE'].includes(method)) {
      await requireProfessional(db, auth, { product: 'etha', write: true });
      const proj = await ensureEthaProject(db, auth.account.id);
      const photo = method === 'POST' ? await savePortrait(db, auth, await readJsonBody(req), 'etha_photo') : null;
      const briefing = { ...JSON.parse(proj.briefing_json || '{}'), photoAssetId: photo?.photoAssetId || null,
        photoUrl: photo?.photoUrl || null, photosConfirmed: Boolean(photo) };
      const ids = JSON.parse(proj.attachment_file_ids_json || '[]');
      if (photo) ids.push(photo.photoAssetId);
      await db.run('UPDATE etha_projects SET briefing_json = ?, attachment_file_ids_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(briefing), JSON.stringify(ids), nowIso(), proj.id);
      return json(res, 200, photo || { photoAssetId: null, photoUrl: null });
    }

    if (method === 'PUT' && pathname === '/api/v1/etha/project/briefing') {
      await requireProfessional(db, auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = await ensureEthaProject(db, auth.account.id);
      const existingBriefing = JSON.parse(proj.briefing_json || '{}');
      const mergedBriefing = { ...existingBriefing, ...(body.briefing || {}) };
      const fileIds = JSON.parse(proj.attachment_file_ids_json || '[]');
      if (Array.isArray(body.files)) {
        for (const f of body.files) {
          const buf = Buffer.from(String(f.contentBase64 || ''), 'base64');
          const saved = await savePrivateFile(db, {
            accountId: auth.account.id,
            ownerUserId: auth.user.id,
            scope: 'etha_briefing',
            originalName: f.originalName || 'anexo-briefing.jpg',
            buffer: buf,
          });
          fileIds.push(saved.id);
        }
      }
      const blockers = [];
      if (!mergedBriefing.approach) blockers.push('Falta descrever abordagem e público atendido');
      if (fileIds.length === 0 && !mergedBriefing.photosConfirmed) blockers.push('Falta anexar foto profissional em alta resolução');
      if (!body.ctaMode && !proj.cta_mode) blockers.push('Definir destino do botão de contato (Ambo ou canal próprio)');

      const nextStatus = blockers.length > 0 ? 'blocked_materials' : (proj.status === 'briefing' || proj.status === 'blocked_materials' ? 'in_production' : proj.status);
      const now = nowIso();
      (await db.run(`
        UPDATE etha_projects SET
          format = COALESCE(?, format),
          briefing_step = COALESCE(?, briefing_step),
          briefing_json = ?,
          attachment_file_ids_json = ?,
          blockers_json = ?,
          cta_mode = COALESCE(?, cta_mode),
          custom_contact_url = COALESCE(?, custom_contact_url),
          domain_name = COALESCE(?, domain_name),
          status = ?,
          updated_at = ?
        WHERE id = ?
      `, body.format ?? null, body.briefingStep ?? null, JSON.stringify(mergedBriefing), JSON.stringify(fileIds),
        JSON.stringify(blockers), body.ctaMode ?? null, body.customContactUrl ?? null, body.domainName ?? null,
        nextStatus, now, proj.id));
      return json(res, 200, await buildEthaProjectDetail(db, (await db.get('SELECT * FROM etha_projects WHERE id = ?', proj.id))));
    }

    if (method === 'POST' && pathname === '/api/v1/etha/project/revision') {
      await requireProfessional(db, auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = await ensureEthaProject(db, auth.account.id);
      const comments = Array.isArray(body.comments) ? body.comments.filter(Boolean) : [];
      if (comments.length === 0) throw Object.assign(new Error('Adicione ao menos um comentário consolidado para enviar a revisão.'), { status: 400, code: 'EMPTY_REVISION' });
      const existingRound = Number(((await db.get('SELECT COUNT(*) as c FROM etha_revisions WHERE project_id = ?', proj.id)))?.c || 0);
      if (existingRound >= 1) throw Object.assign(new Error('A rodada consolidada de revisão incluída no escopo já foi enviada.'), { status: 409, code: 'REVISION_ROUND_USED' });
      const latestPreview = (await db.get("SELECT id FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1", proj.id));
      if (!latestPreview) throw Object.assign(new Error('Nenhuma proposta/prévia disponível para revisão ainda.'), { status: 409, code: 'NO_PREVIEW_VERSION' });
      const revId = randomId('erev');
      const now = nowIso();
      (await db.run(`
        INSERT INTO etha_revisions (id, project_id, version_id, round_number, comments_json, status, submitted_by_user_id, created_at)
        VALUES (?, ?, ?, 1, ?, 'submitted', ?, ?)
      `, revId, proj.id, latestPreview.id, JSON.stringify(comments), auth.user.id, now));
      (await db.run("UPDATE etha_projects SET status = 'revision_submitted', updated_at = ? WHERE id = ?", now, proj.id));
      return json(res, 201, { revisionId: revId, project: await buildEthaProjectDetail(db, (await db.get('SELECT * FROM etha_projects WHERE id = ?', proj.id))) });
    }

    if (method === 'POST' && pathname === '/api/v1/etha/project/approve') {
      await requireProfessional(db, auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = await ensureEthaProject(db, auth.account.id);
      const version = body.versionId
        ? (await db.get('SELECT * FROM etha_content_versions WHERE id = ? AND project_id = ?', body.versionId, proj.id))
        : (await db.get('SELECT * FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1', proj.id));
      if (!version) throw Object.assign(new Error('Versão não encontrada para aprovação.'), { status: 404, code: 'VERSION_NOT_FOUND' });
      const now = nowIso();
      (await db.run("UPDATE etha_content_versions SET stage = 'approved', approved_by_user_id = ?, approved_at = ? WHERE id = ?", auth.user.id, now, version.id));
      (await db.run("UPDATE etha_projects SET status = 'approved', updated_at = ? WHERE id = ?", now, proj.id));
      return json(res, 200, { approvedVersionId: version.id, project: await buildEthaProjectDetail(db, (await db.get('SELECT * FROM etha_projects WHERE id = ?', proj.id))) });
    }

    // Editor saves DRAFT / PREVIEW — NEVER publishes silently!
    if (method === 'POST' && pathname === '/api/v1/etha/project/editor') {
      await requireProfessional(db, auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = await ensureEthaProject(db, auth.account.id);
      const content = z.object({ displayName: z.string().max(160).optional(), headline: z.string().max(300).optional(),
        subheadline: z.string().max(2000).optional(), about: z.string().max(15000).optional(),
        ctaLabel: z.string().max(100).optional(), photoAssetId: z.string().nullable().optional(),
        customContactUrl: z.string().max(1000).optional(), crp: z.string().max(100).optional() }).parse(body.content || {});
      if (content.photoAssetId) await requireOwnedPortrait(db, auth.account.id, content.photoAssetId);
      const stage = body.stage === 'preview' ? 'preview' : 'draft';
      const lastVer = Number(((await db.get('SELECT MAX(version_number) as m FROM etha_content_versions WHERE project_id = ?', proj.id)))?.m || 0) || 0;
      const verId = randomId('ethav');
      const now = nowIso();
      (await db.run(`
        INSERT INTO etha_content_versions (id, project_id, account_id, version_number, stage, content_json, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, verId, proj.id, auth.account.id, lastVer + 1, stage, JSON.stringify(content), auth.user.id, now));
      return json(res, 201, {
        versionId: verId,
        versionNumber: lastVer + 1,
        stage,
        published: false,
        note: 'Salvo como rascunho/prévia. O site público só muda quando você clicar explicitamente em Publicar atualização.',
      });
    }

    if (method === 'POST' && pathname === '/api/v1/etha/project/publish-staging') {
      await requireProfessional(db, auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = await ensureEthaProject(db, auth.account.id);
      const version = body.versionId
        ? (await db.get('SELECT * FROM etha_content_versions WHERE id = ? AND project_id = ?', body.versionId, proj.id))
        : (await db.get('SELECT * FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1', proj.id));
      if (!version) throw Object.assign(new Error('Nenhuma versão encontrada para publicação em homologação.'), { status: 404, code: 'VERSION_NOT_FOUND' });
      const now = nowIso();
      const ctaMode = body.ctaMode === 'custom' || (body.ctaMode == null && proj.cta_mode === 'custom') ? 'custom' : 'ambo';
      const customContactUrl = body.customContactUrl ?? proj.custom_contact_url;
      (await db.run("UPDATE etha_content_versions SET stage = 'published', published_at = ? WHERE id = ?", now, version.id));
      // Honest DNS status: NEVER fakes verified DNS/SSL!
      const domainStatus = proj.domain_name ? 'pending_owner_dns' : 'staging_only';
      (await db.run(`
        UPDATE etha_projects SET
          status = 'published_staging',
          published_version_id = ?,
          published_at = ?,
          cta_mode = ?,
          custom_contact_url = ?,
          domain_status = ?,
          updated_at = ?
        WHERE id = ?
      `, version.id, now, ctaMode, customContactUrl, domainStatus, now, proj.id));
      return json(res, 200, {
        publishedVersionId: version.id,
        stagingSite: await buildPublicSiteDto(db, auth.account),
        domainNotice: domainStatus === 'pending_owner_dns'
          ? `Publicado no ambiente de homologação. O domínio próprio (${proj.domain_name}) permanece com status "pending_owner_dns" até configuração real de DNS pelo titular.`
          : 'Publicado no ambiente de homologação.',
      });
    }

    // Marcos Operator Dashboard (role='operator' — ZERO clinical access!)
    if (method === 'GET' && pathname === '/api/v1/etha/operator/dashboard') {
      requireOperator(auth);
      const settings = (await db.get("SELECT * FROM etha_settings WHERE id = 'default'"));
      const rawProjects = await db.all(`
        SELECT ep.*, pa.display_name, pa.slug, pa.crp_or_crm
        FROM etha_projects ep JOIN professional_accounts pa ON pa.id = ep.account_id
        ORDER BY ep.updated_at DESC
      `);
      const projects = await Promise.all(rawProjects.map((p) => buildEthaProjectDetail(db, p)));
      const waitlist = (await db.all('SELECT * FROM etha_waitlist ORDER BY created_at DESC'));
      return json(res, 200, { settings, projects, waitlist });
    }

    if (method === 'PATCH' && pathname === '/api/v1/etha/operator/capacity') {
      requireOperator(auth);
      const body = await readJsonBody(req);
      const limit = Math.max(0, Math.min(50, Number(body.capacityLimit)));
      (await db.run("UPDATE etha_settings SET capacity_limit = ?, updated_by_user_id = ?, updated_at = ? WHERE id = 'default'", limit, auth.user.id, nowIso()));
      return json(res, 200, { capacityLimit: limit });
    }

    const opProjAction = pathname.match(/^\/api\/v1\/etha\/operator\/projects\/([^/]+)\/deliver$/);
    if (method === 'POST' && opProjAction) {
      requireOperator(auth);
      const proj = (await db.get('SELECT * FROM etha_projects WHERE id = ?', opProjAction[1]));
      if (!proj) throw Object.assign(new Error('Projeto Etha não encontrado.'), { status: 404, code: 'PROJECT_NOT_FOUND' });
      const body = await readJsonBody(req);
      const now = nowIso();
      let createdVersionId = null;
      if (body.proposalContent) {
        const lastVer = Number(((await db.get('SELECT MAX(version_number) as m FROM etha_content_versions WHERE project_id = ?', proj.id)))?.m || 0) || 0;
        createdVersionId = randomId('ethav');
        (await db.run(`
          INSERT INTO etha_content_versions (id, project_id, account_id, version_number, stage, content_json, created_by_user_id, created_at)
          VALUES (?, ?, ?, ?, 'preview', ?, ?, ?)
        `, createdVersionId, proj.id, proj.account_id, lastVer + 1, JSON.stringify(body.proposalContent), auth.user.id, now));
      }
      if (body.markRevisionApplied) {
        (await db.run("UPDATE etha_revisions SET status = 'applied', resolved_at = ? WHERE project_id = ? AND status = 'submitted'", now, proj.id));
      }
      const nextStatus = body.status || (createdVersionId ? 'awaiting_approval' : proj.status);
      (await db.run('UPDATE etha_projects SET status = ?, blockers_json = COALESCE(?, blockers_json), updated_at = ? WHERE id = ?', nextStatus,
        Array.isArray(body.blockers) ? JSON.stringify(body.blockers) : null,
        now,
        proj.id));
      return json(res, 200, { createdVersionId, project: await buildEthaProjectDetail(db, (await db.get('SELECT * FROM etha_projects WHERE id = ?', proj.id))) });
    }

    // Public Staging Site (Consumed by Helena Duarte site!)
    const pubSiteMatch = pathname.match(/^\/api\/v1\/public\/sites\/([^/]+)$/);
    if (method === 'GET' && pubSiteMatch) {
      const acc = (await db.get('SELECT * FROM professional_accounts WHERE slug = ?', pubSiteMatch[1]));
      if (!acc) throw Object.assign(new Error('Site não encontrado.'), { status: 404, code: 'SITE_NOT_FOUND' });
      const site = await buildPublicSiteDto(db, acc);
      if (!site.publishedAt || !site.versionNumber) throw Object.assign(new Error('Este site ainda não foi publicado.'), { status: 404, code: 'SITE_NOT_PUBLISHED' });
      return json(res, 200, site);
    }

    return json(res, 404, { error: 'Rota não encontrada.', code: 'NOT_FOUND', pathname });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return json(res, 400, { error: 'Dados inválidos.', code: 'VALIDATION_ERROR', issues: err.issues });
    }
    const status = err.status || 500;
    const payload = { error: err.message || 'Erro interno no servidor.', code: err.code || 'INTERNAL_ERROR' };
    if (err.suggestions) payload.suggestions = err.suggestions;
    if (err.product) payload.product = err.product;
    if (err.missingEnvVars) payload.missingEnvVars = err.missingEnvVars;
    return json(res, status, payload);
  }
}

async function activateOrderEntitlementsTx(db, accountId, quote) {
  const now = nowIso();
  const periodEnd = addDaysIso(30);
  for (const prod of quote.selectedProducts || []) {
    (await db.run(`
      INSERT INTO entitlements (id, account_id, product, status, billing_mode, current_period_end, cancelled_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, NULL, ?)
      ON CONFLICT(account_id, product) DO UPDATE SET
        status = 'active',
        billing_mode = excluded.billing_mode,
        current_period_end = excluded.current_period_end,
        cancelled_at = NULL,
        updated_at = excluded.updated_at
    `, randomId('ent'), accountId, prod, quote.billing === 'permanent' ? 'annual' : 'monthly', periodEnd, now));
    if (prod === 'etha') {
      await ensureEthaProject(db, accountId, quote.ethaFormat || 'one_page');
    }
  }
}

async function ensureEthaProject(db, accountId, format = 'one_page') {
  let proj = (await db.get('SELECT * FROM etha_projects WHERE account_id = ?', accountId));
  if (!proj) {
    const id = randomId('etha');
    const now = nowIso();
    (await db.run(`
      INSERT INTO etha_projects (id, account_id, format, status, briefing_step, briefing_json, blockers_json, cta_mode, domain_status, created_at, updated_at)
      VALUES (?, ?, ?, 'briefing', 1, '{}', '["Falta preencher abordagem","Falta anexar fotos principais"]', 'ambo', 'staging_only', ?, ?)
    `, id, accountId, format, now, now));
    proj = (await db.get('SELECT * FROM etha_projects WHERE id = ?', id));
  }
  return proj;
}

async function buildEthaProjectDetail(db, proj) {
  const versions = (await db.all('SELECT * FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC', proj.id)).map((v) => ({
    ...v,
    content: (() => { const c = JSON.parse(v.content_json || '{}'); return { ...c, photoUrl: c.photoAssetId ? `/api/v1/files/${encodeURIComponent(c.photoAssetId)}` : null }; })(),
  }));
  const revisions = (await db.all('SELECT * FROM etha_revisions WHERE project_id = ? ORDER BY round_number ASC', proj.id)).map((r) => ({
    ...r,
    comments: JSON.parse(r.comments_json || '[]'),
  }));
  const fileIds = JSON.parse(proj.attachment_file_ids_json || '[]');
  const attachments = (await Promise.all(fileIds.map((fid) => db.get('SELECT id, original_name, detected_mime, size_bytes, created_at FROM private_files WHERE id = ?', fid)))).filter(Boolean);
  return {
    ...proj,
    briefing: JSON.parse(proj.briefing_json || '{}'),
    blockers: JSON.parse(proj.blockers_json || '[]'),
    attachments,
    versions,
    revisions,
  };
}
