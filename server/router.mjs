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
  runTransaction,
  writeAudit,
} from './db.mjs';
import { getMailerStatus, sendTransactionalEmail } from './mailer.mjs';
import { OVERDUE_GRACE_DAYS, cancelProductBilling, getAsaasStatus, handleBillingRoutes } from './asaas.mjs';
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
  declineConsultationRequest,
  findDuplicatePatientCandidate,
  generateAvailableSlots,
  proposeRescheduleByProfessional,
  requestAppointmentReschedule,
  reserveSlotByInvitation,
  respondToProfessionalProposal,
} from './scheduling.mjs';
import { seedDatabase } from './seed.mjs';
import { cancelAccountDeletion, requestAccountDeletion, runRetention } from './retention.mjs';
import { clientIp, contentDispositionAttachment, enforceRateLimit, rateLimitRulesFor, safeHttpsUrl } from './security.mjs';
import { handlePilotRoutes } from './pilot.mjs';
import { getPilotAccess, pilotFreeContract, pilotFreeQuote, PILOT_FREE_UNTIL } from './pilot-free.mjs';
import {
  getStorageBackendStatus,
  readPrivateFileBinary,
  savePrivateFile,
} from './storage.mjs';

const COOKIE_NAME = 'enomera_sid';
// Sessão do paciente em cookie próprio: testar como paciente no mesmo navegador não derruba a sessão do profissional.
const PATIENT_COOKIE_NAME = 'enomera_psid';
const TERMS_VERSION = 'termos-2026-11-26';
const PATIENT_CONSENT_VERSION = 'privacidade-pacientes-2026-11-26';
// Conta inexistente também passa pelo scrypt, para o tempo de resposta não revelar quem tem cadastro.
const DUMMY_PASSWORD = hashPassword('enomera-dummy-password-for-timing');
const MAX_BODY_BYTES = 35 * 1024 * 1024; // allows base64-encoded 25 MB ZIP

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (!isRemoteInfraRequired() && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    const extra = [process.env.ALLOWED_ORIGINS || '', process.env.ENOMERA_AMBO_URL, process.env.ENOMERA_MINNE_URL,
      process.env.ENOMERA_ETHA_URL, process.env.ENOMERA_HELENA_URL, process.env.ENOMERA_PUBLIC_URL]
      .filter(Boolean).flatMap((s) => s.split(',')).map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
    if (extra.includes(origin)) return true;
    // Produtos no mesmo domínio público, por caminho (/agendamento, /consultorio, /site).
    const pub = String(process.env.ENOMERA_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    if (pub && ['agendamento', 'consultorio', 'site'].some((seg) => origin === `${pub}/${seg}`)) return true;
  } catch {}
  return false;
}

// Endereço público único da Enomera (VC-7/VC-9): links de e-mail e de convite sempre saem sobre o
// domínio público (ENOMERA_PUBLIC_URL). Os projetos internos (destino dos rewrites) nunca aparecem.
// Sem a variável (desenvolvimento local), vale a origem da própria requisição.
const CANONICAL_PUBLIC_URL = 'https://enomera.vercel.app';
// Endereços que nunca podem aparecer em link: projetos internos dos produtos e o antigo ambiente de entrega.
const INTERNAL_HOST_RE = /^(ambo|minne|etha)-enomera|^(agendamento|consultorio)-enomera|^enomera-(entrega|painel)/i;

export function publicBaseUrl(req = null) {
  const fixed = String(process.env.ENOMERA_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/]+$/.test(fixed) && !INTERNAL_HOST_RE.test(fixed.replace(/^https?:\/\//, ''))) return fixed;
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim().toLowerCase();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (local && !isRemoteInfraRequired()) return `http://${host}`;
  if (host && !local && /^[a-z0-9.-]+$/.test(host) && !INTERNAL_HOST_RE.test(host)) return `https://${host}`;
  return process.env.VERCEL_ENV === 'production' ? CANONICAL_PUBLIC_URL : '';
}

function agendamentoUrl(req, slug, params = {}) {
  const base = publicBaseUrl(req);
  if (!base) return '';
  const qs = new URLSearchParams({ pro: slug, ...params }).toString();
  return `${base}/agendamento/?${qs}`;
}

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function whenLabel(account, iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: account?.timezone || 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
}

// E-mail do dono da conta (quem recebe os avisos do Agendamento).
async function accountOwnerEmail(db, account) {
  const u = account?.owner_user_id ? await db.get('SELECT email, is_demo FROM users WHERE id = ?', account.owner_user_id) : null;
  const email = String(u?.email || '').trim();
  return email && !/\.invalid$/i.test(email) && !u.is_demo ? email : '';
}

// Avisos por e-mail nunca desfazem a ação principal: falha de envio vira { sent: false }.
async function safeNotify(db, mail) {
  if (!mail.recipient) return { sent: false, recipient: null, reason: 'no_email' };
  try {
    const delivery = await sendTransactionalEmail(db, mail);
    return { sent: Boolean(delivery.sentExternally), recipient: mail.recipient, reason: delivery.sentExternally ? null : delivery.deliveryStatus };
  } catch (err) {
    return { sent: false, recipient: mail.recipient, reason: err.code || 'delivery_failed' };
  }
}

// Novo pedido de consulta: a profissional é avisada (sem dados de saúde no e-mail).
async function notifyProfessionalOfRequest(db, req, account, { protocol }) {
  const base = publicBaseUrl(req);
  const link = base ? `${base}/agendamento/` : '';
  return safeNotify(db, {
    recipient: await accountOwnerEmail(db, account),
    subject: 'Novo pedido de consulta · Agendamento',
    textBody: `Você recebeu um novo pedido de consulta (protocolo ${protocol}).\n\nAbra o Agendamento para ver as preferências de horário e confirmar.${link ? `\n\n${link}` : ''}`,
    purpose: 'ambo_new_request_professional',
  });
}

// Decisão sobre a remarcação: o paciente recebe a nova data ou o aviso de que o horário original continua.
async function notifyPatientOfRescheduleDecision(db, req, account, out, decision) {
  const appt = out?.appointment;
  if (!appt || out?.idempotentReplay) return { sent: false, reason: 'already_notified' };
  const pat = appt.patient_id ? await db.get('SELECT email FROM operational_patients WHERE id = ? AND account_id = ?', appt.patient_id, account.id) : null;
  const recipient = String(pat?.email || '').trim();
  if (!recipient || /\.invalid$/i.test(recipient)) return { sent: false, recipient: null, reason: 'no_email' };
  const link = agendamentoUrl(req, account.slug, { aba: 'acesso' });
  const when = whenLabel(account, appt.start_at);
  const approved = decision === 'approve';
  return safeNotify(db, {
    recipient,
    subject: approved ? `Remarcação confirmada com ${account.display_name} · Agendamento` : `Remarcação não aprovada por ${account.display_name} · Agendamento`,
    textBody: approved
      ? `${account.display_name} confirmou a remarcação. Sua consulta agora é ${when}.${link ? `\n\nAcompanhe em ${link}` : ''}`
      : `${account.display_name} não pôde aprovar a remarcação. Sua consulta continua no horário original: ${when}.${link ? `\n\nPara pedir outro horário, abra ${link}` : ''}`,
    purpose: approved ? 'ambo_reschedule_approved' : 'ambo_reschedule_declined',
  });
}

// Cancelamento ou pedido de remarcação feito pelo paciente: a profissional é avisada.
async function notifyProfessionalOfPatientChange(db, req, account, out, kind) {
  const appt = out?.appointment;
  if (!appt || out?.idempotentReplay) return { sent: false, reason: 'already_notified' };
  const base = publicBaseUrl(req);
  const link = base ? `${base}/agendamento/` : '';
  const when = whenLabel(account, kind === 'reschedule' ? (out.reschedule?.original_start_at || appt.start_at) : appt.start_at);
  return safeNotify(db, {
    recipient: await accountOwnerEmail(db, account),
    subject: kind === 'cancel' ? 'Consulta cancelada pelo paciente · Agendamento' : 'Pedido de remarcação · Agendamento',
    textBody: kind === 'cancel'
      ? `Um paciente cancelou a consulta de ${when}. O horário voltou a ficar livre na sua agenda.${link ? `\n\n${link}` : ''}`
      : `Um paciente pediu para remarcar a consulta de ${when}. A consulta continua no horário original até você decidir.${link ? `\n\n${link}` : ''}`,
    purpose: kind === 'cancel' ? 'ambo_patient_cancelled_professional' : 'ambo_patient_reschedule_professional',
  });
}

// Pagamento em atraso (aviso do Asaas): e-mail único com o prazo da carência.
async function notifyAccountOfOverdue(db, req, { accountId, invoiceUrl, suspendOn }) {
  const account = await db.get('SELECT * FROM professional_accounts WHERE id = ?', accountId);
  if (!account) return { sent: false, reason: 'no_account' };
  const base = publicBaseUrl(req);
  return safeNotify(db, {
    recipient: await accountOwnerEmail(db, account),
    subject: 'Pagamento em atraso · Enomera',
    textBody: `O pagamento da sua assinatura Enomera está em atraso.\n\nSeus serviços continuam funcionando até ${formatDateBr(suspendOn)}. Depois dessa data, ficam só para leitura e exportação até o pagamento ser confirmado. Nenhum dado é apagado.${invoiceUrl ? `\n\nPagar agora: ${invoiceUrl}` : ''}${base ? `\n\nVer a cobrança no portal: ${base}/portal` : ''}`,
    purpose: 'billing_overdue_notice',
  });
}

// Aviso ao paciente quando a solicitação é confirmada. O envio é à parte da confirmação:
// se o e-mail falhar, a consulta continua confirmada e a resposta diz que o aviso não saiu.
async function notifyPatientOfConfirmation(db, req, account, out) {
  const recipient = String(out?.request?.patient_email || '').trim();
  if (!recipient || out?.idempotentReplay || !out?.appointment) return { sent: false, recipient: recipient || null, reason: recipient ? 'already_notified' : 'no_email' };
  const tz = account.timezone || 'America/Sao_Paulo';
  const when = new Date(out.appointment.start_at).toLocaleString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  const modality = out.appointment.modality === 'presencial' ? 'presencial' : 'online';
  const link = agendamentoUrl(req, account.slug);
  try {
    const delivery = await sendTransactionalEmail(db, {
      recipient,
      subject: `Consulta confirmada com ${account.display_name} · Agendamento`,
      textBody: `${account.display_name} confirmou sua consulta ${modality}: ${when}.${link ? ` Acompanhe ou peça remarcação em ${link}` : ''}`,
      htmlBody: `<p><b>${escHtml(account.display_name)}</b> confirmou sua consulta ${modality}.</p><p><b>${escHtml(when)}</b></p>${link ? `<p><a href="${escHtml(link)}">Acompanhar ou pedir remarcação no Agendamento</a></p>` : ''}`,
      purpose: 'ambo_request_confirmed',
    });
    return { sent: Boolean(delivery.sentExternally), recipient, reason: delivery.sentExternally ? null : delivery.deliveryStatus };
  } catch (err) {
    return { sent: false, recipient, reason: err.code || 'delivery_failed' };
  }
}

// Aviso ao paciente quando a profissional cancela uma consulta (feedback do piloto, 23 nov):
// mesmo formato da confirmação. Falha no envio não desfaz o cancelamento.
async function notifyPatientOfCancellation(db, req, account, out) {
  const appt = out?.appointment;
  if (!appt || out?.idempotentReplay) return { sent: false, reason: 'already_notified' };
  let recipient = '';
  try {
    const pat = appt.patient_id ? await db.get('SELECT email FROM operational_patients WHERE id = ? AND account_id = ?', appt.patient_id, account.id) : null;
    recipient = String(pat?.email || '').trim();
  } catch {}
  if (!recipient || /@patient\.enomera\.invalid$/i.test(recipient)) return { sent: false, recipient: null, reason: 'no_email' };
  const tz = account.timezone || 'America/Sao_Paulo';
  const when = new Date(appt.start_at).toLocaleString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  const link = agendamentoUrl(req, account.slug);
  try {
    const delivery = await sendTransactionalEmail(db, {
      recipient,
      subject: `Consulta cancelada com ${account.display_name} · Agendamento`,
      textBody: `${account.display_name} cancelou a consulta de ${when}.${link ? ` Para escolher outro horário, abra ${link}` : ''}`,
      htmlBody: `<p><b>${escHtml(account.display_name)}</b> cancelou a consulta de <b>${escHtml(when)}</b>.</p>${link ? `<p><a href="${escHtml(link)}">Escolher outro horário no Agendamento</a></p>` : ''}<p>Este e-mail serve como comprovante do cancelamento.</p>`,
      purpose: 'ambo_appointment_cancelled',
    });
    return { sent: Boolean(delivery.sentExternally), recipient, reason: delivery.sentExternally ? null : delivery.deliveryStatus };
  } catch (err) {
    return { sent: false, recipient, reason: err.code || 'delivery_failed' };
  }
}

// E-mail do paciente de uma consulta (cadastro) ou de um pedido; endereços internos nunca recebem.
async function patientEmailOf(db, account, { patientId = null, fallback = '' } = {}) {
  let email = '';
  if (patientId) {
    const pat = await db.get('SELECT email FROM operational_patients WHERE id = ? AND account_id = ?', patientId, account.id);
    email = String(pat?.email || '').trim();
  }
  if (!email) email = String(fallback || '').trim();
  return email && !/@patient\.enomera\.invalid$/i.test(email) ? email : '';
}

// Pedido recusado pela profissional: a pessoa recebe o aviso e, se houver, a mensagem.
async function notifyPatientOfDecline(db, req, account, out) {
  const r = out?.request;
  if (!r || out?.idempotentReplay) return { sent: false, reason: 'already_notified' };
  const recipient = await patientEmailOf(db, account, { patientId: r.patient_id, fallback: r.patient_email });
  if (!recipient) return { sent: false, recipient: null, reason: 'no_email' };
  const msg = String(r.decline_message || '').trim();
  return safeNotify(db, {
    recipient,
    subject: `Seu pedido de consulta com ${account.display_name} · Agendamento`,
    textBody: `${account.display_name} não vai conseguir atender o seu pedido de primeira consulta (protocolo ${r.protocol_code}).${msg ? `\n\nMensagem de ${account.display_name}: "${msg}"` : ''}\n\nNenhum horário foi reservado e nada foi cobrado.`,
    purpose: 'ambo_request_declined',
  });
}

// Proposta de outro horário feita pela profissional: o paciente decide no Agendamento.
async function notifyPatientOfProposal(db, req, account, out) {
  const rsc = out?.reschedule;
  if (!rsc || out?.idempotentReplay) return { sent: false, reason: 'already_notified' };
  const recipient = await patientEmailOf(db, account, { patientId: rsc.patient_id });
  if (!recipient) return { sent: false, recipient: null, reason: 'no_email' };
  const link = agendamentoUrl(req, account.slug, { aba: 'acesso' });
  const reason = String(rsc.reason || '').trim();
  return safeNotify(db, {
    recipient,
    subject: `${account.display_name} propôs outro horário · Agendamento`,
    textBody: `${account.display_name} propôs mudar a consulta de ${whenLabel(account, rsc.original_start_at)} para ${whenLabel(account, rsc.requested_start_at)}.${reason ? `\n\nMotivo: "${reason}"` : ''}\n\nSeu horário atual continua valendo até você responder.${link ? `\n\nPara aceitar ou manter o horário atual, abra ${link}` : ''}`,
    purpose: 'ambo_reschedule_proposed',
  });
}

// Resposta do paciente à proposta: a profissional é avisada.
async function notifyProfessionalOfProposalAnswer(db, req, account, out, decision) {
  if (!out?.appointment || out?.idempotentReplay) return { sent: false, reason: 'already_notified' };
  const base = publicBaseUrl(req);
  const link = base ? `${base}/agendamento/` : '';
  const accepted = decision === 'accept';
  return safeNotify(db, {
    recipient: await accountOwnerEmail(db, account),
    subject: accepted ? 'Novo horário aceito · Agendamento' : 'Proposta de horário recusada · Agendamento',
    textBody: accepted
      ? `O paciente aceitou o novo horário. A consulta agora é ${whenLabel(account, out.appointment.start_at)}.${link ? `\n\n${link}` : ''}`
      : `O paciente preferiu manter o horário atual: ${whenLabel(account, out.appointment.start_at)}.${link ? `\n\n${link}` : ''}`,
    purpose: accepted ? 'ambo_proposal_accepted_professional' : 'ambo_proposal_declined_professional',
  });
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

// O corpo é lido uma vez e guardado: o limite de tentativas precisa do e-mail antes da rota.
function readJsonBody(req) {
  if (!req.__enoBodyPromise) req.__enoBodyPromise = readJsonBodyOnce(req);
  return req.__enoBodyPromise;
}

async function readJsonBodyOnce(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  // sendBeacon/text-plain (rastreador do piloto): a Vercel entrega o corpo já lido como texto.
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const rawBody = String(req.body).trim();
    if (!rawBody) return {};
    try { return JSON.parse(rawBody); } catch { throw Object.assign(new Error('JSON inválido no corpo da requisição.'), { status: 400, code: 'INVALID_JSON' }); }
  }
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

async function getSessionFromRequest(db, req, pathname = '') {
  const authHeader = req.headers.authorization || '';
  let rawToken = null;
  if (authHeader.startsWith('Bearer ')) rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    const cookies = parseCookies(req);
    // Rotas da área do paciente leem primeiro o cookie do paciente; as demais, o do profissional.
    const patientRoute = /^\/api\/v1\/ambo\/(patient\/|invitations\/reserve$)/.test(pathname);
    rawToken = (patientRoute ? (cookies[PATIENT_COOKIE_NAME] || cookies[COOKIE_NAME]) : (cookies[COOKIE_NAME] || cookies[PATIENT_COOKIE_NAME])) || null;
  }
  if (!rawToken) return null;

  const tokenHash = sha256Hex(rawToken);
  const sess = (await db.get('SELECT * FROM sessions WHERE token_hash = ?', tokenHash));
  if (!sess) return null;
  if (sess.revoked_at || Date.parse(sess.expires_at) <= Date.now()) return null;

  const user = (await db.get('SELECT id, email, full_name, role, email_verified_at, mfa_enabled, terms_accepted_at, terms_version FROM users WHERE id = ?', sess.user_id));
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

async function issueSession(db, { userId, actorType, accountId = null, patientId = null, ttlMinutes = 60 * 24, verifiedByCode = false }) {
  const rawToken = randomToken(32);
  const id = randomId('ses');
  const now = nowIso();
  const expiresAt = addMinutesIso(ttlMinutes);
  (await db.run(`
    INSERT INTO sessions (id, token_hash, user_id, actor_type, account_id, patient_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, id, sha256Hex(rawToken), userId, actorType, accountId, patientId, expiresAt, now));
  // Entrou com código enviado ao e-mail: a posse do e-mail já está comprovada nesta sessão.
  if (verifiedByCode) await db.run('UPDATE sessions SET mfa_verified_at = ? WHERE id = ?', now, id);
  const secure = process.env.VERCEL ? '; Secure; SameSite=None' : '; SameSite=Lax';
  const cookie = `${actorType === 'patient' ? PATIENT_COOKIE_NAME : COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Max-Age=${ttlMinutes * 60}${secure}`;
  return { id, rawToken, expiresAt, cookie };
}

// Situação efetiva de cada serviço. Nada fica "ativo para sempre":
// - teste (trial) vencido → só leitura;
// - cancelado com período pago (cancelled_grace) → só leitura quando o período termina;
// - ativo com período vencido → só leitura depois da carência de 7 dias (cobre atraso de
//   pagamento e aviso do Asaas perdido). Sem data de fim (como em contas antigas) ou em conta de demonstração, não expira.
async function getAccountEntitlements(db, accountId) {
  const rows = (await db.all('SELECT * FROM entitlements WHERE account_id = ?', accountId));
  const now = Date.now();
  const graceMs = OVERDUE_GRACE_DAYS * 86_400_000;
  const isDemo = rows.length ? Boolean((await db.get('SELECT is_demo_sandbox FROM professional_accounts WHERE id = ?', accountId))?.is_demo_sandbox) : false;
  const map = { ambo: null, minne: null, etha: null };
  for (const r of rows) {
    let effectiveStatus = r.status;
    const periodEnd = r.current_period_end ? periodEndMs(r.current_period_end) : NaN;
    const expired =
      (r.status === 'trial' && r.trial_ends_at && Date.parse(r.trial_ends_at) <= now)
      || (r.status === 'cancelled_grace' && (!Number.isFinite(periodEnd) || periodEnd <= now))
      || (!isDemo && r.status === 'active' && Number.isFinite(periodEnd) && periodEnd + graceMs <= now);
    if (expired) {
      effectiveStatus = 'read_only';
      (await db.run("UPDATE entitlements SET status = 'read_only', updated_at = ? WHERE id = ?", nowIso(), r.id));
    }
    const pastDue = !isDemo && effectiveStatus === 'active' && Number.isFinite(periodEnd) && periodEnd <= now;
    map[r.product] = {
      product: r.product,
      status: effectiveStatus,
      billingMode: r.billing_mode,
      trialEndsAt: r.trial_ends_at,
      currentPeriodEnd: r.current_period_end,
      cancelledAt: r.cancelled_at,
      pastDue,
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

// Agendamento: a página pública só recebe pedidos depois que a profissional revisa atendimento e horários
// e abre a agenda (22 nov 2026). Contas de demonstração já nascem abertas.
// Valores-padrão das colunas (migração 001): nunca são dados que a profissional informou.
const AMBO_DEFAULT_ADDRESS = 'Pinheiros, São Paulo - SP (endereço completo após confirmação)';
const AMBO_DEFAULT_CITY = 'São Paulo, SP';

function amboSetupOf(acc) {
  let prefs = {};
  try { prefs = JSON.parse(acc?.ui_preferences_json || '{}') || {}; } catch { prefs = {}; }
  const setup = prefs.amboSetup || {};
  const open = Boolean(acc?.is_demo_sandbox) || Boolean(setup.openedAt);
  return { open, openedAt: setup.openedAt || null, reviewedAt: setup.reviewedAt || null, demo: Boolean(acc?.is_demo_sandbox), priceUnset: Boolean(setup.priceUnset) };
}

// Endereço em partes (CEP, rua, número, complemento, bairro), guardado ao lado
// do texto único in_person_address que a página pública e os e-mails usam.
function amboAddressOf(acc) {
  let prefs = {};
  try { prefs = JSON.parse(acc?.ui_preferences_json || '{}') || {}; } catch { prefs = {}; }
  const a = prefs.amboSetup?.address;
  return a && typeof a === 'object' ? a : null;
}

function cleanAmboAddress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (k, max = 120) => String(raw[k] ?? '').trim().slice(0, max);
  const cep = pick('cep', 9).replace(/\D/g, '');
  const out = { cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : '', street: pick('street'), number: pick('number', 20), complement: pick('complement', 80), district: pick('district', 80), city: pick('city', 80), uf: pick('uf', 2).toUpperCase() };
  return Object.values(out).some(Boolean) ? out : null;
}

async function amboSetupPayload(db, accountId) {
  const acc = await db.get('SELECT * FROM professional_accounts WHERE id = ?', accountId);
  const rules = await db.all('SELECT weekday, start_time, end_time, modality FROM availability_rules WHERE account_id = ? AND active = 1 ORDER BY weekday, start_time', accountId);
  const state = amboSetupOf(acc);
  // Conta nova nunca revisada: as colunas têm valores-padrão de exemplo (cidade, endereço, valor).
  // A profissional começa do zero em vez de herdar dados que não informou.
  const fresh = !state.demo && !state.reviewedAt && !state.open;
  return {
    ...state,
    modalities: fresh ? ['online'] : JSON.parse(acc.modalities_json || '["online","presencial"]'),
    city: fresh ? '' : acc.city || '',
    inPersonAddress: fresh || acc.in_person_address === AMBO_DEFAULT_ADDRESS ? '' : acc.in_person_address || '',
    address: fresh ? null : amboAddressOf(acc),
    sessionDurationMin: acc.session_duration_min,
    sessionPriceCents: fresh || state.priceUnset ? null : acc.session_price_cents,
    rules: rules.map((r) => ({ weekday: Number(r.weekday), startTime: r.start_time, endTime: r.end_time, modality: r.modality })),
  };
}

async function amboAccountForContact(db, contact) {
  const row = await db.get(`SELECT account_id, MAX(ts) AS last_ts FROM (
      SELECT account_id, updated_at AS ts FROM consultation_requests WHERE lower(patient_email) = ? OR patient_phone = ?
      UNION ALL
      SELECT account_id, updated_at AS ts FROM operational_patients WHERE lower(email) = ? OR phone = ?
    ) x GROUP BY account_id ORDER BY last_ts DESC LIMIT 1`, contact, contact, contact, contact);
  return row ? db.get('SELECT * FROM professional_accounts WHERE id = ?', row.account_id) : null;
}

async function requireProfessional(db, auth, { product = null, write = false, clinical = false } = {}) {
  requireAuth(auth);
  if (auth.session.actor_type !== 'professional' || !auth.account || !auth.membership) {
    throw Object.assign(new Error('Acesso restrito a profissionais autorizados desta conta.'), { status: 403, code: 'FORBIDDEN_ACTOR' });
  }
  if (clinical && !auth.membership.can_access_clinical) {
    throw Object.assign(new Error('Seu vínculo nesta conta não autoriza acesso ao conteúdo clínico.'), { status: 403, code: 'FORBIDDEN_CLINICAL' });
  }
  // Segunda confirmação para o conteúdo clínico: sessão aberta por código do e-mail já conta;
  // sessão aberta por senha precisa do código (/api/v1/auth/stepup). Liga com
  // ENOMERA_REQUIRE_CLINICAL_STEPUP=true, depois que o Consultório tiver a tela de confirmação.
  if (clinical && process.env.ENOMERA_REQUIRE_CLINICAL_STEPUP === 'true') {
    const verifiedAt = auth.session.mfa_verified_at ? Date.parse(auth.session.mfa_verified_at) : NaN;
    if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > CLINICAL_STEPUP_MAX_AGE_MS) {
      throw Object.assign(new Error('Confirme o código enviado ao seu e-mail para abrir o conteúdo clínico.'), { status: 403, code: 'STEPUP_REQUIRED' });
    }
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
    throw Object.assign(new Error('Acesso restrito à operação do Site.'), { status: 403, code: 'FORBIDDEN_OPERATOR' });
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

// Recusar pedido, cancelar consulta e propor outro horário: só a profissional dona da conta.
async function requireAgendaOwner(db, auth) {
  await requireProfessional(db, auth, { product: 'ambo', write: true });
  if (auth.membership.role !== 'owner') {
    throw Object.assign(new Error('Só a profissional responsável pela agenda pode fazer esta alteração.'), { status: 403, code: 'OWNER_REQUIRED' });
  }
  return auth;
}

// O que uma sessão de paciente enxerga: os cadastros com o contato verificado (pode haver mais de um,
// por exemplo irmãos com o e-mail do mesmo responsável) e as consultas nascidas de pedidos feitos com
// esse e-mail, mesmo que tenham sido ligadas a outro cadastro na confirmação.
async function patientScope(db, auth) {
  const accountId = auth.session.account_id;
  const sid = auth.session.patient_id;
  let contact;
  let rows;
  if (sid.startsWith('contact:')) {
    contact = sid.slice('contact:'.length);
    rows = await db.all('SELECT id, full_name, email, phone FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?) ORDER BY created_at ASC', accountId, contact, contact);
  } else {
    const row = await db.get('SELECT id, full_name, email, phone FROM operational_patients WHERE id = ? AND account_id = ?', sid, accountId);
    rows = row ? [row] : [];
    contact = row?.email ? String(row.email).trim().toLowerCase() : null;
  }
  const ids = rows.map((r) => r.id);
  const idsSql = ids.length ? `patient_id IN (${ids.map(() => '?').join(', ')})` : '0 = 1';
  const apptWhere = `account_id = ? AND (${idsSql} OR id IN (SELECT appointment_id FROM consultation_requests WHERE account_id = ? AND appointment_id IS NOT NULL AND lower(patient_email) = ?))`;
  const apptArgs = [accountId, ...ids, accountId, contact || ''];
  return { accountId, contact, rows, ids, apptWhere, apptArgs };
}

// Candidato mostrado à profissional: recalculado com a regra atual para pedidos pendentes, para que
// pedidos antigos (marcados quando nome igual bastava) não juntem pessoas diferentes ao confirmar.
async function currentDuplicateCandidate(db, r) {
  if (r.status !== 'preference_sent') return null;
  const c = await findDuplicatePatientCandidate(db, r.account_id, { email: r.patient_email || '', phone: r.patient_phone || '', fullName: r.patient_name || '' });
  if (!c) return null;
  if (r.patient_id && c.id === r.patient_id) return null;
  return c;
}

async function patientOwnedAppointment(db, auth, appointmentId) {
  const scope = await patientScope(db, auth);
  const appt = await db.get(`SELECT id, patient_id FROM appointments WHERE id = ? AND ${scope.apptWhere}`, appointmentId, ...scope.apptArgs);
  if (!appt) throw Object.assign(new Error('Consulta não encontrada.'), { status: 404, code: 'APPOINTMENT_NOT_FOUND' });
  return appt;
}

function slugify(name) {
  return String(name || 'profissional')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profissional';
}

// Endereço (slug) da conta: o atual ou um anterior, que continua valendo depois de uma troca.
async function findAccountBySlug(db, slug) {
  const key = String(slug || '').trim();
  if (!key) return undefined;
  const direct = await db.get('SELECT * FROM professional_accounts WHERE slug = ?', key);
  if (direct) return direct;
  const alias = await db.get('SELECT account_id FROM account_slug_aliases WHERE slug = ?', key);
  return alias ? db.get('SELECT * FROM professional_accounts WHERE id = ?', alias.account_id) : undefined;
}
async function slugTaken(db, slug, exceptAccountId = null) {
  const acc = await db.get('SELECT id FROM professional_accounts WHERE slug = ?', slug);
  if (acc && acc.id !== exceptAccountId) return true;
  const alias = await db.get('SELECT account_id FROM account_slug_aliases WHERE slug = ?', slug);
  return Boolean(alias && alias.account_id !== exceptAccountId);
}
const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'agendamento', 'consultorio', 'site', 'sites', 'portal', 'conta', 'checkout', 'configurar', 'piloto', 'convite',
  'termos', 'privacidade', 'enomera', 'suporte', 'ajuda', 'contato', 'login', 'entrar', 'sair', 'www', 'assets', 'static', 'glass', 'demo', 'teste', 'null', 'undefined']);

// Respostas do site: só o que é público. O que o profissional marcou como oculto não sai do servidor.
function publicSiteAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const out = { ...answers };
  if (out.showAddress !== true) {
    if ('address' in out) out.address = typeof out.address === 'string' ? '' : null;
    for (const k of ['cep', 'street', 'number', 'complement']) if (k in out) out[k] = '';
  }
  return out;
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
  // Essencial = modelo com a marca Enomera. Só o Sob medida entregue é 100% da pessoa.
  let briefing = {};
  try { briefing = JSON.parse(proj?.briefing_json || '{}') || {}; } catch { briefing = {}; }
  const selection = await readAccountSelection(db, account.id).catch(() => null);
  const ethaService = briefing.service === 'sob_medida' || briefing.service === 'essencial' ? briefing.service : (selection?.ethaService === 'sob_medida' ? 'sob_medida' : 'essencial');
  const customDelivered = ethaService === 'sob_medida' && Boolean(briefing.sobMedida?.deliveredAt);
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
    authorship: 'Site por Enomera',
    versionNumber: published?.versionNumber || null,
    publishedAt: published?.publishedAt || null,
    domainStatus: proj?.domain_status || 'staging_only',
    answers: publicSiteAnswers(published?.content?.answers),
    ethaService,
    brand: customDelivered ? 'own' : 'etha',
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
    // Texto completo e pessoal (e não só o número): e-mails curtos demais com um código são mais marcados como spam.
    textBody: `Olá,\n\nUse este código para entrar na Enomera: ${code}\n\nEle vale por ${ttlMinutes} minutos e só funciona uma vez. Digite na mesma tela em que você pediu o código.\n\nSe não foi você que pediu, ignore este e-mail. Ninguém entra na sua conta sem este código.\n\nEquipe Enomera`,
    htmlBody: `<p style="margin:0 0 14px">Olá,</p><p style="margin:0 0 14px">Use este código para entrar na Enomera:</p><p style="margin:0 0 14px;font-size:26px;font-weight:700;letter-spacing:6px">${code}</p><p style="margin:0 0 14px">Ele vale por ${ttlMinutes} minutos e só funciona uma vez. Digite na mesma tela em que você pediu o código.</p><p style="margin:0 0 14px">Se não foi você que pediu, ignore este e-mail. Ninguém entra na sua conta sem este código.</p><p style="margin:0">Equipe Enomera</p>`,
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
  if (await slugTaken(db, slug)) {
    slug = `${slug}-${randomDigits(4)}`;
  }
  await runTransaction(db, async (db) => {
    (await db.run(`
      INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'professional', ?, 1, ?, ?)
    `, userId, email, pwd.hash, pwd.salt, cleanName, emailVerifiedAt, now, now));

    (await db.run(`
      INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, crp_or_crm, specialty, online_meeting_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)
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
      // Público: só "no ar" ou "fora do ar". O detalhe (variáveis, provedores, migrações) aparece em
      // desenvolvimento local ou com o cabeçalho x-enomera-health-token igual a ENOMERA_HEALTH_TOKEN.
      const healthToken = String(process.env.ENOMERA_HEALTH_TOKEN || '');
      const given = String(req.headers['x-enomera-health-token'] || '');
      const detailed = !guard.required || (healthToken.length >= 16 && given.length === healthToken.length && sha256Hex(given) === sha256Hex(healthToken));
      if (!detailed) {
        if (guard.required && !guard.ready) {
          return json(res, 503, { ok: false, code: 'REMOTE_INFRA_NOT_CONFIGURED', error: 'Serviço temporariamente indisponível.', service: 'enomera-core-api', time: nowIso() });
        }
        await getDb();
        return json(res, 200, { ok: true, service: 'enomera-core-api', time: nowIso() });
      }
      if (guard.required && !guard.ready) {
        return json(res, 503, {
          ok: false,
          code: 'REMOTE_INFRA_NOT_CONFIGURED',
          error: `Ambiente de entrega requer infraestrutura remota completa (Neon Postgres, Vercel Blob Private e envio de e-mail por SMTP ou Resend). Variáveis ausentes: ${guard.missingEnvVars.join(', ')}.`,
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
      await seedOnce(db);
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
    await seedOnce(db);
    const auth = await getSessionFromRequest(db, req, pathname);

    const ip = clientIp(req);
    if (rateLimitRulesFor(method, pathname, ip, {})) {
      const peek = await readJsonBody(req).catch(() => ({}));
      await enforceRateLimit(db, rateLimitRulesFor(method, pathname, ip, peek && typeof peek === 'object' ? peek : {}));
    }

    if (await handlePilotRoutes({ db, req, res, method, pathname, url, auth, json, readJsonBody, createProfessionalUser, issueSession, writeAudit, issueVerificationCode, consumeVerificationCode, recordTermsAcceptance, publicBaseUrl })) return;

    // Rotina diária de retenção (Vercel Cron). Só roda com o segredo do ambiente.
    if (method === 'GET' && pathname === '/api/v1/internal/retention') {
      const secret = String(process.env.CRON_SECRET || '');
      const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (secret.length < 16 || given.length !== secret.length || sha256Hex(given) !== sha256Hex(secret)) {
        throw Object.assign(new Error('Não autorizado.'), { status: 401, code: 'UNAUTHENTICATED' });
      }
      return json(res, 200, { ok: true, ...(await runRetention(db)) });
    }

    if (method === 'GET' && pathname === '/api/v1/catalog') {
      return json(res, 200, COMMERCIAL_CATALOG);
    }
    if (method === 'POST' && pathname === '/api/v1/catalog/quote') {
      const body = await readJsonBody(req);
      const quote = calculateSimulatedQuote(body);
      const contract = buildContractSummary(body);
      if (await getPilotAccess(db, auth?.user?.id)) return json(res, 200, { ...pilotFreeQuote(quote), contract: pilotFreeContract(contract) });
      return json(res, 200, { ...quote, contract });
    }

    // ── COBRANÇA (Asaas; sandbox até autorização de cobrança real) ─────────
    if (pathname.startsWith('/api/v1/billing/')) {
      // Piloto gratuito: convidado não vê assinatura, cartão nem fatura.
      if ((pathname === '/api/v1/billing/status' || pathname === '/api/v1/billing/checkout') && auth?.user && await getPilotAccess(db, auth.user.id)) {
        await requireProfessional(db, auth);
        if (method === 'POST') throw Object.assign(new Error('No piloto, todos os serviços são gratuitos. Não há nada a pagar.'), { status: 409, code: 'PILOT_FREE' });
        return json(res, 200, { configured: false, mode: 'pilot', pilot: { free: true, until: PILOT_FREE_UNTIL }, subscription: null });
      }
      if (method === 'POST' && pathname === '/api/v1/billing/checkout' && auth?.user) {
        await requireProfessional(db, auth);
        await requireTermsAccepted(db, req, auth, await readJsonBody(req));
      }
      if (await handleBillingRoutes({ db, req, res, method, pathname, auth }, { json, readJsonBody, requireProfessional, writeAudit, notifyOverdue: (n) => notifyAccountOfOverdue(db, req, n) })) return;
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
        // Nome digitado na contratação; o e-mail só serve de último recurso (contas antigas ou chamadas sem nome).
        const typedName = String(body.fullName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        await createProfessionalUser(db, {
          fullName: typedName.length >= 3 && /\p{L}/u.test(typedName) ? typedName : displayNameFromEmail(email),
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
      // Aceite explícito na tela de contratação (caixa marcada): fica registrado com versão e data.
      if (body.acceptTerms === true && u.role === 'professional' && !u.terms_accepted_at) {
        u.terms_accepted_at = await recordTermsAcceptance(db, req, u.id, account?.id || null);
      }
      const sess = await issueSession(db, { userId: u.id, actorType: u.role, accountId: account?.id || null, verifiedByCode: true });
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
        selection: z.object({ products: z.array(z.enum(['ambo', 'minne', 'etha'])).min(1), ethaFormat: z.enum(['one_page', 'multi_page']).optional(), ethaService: z.enum(['essencial', 'sob_medida']).optional() }).optional(),
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
      const passwordOk = u ? verifyPassword(password, u.password_hash, u.password_salt) : (verifyPassword(password, DUMMY_PASSWORD.hash, DUMMY_PASSWORD.salt) && false);
      if (!u || !passwordOk) {
        await writeAudit(db, { actorType: 'anonymous', action: 'auth.login', resourceType: 'user', outcome: 'deny', meta: { emailHash: sha256Hex(email).slice(0, 16) } });
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
      // Administrador do piloto vê dados de uso de todos os convidados: senha e, além dela,
      // código enviado ao e-mail. A sessão dura 12 horas.
      const isPilotAdmin = u.role === 'pilot_admin';
      if (isPilotAdmin) {
        const code = String(body.code || '').trim();
        if (!code) {
          const ver = await issueVerificationCode(db, { purpose: 'admin_login', targetContact: email, userId: u.id, subject: 'Código para abrir o painel do piloto · Enomera' });
          return json(res, 401, { code: 'ADMIN_CODE_REQUIRED', error: 'Enviamos um código de 6 dígitos ao seu e-mail. Digite-o para abrir o painel.', expiresAt: ver.expiresAt, devCode: ver.devCode });
        }
        await consumeVerificationCode(db, { purpose: 'admin_login', targetContact: email, code });
      }
      const sess = await issueSession(db, { userId: u.id, actorType: u.role, accountId: account?.id || null, ...(isPilotAdmin ? { ttlMinutes: 12 * 60, verifiedByCode: true } : {}) });
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
      return json(res, 200, { ok: true }, { 'Set-Cookie': `${auth?.session?.actor_type === 'patient' ? PATIENT_COOKIE_NAME : COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0${secureClear}` });
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
        subject: 'Verificação reforçada · Acesso clínico Consultório',
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
      if (auth.session.actor_type !== 'professional') throw Object.assign(new Error('Use o acesso do paciente no Agendamento.'), { status: 403, code: 'FORBIDDEN_ACTOR' });
      if (!isAllowedOrigin(targetOrigin)) {
        throw Object.assign(new Error('Origem de destino não autorizada para passagem autenticada.'), { status: 400, code: 'INVALID_TARGET_ORIGIN' });
      }
      // Produtos no mesmo domínio vêm como origem + caminho (https://enomera.vercel.app/consultorio).
      // O navegador manda só a origem no cabeçalho Origin da troca: é ela que fica gravada e é conferida.
      const exchangeOrigin = new URL(targetOrigin).origin;
      const code = `hc_${randomToken(24)}`;
      const expiresAt = addMinutesIso(1); // 60 seconds single-use
      (await db.run(`
        INSERT INTO auth_handoff_codes (id, code_hash, session_id, target_origin, return_path, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, randomId('hnd'), sha256Hex(code), auth.session.id, exchangeOrigin, /^\/(?!\/)/.test(body.returnPath || '/') ? String(body.returnPath || '/') : '/', expiresAt, nowIso()));
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
        user: { id: auth.user.id, email: auth.user.email, fullName: auth.user.full_name, role: auth.user.role, emailVerified: Boolean(auth.user.email_verified_at), termsAccepted: Boolean(auth.user.terms_accepted_at), termsVersion: TERMS_VERSION },
        account: auth.account ? {
          id: auth.account.id,
          slug: auth.account.slug,
          displayName: auth.account.display_name,
          crpOrCrm: auth.account.crp_or_crm,
          specialty: auth.account.specialty,
          deletionScheduledFor: auth.account.deletion_scheduled_for || null,
          city: auth.account.city,
          timezone: auth.account.timezone,
          sessionDurationMin: auth.account.session_duration_min,
          sessionPriceCents: auth.account.session_price_cents,
          modalities: JSON.parse(auth.account.modalities_json || '["online","presencial"]'),
          uiPreferences: JSON.parse(auth.account.ui_preferences_json || '{}'),
        } : null,
        entitlements: auth.account ? await getAccountEntitlements(db, auth.account.id) : null,
        pilot: await getPilotAccess(db, auth.user.id),
      });
    }

    // Dev/Homologation Outbox inspection (ONLY when SMTP is unconfigured — honest inspection for verification flows!)
    if (method === 'GET' && pathname === '/api/v1/dev/outbox') {
      const realMailerOn = Boolean(process.env.SMTP_URL || process.env.SMTP_PASSWORD || (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL));
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
      await requireTermsAccepted(db, req, auth, body);
      const products = (Array.isArray(body.products) ? body.products : ['ambo', 'minne']).filter((p) => ['ambo', 'minne', 'etha'].includes(p));
      if (products.length === 0) throw Object.assign(new Error('Selecione ao menos um serviço para as 2 semanas grátis.'), { status: 400, code: 'INVALID_TRIAL_PRODUCTS' });
      const now = nowIso();
      const trialEndsAt = (await getPilotAccess(db, auth.user.id)) ? PILOT_FREE_UNTIL : addDaysIso(COMMERCIAL_CATALOG.trialDays);
      if (!(await getPilotAccess(db, auth.user.id))) await assertTrialAvailable(db, auth.account.id, products);
      await runTransaction(db, async (db) => {
        for (const p of products) {
          (await db.run(`
            INSERT INTO entitlements (id, account_id, product, status, billing_mode, trial_ends_at, updated_at)
            VALUES (?, ?, ?, 'trial', 'trial', ?, ?)
            ON CONFLICT(account_id, product) DO UPDATE SET
              status = CASE WHEN entitlements.status IN ('active', 'cancelled_grace') THEN entitlements.status ELSE 'trial' END,
              trial_ends_at = COALESCE(entitlements.trial_ends_at, excluded.trial_ends_at),
              updated_at = excluded.updated_at
          `, randomId('ent'), auth.account.id, p, trialEndsAt, now));
        }
        if (products.includes('etha')) await ensureEthaProject(db, auth.account.id, 'one_page');
        await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'commercial.trial_start', resourceType: 'entitlement', meta: { products } });
      });
      return json(res, 200, { ok: true, trialEndsAt, entitlements: await getAccountEntitlements(db, auth.account.id) });
    }

    if (method === 'POST' && pathname === '/api/v1/commercial/pilot/apply') {
      const body = await readJsonBody(req);
      const parsed = z.object({
        fullName: z.string().trim().min(2).max(160),
        email: z.string().trim().toLowerCase().email().max(254),
        specialty: z.string().trim().max(80).optional().default('Psicologia'),
        notes: z.string().trim().max(2000).optional().default(''),
      }).safeParse({
        fullName: body.fullName || auth?.user?.full_name || '',
        email: body.email || auth?.user?.email || '',
        specialty: body.specialty || undefined,
        notes: body.notes || undefined,
      });
      if (!parsed.success) throw Object.assign(new Error('Informe nome e e-mail válidos para pedir o convite do piloto. O recado pode ter até 2.000 caracteres.'), { status: 400, code: 'INVALID_PILOT_DATA' });
      const id = randomId('plt');
      (await db.run(`
        INSERT INTO pilot_applications (id, user_id, full_name, email, specialty, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'received', ?)
      `, id, auth?.user?.id || null, parsed.data.fullName, parsed.data.email, parsed.data.specialty, parsed.data.notes, nowIso()));
      return json(res, 201, { id, status: 'received', pilotUntil: PILOT_FREE_UNTIL, message: 'Pedido de convite registrado. O piloto é gratuito até 31 de janeiro de 2027, sem cartão.' });
    }

    if (method === 'POST' && pathname === '/api/v1/commercial/orders') {
      await requireProfessional(db, auth);
      if (!auth.user.email_verified_at) throw Object.assign(new Error('Confirme seu e-mail antes de ativar os serviços.'), { status: 403, code: 'EMAIL_VERIFICATION_REQUIRED' });
      const body = await readJsonBody(req);
      const idempotencyKey = String(req.headers['x-idempotency-key'] || body.idempotencyKey || '').trim();
      if (!idempotencyKey) throw Object.assign(new Error('Não foi possível identificar este pedido. Recarregue a página e tente de novo.'), { status: 400, code: 'IDEMPOTENCY_REQUIRED' });
      await requireTermsAccepted(db, req, auth, body);

      const existing = (await db.get('SELECT * FROM commercial_orders WHERE account_id = ? AND idempotency_key = ?', auth.account.id, idempotencyKey));
      if (existing) {
        const attempts = (await db.all('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt_number ASC', existing.id));
        return json(res, 200, { order: existing, summary: JSON.parse(existing.summary_json), attempts, entitlements: await getAccountEntitlements(db, auth.account.id), idempotentReplay: true });
      }

      // Três caminhos, decididos no servidor (nunca pelo que o navegador manda):
      // 1. Convidado do piloto (convite válido aceito): ativa grátis até o fim do piloto.
      // 2. Ativação simulada: só em ambiente de teste, com ENOMERA_ALLOW_SIMULATED_CHECKOUT=true.
      // 3. Qualquer outra conta: começa as 2 semanas grátis da oferta (uma vez por serviço);
      //    depois disso, só com a contratação paga (/api/v1/billing/checkout).
      const pilotFree = await getPilotAccess(db, auth.user.id);
      const simulated = !pilotFree && allowSimulatedActivation();
      const trialOnly = !pilotFree && !simulated;
      let quote = calculateSimulatedQuote({ products: body.products, ethaFormat: body.ethaFormat, ethaService: body.ethaService, mode: 'monthly' });
      if (trialOnly) await assertTrialAvailable(db, auth.account.id, quote.selectedProducts);
      if (pilotFree) quote = pilotFreeQuote(quote);
      // Percurso aprovado (22 nov): a ativação informa a periodicidade e não cobra nada hoje.
      const isContractFlow = body.billing === 'monthly' || body.billing === 'permanent';
      if (isContractFlow) {
        let contract = buildContractSummary({ products: body.products, ethaFormat: body.ethaFormat, ethaService: body.ethaService, billing: body.billing });
        if (pilotFree) contract = pilotFreeContract(contract);
        quote.billing = contract.billing;
        quote.contract = contract;
        quote.dueTodayCents = 0;
        quote.chargedTodayCents = 0;
        await writeAccountSelection(db, auth.account.id, contract);
      }
      // No piloto e no teste grátis não há pagamento: a ativação não depende de resultado simulado.
      const simulatedOutcome = !simulated ? 'approved' : ['approved', 'pending', 'declined'].includes(body.simulatedOutcome) ? body.simulatedOutcome : 'approved';
      const methodUsed = pilotFree ? 'pilot_free' : trialOnly ? 'free_trial' : body.method === 'simulated_card' ? 'simulated_card' : 'simulated_pix';

      const result = await runTransaction(db, async (db) => {
        const replay = await db.get('SELECT * FROM commercial_orders WHERE account_id = ? AND idempotency_key = ?', auth.account.id, idempotencyKey);
        if (replay) return { order: replay, attempts: await db.all('SELECT * FROM payment_attempts WHERE order_id = ?', replay.id), idempotentReplay: true };
        const orderId = randomId('ord');
        const receiptCode = `${simulated ? 'SIM' : pilotFree ? 'PIL' : 'TST'}-ENO-${randomDigits(6)}`;
        const now = nowIso();
        (await db.run(`
          INSERT INTO commercial_orders (
            id, account_id, idempotency_key, catalog_version, items_json, due_today_cents,
            recurring_monthly_cents, balance_on_approval_cents, discount_cents, summary_json,
            status, is_simulated, receipt_code, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, orderId, auth.account.id, idempotencyKey, quote.catalogVersion, JSON.stringify(quote.selectedProducts),
          quote.dueTodayCents, quote.recurringMonthlyCents, quote.balanceOnApprovalCents, quote.discountCents,
          JSON.stringify(quote), simulatedOutcome, simulated ? 1 : 0, receiptCode, now, now));

        const failReason = simulatedOutcome === 'declined'
          ? 'Pagamento de teste recusado (nenhum valor foi cobrado). Sua escolha continua guardada.'
          : null;
        (await db.run(`
          INSERT INTO payment_attempts (id, order_id, attempt_number, method, status, failure_reason, created_at, updated_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?)
        `, randomId('pay'), orderId, methodUsed, simulatedOutcome, failReason, now, now));

        if (simulatedOutcome === 'approved') {
          await activateOrderEntitlementsTx(db, auth.account.id, quote, { pilotFree: Boolean(pilotFree), trial: trialOnly });
          await db.run('INSERT INTO checkout_selections (account_id, selection_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET selection_json = excluded.selection_json, updated_at = excluded.updated_at', auth.account.id,
            JSON.stringify({products:quote.selectedProducts,ethaFormat:quote.ethaFormat || 'one_page',stage:'confirmed'}),now);
          await writeAccountSelection(db, auth.account.id, { ...(await readAccountSelection(db, auth.account.id) || {}), products: quote.selectedProducts, ethaFormat: quote.ethaFormat || 'one_page', stage: 'confirmed' });
        }
        await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: simulated ? 'commercial.checkout_simulated' : pilotFree ? 'commercial.pilot_activation' : 'commercial.trial_activation', resourceType: 'order', resourceId: orderId, meta: { outcome: simulatedOutcome, products: quote.selectedProducts } });
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
      const retryPilotFree = Boolean(await getPilotAccess(db, auth.user.id));
      if (!retryPilotFree && !allowSimulatedActivation()) {
        throw Object.assign(new Error('Para ativar este serviço, conclua a contratação com pagamento na aba Cobrança.'), { status: 402, code: 'PAYMENT_REQUIRED' });
      }
      const nextOutcome = retryPilotFree ? 'approved' : ['approved', 'pending', 'declined'].includes(body.simulatedOutcome) ? body.simulatedOutcome : 'approved';
      const methodUsed = retryPilotFree ? 'pilot_free' : body.method === 'simulated_card' ? 'simulated_card' : 'simulated_pix';

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
        `, randomId('pay'), orderId, count + 1, methodUsed, nextOutcome, nextOutcome === 'declined' ? 'Pagamento de teste recusado de novo.' : null, now, now));
        (await db.run('UPDATE commercial_orders SET status = ?, updated_at = ? WHERE id = ?', nextOutcome, now, orderId));
        if (nextOutcome === 'approved') {
          const quote = JSON.parse(order.summary_json);
          await activateOrderEntitlementsTx(db, auth.account.id, quote, { pilotFree: retryPilotFree });
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
      const label = PRODUCT_LABELS[product] || product;
      let note;
      if (action === 'cancel') {
        // Primeiro a cobrança (Asaas), depois a situação do serviço: se o Asaas falhar, nada muda
        // e o profissional vê o erro. Com período já pago, o serviço segue até o fim dele (Termos, item 5).
        const { paidUntil } = await cancelProductBilling(db, { accountId: auth.account.id, product });
        note = paidUntil
          ? `${label} cancelado. Você continua usando até ${formatDateBr(paidUntil)}, fim do período já pago. Depois disso, fica só para leitura e exportação. Nenhuma nova cobrança será feita.`
          : `${label} ficou só para leitura e exportação. Os outros serviços continuam ativos e nenhum dado foi apagado.`;
      } else {
        // Reativar não cria período pago novo: só volta a valer o que já estava pago, o teste em curso ou o piloto.
        const pilotFree = await getPilotAccess(db, auth.user.id);
        const stillPaid = ent.current_period_end && periodEndMs(ent.current_period_end) > Date.now();
        const trialRunning = !stillPaid && ent.trial_ends_at && Date.parse(ent.trial_ends_at) > Date.now();
        if (!pilotFree && !stillPaid && !trialRunning && !allowSimulatedActivation()) {
          throw Object.assign(new Error('O período deste serviço terminou. Contrate de novo para reativar.'), { status: 402, code: 'PAYMENT_REQUIRED', product });
        }
        if (trialRunning && !pilotFree) {
          (await db.run("UPDATE entitlements SET status = 'trial', cancelled_at = NULL, updated_at = ? WHERE id = ?", now, ent.id));
        } else {
          const periodEnd = pilotFree ? PILOT_FREE_UNTIL : stillPaid ? ent.current_period_end : addDaysIso(30);
          (await db.run("UPDATE entitlements SET status = 'active', cancelled_at = NULL, current_period_end = ?, updated_at = ? WHERE id = ?", periodEnd, now, ent.id));
        }
        note = `${label} reativado.`;
      }
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: `entitlement.${action}`, resourceType: 'entitlement', resourceId: ent.id, meta: { product } });
      return json(res, 200, { ok: true, entitlements: await getAccountEntitlements(db, auth.account.id), note });
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

      let nextAction = { label: 'Escolher serviços ou começar 2 semanas grátis', product: 'enomera' };
      if (hasAmbo && !hasMinne) nextAction = { label: 'Configurar disponibilidade e link no Agendamento', product: 'ambo' };
      else if (hasMinne && pendingRequests > 0) nextAction = { label: `Responder ${pendingRequests} ${pendingRequests === 1 ? 'solicitação' : 'solicitações'} no Consultório`, product: 'minne' };
      else if (hasAmbo && hasMinne) nextAction = { label: 'Abrir Agendamento para compartilhar perfil ou Consultório para agenda', product: 'ambo' };
      else if (hasEtha && !hasAmbo && !hasMinne) nextAction = { label: 'Acompanhar seu site', product: 'etha' };

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
      const accId = auth.account.id;
      const patients = (await db.all('SELECT * FROM operational_patients WHERE account_id = ?', accId));
      const appointments = (await db.all('SELECT * FROM appointments WHERE account_id = ?', accId));
      const notes = await Promise.all((await db.all("SELECT * FROM clinical_notes WHERE account_id = ? AND status != 'reverted'", accId)).map(async (n) => ({
        ...n,
        versions: (await db.all('SELECT version_number, author_display_name, blocks_json, change_reason, created_at FROM clinical_note_versions WHERE note_id = ? ORDER BY version_number ASC', n.id)),
      })));
      const parse = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };
      const requests = (await db.all('SELECT id, protocol_code, source, modality, patient_id, patient_name, patient_email, patient_phone, patient_birth, guardian_json, preferences_json, answers_json, status, appointment_id, consent_at, consent_version, created_at, updated_at FROM consultation_requests WHERE account_id = ?', accId))
        .map(({ guardian_json, preferences_json, answers_json, ...r }) => ({ ...r, guardian: parse(guardian_json, null), preferences: parse(preferences_json, {}), answers: parse(answers_json, {}) }));
      const reschedules = (await db.all('SELECT id, appointment_id, patient_id, original_start_at, original_end_at, requested_start_at, requested_end_at, preferences_json, reason, status, decided_at, created_at FROM reschedule_requests WHERE account_id = ?', accId))
        .map(({ preferences_json, ...r }) => ({ ...r, preferences: parse(preferences_json, {}) }));
      const guardians = await db.all('SELECT patient_id, guardian_name, relation, contact, created_at FROM patient_guardians WHERE account_id = ?', accId);
      const invitations = await db.all('SELECT id, patient_id, channel, target_contact, status, expires_at, used_at, created_at FROM patient_invitations WHERE account_id = ?', accId);
      const base = publicBaseUrl(req);
      // Arquivos: a exportação lista cada um com o endereço de download (exige a sessão do profissional).
      const files = (await db.all('SELECT id, scope, original_name, detected_mime, size_bytes, sha256, created_at FROM private_files WHERE account_id = ?', accId))
        .map((f) => ({ ...f, downloadUrl: `${base}/api/v1/files/${f.id}` }));
      const site = await db.get('SELECT * FROM etha_projects WHERE account_id = ?', accId);
      const siteVersions = site ? (await db.all('SELECT id, version_number, stage, content_json, created_at, published_at FROM etha_content_versions WHERE project_id = ? ORDER BY version_number ASC', site.id))
        .map(({ content_json, ...v }) => ({ ...v, content: parse(content_json, {}) })) : [];
      const acc = auth.account;
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: accId, action: 'account.export', resourceType: 'account', resourceId: accId });
      return json(res, 200, {
        schemaVersion: 'enomera-export-v2',
        exportedAt: nowIso(),
        account: { slug: acc.slug, displayName: acc.display_name, crpOrCrm: acc.crp_or_crm },
        profile: {
          fullName: auth.user.full_name, email: auth.user.email, specialty: acc.specialty, bio: acc.bio, audience: acc.audience || '', city: acc.city, timezone: acc.timezone,
          sessionDurationMin: acc.session_duration_min, sessionPriceCents: acc.session_price_cents, modalities: parse(acc.modalities_json, []),
          onlineMeetingUrl: acc.online_meeting_url, onlineInstructions: acc.online_instructions, inPersonAddress: acc.in_person_address,
          preferences: parse(acc.ui_preferences_json, {}), termsAcceptedAt: auth.user.terms_accepted_at || null, termsVersion: auth.user.terms_version || null, createdAt: acc.created_at,
        },
        availability: {
          rules: await db.all('SELECT weekday, start_time, end_time, modality, active FROM availability_rules WHERE account_id = ?', accId),
          blocks: await db.all('SELECT start_at, end_at, reason FROM availability_blocks WHERE account_id = ?', accId),
        },
        services: await getAccountEntitlements(db, accId),
        orders: await db.all('SELECT id, items_json, status, receipt_code, created_at FROM commercial_orders WHERE account_id = ?', accId),
        patients,
        guardians,
        consultationRequests: requests,
        appointments,
        reschedules,
        invitations,
        files,
        site: site ? { format: site.format, status: site.status, briefing: parse(site.briefing_json, {}), domainName: site.domain_name, publishedAt: site.published_at, versions: siteVersions } : null,
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
            attachmentFileIds: parse(n.attachment_file_ids_json, []),
            versionsCount: n.versions.length,
          };
        }),
      });
    }

    // Exclusão de conta (LGPD, art. 18, VI): só o dono, confirmando o e-mail da conta.
    // A conta fica 90 dias só para leitura e exportação e depois é apagada pela rotina diária.
    if (pathname === '/api/v1/account/deletion' && ['POST', 'DELETE'].includes(method)) {
      await requireProfessional(db, auth);
      if (auth.membership.role !== 'owner') throw Object.assign(new Error('Só quem criou a conta pode pedir a exclusão.'), { status: 403, code: 'OWNER_REQUIRED' });
      if (auth.account.is_demo_sandbox) throw Object.assign(new Error('Contas de demonstração não podem ser excluídas.'), { status: 403, code: 'DEMO_ACCOUNT' });
      if (method === 'DELETE') {
        await cancelAccountDeletion(db, { account: auth.account, userId: auth.user.id });
        return json(res, 200, { ok: true, deletionScheduledFor: null, message: 'Exclusão cancelada. Seus dados continuam guardados. Para voltar a usar os serviços, reative-os no portal.' });
      }
      const body = await readJsonBody(req);
      if (String(body.confirmEmail || '').trim().toLowerCase() !== String(auth.user.email).toLowerCase()) {
        throw Object.assign(new Error('Para confirmar, digite o e-mail desta conta.'), { status: 400, code: 'CONFIRMATION_MISMATCH' });
      }
      const out = await requestAccountDeletion(db, { account: auth.account, userId: auth.user.id });
      const dateLabel = formatDateBr(out.scheduledFor);
      const notice = await safeNotify(db, {
        recipient: await accountOwnerEmail(db, auth.account),
        subject: 'Pedido de exclusão da conta · Enomera',
        textBody: `Recebemos o pedido de exclusão da sua conta Enomera.\n\nAté ${dateLabel}, a conta fica só para leitura e exportação. Nessa data, apagamos a conta, os pacientes, a agenda, os registros e os arquivos. Dados de cobrança ficam guardados por 5 anos, por exigência fiscal.\n\nLembre de exportar o prontuário antes: a guarda dele é dever do profissional (CFP: 5 anos; CFM: 20 anos).\n\nSe não foi você, ou se mudou de ideia, entre no portal e cancele a exclusão.`,
        purpose: 'account_deletion_requested',
      });
      return json(res, 200, { ok: true, deletionScheduledFor: out.scheduledFor, notified: notice.sent, message: `Exclusão marcada para ${dateLabel}. Até lá, a conta fica só para leitura e exportação, e você pode cancelar o pedido.` });
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
      if (body.onlineMeetingUrl != null) body.onlineMeetingUrl = safeHttpsUrl(body.onlineMeetingUrl, { field: 'onlineMeetingUrl' });
      if (body.sessionPriceCents != null && !(Number.isFinite(Number(body.sessionPriceCents)) && Number(body.sessionPriceCents) >= 0 && Number(body.sessionPriceCents) <= 10_000_000)) {
        throw Object.assign(new Error('Valor da sessão inválido.'), { status: 400, code: 'INVALID_PRICE' });
      }
      // Preferências: junta por chave com o que já existe (nunca apaga a escolha de serviços nem a
      // configuração da agenda, que vivem no mesmo campo e têm rotas próprias).
      let mergedPrefs = null;
      if (body.uiPreferences != null || body.sessionPriceCents != null) {
        const incoming = z.record(z.string().max(60), z.any()).safeParse(body.uiPreferences ?? {});
        if (!incoming.success || JSON.stringify(incoming.data).length > 8000) {
          throw Object.assign(new Error('Preferências inválidas.'), { status: 400, code: 'INVALID_PREFERENCES' });
        }
        let current = {};
        try { current = JSON.parse(auth.account.ui_preferences_json || '{}') || {}; } catch { current = {}; }
        const { commercialSelection: _sel, amboSetup: _setup, priceInformed: _pi, ...allowed } = incoming.data;
        mergedPrefs = { ...current, ...allowed };
        if (body.sessionPriceCents != null) {
          mergedPrefs.priceInformed = true;
          if (mergedPrefs.amboSetup?.priceUnset) mergedPrefs.amboSetup = { ...mergedPrefs.amboSetup, priceUnset: undefined };
        }
      }
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
        mergedPrefs ? JSON.stringify(mergedPrefs) : null,
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
      const account = await findAccountBySlug(db, publicPhoto[2]);
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
      const rawBody = await readJsonBody(req);
      const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
      const parsedAvail = z.object({
        rules: z.array(z.object({
          weekday: z.coerce.number().int().min(0).max(6),
          startTime: hhmm.optional().default('09:00'),
          endTime: hhmm.optional().default('18:00'),
          modality: z.enum(['online', 'presencial', 'both']).optional().default('both'),
        }).refine((r) => r.startTime < r.endTime)).max(60).optional(),
        blocks: z.array(z.object({
          startAt: z.string().max(40).refine((v) => Number.isFinite(Date.parse(v))),
          endAt: z.string().max(40).refine((v) => Number.isFinite(Date.parse(v))),
          reason: z.string().max(120).optional().default('Bloqueio'),
        }).refine((b) => Date.parse(b.startAt) < Date.parse(b.endAt))).max(200).optional(),
      }).safeParse(rawBody);
      if (!parsedAvail.success) {
        throw Object.assign(new Error('Horários inválidos. Use dia da semana de 0 (domingo) a 6 (sábado), horas no formato 09:00 e início antes do fim.'), { status: 400, code: 'INVALID_AVAILABILITY' });
      }
      const body = parsedAvail.data;
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
      const acc = await findAccountBySlug(db, slug);
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      const ents = await getAccountEntitlements(db, acc.id);
      if (!ents.ambo?.canWrite) {
        throw Object.assign(new Error('O Agendamento não está ativo para este perfil.'), { status: 404, code: 'AMBO_INACTIVE' });
      }
      const amboState = amboSetupOf(acc);
      const amboFresh = !amboState.demo && !amboState.reviewedAt && !amboState.open;
      return json(res, 200, {
        professional: {
          slug: acc.slug,
          displayName: acc.display_name,
          crpOrCrm: acc.crp_or_crm,
          specialty: acc.specialty,
          bio: acc.bio,
          audience: acc.audience || '',
          photoUrl: profilePhotoUrl(acc),
          city: amboFresh ? '' : acc.city,
          timezone: acc.timezone,
          sessionDurationMin: acc.session_duration_min,
          sessionPriceCents: amboFresh || amboState.priceUnset ? null : acc.session_price_cents,
          modalities: amboFresh ? [] : JSON.parse(acc.modalities_json || '["online","presencial"]'),
          inPersonHint: amboFresh ? '' : acc.city,
        },
        booking: { open: amboState.open },
        note: 'Valor e condições do atendimento são combinados diretamente com a profissional. Enviar preferências não bloqueia horário na agenda.',
      });
    }

    const amboReqMatch = pathname.match(/^\/api\/v1\/ambo\/public\/([^/]+)\/requests$/);
    if (method === 'POST' && amboReqMatch) {
      const slug = amboReqMatch[1];
      const acc = await findAccountBySlug(db, slug);
      if (!acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });
      const ents = await getAccountEntitlements(db, acc.id);
      if (!ents.ambo?.canWrite) throw Object.assign(new Error('Agendamento indisponível para este perfil.'), { status: 403, code: 'AMBO_INACTIVE' });
      if (!amboSetupOf(acc).open) throw Object.assign(new Error('A agenda desta profissional ainda não está aberta para pedidos.'), { status: 409, code: 'AMBO_NOT_OPEN' });

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
      if (!name || name.length > 160 || !z.string().email().max(254).safeParse(email).success || phone.length > 40 || String(body.patientBirth || '').length > 20) {
        throw Object.assign(new Error('Informe nome completo e e-mail válido.'), { status: 400, code: 'INVALID_PATIENT_FIELDS' });
      }
      // Campos livres do pedido têm teto: o formulário real fica muito abaixo disso.
      const jsonSize = (v) => (v == null ? 0 : JSON.stringify(v).length);
      const isPlainObject = (v) => v == null || (typeof v === 'object' && !Array.isArray(v));
      if (!isPlainObject(body.answers) || !isPlainObject(body.preferences) || !isPlainObject(body.guardian)
        || jsonSize(body.answers) > 12000 || jsonSize(body.preferences) > 4000 || jsonSize(body.guardian) > 2000) {
        throw Object.assign(new Error('O pedido ficou grande demais. Resuma as respostas e tente de novo.'), { status: 413, code: 'REQUEST_TOO_LARGE' });
      }
      // Consentimento do paciente (LGPD, art. 11): gravado com versão, data e origem (hash do IP).
      // O Agendamento envia consent: true; ENOMERA_REQUIRE_PATIENT_CONSENT=true torna obrigatório.
      const consentGiven = body.consent === true || body.privacyConsent === true;
      if (!consentGiven && process.env.ENOMERA_REQUIRE_PATIENT_CONSENT === 'true') {
        throw Object.assign(new Error('Para enviar o pedido, confirme que leu o aviso de privacidade.'), { status: 400, code: 'CONSENT_REQUIRED' });
      }

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
      if (consentGiven) {
        await db.run('UPDATE consultation_requests SET consent_at = ?, consent_version = ?, consent_ip_hash = ? WHERE id = ?', now, PATIENT_CONSENT_VERSION, sha256Hex(clientIp(req)).slice(0, 32), id);
      }

      await writeAudit(db, { actorType: 'patient_public', accountId: acc.id, action: 'ambo.request_create', resourceType: 'consultation_request', resourceId: id, meta: { consent: consentGiven ? PATIENT_CONSENT_VERSION : null } });
      await notifyProfessionalOfRequest(db, req, acc, { protocol });
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
      if (!contact) throw Object.assign(new Error('Informe o e-mail ou telefone usado na solicitação.'), { status: 400, code: 'CONTACT_REQUIRED' });
      // Sem profissional (entrada direta do Agendamento): usa a conta com a atividade mais recente deste contato.
      // A resposta é a mesma com ou sem cadastro, então não revela com quem a pessoa se consulta.
      const acc = slug
        ? await findAccountBySlug(db, slug)
        : (await amboAccountForContact(db, contact));
      if (!acc && slug) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });

      // Resposta uniforme (LGPD, dado sensível): quem pergunta não descobre se o contato é paciente.
      // Com ou sem vínculo, a resposta tem os mesmos campos, o mesmo status e tempo parecido, e a
      // conferência do código (verify) se comporta igual, porque um código-isca é registrado quando
      // não há vínculo (ele nunca é enviado e nunca confere).
      const startedAt = Date.now();
      const pat = acc ? (await db.get('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)', acc.id, contact, contact)) : null;
      const reqRow = acc ? (await db.get('SELECT id FROM consultation_requests WHERE account_id = ? AND (lower(patient_email) = ? OR patient_phone = ?)', acc.id, contact, contact)) : null;
      const ttlMinutes = 15;
      let expiresAt;
      if (acc && (pat || reqRow)) {
        const ver = await issueVerificationCode(db, {
          purpose: 'patient_access',
          targetContact: contact,
          accountId: acc.id,
          patientId: pat?.id || null,
          subject: `Código de acesso ao Agendamento · ${acc.display_name}`,
          ttlMinutes,
        });
        expiresAt = ver.expiresAt;
        patientAccessSendMs = Math.min(4000, Date.now() - startedAt);
      } else {
        // Mesmas regras do código real: 30 s entre pedidos e o pedido novo invalida o anterior.
        const previous = await db.get("SELECT created_at FROM verification_tokens WHERE purpose = 'patient_access' AND target_contact = ? ORDER BY created_at DESC LIMIT 1", contact);
        if (previous && Date.now() - Date.parse(previous.created_at) < 30_000) {
          throw Object.assign(new Error('Aguarde 30 segundos antes de solicitar outro código.'), { status: 429, code: 'RESEND_RATE_LIMITED' });
        }
        await db.run("UPDATE verification_tokens SET consumed_at = ? WHERE purpose = 'patient_access' AND target_contact = ? AND consumed_at IS NULL", nowIso(), contact);
        expiresAt = addMinutesIso(ttlMinutes);
        await db.run(
          `INSERT INTO verification_tokens (id, purpose, target_contact, user_id, account_id, patient_id, code_hash, attempts, max_attempts, expires_at, created_at)
           VALUES (?, 'patient_access', ?, NULL, NULL, NULL, ?, 0, 5, ?, ?)`,
          randomId('ver'), contact, sha256Hex(randomToken(32)), expiresAt, nowIso()
        );
        // Espera parecida com a de um envio real de e-mail, para o tempo de resposta não denunciar a diferença.
        const target = (patientAccessSendMs || 450) * (0.85 + Math.random() * 0.3);
        const wait = Math.max(0, target - (Date.now() - startedAt));
        if (wait > 0 && process.env.ENOMERA_UNIFORM_DELAY !== 'off') await new Promise((r) => setTimeout(r, wait));
      }
      const mailer = getMailerStatus();
      return json(res, 200, {
        ok: true,
        expiresAt,
        message: 'Se houver solicitação ou cadastro associado a este contato, enviamos um código de verificação.',
        delivery: {
          sentExternally: Boolean(mailer.configured),
          notice: 'Se houver solicitação ou cadastro associado a este contato, o código chega em instantes. Confira também o spam.',
          delayGuidance: 'Se demorar mais de 60 segundos, verifique a pasta de spam, corrija o endereço acima ou solicite reenvio.',
        },
      });
    }

    if (method === 'POST' && pathname === '/api/v1/ambo/patient-access/verify') {
      const body = await readJsonBody(req);
      const slug = String(body.professionalSlug || '').trim();
      const contact = String(body.contact || '').trim().toLowerCase();
      let acc = slug ? await findAccountBySlug(db, slug) : null;
      if (slug && !acc) throw Object.assign(new Error('Profissional não encontrado.'), { status: 404, code: 'PROFESSIONAL_NOT_FOUND' });

      let verRow;
      try {
        verRow = await consumeVerificationCode(db, { purpose: 'patient_access', targetContact: contact, code: body.code });
      } catch (err) {
        // "Nenhum código pendente" denunciaria que o contato nunca recebeu código: responde como código incorreto.
        if (err.code === 'CODE_NOT_FOUND') throw Object.assign(new Error('Código incorreto. Confira os 6 dígitos e tente novamente.'), { status: 400, code: 'CODE_INVALID' });
        throw err;
      }
      // Código-isca (contato sem vínculo) nunca confere; por garantia, sem conta não há sessão.
      if (!verRow.account_id) throw Object.assign(new Error('Código incorreto. Confira os 6 dígitos e tente novamente.'), { status: 400, code: 'CODE_INVALID' });
      if (!acc) acc = await db.get('SELECT * FROM professional_accounts WHERE id = ?', verRow.account_id);
      if (!acc || verRow.account_id !== acc.id) {
        throw Object.assign(new Error('Código incorreto. Confira os 6 dígitos e tente novamente.'), { status: 400, code: 'CODE_INVALID' });
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

      // Um só cadastro com este contato: a sessão fica presa a ele. Mais de um (irmãos com o e-mail do
      // responsável, homônimos antigos): a sessão fica presa ao contato verificado e enxerga todos.
      const pats = await db.all('SELECT id FROM operational_patients WHERE account_id = ? AND (lower(email) = ? OR phone = ?)', acc.id, contact, contact);
      const patientId = pats.length === 1 ? pats[0].id : `contact:${contact}`;
      const sess = await issueSession(db, { userId: user.id, actorType: 'patient', accountId: acc.id, patientId, ttlMinutes: 120 });
      await writeAudit(db, { actorUserId: user.id, actorType: 'patient', accountId: acc.id, action: 'ambo.patient_verified', resourceType: 'session', resourceId: sess.id });
      return json(res, 200, { verified: true, sessionToken: sess.rawToken, expiresAt: sess.expiresAt, professionalSlug: acc.slug }, { 'Set-Cookie': sess.cookie });
    }

    if (method === 'GET' && pathname === '/api/v1/ambo/patient/me') {
      requirePatient(auth);
      const acc = (await db.get('SELECT * FROM professional_accounts WHERE id = ?', auth.session.account_id));
      const scope = await patientScope(db, auth);
      const patientRow = scope.rows[0] || null;
      const contactVal = scope.contact;
      const reqIdsSql = scope.ids.length ? `patient_id IN (${scope.ids.map(() => '?').join(', ')}) OR ` : '';
      const requests = await db.all(
        `SELECT id, protocol_code, modality, preferences_json, status, appointment_id, decline_message, created_at, updated_at FROM consultation_requests
         WHERE account_id = ? AND (${reqIdsSql}lower(patient_email) = ? OR patient_phone = ?) ORDER BY created_at DESC`,
        acc.id, ...scope.ids, contactVal || '', contactVal || (scope.rows[0]?.phone || '\u0000'));

      const rawAppts = await db.all(`SELECT id, modality, start_at, end_at, timezone, status, price_cents, version, updated_at FROM appointments WHERE ${scope.apptWhere} ORDER BY start_at DESC`, ...scope.apptArgs);

      const unlockMin = acc.online_unlock_minutes || 15;
      const appointments = await Promise.all(rawAppts.map(async (a) => {
        const reschedules = (await db.all('SELECT id, original_start_at, original_end_at, requested_start_at, requested_end_at, preferences_json, reason, status, initiated_by, created_at FROM reschedule_requests WHERE appointment_id = ? ORDER BY created_at DESC', a.id));
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
        // Lista completa dos 14 dias: o Agendamento ordena pelo que o paciente pediu e espalha pelos dias.
        availableSlots: (await generateAvailableSlots(db, acc.id, { daysAhead: 14 })).slice(0, 400),
      });
    }

    const patReschedMatch = pathname.match(/^\/api\/v1\/ambo\/patient\/appointments\/([^/]+)\/reschedule$/);
    if (method === 'POST' && patReschedMatch) {
      requirePatient(auth);
      const body = await readJsonBody(req);
      const { patient_id: patientId } = await patientOwnedAppointment(db, auth, patReschedMatch[1]);
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
      const acctForNotice = await db.get('SELECT * FROM professional_accounts WHERE id = ?', auth.session.account_id);
      await notifyProfessionalOfPatientChange(db, req, acctForNotice, resData, 'reschedule');
      return json(res, resData.idempotentReplay ? 200 : 201, resData);
    }

    const patCancelMatch = pathname.match(/^\/api\/v1\/ambo\/patient\/appointments\/([^/]+)\/cancel$/);
    if (method === 'POST' && patCancelMatch) {
      requirePatient(auth);
      const body = await readJsonBody(req);
      const { patient_id: patientId } = await patientOwnedAppointment(db, auth, patCancelMatch[1]);
      const resData = await cancelAppointmentTx(db, {
        accountId: auth.session.account_id,
        appointmentId: patCancelMatch[1],
        actorType: 'patient',
        patientId,
        reason: body.reason || '',
      });
      const acctForNotice = await db.get('SELECT * FROM professional_accounts WHERE id = ?', auth.session.account_id);
      await notifyProfessionalOfPatientChange(db, req, acctForNotice, resData, 'cancel');
      return json(res, 200, resData);
    }

    const patProposalMatch = pathname.match(/^\/api\/v1\/ambo\/patient\/reschedules\/([^/]+)\/respond$/);
    if (method === 'POST' && patProposalMatch) {
      requirePatient(auth);
      const body = await readJsonBody(req);
      const decision = body.decision === 'accept' ? 'accept' : body.decision === 'decline' ? 'decline' : null;
      if (!decision) throw Object.assign(new Error('Escolha aceitar ou manter o horário atual.'), { status: 400, code: 'DECISION_REQUIRED' });
      const scope = await patientScope(db, auth);
      const out = await respondToProfessionalProposal(db, { accountId: auth.session.account_id, rescheduleId: patProposalMatch[1], patientIds: scope.ids, decision });
      const acctForNotice = await db.get('SELECT * FROM professional_accounts WHERE id = ?', auth.session.account_id);
      out.professionalNotification = await notifyProfessionalOfProposalAnswer(db, req, acctForNotice, out, decision);
      return json(res, 200, out);
    }

    // Invitations (returning patients)
    if (method === 'POST' && pathname === '/api/v1/ambo/invitations') {
      await requireProfessional(db, auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const pat = (await db.get('SELECT * FROM operational_patients WHERE id = ? AND account_id = ?', body.patientId, auth.account.id));
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      const rawToken = `inv_${randomToken(18)}`;
      const id = randomId('inv');
      const days = body.expiresInDays == null ? 7 : Number(body.expiresInDays);
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        throw Object.assign(new Error('O convite pode valer de 1 a 30 dias.'), { status: 400, code: 'INVALID_EXPIRY' });
      }
      const expiresAt = addDaysIso(days);
      const targetContact = String(body.targetContact || pat.email || pat.phone || '').trim();
      const channelOk = ['email', 'whatsapp'].includes(body.channel || 'email');
      const contactOk = z.string().email().max(254).safeParse(targetContact).success || /^\+?[\d\s().-]{8,20}$/.test(targetContact);
      if (!channelOk || !contactOk) {
        throw Object.assign(new Error('Informe um e-mail ou telefone válido para enviar o convite.'), { status: 400, code: 'INVALID_CONTACT' });
      }
      (await db.run(`
        INSERT INTO patient_invitations (id, account_id, patient_id, token_hash, channel, target_contact, status, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `, id, auth.account.id, pat.id, sha256Hex(rawToken), body.channel || 'email', targetContact, expiresAt, nowIso()));

      const inviteUrl = agendamentoUrl(req, auth.account.slug, { convite: rawToken }) || null;
      const expiresLabel = new Date(expiresAt).toLocaleDateString('pt-BR', { timeZone: auth.account.timezone || 'America/Sao_Paulo' });
      const proName = auth.account.display_name;
      const delivery = await sendTransactionalEmail(db, {
        channel: body.channel || 'email',
        recipient: targetContact,
        subject: `Convite para agendar com ${proName} · Agendamento`,
        textBody: inviteUrl
          ? `${proName} convidou você para escolher um horário. Abra o link (uso único, válido até ${expiresLabel}): ${inviteUrl}`
          : `Use seu convite de uso único para escolher um horário com ${proName} (válido até ${expiresLabel}): ${rawToken}`,
        htmlBody: inviteUrl
          ? `<p><b>${escHtml(proName)}</b> convidou você para escolher um horário.</p><p><a href="${escHtml(inviteUrl)}">Escolher horário no Agendamento</a></p><p>O convite é de uso único e vale até ${expiresLabel}.</p>`
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

    // Agendamento Solo Professional Console (works WITHOUT Consultório!)
    if (method === 'GET' && pathname === '/api/v1/ambo/pro/overview') {
      await requireProfessional(db, auth, { product: 'ambo', write: false });
      const requests = await Promise.all((await db.all('SELECT * FROM consultation_requests WHERE account_id = ? ORDER BY created_at DESC', auth.account.id)).map(async (r) => ({
        ...r,
        preferences: JSON.parse(r.preferences_json || '{}'),
        answers: JSON.parse(r.answers_json || '{}'),
        duplicateCandidate: await currentDuplicateCandidate(db, r),
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
      const proposals = await db.all("SELECT id, appointment_id, requested_start_at, requested_end_at, reason, created_at FROM reschedule_requests WHERE account_id = ? AND status = 'proposed'", auth.account.id);
      const proposalByAppt = new Map(proposals.map((p) => [p.appointment_id, p]));
      const isOwner = auth.membership?.role === 'owner';
      return json(res, 200, {
        account: { id: auth.account.id, slug: auth.account.slug, displayName: auth.account.display_name, timezone: auth.account.timezone || 'America/Sao_Paulo' },
        // Ações que esta Core oferece (o Agendamento só mostra os botões quando vierem true).
        capabilities: { declineRequest: isOwner, cancelAppointment: isOwner, proposeReschedule: isOwner },
        requests,
        appointments: appointments.map((a) => ({
          ...a,
          proposedReschedule: proposalByAppt.get(a.id) || null,
          // Pedido de remarcação do paciente ainda sem resposta (para responder também pela Agenda).
          pendingReschedule: reschedules.find((r) => r.appointment_id === a.id) || null,
          // Dias e turnos que o paciente pediu na primeira consulta: orientam qualquer novo horário.
          requestPreferences: requests.find((r) => r.appointment_id === a.id)?.preferences || null,
        })),
        pendingReschedules: reschedules.map((r) => ({ ...r, requestPreferences: requests.find((q) => q.appointment_id === r.appointment_id)?.preferences || null })),
        patients,
        invitations,
        availableSlots: await generateAvailableSlots(db, auth.account.id, { daysAhead: 14 }),
        setup: await amboSetupPayload(db, auth.account.id),
      });
    }

    // Configuração do atendimento no Agendamento: modalidades, local, duração, valor e horários semanais.
    // `open: true` abre a página pública para pedidos; `open: false` fecha sem apagar nada.
    if (method === 'PUT' && pathname === '/api/v1/ambo/pro/setup') {
      await requireProfessional(db, auth, { product: 'ambo', write: true });
      const body = await readJsonBody(req);
      const acc = await db.get('SELECT * FROM professional_accounts WHERE id = ?', auth.account.id);
      const modalities = Array.isArray(body.modalities) ? body.modalities.filter((m) => m === 'online' || m === 'presencial') : null;
      if (modalities && modalities.length === 0) throw Object.assign(new Error('Escolha ao menos uma modalidade de atendimento.'), { status: 400, code: 'AMBO_SETUP_MODALITY' });
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      const rules = Array.isArray(body.rules) ? body.rules.map((r) => ({
        weekday: Number(r.weekday), startTime: String(r.startTime || ''), endTime: String(r.endTime || ''), modality: ['online', 'presencial', 'both'].includes(r.modality) ? r.modality : 'both',
      })) : null;
      if (rules && rules.some((r) => !(r.weekday >= 0 && r.weekday <= 6) || !timeRe.test(r.startTime) || !timeRe.test(r.endTime) || r.endTime <= r.startTime)) {
        throw Object.assign(new Error('Confira os horários: o fim precisa ser depois do início.'), { status: 400, code: 'AMBO_SETUP_RULES' });
      }
      const finalModalities = modalities || JSON.parse(acc.modalities_json || '["online","presencial"]');
      const before = amboSetupOf(acc);
      const wasFresh = !before.demo && !before.reviewedAt && !before.open;
      // Primeira revisão: o que a profissional não informou não herda o exemplo das colunas.
      const city = body.city != null ? String(body.city).trim() : (wasFresh && acc.city === AMBO_DEFAULT_CITY ? '' : acc.city);
      const address = body.inPersonAddress != null ? String(body.inPersonAddress).trim() : (wasFresh || acc.in_person_address === AMBO_DEFAULT_ADDRESS ? '' : acc.in_person_address);
      const priceGiven = Number.isFinite(Number(body.sessionPriceCents)) && body.sessionPriceCents !== null && body.sessionPriceCents !== '' && Number(body.sessionPriceCents) >= 0;
      if (body.open && finalModalities.includes('presencial') && !String(address || '').trim()) {
        throw Object.assign(new Error('Informe o endereço do consultório para atender presencialmente.'), { status: 400, code: 'AMBO_SETUP_ADDRESS' });
      }
      if (body.open && rules && rules.length === 0) {
        throw Object.assign(new Error('Libere ao menos um horário na semana para abrir a agenda.'), { status: 400, code: 'AMBO_SETUP_NO_HOURS' });
      }
      let prefs = {};
      try { prefs = JSON.parse(acc.ui_preferences_json || '{}') || {}; } catch { prefs = {}; }
      const now = nowIso();
      prefs.amboSetup = {
        ...(prefs.amboSetup || {}),
        reviewedAt: now,
        openedAt: body.open === true ? (prefs.amboSetup?.openedAt || now) : body.open === false ? null : (prefs.amboSetup?.openedAt || null),
      };
      if (body.address !== undefined) prefs.amboSetup.address = cleanAmboAddress(body.address);
      if (priceGiven) delete prefs.amboSetup.priceUnset;
      else if (wasFresh) prefs.amboSetup.priceUnset = true;
      await runTransaction(db, async (db) => {
        await db.run(`UPDATE professional_accounts SET modalities_json = ?, city = ?, in_person_address = ?,
            session_duration_min = COALESCE(?, session_duration_min), session_price_cents = COALESCE(?, session_price_cents),
            ui_preferences_json = ?, updated_at = ? WHERE id = ?`,
          JSON.stringify(finalModalities), city, address,
          Number.isFinite(Number(body.sessionDurationMin)) && Number(body.sessionDurationMin) >= 15 ? Number(body.sessionDurationMin) : null,
          priceGiven ? Math.round(Number(body.sessionPriceCents)) : null,
          JSON.stringify(prefs), now, auth.account.id);
        if (rules) {
          await db.run('DELETE FROM availability_rules WHERE account_id = ?', auth.account.id);
          for (const r of rules) {
            await db.run(`INSERT INTO availability_rules (id, account_id, weekday, start_time, end_time, modality, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?)`, randomId('avr'), auth.account.id, r.weekday, r.startTime, r.endTime, r.modality, now);
          }
        }
      });
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: body.open === true ? 'ambo.setup_open' : body.open === false ? 'ambo.setup_close' : 'ambo.setup_save', resourceType: 'professional_account', resourceId: auth.account.id });
      return json(res, 200, { ok: true, setup: await amboSetupPayload(db, auth.account.id) });
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
        simulateDelayedSync: allowTestHooks() && Boolean(body.simulateDelayedSync),
      });
      out.patientNotification = await notifyPatientOfConfirmation(db, req, auth.account, out);
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
      out.patientNotification = await notifyPatientOfRescheduleDecision(db, req, auth.account, out, body.decision === 'decline' ? 'decline' : 'approve');
      return json(res, 200, out);
    }

    const amboProDecline = pathname.match(/^\/api\/v1\/ambo\/pro\/requests\/([^/]+)\/decline$/);
    if (method === 'POST' && amboProDecline) {
      await requireAgendaOwner(db, auth);
      const body = await readJsonBody(req);
      const out = await declineConsultationRequest(db, {
        accountId: auth.account.id, actorUserId: auth.user.id, requestId: amboProDecline[1],
        message: typeof body.message === 'string' ? body.message : '', sourceProduct: 'ambo',
      });
      out.patientNotification = await notifyPatientOfDecline(db, req, auth.account, out);
      return json(res, 200, out);
    }

    const amboProCancel = pathname.match(/^\/api\/v1\/ambo\/pro\/appointments\/([^/]+)\/cancel$/);
    if (method === 'POST' && amboProCancel) {
      await requireAgendaOwner(db, auth);
      const body = await readJsonBody(req);
      const out = await cancelAppointmentTx(db, {
        accountId: auth.account.id, appointmentId: amboProCancel[1], actorType: 'professional', actorUserId: auth.user.id,
        reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '', sourceProduct: 'ambo',
      });
      const patientNotice = await notifyPatientOfCancellation(db, req, auth.account, out);
      return json(res, 200, { ...out, patientNotice });
    }

    const amboProResched = pathname.match(/^\/api\/v1\/ambo\/pro\/appointments\/([^/]+)\/reschedule$/);
    if (method === 'POST' && amboProResched) {
      await requireAgendaOwner(db, auth);
      const body = await readJsonBody(req);
      const out = await proposeRescheduleByProfessional(db, {
        accountId: auth.account.id, actorUserId: auth.user.id, appointmentId: amboProResched[1],
        startAt: body.startAt, endAt: body.endAt, reason: typeof body.reason === 'string' ? body.reason : '',
        idempotencyKey: req.headers['x-idempotency-key'] || body.idempotencyKey || null,
      });
      out.patientNotification = await notifyPatientOfProposal(db, req, auth.account, out);
      return json(res, out.idempotentReplay ? 200 : 201, out);
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
        duplicateCandidate: await currentDuplicateCandidate(db, r),
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
        simulateDelayedSync: allowTestHooks() && Boolean(body.simulateDelayedSync),
      });
      out.patientNotification = await notifyPatientOfConfirmation(db, req, auth.account, out);
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
      out.patientNotification = await notifyPatientOfRescheduleDecision(db, req, auth.account, out, body.decision === 'decline' ? 'decline' : 'approve');
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
      const patientNotice = await notifyPatientOfCancellation(db, req, auth.account, out);
      return json(res, 200, { ...out, patientNotice });
    }

    // Clinical Notes, Drafts & Version History
    const patNotesMatch = pathname.match(/^\/api\/v1\/minne\/patients\/([^/]+)\/notes$/);
    if (method === 'GET' && patNotesMatch) {
      await requireProfessional(db, auth, { product: 'minne', write: false, clinical: true });
      const patientId = patNotesMatch[1];
      const pat = (await db.get('SELECT id, full_name FROM operational_patients WHERE id = ? AND account_id = ?', patientId, auth.account.id));
      if (!pat) throw Object.assign(new Error('Paciente não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
      // Trilha de leitura do prontuário: quem abriu, quando e de qual paciente (nunca o conteúdo).
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'clinical.notes_read', resourceType: 'patient', resourceId: patientId });

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
      // Os produtos leem o mesmo banco: "propagar" é conferir que o registro de origem existe e está
      // íntegro nesta conta. Só então o evento é dado como sincronizado; senão, o erro fica registrado.
      const table = { appointment: 'appointments', reschedule_request: 'reschedule_requests' }[ev.entity_type];
      const entity = table ? await db.get(`SELECT id FROM ${table} WHERE id = ? AND account_id = ?`, ev.entity_id, auth.account.id) : null;
      if (entity) {
        (await db.run("UPDATE sync_events SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?", now, ev.id));
      } else {
        (await db.run("UPDATE sync_events SET status = 'pending_retry', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?", 'Registro de origem não encontrado nesta conta.', now, ev.id));
        throw Object.assign(new Error('Não foi possível concluir a sincronização: o registro de origem não foi encontrado. Fale com a Enomera.'), { status: 409, code: 'SYNC_SOURCE_MISSING' });
      }
      return json(res, 200, { event: (await db.get('SELECT * FROM sync_events WHERE id = ?', ev.id)) });
    }

    // ── PRIVATE FILES STREAMING (ZERO PUBLIC CLINICAL URLS!) ──────────
    const fileMatch = pathname.match(/^\/api\/v1\/files\/([^/]+)$/);
    if (method === 'GET' && fileMatch) {
      requireAuth(auth);
      const fileRow = (await db.get('SELECT * FROM private_files WHERE id = ?', fileMatch[1]));
      if (!fileRow) throw Object.assign(new Error('Arquivo não encontrado.'), { status: 404, code: 'FILE_NOT_FOUND' });

      if (fileRow.scope === 'minne_clinical') {
        // STRICTLY professional with clinical membership on THAT account — NEVER patient or Site operator!
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
        'Content-Disposition': contentDispositionAttachment(fileRow.original_name),
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
      return json(res, 201, { id, status: 'waiting', chargedCents: 0, message: 'Você entrou na lista de espera do Site sem qualquer cobrança.' });
    }

    if (method === 'GET' && pathname === '/api/v1/etha/project') {
      await requireProfessional(db, auth, { product: 'etha', write: false });
      const proj = await ensureEthaProject(db, auth.account.id);
      const selection = await readAccountSelection(db, auth.account.id).catch(() => null);
      return json(res, 200, { ...(await buildEthaProjectDetail(db, proj)), contractedService: selection?.ethaService === 'sob_medida' ? 'sob_medida' : 'essencial' });
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
      if (body.customContactUrl != null) body.customContactUrl = safeContactUrl(body.customContactUrl);
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
      if (!body.ctaMode && !proj.cta_mode) blockers.push('Definir destino do botão de contato (Agendamento ou canal próprio)');

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
        customContactUrl: z.string().max(1000).optional(), crp: z.string().max(100).optional(),
        // Site por modelo (23/11): respostas guiadas que preenchem o modelo do site.
        answers: z.record(z.string(), z.any()).optional() }).parse(body.content || {});
      if (content.customContactUrl != null) content.customContactUrl = safeContactUrl(content.customContactUrl);
      if (content.answers && JSON.stringify(content.answers).length > 20000) throw Object.assign(new Error('Respostas grandes demais.'), { status: 400, code: 'ANSWERS_TOO_LARGE' });
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
      if (!version) throw Object.assign(new Error('Nenhuma versão encontrada para publicar.'), { status: 404, code: 'VERSION_NOT_FOUND' });
      // Só entra no ar o que a profissional viu: a prévia que ela mandou publicar, uma versão aprovada
      // ou uma já publicada (voltar a uma anterior). Rascunho nunca é publicado direto.
      if (!['preview', 'approved', 'published'].includes(version.stage)) {
        throw Object.assign(new Error('Esta versão ainda é um rascunho. Abra a prévia e confirme antes de publicar.'), { status: 409, code: 'VERSION_NOT_READY' });
      }
      const now = nowIso();
      const ctaMode = body.ctaMode === 'custom' || (body.ctaMode == null && proj.cta_mode === 'custom') ? 'custom' : 'ambo';
      const customContactUrl = body.customContactUrl != null ? safeContactUrl(body.customContactUrl) : proj.custom_contact_url;
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
          ? `Site publicado no endereço da Enomera. O domínio próprio (${proj.domain_name}) passa a valer quando o DNS for configurado pelo titular.`
          : 'Site publicado no endereço da Enomera.',
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
      if (!proj) throw Object.assign(new Error('Projeto Site não encontrado.'), { status: 404, code: 'PROJECT_NOT_FOUND' });
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

    // Troca do endereço (slug) do site (SITE-53). Só o dono da conta; endereço único e validado;
    // o endereço anterior continua levando ao mesmo site; uma troca a cada 30 dias.
    if (method === 'PATCH' && pathname === '/api/v1/etha/site-address') {
      await requireProfessional(db, auth, { product: 'etha', write: true });
      if (auth.membership.role !== 'owner') throw Object.assign(new Error('Só quem criou a conta pode trocar o endereço do site.'), { status: 403, code: 'OWNER_REQUIRED' });
      const body = await readJsonBody(req);
      const slug = String(body.slug || '').trim().toLowerCase();
      if (!/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(slug) || slug.includes('--')) {
        throw Object.assign(new Error('Use de 3 a 40 letras minúsculas, números ou hífen, sem acento e sem espaço. Ex.: ana-souza-psi.'), { status: 400, code: 'SLUG_INVALID' });
      }
      if (RESERVED_SLUGS.has(slug)) throw Object.assign(new Error('Este endereço é reservado. Escolha outro.'), { status: 400, code: 'SLUG_RESERVED' });
      const current = auth.account.slug;
      if (slug === current) return json(res, 200, { ok: true, slug, previousSlug: null, unchanged: true });
      const out = await runTransaction(db, async (tx) => {
        if (await slugTaken(tx, slug, auth.account.id)) throw Object.assign(new Error('Este endereço já está em uso. Escolha outro.'), { status: 409, code: 'SLUG_TAKEN' });
        const mine = await tx.get('SELECT slug FROM account_slug_aliases WHERE slug = ? AND account_id = ?', slug, auth.account.id);
        if (!mine) {
          const last = await tx.get('SELECT created_at FROM account_slug_aliases WHERE account_id = ? ORDER BY created_at DESC LIMIT 1', auth.account.id);
          if (last && Date.now() - Date.parse(last.created_at) < 30 * 86_400_000) {
            throw Object.assign(new Error('O endereço do site só pode ser trocado uma vez a cada 30 dias.'), { status: 429, code: 'SLUG_CHANGE_TOO_SOON' });
          }
        } else {
          await tx.run('DELETE FROM account_slug_aliases WHERE slug = ?', slug); // voltando a um endereço que já foi desta conta
        }
        const now = nowIso();
        await tx.run('INSERT INTO account_slug_aliases (slug, account_id, created_at) VALUES (?, ?, ?)', current, auth.account.id, now);
        await tx.run('UPDATE professional_accounts SET slug = ?, updated_at = ? WHERE id = ?', slug, now, auth.account.id);
        return { slug, previousSlug: current };
      }, `slug:${slug}`);
      await writeAudit(db, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'etha.site_address_change', resourceType: 'professional_account', resourceId: auth.account.id, meta: out });
      return json(res, 200, { ok: true, ...out, message: 'Endereço trocado. O endereço anterior continua levando ao seu site.' });
    }

    // Public Staging Site (Consumed by Helena Duarte site!)
    const pubSiteMatch = pathname.match(/^\/api\/v1\/public\/sites\/([^/]+)$/);
    if (method === 'GET' && pubSiteMatch) {
      const acc = await findAccountBySlug(db, pubSiteMatch[1]);
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
    // Erro inesperado (banco, biblioteca): detalhe só no log do servidor, nunca na resposta.
    if (status >= 500 && !err.code) console.error('[core] erro interno', pathname, err);
    const payload = { error: status >= 500 && !err.code ? 'Erro interno no servidor. Tente de novo em instantes.' : (err.message || 'Erro interno no servidor.'), code: err.code || 'INTERNAL_ERROR' };
    if (status === 429 && err.retryAfterSec) return json(res, 429, { ...payload, retryAfterSec: err.retryAfterSec }, { 'Retry-After': String(err.retryAfterSec) });
    if (err.suggestions) payload.suggestions = err.suggestions;
    if (err.product) payload.product = err.product;
    if (err.missingEnvVars) payload.missingEnvVars = err.missingEnvVars;
    return json(res, status, payload);
  }
}

// Ativação sem pagamento (checkout simulado / reativar sem período pago). FECHADA por padrão:
// só liga com ENOMERA_ALLOW_SIMULATED_CHECKOUT=true e nunca em produção (VERCEL_ENV=production),
// mesmo que a variável esteja definida lá. Convidado do piloto não depende disto: o acesso
// gratuito dele vem do convite aceito (pilot_participants), conferido no servidor.
export function allowSimulatedActivation() {
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.ENOMERA_ALLOW_SIMULATED_CHECKOUT === 'true';
}

// O seed de demonstração roda uma vez por banco aberto (e não a cada requisição).
const seededDbs = new WeakSet();
async function seedOnce(db) {
  if (seededDbs.has(db)) return;
  await seedDatabase(db);
  seededDbs.add(db);
}

// Ganchos de teste (ex.: simulateDelayedSync) nunca valem em produção nem em ambiente remoto.
function allowTestHooks() {
  return process.env.VERCEL_ENV !== 'production' && !isRemoteInfraRequired();
}

// Aceite dos Termos e da Política: grava versão e data na conta; a auditoria guarda o registro do ato.
async function recordTermsAcceptance(db, req, userId, accountId = null) {
  const now = nowIso();
  await db.run('UPDATE users SET terms_accepted_at = ?, terms_version = ?, updated_at = ? WHERE id = ?', now, TERMS_VERSION, now, userId);
  await writeAudit(db, { actorUserId: userId, actorType: 'professional', accountId, action: 'legal.terms_accept', resourceType: 'user', resourceId: userId, meta: { version: TERMS_VERSION, ipHash: sha256Hex(clientIp(req)).slice(0, 16) } });
  return now;
}

// Ativar ou contratar serviços exige o aceite registrado. Quem ainda não aceitou pode aceitar
// no próprio pedido (acceptTerms: true), o que grava o aceite antes de seguir.
async function requireTermsAccepted(db, req, auth, body) {
  if (auth.user.terms_accepted_at) return;
  if (body?.acceptTerms === true) {
    auth.user.terms_accepted_at = await recordTermsAcceptance(db, req, auth.user.id, auth.account?.id || null);
    return;
  }
  throw Object.assign(new Error('Para continuar, leia e aceite os Termos de Uso e a Política de Privacidade.'), { status: 403, code: 'TERMS_ACCEPTANCE_REQUIRED', termsVersion: TERMS_VERSION });
}

// Duração do último envio real de código ao paciente (para igualar o tempo da resposta sem vínculo).
let patientAccessSendMs = 0;

const CLINICAL_STEPUP_MAX_AGE_MS = 12 * 3600_000;

const PRODUCT_LABELS = { ambo: 'Agendamento', minne: 'Consultório', etha: 'Site' };

function formatDateBr(value) {
  const d = new Date(periodEndMs(value));
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : String(value || '');
}

// Teste grátis da oferta (2 semanas, sem cartão): uma vez por serviço. Quem já usou o teste
// ou já teve o serviço ativo precisa da contratação paga.
async function assertTrialAvailable(db, accountId, products) {
  const rows = await db.all('SELECT product, status, trial_ends_at, current_period_end FROM entitlements WHERE account_id = ?', accountId);
  const now = Date.now();
  for (const product of products || []) {
    const r = rows.find((x) => x.product === product);
    if (!r) continue;
    const trialRunning = r.status === 'trial' && r.trial_ends_at && Date.parse(r.trial_ends_at) > now;
    const paidRunning = ['active', 'cancelled_grace'].includes(r.status) && r.current_period_end && periodEndMs(r.current_period_end) > now;
    if (trialRunning || paidRunning) continue;
    throw Object.assign(new Error('O período grátis deste serviço já foi usado. Para continuar, conclua a contratação com pagamento na aba Cobrança.'), { status: 402, code: 'PAYMENT_REQUIRED', product });
  }
}

// current_period_end pode ser data (AAAA-MM-DD, do Asaas) ou instante ISO: a data vale até o fim do dia em São Paulo.
function periodEndMs(value) {
  const v = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T23:59:59-03:00`) : Date.parse(v);
}

// Link de contato do site: https:// (WhatsApp, Instagram, site), mailto: ou tel:. Nunca javascript:.
function safeContactUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^(mailto:[^\s<>"']+@[^\s<>"']+|tel:\+?[\d\s().-]{8,20})$/i.test(s)) return s;
  return safeHttpsUrl(s, { field: 'customContactUrl' });
}

async function activateOrderEntitlementsTx(db, accountId, quote, { pilotFree = false, trial = false } = {}) {
  const now = nowIso();
  if (trial) {
    // 2 semanas grátis: situação "trial" com data de fim; quem já tem o serviço em dia fica como está.
    const trialEndsAt = addDaysIso(COMMERCIAL_CATALOG.trialDays);
    for (const prod of quote.selectedProducts || []) {
      (await db.run(`
        INSERT INTO entitlements (id, account_id, product, status, billing_mode, trial_ends_at, cancelled_at, updated_at)
        VALUES (?, ?, ?, 'trial', 'trial', ?, NULL, ?)
        ON CONFLICT(account_id, product) DO NOTHING
      `, randomId('ent'), accountId, prod, trialEndsAt, now));
      if (prod === 'etha') await ensureEthaProject(db, accountId, quote.ethaFormat || 'one_page');
    }
    return;
  }
  const periodEnd = pilotFree ? PILOT_FREE_UNTIL : addDaysIso(30);
  const mode = pilotFree ? 'pilot' : quote.billing === 'permanent' ? 'annual' : 'monthly';
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
    `, randomId('ent'), accountId, prod, mode, periodEnd, now));
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
