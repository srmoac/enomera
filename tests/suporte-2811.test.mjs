// Chat de ajuda (28/11): perguntas sem resposta, chamado para uma pessoa (e-mail à Enomera)
// e leitura só pelo operador. A base de respostas precisa ser JSON válido e coerente.
import { DEMO_PASSWORD, OPERATOR_PASSWORD } from './demo-credentials.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';

let server, baseUrl, tmpDir;
async function api(route, { method = 'GET', body = null, token = null } = {}) {
  const h = {};
  if (body !== null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${route}`, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-sup-'));
  process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'test.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'storage');
  delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
  delete process.env.VERCEL;
  server = createEnomeraServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('base de respostas: JSON válido, ids únicos, sugestões existem, contato oficial', () => {
  const b = JSON.parse(fs.readFileSync(new URL('../public/eno-suporte-base.json', import.meta.url), 'utf8'));
  const ids = b.respostas.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of b.sugestoes) assert.ok(ids.includes(s), s);
  for (const r of b.respostas) { assert.ok(r.titulo && r.resposta && r.perguntas.length, r.id); }
  assert.equal(b.contato.email, 'contatoenomera@gmail.com');
  assert.equal(b.contato.whatsapp, '5513912352841');
  assert.match(b.respostas.find((r) => r.id === 'crise').resposta, /188/);
});

test('pergunta sem resposta e chamado ficam guardados; e-mail vai para o contato oficial; só operador lê', async () => {
  const q = await api('/api/v1/suporte/sem-resposta', { method: 'POST', body: { pergunta: 'emitem recibo?', pagina: '/portal?token=segredo#x' } });
  assert.equal(q.status, 201);
  const bad = await api('/api/v1/suporte/chamados', { method: 'POST', body: { email: 'sem-arroba', mensagem: 'oi tudo bem' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.field || bad.data.error?.field || 'email', 'email');
  const ok = await api('/api/v1/suporte/chamados', { method: 'POST', body: { nome: 'Ana', email: 'ana@exemplo.invalid', mensagem: 'Quero ajuda com o site', pergunta: 'site', pagina: '/', conversa: [{ de: 'pessoa', texto: 'site' }] } });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const box = (await api(`/api/v1/dev/outbox?recipient=${encodeURIComponent('contatoenomera@gmail.com')}`)).data.messages || [];
  assert.ok(box.some((m) => /ana@exemplo\.invalid/.test(m.body_preview)), 'aviso por e-mail com o endereço para responder');

  assert.equal((await api('/api/v1/suporte/perguntas')).status, 401);
  const helena = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'helena@helenaduartepsi.com.br', password: DEMO_PASSWORD } })).data.sessionToken;
  assert.equal((await api('/api/v1/suporte/perguntas', { token: helena })).status, 403);
  const op = (await api('/api/v1/auth/login', { method: 'POST', body: { email: 'marcos@enomera-ops.exemplo.com.br', password: OPERATOR_PASSWORD } })).data.sessionToken;
  const list = await api('/api/v1/suporte/perguntas', { token: op });
  assert.equal(list.status, 200);
  const semResp = list.data.items.find((i) => i.kind === 'sem_resposta');
  assert.equal(semResp.page, '/portal', 'guarda só o caminho, sem token da URL');
  assert.ok(list.data.items.some((i) => i.kind === 'chamado' && i.email === 'ana@exemplo.invalid'));
});
