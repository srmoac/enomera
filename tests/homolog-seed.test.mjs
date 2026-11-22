import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';

test('Contas de homologação: só com senha no ambiente, verificadas e com os serviços certos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-homolog-'));
  process.env.ENOMERA_DB_PATH = path.join(dir, 'db.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(dir, 'private');
  process.env.ENOMERA_REQUIRE_REMOTE_INFRA = 'false';
  process.env.ENOMERA_SEED_DEMO = 'true';
  process.env.ENOMERA_HOMOLOG_PASSWORD = 'senha-ficticia-de-teste-1';
  const db = await getDb(process.env.ENOMERA_DB_PATH);
  const server = createEnomeraServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email, password) => {
    const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return { status: res.status, data: await res.json() };
  };
  try {
    await fetch(`${base}/api/v1/health`);
    const sofia = await login('sofia.mendes@homolog.enomera.invalid', process.env.ENOMERA_HOMOLOG_PASSWORD);
    assert.equal(sofia.status, 200);
    assert.equal(sofia.data.user.emailVerified, true);
    const rows = async (id) => (await db.all("SELECT product FROM entitlements WHERE account_id = ? AND status = 'active' ORDER BY product", id)).map((r) => r.product);
    assert.deepEqual(await rows('acc_homolog_sofia'), ['ambo', 'etha']);
    assert.deepEqual(await rows('acc_homolog_paulo'), ['etha']);
    assert.deepEqual(await rows('acc_homolog_beatriz'), ['ambo', 'minne']);
    assert.equal((await login('paulo.ribeiro@homolog.enomera.invalid', 'senha-errada-qualquer')).status, 401);
    assert.equal((await db.get("SELECT COUNT(*) AS c FROM users WHERE id LIKE 'usr_homolog_%'")).c, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDb?.();
    delete process.env.ENOMERA_HOMOLOG_PASSWORD;
  }
});
