// Regressões da auditoria de 26/11/2026 (P0 e parte dos P1). Sem demo-credentials de propósito:
// aqui o ambiente fica como em produção, sem ENOMERA_ALLOW_SIMULATED_CHECKOUT.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDb, getDb } from '../server/db.mjs';
import { sha256Hex } from '../server/crypto.mjs';
import { runRetention } from '../server/retention.mjs';
import { tzOffsetMinutes } from '../server/scheduling.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';

let server; let baseUrl; let tmpDir; let db;

async function api(route, { method = 'GET', body = null, token = null, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${route}`, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
}
async function latestCode(email) {
  const r = await api(`/api/v1/dev/outbox?recipient=${encodeURIComponent(email)}`);
  return /(\d{6})/.exec(r.data.messages[0].body_preview)[1];
}
async function newAccount(email, { acceptTerms = true } = {}) {
  await api('/api/v1/auth/email-code/request', { method: 'POST', body: { email } });
  const v = await api('/api/v1/auth/email-code/verify', { method: 'POST', body: { email, code: await latestCode(email), acceptTerms } });
  assert.equal(v.status, 200);
  return v.data;
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-audit-'));
  process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'test.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'storage');
  process.env.ENOMERA_UNIFORM_DELAY = 'off';
  for (const k of ['ENOMERA_ALLOW_SIMULATED_CHECKOUT', 'ENOMERA_REQUIRE_REMOTE_INFRA', 'VERCEL', 'VERCEL_ENV', 'ASAAS_API_KEY', 'DATABASE_URL', 'POSTGRES_URL']) delete process.env[k];
  db = await getDb(process.env.ENOMERA_DB_PATH);
  server = createEnomeraServer(db);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('P0 CORE-2: sem convite ninguém ativa de graça; a oferta de 2 semanas vale uma vez e depois exige pagamento', async () => {
  const acc = await newAccount('sem.convite@exemplo.invalid');
  const token = acc.sessionToken;
  // O navegador pede "aprovado", mas a decisão é do servidor: vira teste de 2 semanas, não serviço ativo.
  const ord = await api('/api/v1/commercial/orders', { method: 'POST', token, body: { products: ['ambo', 'minne'], billing: 'monthly', simulatedOutcome: 'approved', method: 'simulated_pix', idempotencyKey: 'o1' } });
  assert.equal(ord.status, 201);
  assert.equal(ord.data.entitlements.ambo.status, 'trial');
  assert.equal(ord.data.entitlements.minne.billingMode, 'trial');
  assert.equal(Number(ord.data.order.is_simulated), 0);
  const days = (Date.parse(ord.data.entitlements.ambo.trialEndsAt) - Date.now()) / 86_400_000;
  assert.ok(days > 13 && days < 15);

  // Passadas as 2 semanas: só leitura, e nova ativação gratuita é recusada (pedido, teste, reativar e nova tentativa).
  await db.run("UPDATE entitlements SET trial_ends_at = '2020-01-01T00:00:00.000Z' WHERE account_id = ?", acc.account.id);
  assert.equal((await api('/api/v1/auth/me', { token })).data.entitlements.ambo.status, 'read_only');
  const again = await api('/api/v1/commercial/orders', { method: 'POST', token, body: { products: ['ambo'], billing: 'monthly', simulatedOutcome: 'approved', idempotencyKey: 'o2' } });
  assert.equal(again.status, 402); assert.equal(again.data.code, 'PAYMENT_REQUIRED');
  assert.equal((await api('/api/v1/commercial/trial/start', { method: 'POST', token, body: { products: ['ambo'] } })).status, 402);
  assert.equal((await api('/api/v1/commercial/entitlements/ambo/reactivate', { method: 'POST', token, body: {} })).status, 402);
  assert.equal((await api(`/api/v1/commercial/orders/${ord.data.order.id}/retry`, { method: 'POST', token, body: { simulatedOutcome: 'approved' } })).status, 402);
  assert.equal((await api('/api/v1/auth/me', { token })).data.entitlements.ambo.status, 'read_only');

  // Em produção a variável não reabre a ativação simulada.
  process.env.ENOMERA_ALLOW_SIMULATED_CHECKOUT = 'true'; process.env.VERCEL_ENV = 'production';
  try {
    const prod = await api('/api/v1/commercial/orders', { method: 'POST', token, body: { products: ['etha'], billing: 'monthly', simulatedOutcome: 'approved', idempotencyKey: 'o3' } });
    assert.equal(prod.data.entitlements.etha.status, 'trial');
  } finally { delete process.env.ENOMERA_ALLOW_SIMULATED_CHECKOUT; delete process.env.VERCEL_ENV; }
});

test('P0 CORE-2: convidado do piloto (convite válido, conferido no servidor) continua ativando sem pagar', async () => {
  const T = 'tokenDeConviteDaAuditoria1';
  await db.run("INSERT INTO pilot_invites (id, kind, label, token_hash, created_at) VALUES ('inv_aud', 'tester', 'Auditoria', ?, ?)", sha256Hex(T), new Date().toISOString());
  const acc = await api(`/api/v1/pilot/invites/${T}/accept`, { method: 'POST', body: { fullName: 'Convidada Auditoria', email: 'convidada.aud@exemplo.invalid', password: 'senha-ficticia-9', consent: true, code: (await api(`/api/v1/pilot/invites/${T}/code`, { method: 'POST', body: { email: 'convidada.aud@exemplo.invalid' } })).data.devCode } });
  assert.equal(acc.status, 201);
  const ord = await api('/api/v1/commercial/orders', { method: 'POST', token: acc.data.sessionToken, body: { products: ['ambo', 'minne', 'etha'], billing: 'permanent', idempotencyKey: 'p1' } });
  assert.equal(ord.status, 201);
  for (const p of ['ambo', 'minne', 'etha']) {
    assert.equal(ord.data.entitlements[p].status, 'active');
    assert.equal(ord.data.entitlements[p].billingMode, 'pilot');
  }
  assert.equal(Number(ord.data.order.due_today_cents), 0);
  // Cancelar e reativar no piloto continua sem custo.
  assert.equal((await api('/api/v1/commercial/entitlements/minne/cancel', { method: 'POST', token: acc.data.sessionToken, body: {} })).data.entitlements.minne.status, 'read_only');
  assert.equal((await api('/api/v1/commercial/entitlements/minne/reactivate', { method: 'POST', token: acc.data.sessionToken, body: {} })).data.entitlements.minne.status, 'active');
  // Convite inventado não cria conta nem acesso gratuito.
  assert.equal((await api('/api/v1/pilot/invites/tokenQueNaoExisteNoBanco1/accept', { method: 'POST', body: { fullName: 'X Y', email: 'x@exemplo.invalid', password: 'senha-ficticia-9', consent: true, code: '123456' } })).status, 404);
});

test('P0 CORE-3: acesso do paciente responde igual com ou sem vínculo, no pedido e na conferência do código', async () => {
  const known = 'paciente.real@exemplo.invalid';
  const unknown = 'ninguem.aqui@exemplo.invalid';
  const pro = await newAccount('pro.enumeracao@exemplo.invalid');
  await db.run("INSERT INTO operational_patients (id, account_id, full_name, email, created_at, updated_at) VALUES ('pat_enum', ?, 'Paciente Real', ?, ?, ?)", pro.account.id, known, new Date().toISOString(), new Date().toISOString());

  const shape = (r) => ({ status: r.status, keys: Object.keys(r.data).sort(), delivery: Object.keys(r.data.delivery || {}).sort(), message: r.data.message, notice: r.data.delivery?.notice, sent: r.data.delivery?.sentExternally });
  for (const slug of [undefined, pro.account.slug]) {
    await db.run("UPDATE verification_tokens SET created_at = '2000-01-01T00:00:00.000Z' WHERE purpose = 'patient_access'");
    const a = await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { contact: known, professionalSlug: slug } });
    const b = await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { contact: unknown, professionalSlug: slug } });
    assert.equal(a.status, 200);
    assert.deepEqual(shape(a), shape(b));
    assert.ok(a.data.expiresAt && b.data.expiresAt);
    assert.ok(!JSON.stringify(b.data).includes(unknown) && !JSON.stringify(a.data).includes(known));
    // Pedir de novo logo em seguida: o mesmo limite para os dois.
    const a2 = await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { contact: known, professionalSlug: slug } });
    const b2 = await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { contact: unknown, professionalSlug: slug } });
    assert.deepEqual([a2.status, a2.data.code], [b2.status, b2.data.code]);
    assert.equal(a2.status, 429);
  }
  // Conferência: código errado dá a mesma resposta; depois de 5 erros, o mesmo bloqueio.
  for (let i = 0; i < 6; i++) {
    const a = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { contact: known, code: '000000' } });
    const b = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { contact: unknown, code: '000000' } });
    assert.deepEqual([a.status, a.data.code, a.data.error], [b.status, b.data.code, b.data.error], `tentativa ${i + 1}`);
  }
  // Contato que nunca pediu código não se distingue de código errado.
  const never = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { contact: 'nunca.pediu@exemplo.invalid', code: '123456' } });
  assert.equal(never.data.code, 'CODE_INVALID');
  // O paciente de verdade continua entrando (o Agendamento depende disto).
  await db.run("UPDATE verification_tokens SET created_at = '2000-01-01T00:00:00.000Z' WHERE purpose = 'patient_access'");
  await api('/api/v1/ambo/patient-access/request', { method: 'POST', body: { contact: known } });
  const ok = await api('/api/v1/ambo/patient-access/verify', { method: 'POST', body: { contact: known, code: await latestCode(known) } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.professionalSlug, pro.account.slug);
  assert.ok(ok.data.sessionToken);
  // Sessão do paciente vai em cookie próprio, sem tocar no do profissional.
  assert.match(ok.headers.get('set-cookie'), /^enomera_psid=/);
});

test('P1: aceite dos Termos registrado; sem aceite não ativa; exclusão de conta com prazo e rotina de retenção', async () => {
  const acc = await newAccount('sem.aceite@exemplo.invalid', { acceptTerms: false });
  const token = acc.sessionToken;
  assert.equal((await api('/api/v1/auth/me', { token })).data.user.termsAccepted, false);
  const blocked = await api('/api/v1/commercial/orders', { method: 'POST', token, body: { products: ['ambo'], billing: 'monthly', idempotencyKey: 't1' } });
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'TERMS_ACCEPTANCE_REQUIRED');
  const ok = await api('/api/v1/commercial/orders', { method: 'POST', token, body: { products: ['ambo'], billing: 'monthly', idempotencyKey: 't1', acceptTerms: true } });
  assert.equal(ok.status, 201);
  const u = await db.get('SELECT terms_accepted_at, terms_version FROM users WHERE id = ?', acc.user.id);
  assert.ok(u.terms_accepted_at && u.terms_version);
  assert.ok(await db.get("SELECT id FROM audit_logs WHERE action = 'legal.terms_accept' AND actor_user_id = ?", acc.user.id));

  // Exportação completa (portabilidade) e leitura de prontuário auditada.
  const exp = await api('/api/v1/account/export', { token });
  for (const k of ['profile', 'availability', 'consultationRequests', 'reschedules', 'files', 'patients', 'appointments', 'records', 'services']) assert.ok(k in exp.data, k);

  // Exclusão: exige o e-mail da conta, deixa só leitura, pode ser cancelada e é cumprida pela rotina.
  assert.equal((await api('/api/v1/account/deletion', { method: 'POST', token, body: { confirmEmail: 'outro@exemplo.invalid' } })).status, 400);
  const del = await api('/api/v1/account/deletion', { method: 'POST', token, body: { confirmEmail: 'sem.aceite@exemplo.invalid' } });
  assert.equal(del.status, 200);
  const left = (Date.parse(del.data.deletionScheduledFor) - Date.now()) / 86_400_000;
  assert.ok(left > 89 && left < 91);
  assert.equal((await api('/api/v1/auth/me', { token })).data.entitlements.ambo.status, 'read_only');
  assert.equal((await api('/api/v1/account/deletion', { method: 'DELETE', token })).status, 200);
  assert.equal((await runRetention(db)).accountsPurged, 0);
  await api('/api/v1/account/deletion', { method: 'POST', token, body: { confirmEmail: 'sem.aceite@exemplo.invalid' } });
  await db.run("UPDATE professional_accounts SET deletion_scheduled_for = '2020-01-01T00:00:00.000Z' WHERE id = ?", acc.account.id);
  await db.run("INSERT INTO audit_logs (id, actor_type, action, resource_type, outcome, created_at) VALUES ('aud_velho', 'anonymous', 'auth.login', 'user', 'deny', '2020-01-01T00:00:00.000Z')");
  const ran = await runRetention(db);
  assert.equal(ran.accountsPurged, 1);
  assert.ok(ran.accessLogs >= 1);
  assert.equal(await db.get('SELECT id FROM professional_accounts WHERE id = ?', acc.account.id), undefined);
  assert.equal(await db.get('SELECT id FROM users WHERE id = ?', acc.user.id), undefined);
  assert.equal((await api('/api/v1/auth/me', { token })).status, 401);
  // A rotina só roda com o segredo do ambiente.
  assert.equal((await api('/api/v1/internal/retention')).status, 401);
});

test('P2: validações de entrada, saúde pública sem detalhe em produção e fuso da conta', async () => {
  const acc = await newAccount('validacoes@exemplo.invalid');
  const token = acc.sessionToken;
  assert.equal((await api('/api/v1/catalog/quote', { method: 'POST', body: { products: [] } })).status, 400);
  assert.equal((await api('/api/v1/professional/availability', { method: 'PUT', token, body: { rules: [{ weekday: 9, startTime: '25:00', endTime: '08:00' }] } })).status, 400);
  assert.equal((await api('/api/v1/professional/availability', { method: 'PUT', token, body: { rules: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }] } })).status, 200);
  assert.equal((await api('/api/v1/commercial/pilot/apply', { method: 'POST', body: { fullName: 'Ana', email: 'sem@ponto', notes: '' } })).status, 400);
  assert.equal((await api('/api/v1/commercial/pilot/apply', { method: 'POST', body: { fullName: 'Ana Souza', email: 'ana@exemplo.invalid', notes: 'x'.repeat(2001) } })).status, 400);
  // Preferências: juntar por chave, sem apagar a escolha de serviços.
  await api('/api/v1/commercial/selection', { method: 'PUT', token, body: { products: ['ambo'], billing: 'monthly' } });
  await api('/api/v1/professional/profile', { method: 'PATCH', token, body: { uiPreferences: { density: 'compact', commercialSelection: null } } });
  assert.deepEqual((await api('/api/v1/commercial/selection', { token })).data.selection.products, ['ambo']);
  assert.equal((await api('/api/v1/auth/me', { token })).data.account.uiPreferences.density, 'compact');
  // Fusos do Brasil.
  assert.equal(tzOffsetMinutes('America/Sao_Paulo'), -180);
  assert.equal(tzOffsetMinutes('America/Manaus'), -240);
  assert.equal(tzOffsetMinutes('America/Rio_Branco'), -300);
  assert.equal(tzOffsetMinutes('Fuso/Inexistente'), -180);
});

test('CORE-17: preços mostrados nas telas são os mesmos do catálogo do servidor', async () => {
  const { MONTHLY_BY_COMBO, ANNUAL_MONTHS } = await import('../server/catalog.mjs');
  const front = await import('../public/services.js');
  const flow = await import('../public/contract-flow.js');
  for (const [id, reais] of Object.entries(front.MONTHLY)) assert.equal(reais * 100, MONTHLY_BY_COMBO[id], `services.js ${id}`);
  for (const [key, reais] of Object.entries(front.COMBO)) assert.equal(reais * 100, MONTHLY_BY_COMBO[key], `services.js ${key}`);
  const reais = (cents) => `R$ ${cents / 100}`;
  for (const [id, info] of Object.entries(flow.PRODUCT_INFO)) {
    assert.equal(info.monthly, reais(MONTHLY_BY_COMBO[id]), `contract-flow ${id} mensal`);
    assert.equal(info.annual, reais(MONTHLY_BY_COMBO[id] * ANNUAL_MONTHS), `contract-flow ${id} anual`);
  }
  for (const plan of flow.PLANS) {
    const key = ['ambo', 'etha', 'minne'].filter((p) => plan.products.includes(p)).join('+');
    assert.equal(plan.monthly * 100, MONTHLY_BY_COMBO[key], `plano ${plan.id}`);
  }
});

test('CORE-1/VC-9: nomes antigos e endereços internos não aparecem nas telas', async () => {
  const { productOrigin } = await import('../public/eno-origins.js');
  const prod = { hostname: 'enomera.vercel.app', origin: 'https://enomera.vercel.app' };
  // Mesmo com a variável antiga apontando para o projeto interno, o link fica no domínio público.
  assert.equal(productOrigin('ambo', prod, { __ENOMERA_AMBO_URL: 'https://ambo-enomera.vercel.app' }), 'https://enomera.vercel.app/agendamento');
  assert.equal(productOrigin('minne', prod, {}), 'https://enomera.vercel.app/consultorio');
  assert.equal(productOrigin('etha', { hostname: 'meudominio.com.br', origin: 'https://meudominio.com.br' }, {}), 'https://meudominio.com.br/site');
  const { services } = await import('../public/services.js');
  assert.deepEqual(services.map((s) => s.name), ['Agendamento', 'Consultório', 'Site']);
  const visible = ['public/index.html', 'public/configurar.html', 'public/404.html', 'public/piloto/convite.html', 'public/piloto/como-funciona.html', 'public/piloto/painel.html']
    .map((f) => fs.readFileSync(f, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/\b(id|class|for|href|data-[a-z-]+|aria-controls)="[^"]*"/g, ''));
  for (const html of visible) {
    assert.doesNotMatch(html, /\b(Ambo|Minne|Etha|Lotus|Compasso)\b/);
    assert.doesNotMatch(html, /(ambo|minne|etha)-enomera/);
  }
});

test('Pedidos do Enomera Site: respostas públicas sem campo oculto, troca de endereço e prazo com feriado', async () => {
  const { addBusinessDays } = await import('../server/pilot-sobmedida.mjs');
  // 30/04/2026 (quinta) + 2 dias úteis: pula 1º de maio (feriado) e o fim de semana, vence na terça 05/05.
  assert.equal(addBusinessDays('2026-04-30T15:00:00.000Z', 2).slice(0, 10), '2026-05-06'); // 23:59 de 05/05 em Brasília = 02:59Z de 06/05
  // Sexta-feira Santa (03/04/2026) também é pulada.
  assert.equal(addBusinessDays('2026-04-02T15:00:00.000Z', 1).slice(0, 10), '2026-04-07');

  const acc = await newAccount('endereco-site@exemplo.invalid');
  const token = acc.sessionToken;
  const order = await api('/api/v1/commercial/orders', { method: 'POST', token, body: { products: ['etha'], billing: 'monthly', idempotencyKey: 'site1' } });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  const draft = await api('/api/v1/etha/project/editor', { method: 'POST', token, body: { stage: 'preview', content: { displayName: 'Ana Site', answers: { city: 'Santos', address: 'Rua Secreta, 10', showAddress: false, whatsapp: '13999990000' } } } });
  assert.ok(draft.data.versionId, JSON.stringify(draft.data));
  assert.equal((await api('/api/v1/etha/project/publish-staging', { method: 'POST', token, body: { versionId: draft.data.versionId } })).status, 200);
  const oldSlug = acc.account.slug;
  const pub = await api(`/api/v1/public/sites/${oldSlug}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.answers.address, '');
  assert.equal(pub.data.answers.city, 'Santos');
  assert.doesNotMatch(JSON.stringify(pub.data), /Rua Secreta/);

  // Troca de endereço: validação, reserva, unicidade e redirecionamento do anterior.
  const patch = (slug, t = token) => api('/api/v1/etha/site-address', { method: 'PATCH', token: t, body: { slug } });
  assert.equal((await patch('Ab')).data.code, 'SLUG_INVALID');
  assert.equal((await patch('com espaço')).data.code, 'SLUG_INVALID');
  assert.equal((await patch('agendamento')).data.code, 'SLUG_RESERVED');
  assert.equal((await api('/api/v1/etha/site-address', { method: 'PATCH', body: { slug: 'ana-site-psi' } })).status, 401);
  const other = await newAccount('outro-endereco@exemplo.invalid');
  assert.equal((await patch(other.account.slug)).data.code, 'SLUG_TAKEN');
  const ok = await patch('ana-site-psi');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.previousSlug, oldSlug);
  assert.equal((await api('/api/v1/public/sites/ana-site-psi')).data.slug, 'ana-site-psi');
  assert.equal((await api(`/api/v1/public/sites/${oldSlug}`)).data.slug, 'ana-site-psi');
  // O endereço antigo fica reservado para a mesma conta; ninguém mais pode tomá-lo.
  await api('/api/v1/commercial/orders', { method: 'POST', token: other.sessionToken, body: { products: ['etha'], billing: 'monthly', idempotencyKey: 'site2' } });
  assert.equal((await patch(oldSlug, other.sessionToken)).data.code, 'SLUG_TAKEN');
  assert.equal((await patch('ana-outra-vez')).data.code, 'SLUG_CHANGE_TOO_SOON');
});
