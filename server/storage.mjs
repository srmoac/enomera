import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFileMagic, nowIso, randomId, sha256Hex } from './crypto.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per single file
export const MAX_ZIP_BYTES = 25 * 1024 * 1024;  // 25 MB per batch ZIP

export function resolvePrivateStorageRoot() {
  if (process.env.ENOMERA_STORAGE_DIR) return process.env.ENOMERA_STORAGE_DIR;
  if (process.env.VERCEL) return '/tmp/enomera-private-files';
  return path.join(__dirname, 'storage', 'private');
}

export function savePrivateFile(db, { accountId, ownerUserId, scope, originalName, buffer, allowLegacyReject = true }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error('Arquivo vazio.'), { status: 400, code: 'EMPTY_FILE' });
  }
  const safeName = path.basename(String(originalName || 'arquivo.bin')).replace(/[^\w.\- ()áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/g, '_');
  const magic = detectFileMagic(buffer, safeName);

  if (magic.format === 'legacy_doc' && allowLegacyReject) {
    throw Object.assign(
      new Error('Formato .doc antigo não é suportado com segurança sem conversor validado. Salve o arquivo como .docx ou .pdf no Word/LibreOffice/Google Docs e envie novamente.'),
      { status: 415, code: 'LEGACY_DOC_UNSUPPORTED' }
    );
  }
  const maxBytes = magic.format === 'zip' ? MAX_ZIP_BYTES : MAX_FILE_BYTES;
  if (buffer.length > maxBytes) {
    throw Object.assign(
      new Error(`Arquivo excede o limite permitido (${Math.round(maxBytes / (1024 * 1024))} MB).`),
      { status: 413, code: 'FILE_TOO_LARGE' }
    );
  }
  if (!magic.safe) {
    throw Object.assign(
      new Error('Tipo de arquivo não suportado ou assinatura binária inválida.'),
      { status: 415, code: 'UNSUPPORTED_FILE_TYPE' }
    );
  }

  const fileId = randomId('file');
  const sha = sha256Hex(buffer);
  const root = resolvePrivateStorageRoot();
  const accountDir = path.join(root, accountId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  fs.mkdirSync(accountDir, { recursive: true });
  const diskPath = path.join(accountDir, `${fileId}.bin`);
  fs.writeFileSync(diskPath, buffer);

  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO private_files (id, account_id, scope, owner_user_id, original_name, detected_mime, size_bytes, sha256, storage_backend, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local_private', ?, ?)
  `).run(fileId, accountId, scope, ownerUserId, safeName, magic.mime, buffer.length, sha, diskPath, createdAt);

  return {
    id: fileId,
    accountId,
    scope,
    originalName: safeName,
    detectedMime: magic.mime,
    detectedFormat: magic.format,
    sizeBytes: buffer.length,
    sha256: sha,
    createdAt,
  };
}

export function getStorageBackendStatus() {
  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  return {
    backend: hasBlobToken ? 'vercel_blob_private' : 'local_private',
    vercelBlobConfigured: hasBlobToken,
    privateAccessEnforced: true,
    localFallbackRoot: resolvePrivateStorageRoot(),
  };
}

export async function mirrorPrivateFileToBlobIfConfigured(db, fileId, { accountId, scope, buffer, mime }) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { mirrored: false, backend: 'local_private' };
  }
  try {
    const blobMod = await import('@vercel/blob');
    const safeAcct = String(accountId || 'acct').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = String(scope || 'private').replace(/[^a-zA-Z0-9_-]/g, '_');
    const pathname = `private/${safeAcct}/${safeScope}/${fileId}.bin`;
    const uploaded = await blobMod.put(pathname, buffer, {
      access: 'private',
      contentType: mime || 'application/octet-stream',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    db.prepare(`
      UPDATE private_files
      SET storage_backend = 'vercel_blob_private', storage_path = ?
      WHERE id = ?
    `).run(uploaded.pathname || uploaded.url, fileId);
    return { mirrored: true, backend: 'vercel_blob_private', pathname: uploaded.pathname || uploaded.url };
  } catch (err) {
    return { mirrored: false, backend: 'local_private', error: err?.message || 'blob_mirror_failed' };
  }
}

export function readPrivateFileBinary(fileRow) {
  if (!fileRow || !fileRow.storage_path) return null;
  if (fileRow.storage_backend === 'vercel_blob_private') return null;
  const root = path.resolve(resolvePrivateStorageRoot());
  const resolved = path.resolve(fileRow.storage_path);
  if (!resolved.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Caminho de arquivo privado inválido.'), { status: 403, code: 'INVALID_STORAGE_PATH' });
  }
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

export async function readPrivateFileBinaryAsync(fileRow) {
  if (!fileRow || !fileRow.storage_path) return null;
  if (fileRow.storage_backend === 'vercel_blob_private' && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blobMod = await import('@vercel/blob');
      if (typeof blobMod.get === 'function') {
        const result = await blobMod.get(fileRow.storage_path, {
          access: 'private',
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        if (result?.stream) {
          const chunks = [];
          for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
          return Buffer.concat(chunks);
        }
      }
    } catch {
      // Fallback below if local mirror exists
    }
  }
  return readPrivateFileBinary(fileRow);
}
