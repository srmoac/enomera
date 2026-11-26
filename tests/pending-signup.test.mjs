import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';

test('Cadastro pendente: mesma senha retoma a conta, troca de e-mail funciona, conta confirmada continua protegida', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-pending-'));
  process.env.ENOMERA_DB_PATH = path.join(dir, 'db.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(dir, 'private');
  process.env.ENOMERA_REQUIRE_REMOTE_INFRA = 'false';
  const db = await getDb(process.env.ENOMERA_DB_PATH);
  const server = createEnomeraServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, body, token) => {
    const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const person = { fullName: 'Pessoa Fictícia', email: 'pessoa.errada@exemplo.invalid', password: 'senha-ficticia-1', selection: { products: ['ambo'] } };
  try {
    const first = await call('/api/v1/auth/signup', person);
    assert.equal(first.status, 201);
    assert.ok(first.data.sessionToken);

    const again = await call('/api/v1/auth/signup', person);
    assert.equal(again.status, 200);
    assert.equal(again.data.resumed, true);
    assert.equal(again.data.account.id, first.data.account.id);

    const otherPwd = await call('/api/v1/auth/signup', { ...person, password: 'outra-senha-ficticia' });
    assert.equal(otherPwd.status, 409);
    assert.equal(otherPwd.data.code, 'EMAIL_PENDING');

    const fixed = await call('/api/v1/auth/change-email', { email: 'pessoa.certa@exemplo.invalid' }, again.data.sessionToken);
    assert.equal(fixed.status, 200);
    assert.equal(fixed.data.email, 'pessoa.certa@exemplo.invalid');
    assert.equal((await db.get('SELECT email FROM users WHERE id = ?', first.data.user.id)).email, 'pessoa.certa@exemplo.invalid');

    await db.run('UPDATE users SET email_verified_at = ? WHERE id = ?', new Date().toISOString(), first.data.user.id);
    const taken = await call('/api/v1/auth/signup', { ...person, email: 'pessoa.certa@exemplo.invalid' });
    assert.equal(taken.status, 409);
    assert.equal(taken.data.code, 'EMAIL_EXISTS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDb?.();
  }
});
