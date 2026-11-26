import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFileMagic, nowIso, randomId, sha256Hex } from './crypto.mjs';
import { isRemoteInfraRequired } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per single file
export const MAX_ZIP_BYTES = 25 * 1024 * 1024;  // 25 MB per batch ZIP

export function resolvePrivateStorageRoot() {
  if (process.env.ENOMERA_STORAGE_DIR) return process.env.ENOMERA_STORAGE_DIR;
  if (process.env.VERCEL) return '/tmp/enomera-private-files';
  return path.join(__dirname, 'storage', 'private');
}

export function getStorageBackendStatus() {
  const hasBlobToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const remoteRequired = isRemoteInfraRequired();
  return {
    backend: hasBlobToken
      ? 'vercel_blob_private'
      : remoteRequired
        ? 'unconfigured_remote_required'
        : 'local_private',
    vercelBlobConfigured: hasBlobToken,
    remoteRequired,
    missingEnvVars: hasBlobToken ? [] : ['BLOB_READ_WRITE_TOKEN'],
    privateAccessEnforced: true,
    localFallbackRoot: remoteRequired && !hasBlobToken ? null : resolvePrivateStorageRoot(),
  };
}

export async function savePrivateFile(db, { accountId, ownerUserId, scope, originalName, buffer, allowLegacyReject = true }) {
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
  const safeAcct = String(accountId || 'acct').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeScope = String(scope || 'private').replace(/[^a-zA-Z0-9_-]/g, '_');

  let storageBackend = 'local_private';
  let storagePath = '';

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blobMod = await import('@vercel/blob');
    const pathname = `private/${safeAcct}/${safeScope}/${fileId}.bin`;
    const uploaded = await blobMod.put(pathname, buffer, {
      access: 'private',
      contentType: magic.mime || 'application/octet-stream',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    storageBackend = 'vercel_blob_private';
    storagePath = uploaded.pathname || uploaded.url;
  } else if (isRemoteInfraRequired()) {
    throw Object.assign(
      new Error('Armazenamento privado remoto (Vercel Blob Private) não configurado neste ambiente de entrega. Defina BLOB_READ_WRITE_TOKEN no ambiente Preview da Vercel.'),
      {
        status: 503,
        code: 'REMOTE_BLOB_NOT_CONFIGURED',
        missingEnvVars: ['BLOB_READ_WRITE_TOKEN'],
      }
    );
  } else {
    const root = resolvePrivateStorageRoot();
    const accountDir = path.join(root, safeAcct);
    fs.mkdirSync(accountDir, { recursive: true });
    storagePath = path.join(accountDir, `${fileId}.bin`);
    fs.writeFileSync(storagePath, buffer);
  }

  const createdAt = nowIso();
  await db.run(
    `INSERT INTO private_files (id, account_id, scope, owner_user_id, original_name, detected_mime, size_bytes, sha256, storage_backend, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    fileId, accountId, scope, ownerUserId, safeName, magic.mime, buffer.length, sha, storageBackend, storagePath, createdAt
  );

  return {
    id: fileId,
    accountId,
    scope,
    originalName: safeName,
    detectedMime: magic.mime,
    detectedFormat: magic.format,
    sizeBytes: buffer.length,
    sha256: sha,
    storageBackend,
    createdAt,
  };
}

export async function readPrivateFileBinary(fileRow) {
  if (!fileRow || !fileRow.storage_path) return null;
  if (fileRow.storage_backend === 'vercel_blob_private') {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      if (isRemoteInfraRequired()) {
        throw Object.assign(
          new Error('Armazenamento privado remoto (Vercel Blob Private) não configurado neste ambiente de entrega. Defina BLOB_READ_WRITE_TOKEN no ambiente Preview da Vercel.'),
          {
            status: 503,
            code: 'REMOTE_BLOB_NOT_CONFIGURED',
            missingEnvVars: ['BLOB_READ_WRITE_TOKEN'],
          }
        );
      }
      return null;
    }
    const blobMod = await import('@vercel/blob');
    const result = await blobMod.get(fileRow.storage_path, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result?.stream) return null;
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  if (isRemoteInfraRequired() && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw Object.assign(
      new Error('Armazenamento privado remoto (Vercel Blob Private) não configurado neste ambiente de entrega. Defina BLOB_READ_WRITE_TOKEN no ambiente Preview da Vercel.'),
      {
        status: 503,
        code: 'REMOTE_BLOB_NOT_CONFIGURED',
        missingEnvVars: ['BLOB_READ_WRITE_TOKEN'],
      }
    );
  }
  const root = path.resolve(resolvePrivateStorageRoot());
  const resolved = path.resolve(fileRow.storage_path);
  if (!resolved.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Caminho de arquivo privado inválido.'), { status: 403, code: 'INVALID_STORAGE_PATH' });
  }
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

/** Apaga o conteúdo de um arquivo privado (exclusão de conta). Falha de um arquivo não interrompe os demais. */
export async function deletePrivateFileBinary(fileRow) {
  if (!fileRow || !fileRow.storage_path) return false;
  try {
    if (fileRow.storage_backend === 'vercel_blob_private') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
      const blobMod = await import('@vercel/blob');
      await blobMod.del(fileRow.storage_path, { token: process.env.BLOB_READ_WRITE_TOKEN });
      return true;
    }
    const root = path.resolve(resolvePrivateStorageRoot());
    const resolved = path.resolve(fileRow.storage_path);
    if (!resolved.startsWith(root + path.sep)) return false;
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return true;
  } catch (err) {
    console.error('[storage] arquivo não apagado:', fileRow.id, err?.message || err);
    return false;
  }
}
