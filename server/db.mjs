import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso, randomId, sanitizeAuditMeta } from './crypto.mjs';
import { applyPilotDigestMigration } from './pilot-digest.mjs';
import { applyRateLimitMigration } from './security.mjs';
import { applyPilotMigration, applyPilotSelfTestMigration, applyPilotFriendInvitesMigration } from './pilot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_001_SQLITE = path.join(__dirname, 'migrations', '001_init.sql');
const MIGRATION_001_PG = path.join(__dirname, 'migrations', '001_init_postgres.sql');
const MIGRATION_002_COMMON = path.join(__dirname, 'migrations', '002_real_users_and_indexes.sql');

let _db = null;
let _dbKey = null;
let _dbInitPromise = null;

/**
 * Translates SQLite-style `?` positional placeholders into PostgreSQL `$1, $2, ...`
 * while safely ignoring `?` characters inside single-quoted string literals.
 */
export function toPostgresPlaceholders(sql) {
  let out = '';
  let idx = 0;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingle && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      out += ch;
    } else if (ch === '?' && !inSingle) {
      idx++;
      out += `$${idx}`;
    } else {
      out += ch;
    }
  }
  return out;
}

export function resolvePostgresUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

export function isRemoteInfraRequired() {
  if (process.env.ENOMERA_REQUIRE_REMOTE_INFRA === 'true') return true;
  if (process.env.ENOMERA_REQUIRE_REMOTE_INFRA === 'false') return false;
  return process.env.VERCEL === '1' && process.env.ENOMERA_ALLOW_LOCAL_FALLBACK !== 'true';
}

export function getRemoteInfraGuard() {
  const required = isRemoteInfraRequired();
  const hasDb = Boolean(resolvePostgresUrl());
  const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const hasResendKey = Boolean(process.env.RESEND_API_KEY);
  const hasResendFrom = Boolean(process.env.RESEND_FROM_EMAIL);
  const hasSmtp = Boolean(process.env.SMTP_PASSWORD);
  const mailerReady = hasSmtp || (hasResendKey && hasResendFrom);

  const missingEnvVars = [];
  if (!hasDb) missingEnvVars.push('DATABASE_URL');
  if (!hasBlob) missingEnvVars.push('BLOB_READ_WRITE_TOKEN');
  if (!mailerReady) missingEnvVars.push('SMTP_PASSWORD');

  return {
    required,
    ready: !required || missingEnvVars.length === 0,
    missingEnvVars,
    components: {
      database: { configured: hasDb, requiredEnv: ['DATABASE_URL'] },
      storage: { configured: hasBlob, requiredEnv: ['BLOB_READ_WRITE_TOKEN'] },
      mailer: { configured: mailerReady, provider: hasSmtp ? 'smtp' : (hasResendKey && hasResendFrom ? 'resend' : null), requiredEnv: ['SMTP_PASSWORD'] },
    },
  };
}

export function resolveDbPath() {
  if (process.env.ENOMERA_DB_PATH) return process.env.ENOMERA_DB_PATH;
  if (process.env.VERCEL) return '/tmp/enomera-preview.sqlite';
  return path.join(__dirname, 'data', 'enomera.sqlite');
}

function wrapSqliteConn(rawDb) {
  // Async mutex serializes concurrent SQLite transactions cleanly (prevents nested BEGIN IMMEDIATE / cross-rollback)
  let txQueue = Promise.resolve();
  let inTx = false;

  const client = {
    dialect: 'sqlite',
    raw: rawDb,
    closed: false,
    async get(sql, ...params) {
      return rawDb.prepare(sql).get(...params);
    },
    async all(sql, ...params) {
      return rawDb.prepare(sql).all(...params);
    },
    async run(sql, ...params) {
      return rawDb.prepare(sql).run(...params);
    },
    async exec(sql) {
      rawDb.exec(sql);
    },
    async advisoryLock() {
      // SQLite serializes via per-connection mutex + BEGIN IMMEDIATE
    },
    async tx(fn) {
      if (inTx) {
        return fn(client);
      }
      let release;
      const next = new Promise((r) => { release = r; });
      const prev = txQueue;
      txQueue = prev.then(() => next);
      await prev;

      let begun = false;
      inTx = true;
      try {
        rawDb.exec('BEGIN IMMEDIATE');
        begun = true;
        const result = await fn(client);
        rawDb.exec('COMMIT');
        return result;
      } catch (err) {
        if (begun) {
          try { rawDb.exec('ROLLBACK'); } catch {}
        }
        throw err;
      } finally {
        inTx = false;
        release();
      }
    },
    async close() {
      client.closed = true;
      try { rawDb.close(); } catch {}
    },
  };
  return client;
}

function wrapPgRunner(runner, isPool, poolRef) {
  const client = {
    dialect: 'postgres',
    raw: runner,
    async get(sql, ...params) {
      const res = await runner.query(toPostgresPlaceholders(sql), params);
      return res.rows[0];
    },
    async all(sql, ...params) {
      const res = await runner.query(toPostgresPlaceholders(sql), params);
      return res.rows;
    },
    async run(sql, ...params) {
      const res = await runner.query(toPostgresPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async exec(sql) {
      await runner.query(sql);
    },
    async advisoryLock(lockKey) {
      if (!isPool) {
        await runner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(lockKey)]);
      }
    },
    async tx(fn) {
      if (!isPool) {
        return fn(client);
      }
      const conn = await poolRef.connect();
      const txClient = wrapPgRunner(conn, false, poolRef);
      try {
        await conn.query('BEGIN');
        const result = await fn(txClient);
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        try { await conn.query('ROLLBACK'); } catch {}
        throw err;
      } finally {
        conn.release();
      }
    },
    async close() {
      if (isPool && poolRef) {
        try { await poolRef.end(); } catch {}
      }
    },
  };
  return client;
}

async function applyMigrations(db) {
  await db.tx(async (tx) => {
    if (tx.dialect === 'postgres') {
      await tx.advisoryLock('enomera_schema_migrations');
    }
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const appliedRows = await tx.all('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.version));

    if (!applied.has('001_init')) {
      const sql001 = fs.readFileSync(tx.dialect === 'postgres' ? MIGRATION_001_PG : MIGRATION_001_SQLITE, 'utf8');
      await tx.exec(sql001);
      await tx.run(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '001_init',
        `Initial Enomera core schema (${tx.dialect})`,
        nowIso()
      );
    }

    if (!applied.has('002_real_users_and_indexes')) {
      if (tx.dialect === 'sqlite') {
        const cols = await tx.all('PRAGMA table_info(users)');
        if (!cols.some((c) => c.name === 'is_demo')) {
          await tx.exec('ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
        }
      } else {
        await tx.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo INTEGER NOT NULL DEFAULT 0');
      }
      const sql002 = fs.readFileSync(MIGRATION_002_COMMON, 'utf8');
      await tx.exec(sql002);
      await tx.run(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '002_real_users_and_indexes',
        'Real-user vs demo separation and operational query indexes',
        nowIso()
      );
    }

    if (!applied.has('003_approved_preview')) {
      if (tx.dialect === 'sqlite') {
        const cols = await tx.all('PRAGMA table_info(professional_accounts)');
        if (!cols.some((c) => c.name === 'audience')) await tx.exec("ALTER TABLE professional_accounts ADD COLUMN audience TEXT NOT NULL DEFAULT ''");
      } else {
        await tx.exec("ALTER TABLE professional_accounts ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT ''");
      }
      await tx.exec(`CREATE TABLE IF NOT EXISTS checkout_selections (
        account_id TEXT PRIMARY KEY REFERENCES professional_accounts(id) ON DELETE CASCADE,
        selection_json TEXT NOT NULL, updated_at TEXT NOT NULL
      )`);
      await tx.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '003_approved_preview', 'Approved profile metadata and server checkout selection', nowIso());
    }

    if (!applied.has('004_pilot_usage')) {
      await applyPilotMigration(tx);
      await tx.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '004_pilot_usage', 'Pilot invites, participants and usage events', nowIso());
    }

    if (!applied.has('005_pilot_self_test')) {
      await applyPilotSelfTestMigration(tx);
      await tx.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '005_pilot_self_test', 'Pilot invite for the administrator own test account', nowIso());
    }

    // Convites extras do piloto: idempotente, roda sempre para pegar os novos da lista.
    await applyPilotFriendInvitesMigration(tx);
    if (!applied.has('006_pilot_friend_invites')) {
      await tx.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '006_pilot_friend_invites', 'Three more pilot tester invites (friends of the administrator)', nowIso());
    }

    if (!applied.has('007_pilot_daily_digest')) {
      await applyPilotDigestMigration(tx);
      await tx.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '007_pilot_daily_digest', 'Daily pilot usage digest for the administrator', nowIso());
    }

    if (!applied.has('008_rate_limits')) {
      await applyRateLimitMigration(tx);
      await tx.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
        '008_rate_limits', 'Shared rate limit buckets (security audit 2026-11-24)', nowIso());
    }

    await tx.run(
      "INSERT INTO etha_settings (id, capacity_limit, updated_at) VALUES ('default', 3, ?) ON CONFLICT(id) DO NOTHING",
      nowIso()
    );
  });
}

export async function getAppliedMigrations(db) {
  return db.all('SELECT version, description, applied_at FROM schema_migrations ORDER BY version ASC');
}

export async function getDb(customPath) {
  const pgUrl = customPath ? '' : resolvePostgresUrl();
  if (!customPath && !pgUrl && isRemoteInfraRequired()) {
    throw Object.assign(
      new Error('Banco de dados remoto (Neon Postgres) não configurado neste ambiente de entrega. Defina DATABASE_URL no ambiente Preview da Vercel.'),
      {
        status: 503,
        code: 'REMOTE_DB_NOT_CONFIGURED',
        missingEnvVars: ['DATABASE_URL'],
      }
    );
  }
  const key = pgUrl ? `pg:${pgUrl}` : `sqlite:${customPath || resolveDbPath()}`;
  if (_db && _dbKey === key) return _db;
  if (_dbInitPromise && _dbKey === key) return _dbInitPromise;

  _dbKey = key;
  _dbInitPromise = (async () => {
    if (_db) {
      await _db.close();
      _db = null;
    }

    let db;
    if (pgUrl) {
      const { Pool } = await import('@neondatabase/serverless');
      const pool = new Pool({ connectionString: pgUrl });
      pool.on('error', (err) => {
        console.error('[enomera-db] idle pool error:', err?.message || err);
      });
      db = wrapPgRunner(pool, true, pool);
    } else {
      const { DatabaseSync } = await import('node:sqlite');
      const target = customPath || resolveDbPath();
      if (target !== ':memory:') {
        fs.mkdirSync(path.dirname(target), { recursive: true });
      }
      const rawDb = new DatabaseSync(target);
      rawDb.exec('PRAGMA journal_mode = WAL;');
      rawDb.exec('PRAGMA foreign_keys = ON;');
      rawDb.exec('PRAGMA busy_timeout = 5000;');
      db = wrapSqliteConn(rawDb);
    }

    await applyMigrations(db);
    _db = db;
    return db;
  })();

  try {
    return await _dbInitPromise;
  } catch (err) {
    _dbInitPromise = null;
    _dbKey = null;
    throw err;
  }
}

export async function closeDb() {
  _dbInitPromise = null;
  if (_db) {
    await _db.close();
    _db = null;
    _dbKey = null;
  }
}

export async function runTransaction(db, fn, lockKey = null) {
  return db.tx(async (tx) => {
    if (lockKey) await tx.advisoryLock(lockKey);
    return fn(tx);
  });
}

export async function writeAudit(db, { actorUserId = null, actorType = 'system', accountId = null, action, resourceType, resourceId = null, outcome = 'allow', meta = {} }) {
  await db.run(
    `INSERT INTO audit_logs (id, actor_user_id, actor_type, account_id, action, resource_type, resource_id, outcome, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

export async function queueDevOutbox(db, { channel = 'email', recipient, subject, bodyPreview, purpose }) {
  const id = randomId('msg');
  const deliveryStatus = 'not_configured_local_outbox';
  await db.run(
    `INSERT INTO dev_outbox_messages (id, channel, recipient, subject, body_preview, purpose, delivery_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    channel,
    recipient,
    subject,
    bodyPreview,
    purpose,
    deliveryStatus,
    nowIso()
  );
  return {
    id,
    deliveryStatus,
    sentExternally: false,
    notice: 'Canal de envio real (Resend/SMTP) não configurado neste ambiente. Mensagem registrada apenas na caixa de homologação (não enviada externamente).',
  };
}
