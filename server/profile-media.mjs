import { savePrivateFile, readPrivateFileBinary } from './storage.mjs';

export const profilePhotoUrl = (account) => account.photo_file_id
  ? `/api/v1/ambo/public/${encodeURIComponent(account.slug)}/photo/${encodeURIComponent(account.photo_file_id)}` : null;

export async function savePortrait(db, auth, body, scope = 'professional_photo') {
  const buffer = Buffer.from(String(body.contentBase64 || ''), 'base64');
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw Object.assign(new Error('Escolha uma foto PNG, JPEG ou WebP válida.'), { status: 415, code: 'INVALID_PORTRAIT' });
  if (buffer.length > 3 * 1024 * 1024) throw Object.assign(new Error('A foto deve ter até 3 MB.'), { status: 413, code: 'PORTRAIT_TOO_LARGE' });
  const saved = await savePrivateFile(db, { accountId: auth.account.id, ownerUserId: auth.user.id,
    scope, originalName: body.originalName || (png ? 'foto.png' : webp ? 'foto.webp' : 'foto.jpg'), buffer });
  return { photoAssetId: saved.id, photoUrl: `/api/v1/files/${saved.id}`, originalName: saved.originalName };
}

export async function requireOwnedPortrait(db, accountId, id) {
  if (id == null) return null;
  const file = await db.get('SELECT * FROM private_files WHERE id = ? AND account_id = ?', id, accountId);
  if (!file || !['professional_photo', 'etha_photo', 'etha_briefing'].includes(file.scope) || !String(file.detected_mime).startsWith('image/')) {
    throw Object.assign(new Error('Foto não encontrada nesta conta.'), { status: 404, code: 'PORTRAIT_NOT_FOUND' });
  }
  return file;
}

export async function servePortrait(res, file) {
  const binary = await readPrivateFileBinary(file);
  if (!binary) throw Object.assign(new Error('Foto indisponível. Envie novamente.'), { status: 404, code: 'PORTRAIT_UNAVAILABLE' });
  res.writeHead(200, { 'Content-Type': file.detected_mime, 'Content-Length': binary.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(binary);
}
