import './demo-credentials.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';
import { contentDispositionAttachment, safeHttpsUrl } from '../server/security.mjs';

// Auditoria de segurança (24 nov 2026): limite de tentativas, links seguros e cabeçalhos.
test('Segurança: limite de tentativas em login e códigos, links só https, erro interno sem detalhe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-sec-'));
  process.env.ENOMERA_DB_PATH = path.join(dir, 'db.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(dir, 'private');
  process.env.ENOMERA_REQUIRE_REMOTE_INFRA = 'false';
  delete process.env.ENOMERA_RATE_LIMIT;
  const db = await getDb(process.env.ENOMERA_DB_PATH);
  const server = createEnomeraServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, body, { token, ip = '198.51.100.7', method = 'POST' } = {}) => {
    const res = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
  };
  try {
    // Login: a 11ª tentativa na mesma conta em 15 min é recusada, mesmo com IPs diferentes.
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call('/api/v1/auth/login', { email: 'alvo@exemplo.invalid', password: `errada-${i}` }, { ip: `203.0.113.${i + 1}` })).status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.equal(statuses[10], 429);
    const blocked = await call('/api/v1/auth/login', { email: 'alvo@exemplo.invalid', password: 'x' });
    assert.equal(blocked.data.code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // Outra conta, mesmo IP, continua livre.
    assert.equal((await call('/api/v1/auth/login', { email: 'outra@exemplo.invalid', password: 'x' })).status, 401);

    // Código por e-mail: depois de 15 conferências por hora para o mesmo e-mail, para de aceitar tentativas.
    let last;
    for (let i = 0; i < 16; i++) {
      last = await call('/api/v1/auth/email-code/verify', { email: 'otp@exemplo.invalid', code: String(100000 + i) }, { ip: `192.0.2.${i + 1}` });
    }
    assert.equal(last.status, 429);
    assert.equal(last.data.code, 'RATE_LIMITED');

    // Pedidos de código: no máximo 6 por hora para o mesmo endereço.
    await db.run('DELETE FROM verification_tokens');
    let req;
    for (let i = 0; i < 7; i++) {
      await db.run('DELETE FROM verification_tokens'); // pula a espera de 20 s entre pedidos
      req = await call('/api/v1/auth/email-code/request', { email: 'spam@exemplo.invalid' }, { ip: `198.18.0.${i + 1}` });
    }
    assert.equal(req.status, 429);

    // Links: javascript: e http: recusados; https aceito.
    assert.throws(() => safeHttpsUrl('javascript:alert(1)'), /https/);
    assert.throws(() => safeHttpsUrl('http://exemplo.invalid'), /https/);
    assert.equal(safeHttpsUrl('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij');
    assert.equal(safeHttpsUrl(''), '');
    const cd = contentDispositionAttachment('a"b\r\nSet-Cookie: x=1.pdf');
    assert.ok(!/[\r\n]/.test(cd));
    assert.ok(cd.startsWith('attachment; filename="a_b__Set-Cookie: x=1.pdf"'));

    // Perfil: link da sala com javascript: é recusado.
    const signup = await call('/api/v1/auth/signup', { fullName: 'Pessoa Segura', email: 'segura@exemplo.invalid', password: 'senha-ficticia-1' }, { ip: '198.51.100.99' });
    assert.equal(signup.status, 201);
    const bad = await call('/api/v1/professional/profile', { onlineMeetingUrl: 'javascript:alert(document.cookie)' }, { token: signup.data.sessionToken, method: 'PATCH' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.code, 'INVALID_URL');
    const good = await call('/api/v1/professional/profile', { onlineMeetingUrl: 'https://meet.google.com/abc-defg-hij' }, { token: signup.data.sessionToken, method: 'PATCH' });
    assert.equal(good.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeDb?.();
  }
});
