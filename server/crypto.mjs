import crypto from 'node:crypto';

export function randomId(prefix = '') {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomDigits(len = 6) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += crypto.randomInt(0, 10).toString();
  }
  return out;
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPassword(password, expectedHash, salt) {
  if (!password || !expectedHash || !salt) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function detectFileMagic(buffer, filename = '') {
  const lower = (filename || '').toLowerCase();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { mime: 'application/octet-stream', format: 'unsupported', safe: false };
  }
  // PDF: %PDF-
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { mime: 'application/pdf', format: 'pdf', safe: true };
  }
  // PNG: 89 50 4E 47
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: 'image/png', format: 'png', safe: true };
  }
  // JPG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', format: 'jpg', safe: true };
  }
  // Legacy OLE2 .doc: D0 CF 11 E0
  if (buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return { mime: 'application/msword', format: 'legacy_doc', safe: false };
  }
  // ZIP-based (DOCX, XLSX, ZIP): PK\x03\x04
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05)) {
    if (lower.endsWith('.docx')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', format: 'docx', safe: true };
    if (lower.endsWith('.xlsx')) return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', format: 'xlsx', safe: true };
    if (lower.endsWith('.zip')) return { mime: 'application/zip', format: 'zip', safe: true };
    return { mime: 'application/zip', format: 'zip', safe: true };
  }
  // Text-based (JSON, CSV, TXT) — reject NUL bytes (binary masquerading as text)
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  const hasNull = sample.includes(0x00);
  if (!hasNull) {
    if (lower.endsWith('.json')) return { mime: 'application/json', format: 'json', safe: true };
    if (lower.endsWith('.csv')) return { mime: 'text/csv', format: 'csv', safe: true };
    if (lower.endsWith('.txt') || !lower.includes('.')) return { mime: 'text/plain', format: 'txt', safe: true };
  }
  return { mime: 'application/octet-stream', format: 'unsupported', safe: false };
}

export function sanitizeAuditMeta(meta = {}) {
  const forbidden = /password|token|secret|hash|clinical|blocks|extracted_text|content_text|note/i;
  const clean = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (forbidden.test(k)) continue;
    clean[k] = typeof v === 'string' ? v.slice(0, 160) : v;
  }
  return JSON.stringify(clean);
}

export function nowIso() {
  return new Date().toISOString();
}

export function addMinutesIso(minutes, fromDate = new Date()) {
  return new Date(fromDate.getTime() + minutes * 60_000).toISOString();
}

export function addDaysIso(days, fromDate = new Date()) {
  return new Date(fromDate.getTime() + days * 86_400_000).toISOString();
}
