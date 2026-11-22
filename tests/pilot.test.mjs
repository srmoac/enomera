import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';
import { sha256Hex } from '../server/crypto.mjs';
import { scrub } from '../server/pilot.mjs';

test('scrub tira e-mail, números longos e nomes próprios', () => {
  assert.equal(scrub('Ligar para Ana Souza em ana@x.com ou 11 99999-1234'), 'Ligar para ‹nome› em ‹e-mail› ou ‹número›');
  assert.equal(scrub('botão: Confirmar horário'), 'botão: Confirmar horário');
});

test('Piloto: convite único, consentimento, eventos ligados à pessoa e painel só para o administrador', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-pilot-'));
  process.env.ENOMERA_DB_PATH = path.join(dir, 'db.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(dir, 'private');
  process.env.ENOMERA_REQUIRE_REMOTE_INFRA = 'false';
  const db = await getDb(process.env.ENOMERA_DB_PATH);
  const now = new Date().toISOString();
  const T = 'tokenDeTesteDoConvidado1', A = 'tokenDeTesteDoAdministrad';
  await db.run("INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES ('inv_t', 'tester', 'Teste', ?, ?)", sha256Hex(T), now);
  await db.run("INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES ('inv_a', 'admin', 'Admin', ?, ?)", sha256Hex(A), now);
  const server = createEnomeraServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, body, token, method = body ? 'POST' : 'GET') => {
    const res = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  try {
    assert.equal((await call(`/api/v1/pilot/invites/${T}`)).data.state, 'open');
    assert.equal((await call('/api/v1/pilot/invites/naoexisteeste1234567')).status, 404);

    // Eventos antes do cadastro (mesmo aparelho) ficam pendentes e depois passam a contar.
    const dev = 'dTesteAparelho01';
    const ev = (type, extra = {}) => ({ t: Date.now(), type, sc: '/checkout', ...extra });
    let r = await call('/api/v1/pilot/events', { d: dev, p: 'enomera', s: 'sTeste01', f: 'celular', e: [ev('view'), ev('click', { tg: 'botão: Criar conta', x: 500, y: 300 })] });
    assert.equal(r.status, 200); assert.equal(r.data.identified, false);

    const noConsent = await call(`/api/v1/pilot/invites/${T}/accept`, { fullName: 'Convidada Teste', email: 'convidada@exemplo.invalid', password: 'senha-ficticia-1', consent: false });
    assert.equal(noConsent.status, 400);
    const acc = await call(`/api/v1/pilot/invites/${T}/accept`, { fullName: 'Convidada Teste', email: 'convidada@exemplo.invalid', password: 'senha-ficticia-1', consent: true });
    assert.equal(acc.status, 201); assert.equal(acc.data.next, '/checkout');
    const again = await call(`/api/v1/pilot/invites/${T}/accept`, { fullName: 'Outra', email: 'outra@exemplo.invalid', password: 'senha-ficticia-1', consent: true });
    assert.equal(again.status, 409); assert.equal(again.data.code, 'INVITE_USED');
    const me = await call('/api/v1/auth/me', null, acc.data.sessionToken);
    assert.equal(me.data.user.emailVerified, true);

    r = await call('/api/v1/pilot/events', { d: dev, p: 'enomera', s: 'sTeste01', f: 'celular', e: [ev('time', { n: 42000 }), ev('click', { tg: 'botão: Começar', x: 400, y: 600, m: { rage: true } })] }, acc.data.sessionToken);
    assert.equal(r.data.identified, true); assert.ok(r.data.ref);
    // Outro produto, identificado pelo hash da sessão (sem cookie da Core).
    r = await call('/api/v1/pilot/events', { d: 'dOutroProduto01', p: 'minne', s: 'sTeste02', sh: sha256Hex(acc.data.sessionToken), f: 'computador', e: [ev('view', { sc: '/fila' }), ev('api', { sc: '/fila', tg: 'POST /api/v1/minne/patients', n: 120, m: { status: 201 } }), ev('error', { sc: '/fila', tg: 'TypeError: x is undefined', m: { stack: 'at a (app.js:1:2)' } })] });
    assert.equal(r.data.identified, true);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS c FROM pilot_events WHERE participant_id IS NULL')).c), 0);

    // Painel: convidada não entra; administrador entra e não é rastreado.
    assert.equal((await call('/api/v1/pilot/admin/overview', null, acc.data.sessionToken)).status, 403);
    const adm = await call(`/api/v1/pilot/invites/${A}/accept`, { fullName: 'Admin Teste', email: 'admin@exemplo.invalid', password: 'senha-ficticia-2', consent: true });
    assert.equal(adm.status, 201); assert.equal(adm.data.next, '/piloto/painel');
    const off = await call('/api/v1/pilot/events', { d: 'dAdmin000001', p: 'enomera', s: 'sAdm0001', e: [ev('view')] }, adm.data.sessionToken);
    assert.equal(off.data.track, false);
    const login = await call('/api/v1/auth/login', { email: 'admin@exemplo.invalid', password: 'senha-ficticia-2' });
    assert.equal(login.data.user.role, 'pilot_admin');
    const ov = await call('/api/v1/pilot/admin/overview?dias=7', null, login.data.sessionToken);
    assert.equal(ov.status, 200);
    assert.equal(ov.data.totals.joined, 1); assert.equal(ov.data.totals.active, 1);
    const p = ov.data.participants[0];
    assert.equal(p.activeMs, 42000); assert.equal(p.rage, 1); assert.equal(p.errors, 1);
    assert.ok(p.features.find((f) => f.key === 'minne_paciente').used);
    assert.ok(ov.data.features.find((f) => f.key === 'etha_publicar').users === 0);
    const heat = await call(`/api/v1/pilot/admin/heatmap?produto=enomera&tela=${encodeURIComponent('/checkout')}`, null, login.data.sessionToken);
    assert.equal(heat.data.points.length, 2);
    const tl = await call(`/api/v1/pilot/admin/participants/${p.id}/timeline`, null, login.data.sessionToken);
    assert.ok(tl.data.events.length >= 5);
    const ni = await call('/api/v1/pilot/admin/invites', { label: 'Convidado 3' }, login.data.sessionToken);
    assert.equal(ni.status, 201); assert.match(ni.data.link, /\/convite\/[A-Za-z0-9_-]{20,}$/);
    assert.equal((await call(`/api/v1/pilot/invites/${ni.data.link.split('/').pop()}`)).data.state, 'open');

    // Retirar consentimento apaga os eventos.
    await call('/api/v1/pilot/withdraw', {}, acc.data.sessionToken);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS c FROM pilot_events WHERE participant_id = ?', p.id)).c), 0);
  } finally {
    server.close();
    await closeDb();
  }
});
