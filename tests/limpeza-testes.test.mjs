import './demo-credentials.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb } from '../server/db.mjs';
import { purgeTestAccounts, runTestCleanupOnce, CLEANUP_VERSION } from '../server/limpeza-testes.mjs';

test('Limpeza das contas de teste: apaga testes e mantém demo, exclusivos e administrador', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-limpeza-'));
  process.env.ENOMERA_STORAGE_DIR = path.join(dir, 'private');
  process.env.ENOMERA_REQUIRE_REMOTE_INFRA = 'false';
  const db = await getDb(path.join(dir, 'db.sqlite'));
  const now = new Date().toISOString();
  const user = (id, role = 'professional', demo = 0) => db.run(
    "INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, is_demo, created_at, updated_at) VALUES (?, ?, 'h', 's', 'Teste', ?, ?, 1, ?, ?, ?)",
    id, `${id}@exemplo.invalid`, role, now, demo, now, now);
  const account = async (id, owner, slug, demo = 0) => {
    await db.run('INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, is_demo_sandbox, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, owner, slug, slug, demo, now, now);
    await db.run("INSERT INTO account_memberships (id, account_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)", `mem_${id}`, id, owner, now);
  };
  const participant = (id, userId, inviteId, kind = 'tester') => db.run(
    "INSERT INTO pilot_participants (id, user_id, invite_id, kind, label, track_key, created_at) VALUES (?, ?, ?, ?, '', ?, ?)", id, userId, inviteId, kind, `tk_${id}`, now);

  await user('usr_teste1'); await account('acc_teste1', 'usr_teste1', 'baps'); await participant('pp_t1', 'usr_teste1', 'inv_piloto_amigo_1');
  await user('usr_teste2'); await account('acc_teste2', 'usr_teste2', 'mrsaocmisc-teste');
  await user('usr_sem_conta'); await participant('pp_t2', 'usr_sem_conta', 'inv_piloto_amiga_4');
  await db.run("INSERT INTO pilot_devices (id, participant_id, product, first_seen, last_seen) VALUES ('dev1', 'pp_t1', 'enomera', ?, ?)", now, now);
  await db.run("INSERT INTO pilot_events (id, device_id, participant_id, product, session_key, type, occurred_at, received_at) VALUES ('ev1', 'dev1', 'pp_t1', 'enomera', 's', 'view', ?, ?)", now, now);
  await user('usr_jessica'); await account('acc_jessica', 'usr_jessica', 'jessica-x'); await participant('pp_j', 'usr_jessica', 'inv_exclusivo_1');
  await user('usr_admin', 'pilot_admin'); await participant('pp_a', 'usr_admin', 'inv_piloto_admin', 'admin');
  await user('usr_demo', 'professional', 1); await account('acc_demo', 'usr_demo', 'demo-x', 1);

  try {
    const dry = await purgeTestAccounts(db, { dryRun: true });
    assert.deepEqual(dry.slugs, ['baps', 'mrsaocmisc-teste']);
    assert.equal(dry.users, 3); assert.equal(dry.participants, 2);
    assert.ok(await db.get("SELECT id FROM users WHERE id = 'usr_teste1'"), 'dry run não apaga nada');

    assert.equal(await runTestCleanupOnce(db), null, 'fora de produção não roda sozinho');
    const out = await runTestCleanupOnce(db, { force: true });
    assert.equal(out.accounts, 2); assert.equal(out.errors, 0);
    for (const id of ['usr_teste1', 'usr_teste2', 'usr_sem_conta']) assert.equal(await db.get('SELECT id FROM users WHERE id = ?', id), undefined, id);
    assert.equal(await db.get("SELECT id FROM professional_accounts WHERE slug = 'baps'"), undefined);
    assert.equal(await db.get("SELECT id FROM pilot_events WHERE id = 'ev1'"), undefined);
    assert.equal(await db.get("SELECT id FROM pilot_participants WHERE id = 'pp_t2'"), undefined);
    for (const id of ['usr_jessica', 'usr_admin', 'usr_demo']) assert.ok(await db.get('SELECT id FROM users WHERE id = ?', id), id);
    assert.ok(await db.get("SELECT id FROM professional_accounts WHERE slug = 'jessica-x'"));
    assert.ok(await db.get("SELECT id FROM professional_accounts WHERE slug = 'demo-x'"));
    // Convites antigos seguem cancelados; os exclusivos e o do administrador continuam abertos.
    assert.ok((await db.get("SELECT revoked_at FROM pilot_invites WHERE id = 'inv_piloto_amigo_1'")).revoked_at);
    for (const id of ['inv_exclusivo_1', 'inv_exclusivo_2', 'inv_piloto_admin']) assert.equal((await db.get('SELECT revoked_at FROM pilot_invites WHERE id = ?', id)).revoked_at, null, id);
    assert.ok(await db.get('SELECT version FROM schema_migrations WHERE version = ?', CLEANUP_VERSION));
    assert.equal(await runTestCleanupOnce(db, { force: true }), null, 'roda uma vez só');
  } finally {
    await closeDb();
  }
});
