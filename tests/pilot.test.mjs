import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';
import { sha256Hex } from '../server/crypto.mjs';
import { scrub } from '../server/pilot.mjs';
import { buildDailyDigest, digestEmail, spDay, ensureDailyDigests } from '../server/pilot-digest.mjs';

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

    // Piloto gratuito: planos, combos, anual e Sob medida saem a R$ 0, sem cartão nem fatura.
    const sel = { products: ['ambo', 'minne', 'etha'], ethaService: 'sob_medida', billing: 'permanent', mode: 'monthly' };
    const paid = await call('/api/v1/catalog/quote', sel);
    assert.ok(paid.data.contract.totalCents > 0); assert.equal(paid.data.contract.setup.amountCents, 79000);
    const free = await call('/api/v1/catalog/quote', sel, acc.data.sessionToken);
    assert.equal(free.data.contract.totalCents, 0); assert.equal(free.data.contract.setup.amountCents, 0);
    assert.equal(free.data.recurringMonthlyCents, 0); assert.equal(free.data.contract.pilotFree, true);
    assert.ok(free.data.contract.lines.every((l) => l.amountCents === 0));
    assert.equal((await call('/api/v1/auth/me', null, acc.data.sessionToken)).data.pilot.free, true);
    const ord = await call('/api/v1/commercial/orders', { ...sel, idempotencyKey: 'piloto-gratis-1', simulatedOutcome: 'declined' }, acc.data.sessionToken);
    assert.equal(ord.status, 201); assert.equal(ord.data.order.status, 'approved');
    assert.equal(Number(ord.data.order.due_today_cents), 0); assert.equal(Number(ord.data.order.recurring_monthly_cents), 0);
    for (const prodKey of ['ambo', 'minne', 'etha']) {
      assert.equal(ord.data.entitlements[prodKey].status, 'active'); assert.equal(ord.data.entitlements[prodKey].billingMode, 'pilot');
      assert.ok(ord.data.entitlements[prodKey].currentPeriodEnd.startsWith('2027-01-31'));
    }
    const bill = await call('/api/v1/billing/status', null, acc.data.sessionToken);
    assert.equal(bill.status, 200); assert.equal(bill.data.mode, 'pilot'); assert.equal(bill.data.subscription, null);
    const chk = await call('/api/v1/billing/checkout', { products: ['ambo'], cycle: 'monthly', cpfCnpj: '00000000000' }, acc.data.sessionToken);
    assert.equal(chk.status, 409); assert.equal(chk.data.code, 'PILOT_FREE');

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
    // Resumo diário: fecha o dia em Brasília e compara com o anterior; só o administrador vê.
    const dg = await buildDailyDigest(db, spDay(), { totals: { active: 0, activeMs: 0, sessions: 0, errors: 0 }, errorKeys: [] });
    assert.equal(dg.totals.active, 1); assert.equal(dg.deltas.active, 1); assert.ok(dg.newErrors.length >= 1);
    assert.ok(dg.highlights.find(([k]) => k === 'Primeiro uso'));
    assert.match(digestEmail(dg).textBody, /Painel completo: .*\/piloto\/painel/);
    assert.deepEqual(await ensureDailyDigests(db, { force: true, mail: false }), []); // nada fechou ainda: o piloto começou hoje
    assert.equal((await call('/api/v1/pilot/admin/digests', null, acc.data.sessionToken)).status, 403);
    const dl = await call('/api/v1/pilot/admin/digests', null, login.data.sessionToken);
    assert.equal(dl.status, 200); assert.ok(Array.isArray(dl.data.digests));
    const heat = await call(`/api/v1/pilot/admin/heatmap?produto=enomera&tela=${encodeURIComponent('/checkout')}`, null, login.data.sessionToken);
    assert.equal(heat.data.points.length, 2);
    const tl = await call(`/api/v1/pilot/admin/participants/${p.id}/timeline`, null, login.data.sessionToken);
    assert.ok(tl.data.events.length >= 5);
    // Operador marca o Sob medida da Etha como entregue (e reabre).
    assert.equal((await call('/api/v1/pilot/admin/etha-sob-medida', null, acc.data.sessionToken)).status, 403);
    const sobList = await call('/api/v1/pilot/admin/etha-sob-medida', null, login.data.sessionToken);
    assert.equal(sobList.data.orders.length, 1); assert.equal(sobList.data.orders[0].deliveredAt, null);
    const projId = sobList.data.orders[0].projectId;
    const dlv = await call(`/api/v1/pilot/admin/etha-sob-medida/${projId}/entrega`, { delivered: true }, login.data.sessionToken);
    assert.equal(dlv.status, 200); assert.ok(dlv.data.deliveredAt);
    assert.ok(JSON.parse((await db.get('SELECT briefing_json FROM etha_projects WHERE id = ?', projId)).briefing_json).sobMedida.deliveredAt);
    assert.equal((await call(`/api/v1/pilot/admin/etha-sob-medida/${projId}/entrega`, { delivered: false }, login.data.sessionToken)).data.deliveredAt, null);
    assert.equal((await call('/api/v1/pilot/admin/etha-sob-medida/naoexiste/entrega', { delivered: true }, login.data.sessionToken)).status, 404);
    const ni = await call('/api/v1/pilot/admin/invites', { label: 'Convidado 3' }, login.data.sessionToken);
    assert.equal(ni.status, 201); assert.match(ni.data.link, /\/convite\/[A-Za-z0-9_-]{20,}$/);
    assert.equal((await call(`/api/v1/pilot/invites/${ni.data.link.split('/').pop()}`)).data.state, 'open');

    // Conta de teste do administrador: entra só com ?teste=1.
    const S = 'tokenDeTesteDoMarcosTeste';
    await db.run("INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES ('inv_s', 'self_test', 'Teste do Marcos', ?, ?)", sha256Hex(S), now);
    const self = await call(`/api/v1/pilot/invites/${S}/accept`, { fullName: 'Marcos Teste', email: 'marcos.teste@exemplo.invalid', password: 'senha-ficticia-3', consent: true });
    assert.equal(self.status, 201); assert.equal(self.data.next, '/checkout');
    await call('/api/v1/pilot/events', { d: 'dSelfTeste01', p: 'enomera', s: 'sSelf001', e: [ev('time', { n: 5000 })] }, self.data.sessionToken);
    const ov2 = await call('/api/v1/pilot/admin/overview?dias=7', null, login.data.sessionToken);
    assert.equal(ov2.data.totals.joined, 1); assert.equal(ov2.data.totals.activeMs, 42000);
    const ov3 = await call('/api/v1/pilot/admin/overview?dias=7&teste=1', null, login.data.sessionToken);
    assert.equal(ov3.data.participants.length, 2); assert.ok(ov3.data.participants.find((x) => x.selfTest));

    // Dias fechados que faltam são gerados uma vez, em ordem, e aparecem no painel.
    const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString();
    await db.run("UPDATE pilot_participants SET created_at = ? WHERE kind = 'tester'", twoDaysAgo);
    await db.run('UPDATE pilot_events SET occurred_at = ? WHERE participant_id = ?', new Date(Date.now() - 864e5).toISOString(), p.id);
    const made = await ensureDailyDigests(db, { force: true, mail: false });
    assert.ok(made.length >= 2 && made.length <= 3);
    const hist = (await call('/api/v1/pilot/admin/digests', null, login.data.sessionToken)).data.digests;
    assert.equal(hist.length, made.length); assert.ok(hist.some((d) => d.totals.active === 1));
    assert.deepEqual(await ensureDailyDigests(db, { force: true, mail: false }), []);

    // Retirar consentimento apaga os eventos.
    await call('/api/v1/pilot/withdraw', {}, acc.data.sessionToken);
    assert.equal(Number((await db.get('SELECT COUNT(*) AS c FROM pilot_events WHERE participant_id = ?', p.id)).c), 0);
  } finally {
    server.close();
    await closeDb();
  }
});
