// Cofre obrigatório no Consultório (28/11): com o cofre ligado, a Core recusa texto e anexos em claro,
// bloqueia a importação lida no servidor e aceita trocar registros antigos pela versão cifrada (só claro → cifrado).
import { DEMO_PASSWORD } from './demo-credentials.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDb } from '../server/db.mjs';
import { createEnomeraServer } from '../scripts/server.mjs';

let server;
let baseUrl;
let tmpDir;
let token;

async function api(route, { method = 'GET', body = null } = {}) {
  const h = {};
  if (body !== null) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${route}`, { method, headers: h, body: body !== null ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const sealed = (s) => `minne:e2e:2:kid1:${Buffer.from(`iv-${s}`).toString('base64')}:${Buffer.from(`ct-${s}`).toString('base64')}`;
const b64 = (s) => Buffer.from(s).toString('base64');
const sealedName = 'a'.repeat(40) + '.e2e.txt';

test.before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enomera-cofre-'));
  process.env.ENOMERA_DB_PATH = path.join(tmpDir, 'test.sqlite');
  process.env.ENOMERA_STORAGE_DIR = path.join(tmpDir, 'storage');
  delete process.env.ENOMERA_REQUIRE_REMOTE_INFRA;
  delete process.env.ENOMERA_REQUIRE_VAULT;
  delete process.env.VERCEL;
  process.env.ENOMERA_RATE_LIMIT = 'off';
  server = createEnomeraServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const r = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'helena@helenaduartepsi.com.br', password: DEMO_PASSWORD } });
  assert.equal(r.status, 200);
  token = r.data.sessionToken;
});

test.after(async () => {
  delete process.env.ENOMERA_RATE_LIMIT;
  delete process.env.ENOMERA_REQUIRE_VAULT;
  await new Promise((r) => server.close(r));
  await closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Cofre: sem cofre e sem exigência tudo segue; com ENOMERA_REQUIRE_VAULT a escrita pede o cofre', async () => {
  const pat = await api('/api/v1/minne/patients', { method: 'POST', body: { fullName: 'Paciente Cofre Antigo' } });
  assert.equal(pat.status, 201);
  const pid = pat.data.patient.id;
  const d = await api('/api/v1/minne/notes/draft', { method: 'POST', body: { patientId: pid, blocks: [{ id: 'b1', type: 'section', title: 'Sessão', text: 'texto antigo em claro' }, { id: 'b2', type: 'section', title: 'Vazio', text: '' }] } });
  assert.equal(d.status, 200);
  const c = await api(`/api/v1/minne/notes/${d.data.noteId}/conclude`, { method: 'POST', body: {} });
  assert.equal(c.status, 200);
  const a = await api(`/api/v1/minne/notes/${d.data.noteId}/attachments`, { method: 'POST', body: { originalName: 'laudo.txt', contentBase64: b64('laudo em claro') } });
  assert.equal(a.status, 201);

  process.env.ENOMERA_REQUIRE_VAULT = 'true';
  const blocked = await api('/api/v1/minne/notes/draft', { method: 'POST', body: { patientId: pid, blocks: [{ id: 'x', type: 'section', text: 'oi' }] } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'VAULT_REQUIRED');
  const imp = await api('/api/v1/minne/imports/stage', { method: 'POST', body: { sourceKind: 'paste', pastedText: 'x' } });
  assert.equal(imp.data.code, 'VAULT_LOCAL_IMPORT');
  delete process.env.ENOMERA_REQUIRE_VAULT;

  // Liga o cofre (metadados, a Core nunca vê a chave)
  const on = await api('/api/v1/professional/profile', { method: 'PATCH', body: { uiPreferences: { minneVault: { v: 1, kid: 'kid1', wrapped: 'w', salt: 's', iter: 600000 } } } });
  assert.equal(on.status, 200);

  const plain = await api('/api/v1/minne/notes/draft', { method: 'POST', body: { patientId: pid, blocks: [{ id: 'x', type: 'section', text: 'em claro' }] } });
  assert.equal(plain.status, 422);
  assert.equal(plain.data.code, 'PLAINTEXT_REJECTED');
  const ok = await api('/api/v1/minne/notes/draft', { method: 'POST', body: { patientId: pid, blocks: [{ id: 'x', type: 'section', text: sealed('novo') }, { id: 'y', type: 'section', text: '' }] } });
  assert.equal(ok.status, 200);
  const concPlain = await api(`/api/v1/minne/notes/${ok.data.noteId}/conclude`, { method: 'POST', body: { blocks: [{ id: 'x', type: 'section', text: 'claro' }] } });
  assert.equal(concPlain.status, 422);
  assert.equal((await api(`/api/v1/minne/notes/${ok.data.noteId}/conclude`, { method: 'POST', body: {} })).status, 200);

  const attPlain = await api(`/api/v1/minne/notes/${ok.data.noteId}/attachments`, { method: 'POST', body: { originalName: 'laudo.pdf', contentBase64: b64('%PDF-1.4') } });
  assert.equal(attPlain.status, 422);
  const attOk = await api(`/api/v1/minne/notes/${ok.data.noteId}/attachments`, { method: 'POST', body: { originalName: sealedName, contentBase64: b64('MINNE-E2E-2\nkid1\nabc') } });
  assert.equal(attOk.status, 201);
  assert.equal((await api('/api/v1/minne/imports/stage', { method: 'POST', body: { sourceKind: 'paste', pastedText: 'x' } })).status, 409);

  // Migração da versão antiga
  const list = await api(`/api/v1/minne/patients/${pid}/notes`);
  const old = list.data.notes.find((n) => n.id === d.data.noteId);
  const ver = old.versions[0];
  const verId = ver.id;
  const mismatch = await api('/api/v1/minne/vault/seal-version', { method: 'POST', body: { noteId: old.id, versionId: verId, blocks: [{ id: 'b1', type: 'section', text: sealed('a') }] } });
  assert.equal(mismatch.data.code, 'BLOCKS_MISMATCH');
  const half = await api('/api/v1/minne/vault/seal-version', { method: 'POST', body: { noteId: old.id, versionId: verId, blocks: [{ id: 'b1', type: 'section', title: 'Sessão', text: 'ainda claro' }, { id: 'b2', type: 'section', text: '' }] } });
  assert.equal(half.data.code, 'PLAINTEXT_REJECTED');
  const sv = await api('/api/v1/minne/vault/seal-version', { method: 'POST', body: { noteId: old.id, versionId: verId, blocks: [{ id: 'b1', type: 'section', title: 'Sessão', text: sealed('antigo') }, { id: 'b2', type: 'section', title: 'Vazio', text: '' }] } });
  assert.equal(sv.status, 200);
  assert.equal(sv.data.versionNumber, ver.version_number);
  const again = await api('/api/v1/minne/vault/seal-version', { method: 'POST', body: { noteId: old.id, versionId: verId, blocks: [{ id: 'b1', type: 'section', text: sealed('x') }, { id: 'b2', type: 'section', text: '' }] } });
  assert.equal(again.data.code, 'ALREADY_SEALED');

  // Migração do anexo antigo
  const fileId = old.attachments[0].id;
  const sa = await api('/api/v1/minne/vault/seal-attachment', { method: 'POST', body: { noteId: old.id, fileId, originalName: sealedName, contentBase64: b64('MINNE-E2E-2\nkid1\nxyz') } });
  assert.equal(sa.status, 200);
  assert.equal(sa.data.replaced, fileId);
  const after = (await api(`/api/v1/minne/patients/${pid}/notes`)).data.notes.find((n) => n.id === old.id);
  assert.ok(after.versions[0].blocks.every((b) => !b.text || b.text.startsWith('minne:e2e:2:')));
  assert.deepEqual(after.attachments.map((x) => x.id), [sa.data.file.id]);
  assert.equal((await api(`/api/v1/files/${fileId}`)).status, 404);

  // Resíduo das importações (a conta de demonstração não tem nenhuma; a rota responde e limpa)
  const io = await api('/api/v1/minne/vault/import-originals');
  assert.equal(io.status, 200);
  assert.ok(Array.isArray(io.data.originals));
  const pg = await api('/api/v1/minne/vault/purge-import-residue', { method: 'POST', body: {} });
  assert.equal(pg.status, 200);
});
