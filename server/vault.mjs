// Cofre do Consultório (28/11/2026): a cifra dos prontuários passa a ser obrigatória.
// A Core nunca vê a chave: ela só confere a forma do que chega. Com o cofre ligado na conta,
// texto e anexos em claro são recusados; registros antigos podem ser trocados pela versão
// cifrada uma única vez (claro → cifrado, nunca o contrário), com trilha de auditoria.
import { runTransaction, writeAudit } from './db.mjs';
import { deletePrivateFileBinary, savePrivateFile } from './storage.mjs';
import { nowIso } from './crypto.mjs';

const TEXT_FAMILY = 'minne:e2e:';
const TEXT_V2 = 'minne:e2e:2:';
const FILE_MAGIC_V2 = 'MINNE-E2E-2\n';
const NAME_SUFFIX = '.e2e.txt';

export const isSealedText = (s) => typeof s === 'string' && s.startsWith(TEXT_FAMILY);
const isSealedTextV2 = (s) => typeof s === 'string' && s.startsWith(TEXT_V2);
export const isSealedName = (n) => typeof n === 'string' && n.endsWith(NAME_SUFFIX) && n.length > 40;
const blockTexts = (blocks) => (Array.isArray(blocks) ? blocks : []).map((b) => (b && typeof b.text === 'string' ? b.text : ''));

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export async function accountHasVault(db, accountId) {
  const row = await db.get('SELECT ui_preferences_json FROM professional_accounts WHERE id = ?', accountId);
  let prefs = {};
  try { prefs = JSON.parse(row?.ui_preferences_json || '{}') || {}; } catch { prefs = {}; }
  const v = prefs.minneVault;
  return Boolean(v && typeof v.wrapped === 'string' && typeof v.kid === 'string');
}

/** Liga a exigência para contas sem cofre. Contas com cofre recusam texto em claro sempre. */
const vaultRequiredForAll = () => process.env.ENOMERA_REQUIRE_VAULT === 'true';

/** Antes de gravar blocos clínicos: com cofre, tudo que tem texto precisa estar cifrado. */
export async function assertSealedBlocks(db, accountId, blocks) {
  const has = await accountHasVault(db, accountId);
  if (!has) {
    if (vaultRequiredForAll()) throw fail(403, 'VAULT_REQUIRED', 'Configure o cofre do prontuário antes de escrever. Os registros são cifrados no seu navegador.');
    return;
  }
  if (blockTexts(blocks).some((t) => t.trim() && !isSealedText(t))) {
    throw fail(422, 'PLAINTEXT_REJECTED', 'Este registro chegou sem cifra. Recarregue o Consultório e abra o cofre para salvar.');
  }
}

/** Antes de guardar um anexo clínico: com cofre, só arquivo cifrado no navegador. */
export async function assertSealedAttachment(db, accountId, originalName, buffer) {
  const has = await accountHasVault(db, accountId);
  if (!has) {
    if (vaultRequiredForAll()) throw fail(403, 'VAULT_REQUIRED', 'Configure o cofre do prontuário antes de anexar arquivos.');
    return;
  }
  const head = buffer.subarray(0, 16).toString('utf8');
  if (!isSealedName(originalName) || !head.startsWith('MINNE-E2E-')) {
    throw fail(422, 'PLAINTEXT_REJECTED', 'Este anexo chegou sem cifra. Recarregue o Consultório e abra o cofre para anexar.');
  }
}

/** A importação lida no servidor não combina com o cofre: com ele, a leitura é feita no navegador. */
export async function assertServerImportAllowed(db, accountId) {
  if (await accountHasVault(db, accountId) || vaultRequiredForAll()) {
    throw fail(409, 'VAULT_LOCAL_IMPORT', 'Com o cofre, a importação é lida e cifrada no seu navegador. Atualize o Consultório e tente de novo.');
  }
}

async function ownedNote(db, accountId, noteId) {
  const note = await db.get('SELECT * FROM clinical_notes WHERE id = ? AND account_id = ?', noteId, accountId);
  if (!note) throw fail(404, 'NOTE_NOT_FOUND', 'Registro não encontrado.');
  return note;
}

/**
 * Migração de uma versão antiga: troca o texto em claro pela mesma versão cifrada.
 * Só vale se a versão inteira estiver em claro e a nova vier inteira cifrada (formato 2, preso ao paciente),
 * com os mesmos blocos na mesma ordem. Número, autor e data da versão não mudam.
 */
export async function sealVersion(db, auth, { noteId, versionId, blocks }) {
  if (!(await accountHasVault(db, auth.account.id))) throw fail(409, 'VAULT_OFF', 'Ligue o cofre antes de cifrar os registros antigos.');
  const note = await ownedNote(db, auth.account.id, noteId);
  const ver = await db.get('SELECT * FROM clinical_note_versions WHERE id = ? AND note_id = ? AND account_id = ?', versionId, note.id, auth.account.id);
  if (!ver) throw fail(404, 'VERSION_NOT_FOUND', 'Versão não encontrada.');
  let current = [];
  try { current = JSON.parse(ver.blocks_json || '[]'); } catch { current = []; }
  const next = Array.isArray(blocks) ? blocks : [];
  const cur = blockTexts(current);
  if (cur.some(isSealedText)) throw fail(409, 'ALREADY_SEALED', 'Esta versão já está cifrada.');
  if (next.length !== current.length || next.some((b, i) => String(b?.id ?? '') !== String(current[i]?.id ?? '') || String(b?.type ?? '') !== String(current[i]?.type ?? ''))) {
    throw fail(422, 'BLOCKS_MISMATCH', 'A versão cifrada precisa ter os mesmos blocos da original.');
  }
  const nt = blockTexts(next);
  if (nt.some((t, i) => (cur[i].trim() ? !isSealedTextV2(t) : t !== cur[i] && !isSealedTextV2(t)))) {
    throw fail(422, 'PLAINTEXT_REJECTED', 'Todo texto da versão precisa chegar cifrado.');
  }
  await runTransaction(db, async (tx) => {
    await tx.run('UPDATE clinical_note_versions SET blocks_json = ? WHERE id = ?', JSON.stringify(next), ver.id);
    await writeAudit(tx, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'clinical_note.version_sealed', resourceType: 'clinical_note', resourceId: note.id, meta: { versionNumber: ver.version_number } });
  });
  return { noteId: note.id, versionId: ver.id, versionNumber: ver.version_number };
}

/** Migração de um anexo antigo: grava a cópia cifrada no lugar do arquivo em claro, que é apagado. */
export async function sealAttachment(db, auth, { noteId, fileId, originalName, contentBase64 }) {
  if (!(await accountHasVault(db, auth.account.id))) throw fail(409, 'VAULT_OFF', 'Ligue o cofre antes de cifrar os anexos antigos.');
  const note = await ownedNote(db, auth.account.id, noteId);
  const ids = JSON.parse(note.attachment_file_ids_json || '[]');
  if (!ids.includes(fileId)) throw fail(404, 'FILE_NOT_FOUND', 'Anexo não encontrado neste registro.');
  const old = await db.get('SELECT * FROM private_files WHERE id = ? AND account_id = ?', fileId, auth.account.id);
  if (!old) throw fail(404, 'FILE_NOT_FOUND', 'Anexo não encontrado.');
  if (isSealedName(old.original_name)) throw fail(409, 'ALREADY_SEALED', 'Este anexo já está cifrado.');
  const buffer = Buffer.from(String(contentBase64 || ''), 'base64');
  if (!isSealedName(originalName) || !buffer.subarray(0, 12).toString('utf8').startsWith(FILE_MAGIC_V2)) {
    throw fail(422, 'PLAINTEXT_REJECTED', 'O anexo precisa chegar cifrado.');
  }
  const saved = await savePrivateFile(db, { accountId: auth.account.id, ownerUserId: auth.user.id, scope: 'minne_clinical', originalName, buffer });
  const nextIds = ids.map((x) => (x === fileId ? saved.id : x));
  await runTransaction(db, async (tx) => {
    await tx.run('UPDATE clinical_notes SET attachment_file_ids_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(nextIds), nowIso(), note.id);
    await tx.run('UPDATE import_items SET file_id = NULL WHERE file_id = ? AND account_id = ?', old.id, auth.account.id);
    await tx.run('DELETE FROM private_files WHERE id = ?', old.id);
    await writeAudit(tx, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'clinical_note.attachment_sealed', resourceType: 'private_file', resourceId: saved.id, meta: { noteId: note.id, replaced: old.id } });
  });
  await deletePrivateFileBinary(old);
  return { file: saved, replaced: old.id, noteId: note.id };
}

/** Originais de importações antigas (lidos no servidor) que ainda estão guardados em claro. */
export async function listImportOriginals(db, auth) {
  const rows = await db.all(`
    SELECT i.id AS item_id, i.created_note_id, i.status, f.id AS file_id, f.original_name, f.size_bytes
    FROM import_items i JOIN private_files f ON f.id = i.file_id
    WHERE i.account_id = ? AND f.account_id = ?`, auth.account.id, auth.account.id);
  const residue = await db.get(`SELECT COUNT(*) AS n FROM import_items WHERE account_id = ? AND (extracted_text <> '' OR extracted_fields_json <> '{}' OR unrecognized_fields_json <> '{}')`, auth.account.id);
  return { originals: rows.filter((r) => !isSealedName(r.original_name)), textResidue: Number(residue?.n || 0) };
}

/**
 * Fim da migração: apaga o texto lido no servidor nas importações antigas e os originais em claro.
 * O Consultório chama depois de guardar a cópia cifrada de cada original no registro criado.
 * Os registros do prontuário não são tocados.
 */
export async function purgeImportResidue(db, auth) {
  if (!(await accountHasVault(db, auth.account.id))) throw fail(409, 'VAULT_OFF', 'Ligue o cofre antes de limpar as importações antigas.');
  const { originals } = await listImportOriginals(db, auth);
  const files = [];
  for (const o of originals) {
    const row = await db.get('SELECT * FROM private_files WHERE id = ? AND account_id = ?', o.file_id, auth.account.id);
    if (row) files.push(row);
  }
  await runTransaction(db, async (tx) => {
    await tx.run(`UPDATE import_items SET extracted_text = '', extracted_fields_json = '{}', unrecognized_fields_json = '{}' WHERE account_id = ?`, auth.account.id);
    for (const f of files) {
      await tx.run('UPDATE import_items SET file_id = NULL WHERE file_id = ? AND account_id = ?', f.id, auth.account.id);
      // O original também pode estar ligado a um registro como anexo (importação de arquivo); sai da lista.
      const notes = await tx.all('SELECT id, attachment_file_ids_json FROM clinical_notes WHERE account_id = ? AND attachment_file_ids_json LIKE ?', auth.account.id, `%${f.id}%`);
      for (const n of notes) {
        const ids = JSON.parse(n.attachment_file_ids_json || '[]').filter((x) => x !== f.id);
        await tx.run('UPDATE clinical_notes SET attachment_file_ids_json = ? WHERE id = ?', JSON.stringify(ids), n.id);
      }
      await tx.run('DELETE FROM private_files WHERE id = ?', f.id);
    }
    await writeAudit(tx, { actorUserId: auth.user.id, actorType: 'professional', accountId: auth.account.id, action: 'import.residue_purged', resourceType: 'account', resourceId: auth.account.id, meta: { files: files.length } });
  });
  for (const f of files) await deletePrivateFileBinary(f);
  return { purgedFiles: files.length };
}
