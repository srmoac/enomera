import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso, randomId, sanitizeAuditMeta } from './crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, 'migrations', '001_init.sql');

let _db = null;
let _dbPath = null;

export function resolveDbPath() {
  if (process.env.ENOMERA_DB_PATH) return process.env.ENOMERA_DB_PATH;
  // On Vercel serverless, filesystem outside /tmp is read-only unless DATABASE_URL (Neon) is used
  if (process.env.VERCEL) return '/tmp/enomera-preview.sqlite';
  return path.join(__dirname, 'data', 'enomera.sqlite');
}

export function getDb(customPath) {
  const target = customPath || resolveDbPath();
  if (_db && _dbPath === target) return _db;
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  db.exec(migrationSql);

  // Ensure default etha_settings row exists
  const hasSettings = db.prepare("SELECT id FROM etha_settings WHERE id = 'default'").get();
  if (!hasSettings) {
    db.prepare("INSERT INTO etha_settings (id, capacity_limit, updated_at) VALUES ('default', 3, ?)").run(nowIso());
  }

  _db = db;
  _dbPath = target;
  return db;
}

export function closeDb() {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
    _dbPath = null;
  }
}

/**
 * Runs fn inside an exclusive SQLite write transaction (BEGIN IMMEDIATE).
 * Serializes concurrent booking/confirmation writes to prevent double-booking races.
 */
export function runTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }
}

export function writeAudit(db, { actorUserId = null, actorType = 'system', accountId = null, action, resourceType, resourceId = null, outcome = 'allow', meta = {} }) {
  db.prepare(`
    INSERT INTO audit_logs (id, actor_user_id, actor_type, account_id, action, resource_type, resource_id, outcome, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomId('aud'),
    actorUserId,
    actorType,
    accountId,
    action,
    resourceType,
    resourceId,
    outcome,
    sanitizeAuditMeta(meta),
    nowIso()
  );
}

export function queueDevOutbox(db, { channel = 'email', recipient, subject, bodyPreview, purpose }) {
  const id = randomId('msg');
  const smtpConfigured = Boolean(process.env.SMTP_URL || process.env.RESEND_API_KEY);
  const deliveryStatus = smtpConfigured ? 'queued_provider' : 'not_configured_local_outbox';
  db.prepare(`
    INSERT INTO dev_outbox_messages (id, channel, recipient, subject, body_preview, purpose, delivery_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, channel, recipient, subject, bodyPreview, purpose, deliveryStatus, nowIso());
  return {
    id,
    deliveryStatus,
    notice: smtpConfigured
      ? 'Mensagem encaminhada ao provedor configurado.'
      : 'Canal de envio real (SMTP/WhatsApp) não configurado neste ambiente. Mensagem registrada apenas na caixa de homologação (não enviada externamente).',
  };
}
