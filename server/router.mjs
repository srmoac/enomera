import { z } from 'zod';
import { COMMERCIAL_CATALOG, calculateSimulatedQuote } from './catalog.mjs';
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
import { getDb, queueDevOutbox, runTransaction, writeAudit } from './db.mjs';
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
import { readPrivateFileBinary, savePrivateFile } from './storage.mjs';

const COOKIE_NAME = 'enomera_sid';
const MAX_BODY_BYTES = 35 * 1024 * 1024; // allows base64-encoded 25 MB ZIP

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (u.protocol === 'https:' && u.hostname.endsWith('.vercel.app')) return true;
    const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (extra.includes(origin)) return true;
  } catch {}
  return false;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
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

function getSessionFromRequest(db, req) {
  const authHeader = req.headers.authorization || '';
  let rawToken = null;
  if (authHeader.startsWith('Bearer ')) rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    const cookies = parseCookies(req);
    rawToken = cookies[COOKIE_NAME] || null;
  }
  if (!rawToken) return null;

  const tokenHash = sha256Hex(rawToken);
  const sess = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
  if (!sess) return null;
  if (sess.revoked_at || Date.parse(sess.expires_at) <= Date.now()) return null;

  const user = db.prepare('SELECT id, email, full_name, role, email_verified_at, mfa_enabled FROM users WHERE id = ?').get(sess.user_id);
  if (!user) return null;

  let account = null;
  let membership = null;
  if (sess.account_id) {
    account = db.prepare('SELECT * FROM professional_accounts WHERE id = ?').get(sess.account_id);
    if (sess.actor_type === 'professional') {
      membership = db.prepare('SELECT * FROM account_memberships WHERE account_id = ? AND user_id = ?').get(sess.account_id, user.id);
    }
  }
  return { session: sess, user, account, membership, rawToken };
}

function issueSession(db, { userId, actorType, accountId = null, patientId = null, ttlMinutes = 60 * 24 }) {
  const rawToken = randomToken(32);
  const id = randomId('ses');
  const now = nowIso();
  const expiresAt = addMinutesIso(ttlMinutes);
  db.prepare(`
    INSERT INTO sessions (id, token_hash, user_id, actor_type, account_id, patient_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sha256Hex(rawToken), userId, actorType, accountId, patientId, expiresAt, now);
  const secure = process.env.VERCEL ? '; Secure; SameSite=None' : '; SameSite=Lax';
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Max-Age=${ttlMinutes * 60}${secure}`;
  return { id, rawToken, expiresAt, cookie };
}

function getAccountEntitlements(db, accountId) {
  const rows = db.prepare('SELECT * FROM entitlements WHERE account_id = ?').all(accountId);
  const now = Date.now();
  const map = { ambo: null, minne: null, etha: null };
  for (const r of rows) {
    let effectiveStatus = r.status;
    if (r.status === 'trial' && r.trial_ends_at && Date.parse(r.trial_ends_at) <= now) {
      effectiveStatus = 'read_only';
      db.prepare("UPDATE entitlements SET status = 'read_only', updated_at = ? WHERE id = ?").run(nowIso(), r.id);
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

function requireProfessional(auth, { product = null, write = false, clinical = false } = {}) {
  requireAuth(auth);
  if (auth.session.actor_type !== 'professional' || !auth.account || !auth.membership) {
    throw Object.assign(new Error('Acesso restrito a profissionais autorizados desta conta.'), { status: 403, code: 'FORBIDDEN_ACTOR' });
  }
  if (clinical && !auth.membership.can_access_clinical) {
    throw Object.assign(new Error('Seu vínculo nesta conta não autoriza acesso ao conteúdo clínico.'), { status: 403, code: 'FORBIDDEN_CLINICAL' });
  }
  if (product) {
    const ents = getAccountEntitlements(getDb(), auth.account.id);
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
  if (auth.user.role !== 'operator' && auth.session.actor_type !== 'operator') {
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

function buildPublicSiteDto(db, account) {
  const ents = getAccountEntitlements(db, account.id);
  const amboActive = Boolean(ents.ambo?.canWrite);
  const proj = db.prepare('SELECT * FROM etha_projects WHERE account_id = ?').get(account.id);
  let published = null;
  if (proj?.published_version_id) {
    const v = db.prepare("SELECT * FROM etha_content_versions WHERE id = ? AND stage = 'published'").get(proj.published_version_id);
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
    ctaLabel: published?.content?.ctaLabel || (ctaMode === 'ambo' ? 'Solicitar primeira consulta' : 'Entrar em contato'),
    ctaMode,
    amboActive,
    amboProfileSlug: amboActive ? account.slug : null,
    customContactUrl: ctaMode === 'custom' ? (proj?.custom_contact_url || published?.content?.customContactUrl || '') : null,
    authorship: 'Site por Etha',
    versionNumber: published?.versionNumber || null,
    publishedAt: published?.publishedAt || null,
    domainStatus: proj?.domain_status || 'staging_only',
  };
}

function issueVerificationCode(db, { purpose, targetContact, userId = null, accountId = null, patientId = null, subject, ttlMinutes = 15 }) {
  const code = randomDigits(6);
  const id = randomId('ver');
  const now = nowIso();
  const expiresAt = addMinutesIso(ttlMinutes);
  db.prepare(`
    INSERT INTO verification_tokens (id, purpose, target_contact, user_id, account_id, patient_id, code_hash, attempts, max_attempts, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 5, ?, ?)
  `).run(id, purpose, targetContact.toLowerCase(), userId, accountId, patientId, sha256Hex(code), expiresAt, now);

  const delivery = queueDevOutbox(db, {
    channel: targetContact.includes('@') ? 'email' : 'whatsapp',
    recipient: targetContact,
    subject,
    bodyPreview: `Seu código de uso único (expira em ${ttlMinutes} min): ${code}`,
    purpose,
  });

  return { tokenId: id, expiresAt, delivery, devCode: process.env.NODE_ENV === 'production' && process.env.SMTP_URL ? undefined : code };
}

function consumeVerificationCode(db, { purpose, targetContact, code }) {
  const row = db.prepare(`
    SELECT * FROM verification_tokens
    WHERE purpose = ? AND target_contact = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(purpose, targetContact.toLowerCase());
  if (!row) throw Object.assign(new Error('Nenhum código pendente encontrado. Solicite um novo código.'), { status: 400, code: 'CODE_NOT_FOUND' });
  if (Date.parse(row.expires_at) <= Date.now()) {
    throw Object.assign(new Error('Este código expirou. Solicite um reenvio para continuar.'), { status: 410, code: 'CODE_EXPIRED' });
  }
  if (row.attempts >= row.max_attempts) {
    throw Object.assign(new Error('Limite de tentativas atingido. Solicite um novo código.'), { status: 429, code: 'CODE_RATE_LIMITED' });
  }
  if (row.code_hash !== sha256Hex(String(code || '').trim())) {
    db.prepare('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('Código incorreto. Confira os 6 dígitos e tente novamente.'), { status: 400, code: 'CODE_INVALID' });
  }
  db.prepare('UPDATE verification_tokens SET consumed_at = ? WHERE id = ?').run(nowIso(), row.id);
  return row;
}

export async function handleApiRequest(req, res, customDb = null) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const db = customDb || getDb();
  seedDatabase(db);

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const auth = getSessionFromRequest(db, req);

  try {
    // ── HEALTH & CATALOG ──────────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/v1/health') {
      return json(res, 200, { ok: true, service: 'enomera-core-api', catalogVersion: COMMERCIAL_CATALOG.version, time: nowIso() });
    }
    if (method === 'GET' && pathname === '/api/v1/catalog') {
      return json(res, 200, COMMERCIAL_CATALOG);
    }
    if (method === 'POST' && pathname === '/api/v1/catalog/quote') {
      const body = await readJsonBody(req);
      const quote = calculateSimulatedQuote(body);
      return json(res, 200, quote);
    }

    // ── AUTHENTICATION & VERIFICATION ─────────────────────────────────
    if (method === 'POST' && pathname === '/api/v1/auth/signup') {
      const schema = z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        crpOrCrm: z.string().optional().default(''),
        specialty: z.enum(['Psicologia', 'Psiquiatria']).optional().default('Psicologia'),
      });
      const data = schema.parse(await readJsonBody(req));
      const normEmail = data.email.trim().toLowerCase();
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normEmail);
      if (exists) throw Object.assign(new Error('Já existe uma conta com este e-mail. Entre para recuperar sua combinação.'), { status: 409, code: 'EMAIL_EXISTS' });

      const userId = randomId('usr');
      const accountId = randomId('acc');
      const now = nowIso();
      const pwd = hashPassword(data.password);
      let slug = slugify(data.fullName);
      if (db.prepare('SELECT id FROM professional_accounts WHERE slug = ?').get(slug)) {
        slug = `${slug}-${randomDigits(4)}`;
      }

      runTransaction(db, () => {
        db.prepare(`
          INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'professional', NULL, 1, ?, ?)
        `).run(userId, normEmail, pwd.hash, pwd.salt, data.fullName.trim(), now, now);

        db.prepare(`
          INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, crp_or_crm, specialty, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(accountId, userId, slug, data.fullName.trim(), data.crpOrCrm.trim(), data.specialty, now, now);

        db.prepare(`
          INSERT INTO account_memberships (id, account_id, user_id, role, can_access_clinical, created_at)
          VALUES (?, ?, ?, 'owner', 1, ?)
        `).run(randomId('mem'), accountId, userId, now);

        // Sensible default availability Mon-Fri 09:00-18:00 (editable by professional)
        for (const wd of [1, 2, 3, 4, 5]) {
          db.prepare(`
            INSERT INTO availability_rules (id, account_id, weekday, start_time, end_time, modality, active, created_at)
            VALUES (?, ?, ?, '09:00', '18:00', 'both', 1, ?)
          `).run(randomId('avr'), accountId, wd, now);
        }
        writeAudit(db, { actorUserId: userId, actorType: 'professional', accountId, action: 'auth.signup', resourceType: 'user', resourceId: userId });
      });

      const ver = issueVerificationCode(db, {
        purpose: 'email_verify',
        targetContact: normEmail,
        userId,
        accountId,
        subject: 'Verifique seu e-mail na Enomera',
      });
      const sess = issueSession(db, { userId, actorType: 'professional', accountId });

      return json(res, 201, {
        user: { id: userId, email: normEmail, fullName: data.fullName.trim(), emailVerified: false, role: 'professional' },
        account: { id: accountId, slug, displayName: data.fullName.trim(), crpOrCrm: data.crpOrCrm.trim(), specialty: data.specialty },
        entitlements: getAccountEntitlements(db, accountId),
        sessionToken: sess.rawToken,
        expiresAt: sess.expiresAt,
        verification: { required: true, expiresAt: ver.expiresAt, delivery: ver.delivery },
      }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/verify-email') {
      const body = await readJsonBody(req);
      const email = String(body.email || auth?.user?.email || '').trim().toLowerCase();
      const row = consumeVerificationCode(db, { purpose: 'email_verify', targetContact: email, code: body.code });
      const now = nowIso();
      db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.user_id);
      writeAudit(db, { actorUserId: row.user_id, actorType: 'professional', accountId: row.account_id, action: 'auth.verify_email', resourceType: 'user', resourceId: row.user_id });
      return json(res, 200, { verified: true, verifiedAt: now });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/resend-verification') {
      const body = await readJsonBody(req);
      const email = String(body.email || auth?.user?.email || '').trim().toLowerCase();
      const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (!u) return json(res, 200, { ok: true, delivery: { deliveryStatus: 'ignored_unknown_account' } });
      const ver = issueVerificationCode(db, { purpose: 'email_verify', targetContact: email, userId: u.id, subject: 'Novo código de verificação · Enomera' });
      return json(res, 200, { ok: true, expiresAt: ver.expiresAt, delivery: ver.delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/login') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!u || !verifyPassword(password, u.password_hash, u.password_salt)) {
        writeAudit(db, { actorType: 'anonymous', action: 'auth.login', resourceType: 'user', outcome: 'deny', meta: { email } });
        throw Object.assign(new Error('E-mail ou senha inválidos.'), { status: 401, code: 'INVALID_CREDENTIALS' });
      }
      let account = null;
      if (u.role === 'professional') {
        account = db.prepare(`
          SELECT pa.* FROM professional_accounts pa
          JOIN account_memberships am ON am.account_id = pa.id
          WHERE am.user_id = ? LIMIT 1
        `).get(u.id);
      }
      const sess = issueSession(db, { userId: u.id, actorType: u.role, accountId: account?.id || null });
      writeAudit(db, { actorUserId: u.id, actorType: u.role, accountId: account?.id || null, action: 'auth.login', resourceType: 'session', resourceId: sess.id });
      return json(res, 200, {
        user: { id: u.id, email: u.email, fullName: u.full_name, role: u.role, emailVerified: Boolean(u.email_verified_at) },
        account: account ? { id: account.id, slug: account.slug, displayName: account.display_name, crpOrCrm: account.crp_or_crm, specialty: account.specialty } : null,
        entitlements: account ? getAccountEntitlements(db, account.id) : null,
        sessionToken: sess.rawToken,
        expiresAt: sess.expiresAt,
      }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/logout') {
      const body = await readJsonBody(req);
      if (auth) {
        const now = nowIso();
        if (body.revokeAll) {
          db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, auth.user.id);
        } else {
          db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now, auth.session.id);
        }
        writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: auth.session.account_id, action: 'auth.logout', resourceType: 'session', resourceId: auth.session.id });
      }
      return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0` });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/recovery/request') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (!u) {
        return json(res, 200, { ok: true, message: 'Se o e-mail estiver cadastrado, um código de recuperação de uso único foi gerado.' });
      }
      const ver = issueVerificationCode(db, { purpose: 'password_reset', targetContact: email, userId: u.id, subject: 'Recuperação de acesso · Enomera' });
      return json(res, 200, { ok: true, expiresAt: ver.expiresAt, delivery: ver.delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/recovery/confirm') {
      const body = await readJsonBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 8) throw Object.assign(new Error('A nova senha precisa ter ao menos 8 caracteres.'), { status: 400, code: 'PASSWORD_TOO_SHORT' });
      const row = consumeVerificationCode(db, { purpose: 'password_reset', targetContact: email, code: body.code });
      const pwd = hashPassword(newPassword);
      const now = nowIso();
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(pwd.hash, pwd.salt, now, row.user_id);
      // Revoke all old sessions on password reset!
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now, row.user_id);
      writeAudit(db, { actorUserId: row.user_id, actorType: 'professional', action: 'auth.password_reset', resourceType: 'user', resourceId: row.user_id });
      return json(res, 200, { ok: true, message: 'Senha redefinida e sessões anteriores encerradas.' });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/stepup/request') {
      requireProfessional(auth);
      const ver = issueVerificationCode(db, {
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
      requireProfessional(auth);
      const body = await readJsonBody(req);
      consumeVerificationCode(db, { purpose: 'clinical_stepup', targetContact: auth.user.email, code: body.code });
      const now = nowIso();
      db.prepare('UPDATE sessions SET mfa_verified_at = ? WHERE id = ?').run(now, auth.session.id);
      writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'auth.stepup_verified', resourceType: 'session', resourceId: auth.session.id });
      return json(res, 200, { verified: true, mfaVerifiedAt: now });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/handoff') {
      requireAuth(auth);
      const body = await readJsonBody(req);
      const targetOrigin = String(body.targetOrigin || '');
      if (!isAllowedOrigin(targetOrigin)) {
        throw Object.assign(new Error('Origem de destino não autorizada para passagem autenticada.'), { status: 400, code: 'INVALID_TARGET_ORIGIN' });
      }
      const code = `hc_${randomToken(24)}`;
      const expiresAt = addMinutesIso(1); // 60 seconds single-use
      db.prepare(`
        INSERT INTO auth_handoff_codes (id, code_hash, session_id, target_origin, return_path, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomId('hnd'), sha256Hex(code), auth.session.id, targetOrigin, String(body.returnPath || '/'), expiresAt, nowIso());
      writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: auth.session.account_id, action: 'auth.handoff_issue', resourceType: 'handoff', meta: { targetOrigin } });
      return json(res, 200, { handoffCode: code, expiresAt, targetOrigin });
    }

    if (method === 'POST' && pathname === '/api/v1/auth/exchange') {
      const body = await readJsonBody(req);
      const code = String(body.handoffCode || '').trim();
      const row = db.prepare('SELECT * FROM auth_handoff_codes WHERE code_hash = ?').get(sha256Hex(code));
      if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now()) {
        throw Object.assign(new Error('Código de passagem inválido ou expirado. Entre novamente pela Enomera.'), { status: 401, code: 'HANDOFF_INVALID' });
      }
      const reqOrigin = req.headers.origin;
      if (reqOrigin && reqOrigin !== row.target_origin) {
        throw Object.assign(new Error('Origem da troca não corresponde ao destino autorizado.'), { status: 403, code: 'HANDOFF_ORIGIN_MISMATCH' });
      }
      const sourceSess = db.prepare('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL').get(row.session_id);
      if (!sourceSess || Date.parse(sourceSess.expires_at) <= Date.now()) {
        throw Object.assign(new Error('Sessão original revogada ou expirada.'), { status: 401, code: 'SESSION_REVOKED' });
      }
      db.prepare('UPDATE auth_handoff_codes SET consumed_at = ? WHERE id = ?').run(nowIso(), row.id);
      const newSess = issueSession(db, {
        userId: sourceSess.user_id,
        actorType: sourceSess.actor_type,
        accountId: sourceSess.account_id,
        patientId: sourceSess.patient_id,
      });
      if (sourceSess.mfa_verified_at) {
        db.prepare('UPDATE sessions SET mfa_verified_at = ? WHERE id = ?').run(sourceSess.mfa_verified_at, newSess.id);
      }
      const user = db.prepare('SELECT id, email, full_name, role, email_verified_at FROM users WHERE id = ?').get(sourceSess.user_id);
      const account = sourceSess.account_id ? db.prepare('SELECT * FROM professional_accounts WHERE id = ?').get(sourceSess.account_id) : null;
      return json(res, 200, {
        user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, emailVerified: Boolean(user.email_verified_at) },
        account: account ? { id: account.id, slug: account.slug, displayName: account.display_name, crpOrCrm: account.crp_or_crm, specialty: account.specialty } : null,
        entitlements: account ? getAccountEntitlements(db, account.id) : null,
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
        entitlements: auth.account ? getAccountEntitlements(db, auth.account.id) : null,
      });
    }

    // Dev/Homologation Outbox inspection (ONLY when SMTP is unconfigured — honest inspection for verification flows!)
    if (method === 'GET' && pathname === '/api/v1/dev/outbox') {
      if (process.env.SMTP_URL) {
        throw Object.assign(new Error('Caixa de homologação indisponível com SMTP ativo.'), { status: 403, code: 'OUTBOX_DISABLED' });
      }
      const recipient = url.searchParams.get('recipient');
      if (!recipient) throw Object.assign(new Error('Informe recipient para consultar a caixa de homologação.'), { status: 400, code: 'RECIPIENT_REQUIRED' });
      const rows = db.prepare('SELECT id, channel, recipient, subject, body_preview, purpose, delivery_status, created_at FROM dev_outbox_messages WHERE lower(recipient) = lower(?) ORDER BY created_at DESC LIMIT 10').all(recipient);
      return json(res, 200, {
        notice: 'Caixa de homologação (canal real SMTP/WhatsApp não configurado).',
        messages: rows,
      });
    }

    // ── ENOMERA COMMERCIAL, TRIAL, PILOT, SIMULATED CHECKOUT & PORTAL ──
    if (method === 'POST' && pathname === '/api/v1/commercial/trial/start') {
      requireProfessional(auth);
      const body = await readJsonBody(req);
      const products = (Array.isArray(body.products) ? body.products : ['ambo', 'minne']).filter((p) => ['ambo', 'minne'].includes(p));
      if (products.length === 0) throw Object.assign(new Error('Selecione Ambo e/ou Minne para o teste de 7 dias.'), { status: 400, code: 'INVALID_TRIAL_PRODUCTS' });
      const now = nowIso();
      const trialEndsAt = addDaysIso(7);
      runTransaction(db, () => {
        for (const p of products) {
          db.prepare(`
            INSERT INTO entitlements (id, account_id, product, status, billing_mode, trial_ends_at, updated_at)
            VALUES (?, ?, ?, 'trial', 'trial', ?, ?)
            ON CONFLICT(account_id, product) DO UPDATE SET
              status = CASE WHEN entitlements.status = 'active' THEN 'active' ELSE 'trial' END,
              trial_ends_at = COALESCE(entitlements.trial_ends_at, excluded.trial_ends_at),
              updated_at = excluded.updated_at
          `).run(randomId('ent'), auth.account.id, p, trialEndsAt, now);
        }
        writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'commercial.trial_start', resourceType: 'entitlement', meta: { products } });
      });
      return json(res, 200, { ok: true, trialEndsAt, entitlements: getAccountEntitlements(db, auth.account.id) });
    }

    if (method === 'POST' && pathname === '/api/v1/commercial/pilot/apply') {
      const body = await readJsonBody(req);
      const fullName = String(body.fullName || auth?.user?.full_name || '').trim();
      const email = String(body.email || auth?.user?.email || '').trim().toLowerCase();
      if (!fullName || !email.includes('@')) throw Object.assign(new Error('Informe nome e e-mail válidos para solicitar vaga no piloto.'), { status: 400, code: 'INVALID_PILOT_DATA' });
      const id = randomId('plt');
      db.prepare(`
        INSERT INTO pilot_applications (id, user_id, full_name, email, specialty, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
      `).run(id, auth?.user?.id || null, fullName, email, String(body.specialty || 'Psicologia'), String(body.notes || ''), nowIso());
      return json(res, 201, { id, status: 'received', pilotWeeks: 2, message: 'Interesse no piloto acompanhado de 2 semanas registrado sem cobrança.' });
    }

    if (method === 'POST' && pathname === '/api/v1/commercial/orders') {
      requireProfessional(auth);
      const body = await readJsonBody(req);
      const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || '').trim();
      if (!idempotencyKey) throw Object.assign(new Error('Chave de idempotência obrigatória no checkout simulado.'), { status: 400, code: 'IDEMPOTENCY_REQUIRED' });

      const existing = db.prepare('SELECT * FROM commercial_orders WHERE account_id = ? AND idempotency_key = ?').get(auth.account.id, idempotencyKey);
      if (existing) {
        const attempts = db.prepare('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt_number ASC').all(existing.id);
        return json(res, 200, { order: existing, summary: JSON.parse(existing.summary_json), attempts, entitlements: getAccountEntitlements(db, auth.account.id), idempotentReplay: true });
      }

      const quote = calculateSimulatedQuote({ products: body.products, ethaFormat: body.ethaFormat, mode: 'monthly' });
      const simulatedOutcome = ['approved', 'pending', 'declined'].includes(body.simulatedOutcome) ? body.simulatedOutcome : 'approved';
      const methodUsed = body.method === 'simulated_card' ? 'simulated_card' : 'simulated_pix';

      const result = runTransaction(db, () => {
        const orderId = randomId('ord');
        const receiptCode = `SIM-ENO-${randomDigits(6)}`;
        const now = nowIso();
        db.prepare(`
          INSERT INTO commercial_orders (
            id, account_id, idempotency_key, catalog_version, items_json, due_today_cents,
            recurring_monthly_cents, balance_on_approval_cents, discount_cents, summary_json,
            status, is_simulated, receipt_code, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(
          orderId, auth.account.id, idempotencyKey, quote.catalogVersion, JSON.stringify(quote.selectedProducts),
          quote.dueTodayCents, quote.recurringMonthlyCents, quote.balanceOnApprovalCents, quote.discountCents,
          JSON.stringify(quote), simulatedOutcome, receiptCode, now, now
        );

        const failReason = simulatedOutcome === 'declined'
          ? 'Autorização recusada pelo simulador (nenhum valor real foi cobrado). Sua combinação foi preservada.'
          : null;
        db.prepare(`
          INSERT INTO payment_attempts (id, order_id, attempt_number, method, status, failure_reason, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        `).run(randomId('pay'), orderId, methodUsed, simulatedOutcome, failReason, now, now);

        if (simulatedOutcome === 'approved') {
          activateOrderEntitlementsTx(db, auth.account.id, quote);
        }
        writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'commercial.checkout_simulated', resourceType: 'order', resourceId: orderId, meta: { outcome: simulatedOutcome, products: quote.selectedProducts } });
        return {
          order: db.prepare('SELECT * FROM commercial_orders WHERE id = ?').get(orderId),
          attempts: db.prepare('SELECT * FROM payment_attempts WHERE order_id = ?').all(orderId),
        };
      });

      return json(res, 201, {
        ...result,
        summary: quote,
        entitlements: getAccountEntitlements(db, auth.account.id),
        idempotentReplay: false,
      });
    }

    const orderRetryMatch = pathname.match(/^\/api\/v1\/commercial\/orders\/([^/]+)\/retry$/);
    if (method === 'POST' && orderRetryMatch) {
      requireProfessional(auth);
      const orderId = orderRetryMatch[1];
      const body = await readJsonBody(req);
      const nextOutcome = ['approved', 'pending', 'declined'].includes(body.simulatedOutcome) ? body.simulatedOutcome : 'approved';
      const methodUsed = body.method === 'simulated_card' ? 'simulated_card' : 'simulated_pix';

      const result = runTransaction(db, () => {
        const order = db.prepare('SELECT * FROM commercial_orders WHERE id = ? AND account_id = ?').get(orderId, auth.account.id);
        if (!order) throw Object.assign(new Error('Pedido não encontrado.'), { status: 404, code: 'ORDER_NOT_FOUND' });
        if (order.status === 'approved') {
          return { order, attempts: db.prepare('SELECT * FROM payment_attempts WHERE order_id = ?').all(orderId), alreadyApproved: true };
        }
        const count = db.prepare('SELECT COUNT(*) as c FROM payment_attempts WHERE order_id = ?').get(orderId).c;
        const now = nowIso();
        db.prepare(`
          INSERT INTO payment_attempts (id, order_id, attempt_number, method, status, failure_reason, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomId('pay'), orderId, count + 1, methodUsed, nextOutcome, nextOutcome === 'declined' ? 'Recusado na nova tentativa simulada.' : null, now, now);
        db.prepare('UPDATE commercial_orders SET status = ?, updated_at = ? WHERE id = ?').run(nextOutcome, now, orderId);
        if (nextOutcome === 'approved') {
          activateOrderEntitlementsTx(db, auth.account.id, JSON.parse(order.summary_json));
        }
        return {
          order: db.prepare('SELECT * FROM commercial_orders WHERE id = ?').get(orderId),
          attempts: db.prepare('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt_number ASC').all(orderId),
          alreadyApproved: false,
        };
      });
      return json(res, 200, { ...result, entitlements: getAccountEntitlements(db, auth.account.id) });
    }

    if (method === 'GET' && pathname === '/api/v1/commercial/orders') {
      requireProfessional(auth);
      const orders = db.prepare('SELECT * FROM commercial_orders WHERE account_id = ? ORDER BY created_at DESC').all(auth.account.id).map((o) => ({
        ...o,
        items: JSON.parse(o.items_json),
        summary: JSON.parse(o.summary_json),
        attempts: db.prepare('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt_number ASC').all(o.id),
      }));
      return json(res, 200, { orders, entitlements: getAccountEntitlements(db, auth.account.id) });
    }

    const entCancelMatch = pathname.match(/^\/api\/v1\/commercial\/entitlements\/(ambo|minne|etha)\/(cancel|reactivate)$/);
    if (method === 'POST' && entCancelMatch) {
      requireProfessional(auth);
      const [, product, action] = entCancelMatch;
      const now = nowIso();
      const ent = db.prepare('SELECT * FROM entitlements WHERE account_id = ? AND product = ?').get(auth.account.id, product);
      if (!ent) throw Object.assign(new Error('Serviço não encontrado na conta.'), { status: 404, code: 'ENTITLEMENT_NOT_FOUND' });
      if (action === 'cancel') {
        db.prepare("UPDATE entitlements SET status = 'read_only', cancelled_at = ?, updated_at = ? WHERE id = ?").run(now, now, ent.id);
      } else {
        db.prepare("UPDATE entitlements SET status = 'active', cancelled_at = NULL, current_period_end = ?, updated_at = ? WHERE id = ?").run(addDaysIso(30), now, ent.id);
      }
      writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: `entitlement.${action}`, resourceType: 'entitlement', resourceId: ent.id, meta: { product } });
      return json(res, 200, {
        ok: true,
        entitlements: getAccountEntitlements(db, auth.account.id),
        note: action === 'cancel'
          ? `Serviço ${product} colocado em modo somente leitura/exportação. Os demais serviços permanecem ativos e nenhum dado foi apagado.`
          : `Serviço ${product} reativado com sucesso.`,
      });
    }

    if (method === 'GET' && pathname === '/api/v1/portal/summary') {
      requireProfessional(auth);
      const entitlements = getAccountEntitlements(db, auth.account.id);
      const hasAmbo = Boolean(entitlements.ambo?.canWrite);
      const hasMinne = Boolean(entitlements.minne?.canWrite);
      const hasEtha = Boolean(entitlements.etha?.canReadExport);

      const pendingRequests = (hasAmbo || hasMinne)
        ? db.prepare("SELECT COUNT(*) as c FROM consultation_requests WHERE account_id = ? AND status = 'preference_sent'").get(auth.account.id).c
        : null;
      const confirmedAppointments = (hasAmbo || hasMinne)
        ? db.prepare("SELECT COUNT(*) as c FROM appointments WHERE account_id = ? AND status IN ('confirmed','reschedule_requested')").get(auth.account.id).c
        : null;
      const clinicalDrafts = hasMinne
        ? db.prepare('SELECT COUNT(*) as c FROM clinical_drafts WHERE account_id = ?').get(auth.account.id).c
        : null;
      const ethaProject = hasEtha
        ? db.prepare('SELECT id, format, status, briefing_step, domain_name, domain_status, published_at FROM etha_projects WHERE account_id = ?').get(auth.account.id)
        : null;
      const pendingSyncs = db.prepare("SELECT * FROM sync_events WHERE account_id = ? AND status != 'synced' ORDER BY created_at DESC LIMIT 10").all(auth.account.id);

      let nextAction = { label: 'Escolher serviços ou iniciar teste de 7 dias', product: 'enomera' };
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
      requireProfessional(auth, { clinical: true });
      const patients = db.prepare('SELECT * FROM operational_patients WHERE account_id = ?').all(auth.account.id);
      const appointments = db.prepare('SELECT * FROM appointments WHERE account_id = ?').all(auth.account.id);
      const notes = db.prepare("SELECT * FROM clinical_notes WHERE account_id = ? AND status != 'reverted'").all(auth.account.id).map((n) => ({
        ...n,
        versions: db.prepare('SELECT version_number, author_display_name, blocks_json, change_reason, created_at FROM clinical_note_versions WHERE note_id = ? ORDER BY version_number ASC').all(n.id),
      }));
      writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'account.export', resourceType: 'account', resourceId: auth.account.id });
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
      requireProfessional(auth);
      const rules = db.prepare('SELECT * FROM availability_rules WHERE account_id = ? ORDER BY weekday, start_time').all(auth.account.id);
      const blocks = db.prepare('SELECT * FROM availability_blocks WHERE account_id = ? ORDER BY start_at').all(auth.account.id);
      return json(res, 200, {
        profile: {
          id: auth.account.id,
          slug: auth.account.slug,
          displayName: auth.account.display_name,
          crpOrCrm: auth.account.crp_or_crm,
          specialty: auth.account.specialty,
          bio: auth.account.bio,
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
      requireProfessional(auth);
      const body = await readJsonBody(req);
      const now = nowIso();
      db.prepare(`
        UPDATE professional_accounts SET
          display_name = COALESCE(?, display_name),
          crp_or_crm = COALESCE(?, crp_or_crm),
          specialty = COALESCE(?, specialty),
          bio = COALESCE(?, bio),
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
      `).run(
        body.displayName ?? null, body.crpOrCrm ?? null, body.specialty ?? null, body.bio ?? null, body.city ?? null,
        body.sessionDurationMin ?? null, body.sessionPriceCents ?? null,
        body.modalities ? JSON.stringify(body.modalities) : null,
        body.onlineMeetingUrl ?? null, body.onlineInstructions ?? null, body.onlineUnlockMinutes ?? null,
        body.inPersonAddress ?? null,
        body.uiPreferences ? JSON.stringify(body.uiPreferences) : null,
        now, auth.account.id
      );
      return json(res, 200, { ok: true, updatedAt: now });
    }

    if (method === 'PUT' && pathname === '/api/v1/professional/availability') {
      requireProfessional(auth);
      const body = await readJsonBody(req);
      const now = nowIso();
      runTransaction(db, () => {
        if (Array.isArray(body.rules)) {
          db.prepare('DELETE FROM availability_rules WHERE account_id = ?').run(auth.account.id);
          for (const r of body.rules) {
            db.prepare(`
              INSERT INTO availability_rules (id, account_id, weekday, start_time, end_time, modality, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            `).run(randomId('avr'), auth.account.id, Number(r.weekday), String(r.startTime || '09:00'), String(r.endTime || '18:00'), String(r.modality || 'both'), now);
          }
        }
        if (Array.isArray(body.blocks)) {
          db.prepare('DELETE FROM availability_blocks WHERE account_id = ?').run(auth.account.id);
          for (const b of body.blocks) {
            db.prepare(`
              INSERT INTO availability_blocks (id, account_id, start_at, end_at, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(randomId('avb'), auth.account.id, String(b.startAt), String(b.endAt), String(b.reason || 'Bloqueio'), now);
          }
        }
      });
      return json(res, 200, {
        ok: true,
        slotsPreview: generateAvailableSlots(db, auth.account.id, { daysAhead: 7 }),
      });
    }

    // ── AMBO PUBLIC, PATIENT VERIFIED, INVITATIONS & AMBO SOLO ────────
    const amboPubMatch = pathname.match(/^\/api\/v1\/ambo\/public\/([^/]+)$/);
    if (method === 'GET' && amboPubMatch) {
      const slug = amboPubMatch[1];
      const acc = db.prepare('SELECT * FROM professional_accounts WHERE slug = ?').get(slug);
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      const ents = getAccountEntitlements(db, acc.id);
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
      const acc = db.prepare('SELECT * FROM professional_accounts WHERE slug = ?').get(slug);
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      const ents = getAccountEntitlements(db, acc.id);
      if (!ents.ambo?.canWrite) throw Object.assign(new Error('Agendamento indisponível para este perfil.'), { status: 403, code: 'AMBO_INACTIVE' });

      const body = await readJsonBody(req);
      const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || randomId('idem'));
      const existing = db.prepare('SELECT * FROM consultation_requests WHERE account_id = ? AND idempotency_key = ?').get(acc.id, idempotencyKey);
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

      const candidate = findDuplicatePatientCandidate(db, acc.id, { email, phone, fullName: name });
      const id = randomId('req');
      const protocol = `AMB-${randomDigits(4)}`;
      const now = nowIso();
      db.prepare(`
        INSERT INTO consultation_requests (
          id, account_id, idempotency_key, protocol_code, source, modality, patient_name, patient_email,
          patient_phone, patient_birth, guardian_json, preferences_json, answers_json, status, duplicate_candidate_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ambo', ?, ?, ?, ?, ?, ?, ?, ?, 'preference_sent', ?, ?, ?)
      `).run(
        id, acc.id, idempotencyKey, protocol, body.modality === 'presencial' ? 'presencial' : 'online',
        name, email, phone, String(body.patientBirth || ''),
        body.guardian ? JSON.stringify(body.guardian) : null,
        JSON.stringify(body.preferences || { days: [], periods: [] }),
        JSON.stringify(body.answers || {}),
        candidate?.id || null, now, now
      );

      writeAudit(db, { actorType: 'patient_public', accountId: acc.id, action: 'ambo.request_create', resourceType: 'consultation_request', resourceId: id });
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
      const acc = db.prepare('SELECT * FROM professional_accounts WHERE slug = ?').get(slug);
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      if (!contact) throw Object.assign(new Error('Informe o e-mail ou telefone usado na solicitação.'), { status: 400, code: 'CONTACT_REQUIRED' });

      const pat = db.prepare('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)').get(acc.id, contact, contact);
      const reqRow = db.prepare('SELECT id FROM consultation_requests WHERE account_id = ? AND (lower(patient_email) = ? OR patient_phone = ?)').get(acc.id, contact, contact);
      if (!pat && !reqRow) {
        return json(res, 200, { ok: true, message: 'Se houver solicitação ou cadastro associado a este contato, um código de verificação será gerado.' });
      }
      const ver = issueVerificationCode(db, {
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
      const acc = db.prepare('SELECT * FROM professional_accounts WHERE slug = ?').get(slug);
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });

      const verRow = consumeVerificationCode(db, { purpose: 'patient_access', targetContact: contact, code: body.code });
      if (verRow.account_id !== acc.id) {
        throw Object.assign(new Error('Código não corresponde a este profissional.'), { status: 403, code: 'ACCOUNT_MISMATCH' });
      }

      // Ensure patient identity user exists (role='patient' — NEVER commercial customer!)
      const syntheticEmail = contact.includes('@') ? contact : `pat.${contact.replace(/\D/g, '')}@patient.enomera.invalid`;
      let user = db.prepare('SELECT id FROM users WHERE email = ?').get(syntheticEmail);
      if (!user) {
        const uid = randomId('pusr');
        const pwd = hashPassword(randomToken(24));
        db.prepare(`
          INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'Paciente Verificado', 'patient', ?, 0, ?, ?)
        `).run(uid, syntheticEmail, pwd.hash, pwd.salt, nowIso(), nowIso(), nowIso());
        user = { id: uid };
      }

      const pat = db.prepare('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)').get(acc.id, contact, contact);
      const patientId = pat?.id || `contact:${contact}`;
      const sess = issueSession(db, { userId: user.id, actorType: 'patient', accountId: acc.id, patientId, ttlMinutes: 120 });
      writeAudit(db, { actorUserId: user.id, actorType: 'patient', accountId: acc.id, action: 'ambo.patient_verified', resourceType: 'session', resourceId: sess.id });
      return json(res, 200, { verified: true, sessionToken: sess.rawToken, expiresAt: sess.expiresAt }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'GET' && pathname === '/api/v1/ambo/patient/me') {
      requirePatient(auth);
      const acc = db.prepare('SELECT * FROM professional_accounts WHERE id = ?').get(auth.session.account_id);
      const isContactOnly = auth.session.patient_id.startsWith('contact:');
      const contactVal = isContactOnly ? auth.session.patient_id.slice('contact:'.length) : null;
      const patientRow = isContactOnly
        ? db.prepare('SELECT id, full_name, email, phone FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)').get(acc.id, contactVal, contactVal)
        : db.prepare('SELECT id, full_name, email, phone FROM operational_patients WHERE id = ? AND account_id = ?').get(auth.session.patient_id, acc.id);

      const requests = patientRow
        ? db.prepare('SELECT id, protocol_code, modality, preferences_json, status, appointment_id, created_at, updated_at FROM consultation_requests WHERE account_id = ? AND (patient_id = ? OR lower(patient_email) = lower(?)) ORDER BY created_at DESC').all(acc.id, patientRow.id, patientRow.email)
        : db.prepare('SELECT id, protocol_code, modality, preferences_json, status, appointment_id, created_at, updated_at FROM consultation_requests WHERE account_id = ? AND (lower(patient_email) = ? OR patient_phone = ?) ORDER BY created_at DESC').all(acc.id, contactVal, contactVal);

      const rawAppts = patientRow
        ? db.prepare('SELECT id, modality, start_at, end_at, timezone, status, price_cents, version, updated_at FROM appointments WHERE account_id = ? AND patient_id = ? ORDER BY start_at DESC').all(acc.id, patientRow.id)
        : [];

      const unlockMin = acc.online_unlock_minutes || 15;
      const appointments = rawAppts.map((a) => {
        const reschedules = db.prepare('SELECT id, original_start_at, original_end_at, requested_start_at, requested_end_at, preferences_json, status, created_at FROM reschedule_requests WHERE appointment_id = ? ORDER BY created_at DESC').all(a.id);
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
      });

      return json(res, 200, {
        professional: { slug: acc.slug, displayName: acc.display_name, crpOrCrm: acc.crp_or_crm, specialty: acc.specialty, timezone: acc.timezone },
        patient: patientRow ? { id: patientRow.id, fullName: patientRow.full_name, email: patientRow.email } : { fullName: null, contact: contactVal },
        requests: requests.map((r) => ({ ...r, preferences: JSON.parse(r.preferences_json || '{}') })),
        appointments,
        availableSlots: generateAvailableSlots(db, acc.id, { daysAhead: 14 }).slice(0, 20),
      });
    }

    const patReschedMatch = pathname.match(/^\/api\/v1\/ambo\/patient\/appointments\/([^/]+)\/reschedule$/);
    if (method === 'POST' && patReschedMatch) {
      requirePatient(auth);
      const body = await readJsonBody(req);
      let patientId = auth.session.patient_id;
      if (patientId.startsWith('contact:')) {
        const c = patientId.slice('contact:'.length);
        const p = db.prepare('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)').get(auth.session.account_id, c, c);
        if (!p) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
        patientId = p.id;
      }
      const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || randomId('idem'));
      const resData = requestAppointmentReschedule(db, {
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
        const p = db.prepare('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)').get(auth.session.account_id, c, c);
        patientId = p?.id;
      }
      const resData = cancelAppointmentTx(db, {
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
      requireProfessional(auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const pat = db.prepare('SELECT * FROM operational_patients WHERE id = ? AND account_id = ?').get(body.patientId, auth.account.id);
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      const rawToken = `inv_${randomToken(18)}`;
      const id = randomId('inv');
      const expiresAt = addDaysIso(Number(body.expiresInDays || 7));
      const targetContact = body.targetContact || pat.email || pat.phone;
      db.prepare(`
        INSERT INTO patient_invitations (id, account_id, patient_id, token_hash, channel, target_contact, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(id, auth.account.id, pat.id, sha256Hex(rawToken), body.channel || 'email', targetContact, expiresAt, nowIso());

      const delivery = queueDevOutbox(db, {
        channel: body.channel || 'email',
        recipient: targetContact,
        subject: `Convite para agendar com ${auth.account.display_name} · Ambo`,
        bodyPreview: `Use seu convite (expira em ${expiresAt}): ${rawToken}`,
        purpose: 'ambo_invitation',
      });
      return json(res, 201, { invitationId: id, inviteToken: rawToken, expiresAt, delivery });
    }

    if (method === 'POST' && pathname === '/api/v1/ambo/invitations/verify') {
      const body = await readJsonBody(req);
      const inv = db.prepare('SELECT * FROM patient_invitations WHERE token_hash = ?').get(sha256Hex(String(body.inviteToken || '').trim()));
      if (!inv) throw Object.assign(new Error('Convite inválido.'), { status: 404, code: 'INVITE_NOT_FOUND' });
      if (inv.status === 'used') throw Object.assign(new Error('Este convite já foi utilizado.'), { status: 409, code: 'INVITE_ALREADY_USED' });
      if (inv.status !== 'active' || Date.parse(inv.expires_at) <= Date.now()) {
        throw Object.assign(new Error('Este convite expirou. Peça um reenvio à profissional.'), { status: 410, code: 'INVITE_EXPIRED' });
      }
      const pat = db.prepare('SELECT id, full_name, email FROM operational_patients WHERE id = ?').get(inv.patient_id);
      const acc = db.prepare('SELECT id, slug, display_name, session_price_cents, session_duration_min, timezone FROM professional_accounts WHERE id = ?').get(inv.account_id);
      const syntheticEmail = pat.email || `pat.${pat.id}@patient.enomera.invalid`;
      let u = db.prepare('SELECT id FROM users WHERE email = ?').get(syntheticEmail);
      if (!u) {
        const uid = randomId('pusr');
        const pwd = hashPassword(randomToken(24));
        db.prepare(`
          INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'patient', ?, 0, ?, ?)
        `).run(uid, syntheticEmail, pwd.hash, pwd.salt, pat.full_name, nowIso(), nowIso(), nowIso());
        u = { id: uid };
      }
      const sess = issueSession(db, { userId: u.id, actorType: 'patient', accountId: acc.id, patientId: pat.id, ttlMinutes: 120 });
      return json(res, 200, {
        invitationId: inv.id,
        professional: acc,
        patient: pat,
        availableSlots: generateAvailableSlots(db, acc.id, { daysAhead: 14 }),
        sessionToken: sess.rawToken,
      }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'POST' && pathname === '/api/v1/ambo/invitations/reserve') {
      requirePatient(auth);
      const body = await readJsonBody(req);
      const resData = reserveSlotByInvitation(db, {
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
      requireProfessional(auth, { product: 'ambo', write: false });
      const requests = db.prepare('SELECT * FROM consultation_requests WHERE account_id = ? ORDER BY created_at DESC').all(auth.account.id).map((r) => ({
        ...r,
        preferences: JSON.parse(r.preferences_json || '{}'),
        answers: JSON.parse(r.answers_json || '{}'),
        duplicateCandidate: r.duplicate_candidate_id ? db.prepare('SELECT id, full_name, email, phone, status FROM operational_patients WHERE id = ?').get(r.duplicate_candidate_id) : null,
      }));
      const appointments = db.prepare(`
        SELECT a.*, p.full_name as patient_name, p.email as patient_email
        FROM appointments a JOIN operational_patients p ON p.id = a.patient_id
        WHERE a.account_id = ? ORDER BY a.start_at ASC
      `).all(auth.account.id);
      const reschedules = db.prepare(`
        SELECT r.*, p.full_name as patient_name
        FROM reschedule_requests r JOIN operational_patients p ON p.id = r.patient_id
        WHERE r.account_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC
      `).all(auth.account.id);
      const patients = db.prepare('SELECT id, full_name, email, phone, status, origin FROM operational_patients WHERE account_id = ? ORDER BY full_name').all(auth.account.id);
      const invitations = db.prepare('SELECT id, patient_id, channel, target_contact, status, expires_at, used_at, created_at FROM patient_invitations WHERE account_id = ? ORDER BY created_at DESC LIMIT 20').all(auth.account.id);
      return json(res, 200, {
        account: { id: auth.account.id, slug: auth.account.slug, displayName: auth.account.display_name },
        requests,
        appointments,
        pendingReschedules: reschedules,
        patients,
        invitations,
        availableSlots: generateAvailableSlots(db, auth.account.id, { daysAhead: 14 }),
      });
    }

    const amboProConfirm = pathname.match(/^\/api\/v1\/ambo\/pro\/requests\/([^/]+)\/confirm$/);
    if (method === 'POST' && amboProConfirm) {
      requireProfessional(auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const out = confirmConsultationRequest(db, {
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
      return json(res, out.idempotentReplay ? 200 : 201, out);
    }

    const amboProDecideResch = pathname.match(/^\/api\/v1\/ambo\/pro\/reschedules\/([^/]+)\/decide$/);
    if (method === 'POST' && amboProDecideResch) {
      requireProfessional(auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const out = decideRescheduleRequest(db, {
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
      requireProfessional(auth, { product: 'minne', write: false, clinical: true });
      const entitlements = getAccountEntitlements(db, auth.account.id);
      const patients = db.prepare('SELECT * FROM operational_patients WHERE account_id = ? ORDER BY full_name').all(auth.account.id);
      const appointments = db.prepare(`
        SELECT a.*, p.full_name as patient_name
        FROM appointments a JOIN operational_patients p ON p.id = a.patient_id
        WHERE a.account_id = ? ORDER BY a.start_at ASC
      `).all(auth.account.id);
      const requests = db.prepare('SELECT * FROM consultation_requests WHERE account_id = ? ORDER BY created_at DESC').all(auth.account.id).map((r) => ({
        ...r,
        preferences: JSON.parse(r.preferences_json || '{}'),
        answers: JSON.parse(r.answers_json || '{}'),
        duplicateCandidate: r.duplicate_candidate_id ? db.prepare('SELECT id, full_name, email, phone, status FROM operational_patients WHERE id = ?').get(r.duplicate_candidate_id) : null,
      }));
      const pendingReschedules = db.prepare(`
        SELECT r.*, p.full_name as patient_name
        FROM reschedule_requests r JOIN operational_patients p ON p.id = r.patient_id
        WHERE r.account_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC
      `).all(auth.account.id);
      const drafts = db.prepare(`
        SELECT d.id, d.note_id, d.revision, d.updated_at, n.patient_id, n.appointment_id, p.full_name as patient_name
        FROM clinical_drafts d
        JOIN clinical_notes n ON n.id = d.note_id
        JOIN operational_patients p ON p.id = n.patient_id
        WHERE d.account_id = ? ORDER BY d.updated_at DESC
      `).all(auth.account.id);
      const syncEvents = db.prepare('SELECT * FROM sync_events WHERE account_id = ? ORDER BY created_at DESC LIMIT 15').all(auth.account.id);
      return json(res, 200, {
        account: { id: auth.account.id, slug: auth.account.slug, displayName: auth.account.display_name, crpOrCrm: auth.account.crp_or_crm, specialty: auth.account.specialty },
        entitlements,
        patients,
        appointments,
        requests,
        pendingReschedules,
        drafts,
        availableSlots: generateAvailableSlots(db, auth.account.id, { daysAhead: 14 }),
        syncEvents,
      });
    }

    if (method === 'POST' && pathname === '/api/v1/minne/patients') {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const fullName = String(body.fullName || '').trim();
      if (!fullName) throw Object.assign(new Error('Informe o nome completo do paciente.'), { status: 400, code: 'PATIENT_NAME_REQUIRED' });
      const id = randomId('pat');
      const now = nowIso();
      db.prepare(`
        INSERT INTO operational_patients (id, account_id, full_name, email, phone, birth_date, preferred_contact, status, origin, summary_operational, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'minne_manual', ?, ?, ?)
      `).run(id, auth.account.id, fullName, String(body.email || '').trim().toLowerCase(), String(body.phone || '').trim(), String(body.birthDate || ''), body.preferredContact || 'email', String(body.summary || ''), now, now);
      return json(res, 201, { patient: db.prepare('SELECT * FROM operational_patients WHERE id = ?').get(id) });
    }

    const patArchMatch = pathname.match(/^\/api\/v1\/minne\/patients\/([^/]+)\/(archive|recover)$/);
    if (method === 'POST' && patArchMatch) {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const [, patientId, action] = patArchMatch;
      const p = db.prepare('SELECT id FROM operational_patients WHERE id = ? AND account_id = ?').get(patientId, auth.account.id);
      if (!p) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      const now = nowIso();
      db.prepare('UPDATE operational_patients SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?').run(
        action === 'archive' ? 'archived' : 'active',
        action === 'archive' ? now : null,
        now,
        patientId
      );
      return json(res, 200, { patient: db.prepare('SELECT * FROM operational_patients WHERE id = ?').get(patientId) });
    }

    const minneConfirmMatch = pathname.match(/^\/api\/v1\/minne\/requests\/([^/]+)\/confirm$/);
    if (method === 'POST' && minneConfirmMatch) {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = confirmConsultationRequest(db, {
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
      return json(res, out.idempotentReplay ? 200 : 201, out);
    }

    if (method === 'POST' && pathname === '/api/v1/minne/appointments') {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = createManualAppointment(db, {
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
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = decideRescheduleRequest(db, {
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
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const out = cancelAppointmentTx(db, {
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
      requireProfessional(auth, { product: 'minne', write: false, clinical: true });
      const patientId = patNotesMatch[1];
      const pat = db.prepare('SELECT id, full_name FROM operational_patients WHERE id = ? AND account_id = ?').get(patientId, auth.account.id);
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });

      const notes = db.prepare("SELECT * FROM clinical_notes WHERE account_id = ? AND patient_id = ? AND status != 'reverted' ORDER BY COALESCE(occurred_at, created_at) DESC").all(auth.account.id, patientId).map((n) => {
        const draft = db.prepare('SELECT * FROM clinical_drafts WHERE note_id = ?').get(n.id);
        const versions = db.prepare('SELECT * FROM clinical_note_versions WHERE note_id = ? ORDER BY version_number ASC').all(n.id).map((v) => ({
          ...v,
          blocks: JSON.parse(v.blocks_json),
        }));
        const fileIds = JSON.parse(n.attachment_file_ids_json || '[]');
        const attachments = fileIds.map((fid) => db.prepare('SELECT id, original_name, detected_mime, size_bytes, created_at FROM private_files WHERE id = ? AND account_id = ?').get(fid, auth.account.id)).filter(Boolean);
        return {
          ...n,
          draft: draft ? { ...draft, blocks: JSON.parse(draft.blocks_json) } : null,
          versions,
          attachments,
        };
      });
      return json(res, 200, { patient: pat, notes });
    }

    if (method === 'POST' && pathname === '/api/v1/minne/notes/draft') {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const pat = db.prepare('SELECT id FROM operational_patients WHERE id = ? AND account_id = ?').get(body.patientId, auth.account.id);
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });

      const blocks = Array.isArray(body.blocks) ? body.blocks : [];
      const now = nowIso();
      let noteId = body.noteId || null;

      const out = runTransaction(db, () => {
        if (noteId) {
          const existing = db.prepare('SELECT * FROM clinical_notes WHERE id = ? AND account_id = ?').get(noteId, auth.account.id);
          if (!existing) throw Object.assign(new Error('Registro não encontrado.'), { status: 404, code: 'NOTE_NOT_FOUND' });
        } else {
          noteId = randomId('note');
          db.prepare(`
            INSERT INTO clinical_notes (id, account_id, patient_id, appointment_id, record_origin, occurred_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'minne_session', ?, 'draft', ?, ?)
          `).run(noteId, auth.account.id, pat.id, body.appointmentId || null, body.occurredAt || now, now, now);
        }
        const existingDraft = db.prepare('SELECT * FROM clinical_drafts WHERE note_id = ?').get(noteId);
        if (existingDraft) {
          db.prepare('UPDATE clinical_drafts SET revision = revision + 1, blocks_json = ?, updated_by_user_id = ?, updated_at = ? WHERE note_id = ?').run(JSON.stringify(blocks), auth.user.id, now, noteId);
        } else {
          db.prepare(`
            INSERT INTO clinical_drafts (id, note_id, account_id, revision, base_version_id, blocks_json, updated_by_user_id, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?)
          `).run(randomId('drf'), noteId, auth.account.id, body.baseVersionId || null, JSON.stringify(blocks), auth.user.id, now);
        }
        db.prepare('UPDATE clinical_notes SET updated_at = ? WHERE id = ?').run(now, noteId);
        return {
          noteId,
          draft: db.prepare('SELECT * FROM clinical_drafts WHERE note_id = ?').get(noteId),
        };
      });
      return json(res, 200, { noteId: out.noteId, draft: { ...out.draft, blocks: JSON.parse(out.draft.blocks_json) } });
    }

    const concludeMatch = pathname.match(/^\/api\/v1\/minne\/notes\/([^/]+)\/conclude$/);
    if (method === 'POST' && concludeMatch) {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const noteId = concludeMatch[1];
      const body = await readJsonBody(req);
      const out = runTransaction(db, () => {
        const note = db.prepare('SELECT * FROM clinical_notes WHERE id = ? AND account_id = ?').get(noteId, auth.account.id);
        if (!note) throw Object.assign(new Error('Registro não encontrado.'), { status: 404, code: 'NOTE_NOT_FOUND' });
        const draft = db.prepare('SELECT * FROM clinical_drafts WHERE note_id = ?').get(noteId);
        const blocks = Array.isArray(body.blocks) ? body.blocks : (draft ? JSON.parse(draft.blocks_json) : []);
        const lastVer = db.prepare('SELECT MAX(version_number) as m FROM clinical_note_versions WHERE note_id = ?').get(noteId).m || 0;
        const nextVer = lastVer + 1;
        const verId = randomId('ver');
        const now = nowIso();
        // NEVER overwrites previous versions or original imported metadata/occurred_at!
        db.prepare(`
          INSERT INTO clinical_note_versions (id, note_id, account_id, version_number, author_user_id, author_display_name, blocks_json, change_reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(verId, noteId, auth.account.id, nextVer, auth.user.id, auth.account.display_name, JSON.stringify(blocks), String(body.changeReason || (nextVer === 1 ? 'Conclusão do registro' : `Adendo / revisão v${nextVer}`)), now);
        db.prepare('DELETE FROM clinical_drafts WHERE note_id = ?').run(noteId);
        db.prepare("UPDATE clinical_notes SET status = 'concluded', updated_at = ? WHERE id = ?").run(now, noteId);
        writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'clinical_note.conclude', resourceType: 'clinical_note', resourceId: noteId, meta: { versionNumber: nextVer } });
        return { noteId, versionId: verId, versionNumber: nextVer };
      });
      return json(res, 200, out);
    }

    // ── MINNE 6-MODE IMPORT ENGINE ────────────────────────────────────
    if (method === 'GET' && pathname === '/api/v1/minne/imports/formats') {
      requireProfessional(auth, { product: 'minne', write: false, clinical: true });
      return json(res, 200, { formats: SUPPORTED_IMPORT_FORMATS, maxFileMb: 10, maxZipMb: 25, maxZipEntries: 50 });
    }

    if (method === 'GET' && pathname === '/api/v1/minne/imports/template') {
      requireProfessional(auth, { product: 'minne', write: false, clinical: true });
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
      requireProfessional(auth, { product: 'minne', write: false, clinical: true });
      const batches = db.prepare('SELECT * FROM import_batches WHERE account_id = ? ORDER BY created_at DESC LIMIT 30').all(auth.account.id);
      return json(res, 200, { batches });
    }

    if (method === 'POST' && pathname === '/api/v1/minne/imports/stage') {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
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
      requireProfessional(auth, { product: 'minne', write: false, clinical: true });
      const batch = getImportBatchDetail(db, auth.account.id, impGetMatch[1]);
      if (!batch) throw Object.assign(new Error('Lote de importação não encontrado.'), { status: 404, code: 'BATCH_NOT_FOUND' });
      return json(res, 200, { batch });
    }

    const impItemMatch = pathname.match(/^\/api\/v1\/minne\/imports\/([^/]+)\/items\/([^/]+)$/);
    if (method === 'PATCH' && impItemMatch) {
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const body = await readJsonBody(req);
      const batch = resolveImportItem(db, {
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
      requireProfessional(auth, { product: 'minne', write: true, clinical: true });
      const [, batchId, action] = impActionMatch;
      const body = await readJsonBody(req);
      if (action === 'commit') {
        const resData = commitImportBatch(db, {
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
        return json(res, 200, { batch: cancelImportBatch(db, { accountId: auth.account.id, userId: auth.user.id, batchId }) });
      }
      if (action === 'revert') {
        return json(res, 200, revertImportBatch(db, { accountId: auth.account.id, userId: auth.user.id, batchId }));
      }
    }

    // ── SYNC EVENTS RECOVERY ──────────────────────────────────────────
    if (method === 'GET' && pathname === '/api/v1/sync/events') {
      requireProfessional(auth);
      const events = db.prepare('SELECT * FROM sync_events WHERE account_id = ? ORDER BY created_at DESC LIMIT 20').all(auth.account.id);
      return json(res, 200, { events });
    }

    const syncRetryMatch = pathname.match(/^\/api\/v1\/sync\/events\/([^/]+)\/retry$/);
    if (method === 'POST' && syncRetryMatch) {
      requireProfessional(auth);
      const ev = db.prepare('SELECT * FROM sync_events WHERE id = ? AND account_id = ?').get(syncRetryMatch[1], auth.account.id);
      if (!ev) throw Object.assign(new Error('Evento de sincronização não encontrado.'), { status: 404, code: 'SYNC_NOT_FOUND' });
      const now = nowIso();
      db.prepare("UPDATE sync_events SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?").run(now, ev.id);
      return json(res, 200, { event: db.prepare('SELECT * FROM sync_events WHERE id = ?').get(ev.id) });
    }

    // ── PRIVATE FILES STREAMING (ZERO PUBLIC CLINICAL URLS!) ──────────
    const fileMatch = pathname.match(/^\/api\/v1\/files\/([^/]+)$/);
    if (method === 'GET' && fileMatch) {
      requireAuth(auth);
      const fileRow = db.prepare('SELECT * FROM private_files WHERE id = ?').get(fileMatch[1]);
      if (!fileRow) throw Object.assign(new Error('Arquivo não encontrado.'), { status: 404, code: 'FILE_NOT_FOUND' });

      if (fileRow.scope === 'minne_clinical') {
        // STRICTLY professional with clinical membership on THAT account — NEVER patient or Etha operator!
        if (auth.session.actor_type !== 'professional' || auth.account?.id !== fileRow.account_id || !auth.membership?.can_access_clinical) {
          writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: fileRow.account_id, action: 'file.download', resourceType: 'private_file', resourceId: fileRow.id, outcome: 'deny' });
          throw Object.assign(new Error('Acesso negado ao arquivo clínico privado.'), { status: 403, code: 'FORBIDDEN_CLINICAL_FILE' });
        }
      } else if (fileRow.scope === 'etha_briefing') {
        const isOwner = auth.session.actor_type === 'professional' && auth.account?.id === fileRow.account_id;
        const isOp = auth.user.role === 'operator';
        if (!isOwner && !isOp) {
          throw Object.assign(new Error('Acesso negado ao anexo do briefing.'), { status: 403, code: 'FORBIDDEN_BRIEFING_FILE' });
        }
      }

      const bin = readPrivateFileBinary(fileRow);
      if (!bin) throw Object.assign(new Error('Conteúdo do arquivo indisponível no armazenamento.'), { status: 404, code: 'FILE_MISSING_DISK' });
      writeAudit(db, { actorUserId: auth.user.id, actorType: auth.session.actor_type, accountId: fileRow.account_id, action: 'file.download', resourceType: 'private_file', resourceId: fileRow.id, outcome: 'allow' });
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
      const settings = db.prepare("SELECT capacity_limit, updated_at FROM etha_settings WHERE id = 'default'").get();
      const activeCount = db.prepare("SELECT COUNT(*) as c FROM etha_projects WHERE status IN ('briefing','blocked_materials','in_production','awaiting_approval','revision_submitted')").get().c;
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
      db.prepare(`
        INSERT INTO etha_waitlist (id, user_id, full_name, email, desired_format, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)
      `).run(id, auth?.user?.id || null, fullName, email, body.desiredFormat === 'multi_page' ? 'multi_page' : 'one_page', String(body.notes || ''), nowIso());
      return json(res, 201, { id, status: 'waiting', chargedCents: 0, message: 'Você entrou na lista de espera da Etha sem qualquer cobrança.' });
    }

    if (method === 'GET' && pathname === '/api/v1/etha/project') {
      requireProfessional(auth, { product: 'etha', write: false });
      const proj = ensureEthaProject(db, auth.account.id);
      return json(res, 200, buildEthaProjectDetail(db, proj));
    }

    if (method === 'PUT' && pathname === '/api/v1/etha/project/briefing') {
      requireProfessional(auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = ensureEthaProject(db, auth.account.id);
      const existingBriefing = JSON.parse(proj.briefing_json || '{}');
      const mergedBriefing = { ...existingBriefing, ...(body.briefing || {}) };
      const fileIds = JSON.parse(proj.attachment_file_ids_json || '[]');
      if (Array.isArray(body.files)) {
        for (const f of body.files) {
          const saved = savePrivateFile(db, {
            accountId: auth.account.id,
            ownerUserId: auth.user.id,
            scope: 'etha_briefing',
            originalName: f.originalName || 'anexo-briefing.jpg',
            buffer: Buffer.from(String(f.contentBase64 || ''), 'base64'),
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
      db.prepare(`
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
      `).run(
        body.format ?? null, body.briefingStep ?? null, JSON.stringify(mergedBriefing), JSON.stringify(fileIds),
        JSON.stringify(blockers), body.ctaMode ?? null, body.customContactUrl ?? null, body.domainName ?? null,
        nextStatus, now, proj.id
      );
      return json(res, 200, buildEthaProjectDetail(db, db.prepare('SELECT * FROM etha_projects WHERE id = ?').get(proj.id)));
    }

    if (method === 'POST' && pathname === '/api/v1/etha/project/revision') {
      requireProfessional(auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = ensureEthaProject(db, auth.account.id);
      const comments = Array.isArray(body.comments) ? body.comments.filter(Boolean) : [];
      if (comments.length === 0) throw Object.assign(new Error('Adicione ao menos um comentário consolidado para enviar a revisão.'), { status: 400, code: 'EMPTY_REVISION' });
      const existingRound = db.prepare('SELECT COUNT(*) as c FROM etha_revisions WHERE project_id = ?').get(proj.id).c;
      if (existingRound >= 1) throw Object.assign(new Error('A rodada consolidada de revisão incluída no escopo já foi enviada.'), { status: 409, code: 'REVISION_ROUND_USED' });
      const latestPreview = db.prepare("SELECT id FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1").get(proj.id);
      if (!latestPreview) throw Object.assign(new Error('Nenhuma proposta/prévia disponível para revisão ainda.'), { status: 409, code: 'NO_PREVIEW_VERSION' });
      const revId = randomId('erev');
      const now = nowIso();
      db.prepare(`
        INSERT INTO etha_revisions (id, project_id, version_id, round_number, comments_json, status, submitted_by_user_id, created_at)
        VALUES (?, ?, ?, 1, ?, 'submitted', ?, ?)
      `).run(revId, proj.id, latestPreview.id, JSON.stringify(comments), auth.user.id, now);
      db.prepare("UPDATE etha_projects SET status = 'revision_submitted', updated_at = ? WHERE id = ?").run(now, proj.id);
      return json(res, 201, { revisionId: revId, project: buildEthaProjectDetail(db, db.prepare('SELECT * FROM etha_projects WHERE id = ?').get(proj.id)) });
    }

    if (method === 'POST' && pathname === '/api/v1/etha/project/approve') {
      requireProfessional(auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = ensureEthaProject(db, auth.account.id);
      const version = body.versionId
        ? db.prepare('SELECT * FROM etha_content_versions WHERE id = ? AND project_id = ?').get(body.versionId, proj.id)
        : db.prepare('SELECT * FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1').get(proj.id);
      if (!version) throw Object.assign(new Error('Versão não encontrada para aprovação.'), { status: 404, code: 'VERSION_NOT_FOUND' });
      const now = nowIso();
      db.prepare("UPDATE etha_content_versions SET stage = 'approved', approved_by_user_id = ?, approved_at = ? WHERE id = ?").run(auth.user.id, now, version.id);
      db.prepare("UPDATE etha_projects SET status = 'approved', updated_at = ? WHERE id = ?").run(now, proj.id);
      return json(res, 200, { approvedVersionId: version.id, project: buildEthaProjectDetail(db, db.prepare('SELECT * FROM etha_projects WHERE id = ?').get(proj.id)) });
    }

    // Editor saves DRAFT / PREVIEW — NEVER publishes silently!
    if (method === 'POST' && pathname === '/api/v1/etha/project/editor') {
      requireProfessional(auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = ensureEthaProject(db, auth.account.id);
      const stage = body.stage === 'preview' ? 'preview' : 'draft';
      const lastVer = db.prepare('SELECT MAX(version_number) as m FROM etha_content_versions WHERE project_id = ?').get(proj.id).m || 0;
      const verId = randomId('ethav');
      const now = nowIso();
      db.prepare(`
        INSERT INTO etha_content_versions (id, project_id, account_id, version_number, stage, content_json, created_by_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(verId, proj.id, auth.account.id, lastVer + 1, stage, JSON.stringify(body.content || {}), auth.user.id, now);
      return json(res, 201, {
        versionId: verId,
        versionNumber: lastVer + 1,
        stage,
        published: false,
        note: 'Salvo como rascunho/prévia. O site público só muda quando você clicar explicitamente em Publicar atualização.',
      });
    }

    if (method === 'POST' && pathname === '/api/v1/etha/project/publish-staging') {
      requireProfessional(auth, { product: 'etha', write: true });
      const body = await readJsonBody(req);
      const proj = ensureEthaProject(db, auth.account.id);
      const version = body.versionId
        ? db.prepare('SELECT * FROM etha_content_versions WHERE id = ? AND project_id = ?').get(body.versionId, proj.id)
        : db.prepare('SELECT * FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1').get(proj.id);
      if (!version) throw Object.assign(new Error('Nenhuma versão encontrada para publicação em homologação.'), { status: 404, code: 'VERSION_NOT_FOUND' });
      const now = nowIso();
      const ctaMode = body.ctaMode === 'custom' ? 'custom' : 'ambo';
      const customContactUrl = body.customContactUrl ?? proj.custom_contact_url;
      db.prepare("UPDATE etha_content_versions SET stage = 'published', published_at = ? WHERE id = ?").run(now, version.id);
      // Honest DNS status: NEVER fakes verified DNS/SSL!
      const domainStatus = proj.domain_name ? 'pending_owner_dns' : 'staging_only';
      db.prepare(`
        UPDATE etha_projects SET
          status = 'published_staging',
          published_version_id = ?,
          published_at = ?,
          cta_mode = ?,
          custom_contact_url = ?,
          domain_status = ?,
          updated_at = ?
        WHERE id = ?
      `).run(version.id, now, ctaMode, customContactUrl, domainStatus, now, proj.id);
      return json(res, 200, {
        publishedVersionId: version.id,
        stagingSite: buildPublicSiteDto(db, auth.account),
        domainNotice: domainStatus === 'pending_owner_dns'
          ? `Publicado no ambiente de homologação. O domínio próprio (${proj.domain_name}) permanece com status "pending_owner_dns" até configuração real de DNS pelo titular.`
          : 'Publicado no ambiente de homologação.',
      });
    }

    // Marcos Operator Dashboard (role='operator' — ZERO clinical access!)
    if (method === 'GET' && pathname === '/api/v1/etha/operator/dashboard') {
      requireOperator(auth);
      const settings = db.prepare("SELECT * FROM etha_settings WHERE id = 'default'").get();
      const projects = db.prepare(`
        SELECT ep.*, pa.display_name, pa.slug, pa.crp_or_crm
        FROM etha_projects ep JOIN professional_accounts pa ON pa.id = ep.account_id
        ORDER BY ep.updated_at DESC
      `).all().map((p) => buildEthaProjectDetail(db, p));
      const waitlist = db.prepare('SELECT * FROM etha_waitlist ORDER BY created_at DESC').all();
      return json(res, 200, { settings, projects, waitlist });
    }

    if (method === 'PATCH' && pathname === '/api/v1/etha/operator/capacity') {
      requireOperator(auth);
      const body = await readJsonBody(req);
      const limit = Math.max(0, Math.min(50, Number(body.capacityLimit)));
      db.prepare("UPDATE etha_settings SET capacity_limit = ?, updated_by_user_id = ?, updated_at = ? WHERE id = 'default'").run(limit, auth.user.id, nowIso());
      return json(res, 200, { capacityLimit: limit });
    }

    const opProjAction = pathname.match(/^\/api\/v1\/etha\/operator\/projects\/([^/]+)\/deliver$/);
    if (method === 'POST' && opProjAction) {
      requireOperator(auth);
      const proj = db.prepare('SELECT * FROM etha_projects WHERE id = ?').get(opProjAction[1]);
      if (!proj) throw Object.assign(new Error('Projeto Etha não encontrado.'), { status: 404, code: 'PROJECT_NOT_FOUND' });
      const body = await readJsonBody(req);
      const now = nowIso();
      let createdVersionId = null;
      if (body.proposalContent) {
        const lastVer = db.prepare('SELECT MAX(version_number) as m FROM etha_content_versions WHERE project_id = ?').get(proj.id).m || 0;
        createdVersionId = randomId('ethav');
        db.prepare(`
          INSERT INTO etha_content_versions (id, project_id, account_id, version_number, stage, content_json, created_by_user_id, created_at)
          VALUES (?, ?, ?, ?, 'preview', ?, ?, ?)
        `).run(createdVersionId, proj.id, proj.account_id, lastVer + 1, JSON.stringify(body.proposalContent), auth.user.id, now);
      }
      if (body.markRevisionApplied) {
        db.prepare("UPDATE etha_revisions SET status = 'applied', resolved_at = ? WHERE project_id = ? AND status = 'submitted'").run(now, proj.id);
      }
      const nextStatus = body.status || (createdVersionId ? 'awaiting_approval' : proj.status);
      db.prepare('UPDATE etha_projects SET status = ?, blockers_json = COALESCE(?, blockers_json), updated_at = ? WHERE id = ?').run(
        nextStatus,
        Array.isArray(body.blockers) ? JSON.stringify(body.blockers) : null,
        now,
        proj.id
      );
      return json(res, 200, { createdVersionId, project: buildEthaProjectDetail(db, db.prepare('SELECT * FROM etha_projects WHERE id = ?').get(proj.id)) });
    }

    // Public Staging Site (Consumed by Helena Duarte site!)
    const pubSiteMatch = pathname.match(/^\/api\/v1\/public\/sites\/([^/]+)$/);
    if (method === 'GET' && pubSiteMatch) {
      const acc = db.prepare('SELECT * FROM professional_accounts WHERE slug = ?').get(pubSiteMatch[1]);
      if (!acc) throw Object.assign(new Error('Site não encontrado.'), { status: 404, code: 'SITE_NOT_FOUND' });
      return json(res, 200, buildPublicSiteDto(db, acc));
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
    return json(res, status, payload);
  }
}

function activateOrderEntitlementsTx(db, accountId, quote) {
  const now = nowIso();
  const periodEnd = addDaysIso(30);
  for (const prod of quote.selectedProducts || []) {
    db.prepare(`
      INSERT INTO entitlements (id, account_id, product, status, billing_mode, current_period_end, cancelled_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, NULL, ?)
      ON CONFLICT(account_id, product) DO UPDATE SET
        status = 'active',
        billing_mode = excluded.billing_mode,
        current_period_end = excluded.current_period_end,
        cancelled_at = NULL,
        updated_at = excluded.updated_at
    `).run(randomId('ent'), accountId, prod, prod === 'etha' ? 'one_time_plus_hosting' : 'monthly', periodEnd, now);
    if (prod === 'etha') {
      ensureEthaProject(db, accountId, quote.ethaFormat || 'one_page');
    }
  }
}

function ensureEthaProject(db, accountId, format = 'one_page') {
  let proj = db.prepare('SELECT * FROM etha_projects WHERE account_id = ?').get(accountId);
  if (!proj) {
    const id = randomId('etha');
    const now = nowIso();
    db.prepare(`
      INSERT INTO etha_projects (id, account_id, format, status, briefing_step, briefing_json, blockers_json, cta_mode, domain_status, created_at, updated_at)
      VALUES (?, ?, ?, 'briefing', 1, '{}', '["Falta preencher abordagem","Falta anexar fotos principais"]', 'ambo', 'staging_only', ?, ?)
    `).run(id, accountId, format, now, now);
    proj = db.prepare('SELECT * FROM etha_projects WHERE id = ?').get(id);
  }
  return proj;
}

function buildEthaProjectDetail(db, proj) {
  const versions = db.prepare('SELECT * FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC').all(proj.id).map((v) => ({
    ...v,
    content: JSON.parse(v.content_json || '{}'),
  }));
  const revisions = db.prepare('SELECT * FROM etha_revisions WHERE project_id = ? ORDER BY round_number ASC').all(proj.id).map((r) => ({
    ...r,
    comments: JSON.parse(r.comments_json || '[]'),
  }));
  const fileIds = JSON.parse(proj.attachment_file_ids_json || '[]');
  const attachments = fileIds.map((fid) => db.prepare('SELECT id, original_name, detected_mime, size_bytes, created_at FROM private_files WHERE id = ?').get(fid)).filter(Boolean);
  return {
    ...proj,
    briefing: JSON.parse(proj.briefing_json || '{}'),
    blockers: JSON.parse(proj.blockers_json || '[]'),
    attachments,
    versions,
    revisions,
  };
}
