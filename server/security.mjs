// Proteções transversais da Core (auditoria de segurança, 24 nov 2026).
// - Limite de tentativas guardado no banco, para valer entre as instâncias serverless da Vercel.
// - Ajudantes de validação de URL e de nome de arquivo em cabeçalho.
// Desligar só em teste local: ENOMERA_RATE_LIMIT=off.

export async function applyRateLimitMigration(tx) {
  await tx.exec(`CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    expires_at BIGINT NOT NULL
  )`);
  await tx.exec('CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at)');
}

/** IP de quem chama. Na Vercel, x-real-ip e o primeiro x-forwarded-for vêm da borda. */
export function clientIp(req) {
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket?.remoteAddress || 'unknown';
}

function rateLimitDisabled() {
  return process.env.ENOMERA_RATE_LIMIT === 'off';
}

/**
 * Janela fixa: conta um acesso e recusa com 429 quando passa do limite.
 * rules = [{ key, limit, windowSec }]
 */
export async function enforceRateLimit(db, rules) {
  if (rateLimitDisabled()) return;
  const now = Date.now();
  for (const r of rules) {
    if (!r || !r.key) continue;
    const windowMs = r.windowSec * 1000;
    const slot = Math.floor(now / windowMs);
    const bucket = `${r.key}:${r.windowSec}:${slot}`;
    const expiresAt = (slot + 1) * windowMs;
    await db.run(
      `INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET hits = rate_limits.hits + 1`,
      bucket, expiresAt
    );
    const row = await db.get('SELECT hits FROM rate_limits WHERE bucket = ?', bucket);
    if (Number(row?.hits || 0) > r.limit) {
      const retryAfterSec = Math.max(1, Math.ceil((expiresAt - now) / 1000));
      throw Object.assign(new Error(r.message || 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.'), {
        status: 429, code: 'RATE_LIMITED', retryAfterSec,
      });
    }
  }
  if (Math.random() < 0.02) {
    await db.run('DELETE FROM rate_limits WHERE expires_at < ?', now).catch(() => null);
  }
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/**
 * Regras por rota. `body` é o JSON já lido (fica guardado na requisição),
 * para limitar também por e-mail/contato e não só por IP.
 */
export function rateLimitRulesFor(method, pathname, ip, body = {}) {
  if (method !== 'POST') return null;
  const contact = String(body?.email || body?.contact || '').trim().toLowerCase().slice(0, 200);
  const codeMsg = 'Muitos pedidos de código para este endereço. Aguarde alguns minutos e tente de novo.';
  const tryMsg = 'Muitas tentativas de código. Peça um novo código daqui a pouco.';

  // Pedidos de código enviam e-mail: limitar protege a caixa de quem recebe e a conta de envio.
  if (['/api/v1/auth/email-code/request', '/api/v1/auth/recovery/request', '/api/v1/ambo/patient-access/request',
    '/api/v1/auth/resend-verification', '/api/v1/auth/signup', '/api/v1/auth/change-email', '/api/v1/auth/stepup/request'].includes(pathname)
    || /^\/api\/v1\/pilot\/invites\/[^/]+\/code$/.test(pathname)) {
    return [
      { key: `otpreq:ip:${ip}`, limit: 20, windowSec: HOUR },
      contact && { key: `otpreq:c:${contact}`, limit: 6, windowSec: HOUR, message: codeMsg },
      contact && { key: `otpreq:cd:${contact}`, limit: 20, windowSec: DAY, message: codeMsg },
    ].filter(Boolean);
  }
  // Conferência de código: cada código aceita 5 erros, e estes tetos impedem trocar de código sem fim.
  if (['/api/v1/auth/email-code/verify', '/api/v1/auth/verify-email', '/api/v1/auth/recovery/confirm',
    '/api/v1/ambo/patient-access/verify', '/api/v1/auth/stepup/verify'].includes(pathname)) {
    return [
      { key: `otpver:ip:${ip}`, limit: 40, windowSec: HOUR, message: tryMsg },
      contact && { key: `otpver:c:${contact}`, limit: 15, windowSec: HOUR, message: tryMsg },
      contact && { key: `otpver:cd:${contact}`, limit: 40, windowSec: DAY, message: tryMsg },
    ].filter(Boolean);
  }
  if (pathname === '/api/v1/auth/login') {
    return [
      { key: `login:ip:${ip}`, limit: 30, windowSec: 10 * MIN },
      contact && { key: `login:c:${contact}`, limit: 10, windowSec: 15 * MIN, message: 'Muitas tentativas de entrada nesta conta. Aguarde 15 minutos ou use "Esqueci a senha".' },
    ].filter(Boolean);
  }
  if (/^\/api\/v1\/ambo\/public\/[^/]+\/requests$/.test(pathname)) {
    return [{ key: `amboreq:ip:${ip}`, limit: 10, windowSec: HOUR, message: 'Muitos pedidos enviados daqui. Tente de novo mais tarde.' }];
  }
  if (/^\/api\/v1\/pilot\/invites\/[^/]+\/accept$/.test(pathname) || pathname === '/api/v1/ambo/invitations/verify') {
    return [{ key: `invite:ip:${ip}`, limit: 15, windowSec: HOUR }];
  }
  if (pathname === '/api/v1/auth/exchange') {
    return [{ key: `exchange:ip:${ip}`, limit: 60, windowSec: 10 * MIN }];
  }
  if (pathname === '/api/v1/pilot/events') {
    return [{ key: `pilotev:ip:${ip}`, limit: 600, windowSec: 10 * MIN }];
  }
  // Chat de ajuda: chamados enviam e-mail à Enomera; perguntas sem resposta só gravam texto.
  if (pathname === '/api/v1/suporte/chamados') {
    return [
      { key: `supt:ip:${ip}`, limit: 5, windowSec: HOUR, message: 'Você já mandou algumas mensagens agora. A gente responde por e-mail; se for urgente, use o WhatsApp.' },
      contact && { key: `supt:c:${contact}`, limit: 5, windowSec: DAY, message: 'Já recebemos as suas mensagens de hoje. A gente responde por e-mail.' },
    ].filter(Boolean);
  }
  if (pathname === '/api/v1/suporte/sem-resposta') {
    return [{ key: `supq:ip:${ip}`, limit: 30, windowSec: HOUR }];
  }
  if (pathname === '/api/v1/etha/waitlist' || pathname === '/api/v1/commercial/pilot/apply') {
    return [{ key: `form:ip:${ip}`, limit: 10, windowSec: HOUR }];
  }
  return null;
}

/** Aceita só endereço https:// (ou vazio). Bloqueia javascript:, data: e afins. */
export function safeHttpsUrl(value, { field = 'url', allowEmpty = true, allowHttp = false } = {}) {
  if (value == null) return value;
  const s = String(value).trim();
  if (!s) {
    if (allowEmpty) return '';
    throw Object.assign(new Error('Informe um endereço.'), { status: 400, code: 'INVALID_URL', field });
  }
  let u;
  try { u = new URL(s); } catch {
    throw Object.assign(new Error('Endereço inválido. Use um link completo, começando com https://'), { status: 400, code: 'INVALID_URL', field });
  }
  const ok = u.protocol === 'https:' || (allowHttp && u.protocol === 'http:');
  if (!ok || s.length > 1000) {
    throw Object.assign(new Error('Use um link que comece com https://'), { status: 400, code: 'INVALID_URL', field });
  }
  return u.href;
}

/** Nome de arquivo seguro para Content-Disposition (sem aspas nem quebras de linha). */
export function contentDispositionAttachment(name) {
  const raw = String(name || 'arquivo').replace(/[\r\n"\\]/g, '_').slice(0, 180) || 'arquivo';
  const ascii = raw.normalize('NFD').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}
