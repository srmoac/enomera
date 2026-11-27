// Área Site Sob medida do painel do piloto (Marcos, 23/11/2026): o administrador vê o material
// de cada pedido (briefing, respostas, fotos e anexos com download), o status
// (novo → em produção → entregue) e o prazo de 2 dias úteis.
import { nowIso } from './crypto.mjs';
import { readPrivateFileBinary } from './storage.mjs';

const DAY = 864e5;
const SAFE_SCOPES = ['etha_briefing', 'etha_photo', 'professional_photo'];

function parse(j, fb = {}) { try { return JSON.parse(j || '') ?? fb; } catch { return fb; } }

/** Domingo de Páscoa (algoritmo de Meeus), como [mês, dia]. */
function easter(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
}
const holidayCache = new Map();
/** Feriados nacionais do ano (fixos e móveis: Carnaval, Sexta-feira Santa, Corpus Christi), em AAAA-MM-DD. */
export function nationalHolidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const pad = (n) => String(n).padStart(2, '0');
  const set = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((d) => `${year}-${d}`));
  const [em, ed] = easter(year);
  const base = Date.UTC(year, em - 1, ed);
  for (const off of [-48, -47, -2, 60]) { const d = new Date(base + off * DAY); set.add(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`); }
  holidayCache.set(year, set);
  return set;
}

/** Soma dias úteis (seg–sex, sem feriados nacionais) em horário de Brasília; o prazo vence no fim do dia útil. */
export function addBusinessDays(iso, n) {
  let t = Date.parse(iso) - 3 * 3600e3; // para "hora de Brasília"
  let left = n;
  while (left > 0) {
    t += DAY;
    const day = new Date(t);
    const wd = day.getUTCDay();
    if (wd !== 0 && wd !== 6 && !nationalHolidays(day.getUTCFullYear()).has(day.toISOString().slice(0, 10))) left--;
  }
  const d = new Date(t).toISOString().slice(0, 10);
  return new Date(Date.parse(`${d}T23:59:59.000Z`) + 3 * 3600e3).toISOString();
}

function serviceOf(briefing, prefs) {
  if (briefing.service === 'sob_medida' || briefing.service === 'essencial') return briefing.service;
  return prefs.commercialSelection?.ethaService === 'sob_medida' ? 'sob_medida' : 'essencial';
}

function statusOf(sm) {
  if (sm.deliveredAt) return 'delivered';
  if (sm.startedAt) return 'production';
  return 'new';
}

function orderSummary(r) {
  const b = parse(r.briefing_json); const sm = b.sobMedida || {};
  const receivedAt = sm.submittedAt || sm.sentAt || r.created_at;
  const dueAt = sm.dueAt || addBusinessDays(receivedAt, 2);
  const status = statusOf(sm);
  return {
    projectId: r.id, accountId: r.account_id, name: r.display_name, slug: r.slug, email: r.email || null,
    projectStatus: r.status, status, receivedAt, submitted: Boolean(sm.submittedAt || sm.sentAt), startedAt: sm.startedAt || null, deliveredAt: sm.deliveredAt || null,
    dueAt, late: status !== 'delivered' && Date.now() > Date.parse(dueAt), updatedAt: r.updated_at,
    files: parse(r.attachment_file_ids_json, []).length + (b.photoAssetId ? 1 : 0),
  };
}

const BASE_SQL = `SELECT p.id, p.account_id, p.status, p.briefing_json, p.attachment_file_ids_json, p.format, p.cta_mode, p.custom_contact_url, p.domain_name,
    p.created_at, p.updated_at, a.display_name, a.slug, a.crp_or_crm, a.specialty, a.city, a.bio, a.photo_file_id, a.ui_preferences_json, u.email, u.full_name
  FROM etha_projects p JOIN professional_accounts a ON a.id = p.account_id LEFT JOIN users u ON u.id = a.owner_user_id`;

export async function listSobMedida(db) {
  const rows = await db.all(`${BASE_SQL} ORDER BY p.updated_at DESC`);
  const out = rows.filter((r) => serviceOf(parse(r.briefing_json), parse(r.ui_preferences_json)) === 'sob_medida').map(orderSummary);
  const rank = { new: 0, production: 1, delivered: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.dueAt.localeCompare(b.dueAt));
}

export async function sobMedidaDetail(db, projectId) {
  const r = await db.get(`${BASE_SQL} WHERE p.id = ?`, projectId);
  if (!r) throw Object.assign(new Error('Pedido do Site não encontrado.'), { status: 404, code: 'PROJECT_NOT_FOUND' });
  const briefing = parse(r.briefing_json);
  const last = await db.get('SELECT version_number, stage, content_json, created_at FROM etha_content_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1', r.id);
  const content = last ? parse(last.content_json) : {};
  const ids = [...new Set([...parse(r.attachment_file_ids_json, []), briefing.photoAssetId, content.photoAssetId, r.photo_file_id].filter(Boolean))];
  const files = [];
  for (const id of ids) {
    const f = await db.get('SELECT id, scope, original_name, detected_mime, size_bytes, created_at FROM private_files WHERE id = ? AND account_id = ?', id, r.account_id);
    if (f && SAFE_SCOPES.includes(f.scope)) {
      files.push({ id: f.id, name: f.original_name, mime: f.detected_mime, size: Number(f.size_bytes), createdAt: f.created_at,
        kind: f.id === r.photo_file_id ? 'Foto do perfil' : f.scope === 'etha_photo' ? 'Foto para o site'
          : (briefing.sobMedida?.profile?.cvName && f.original_name === briefing.sobMedida.profile.cvName) ? 'Currículo'
          : String(f.detected_mime).startsWith('image/') ? 'Foto enviada' : 'Anexo' });
    }
  }
  const { sobMedida, ...briefingRest } = briefing;
  return {
    ...orderSummary(r),
    account: { name: r.display_name, fullName: r.full_name, email: r.email, crp: r.crp_or_crm, specialty: r.specialty, city: r.city, bio: r.bio, slug: r.slug },
    site: { format: r.format, ctaMode: r.cta_mode, contactUrl: r.custom_contact_url, domain: r.domain_name },
    briefing: briefingRest,
    sobMedida: sobMedida || {},
    content: { versionNumber: last?.version_number || null, stage: last?.stage || null, savedAt: last?.created_at || null,
      fields: Object.fromEntries(Object.entries(content).filter(([k]) => k !== 'answers' && k !== 'photoAssetId')), answers: content.answers || {} },
    files,
  };
}

export async function setSobMedidaStatus(db, projectId, status, adminUserId) {
  const proj = await db.get('SELECT id, briefing_json FROM etha_projects WHERE id = ?', projectId);
  if (!proj) throw Object.assign(new Error('Pedido do Site não encontrado.'), { status: 404, code: 'PROJECT_NOT_FOUND' });
  const briefing = parse(proj.briefing_json);
  const now = nowIso();
  const sm = { ...(briefing.sobMedida || {}) };
  if (status === 'new') { sm.startedAt = null; sm.deliveredAt = null; sm.deliveredBy = null; }
  if (status === 'production') { sm.startedAt = sm.startedAt || now; sm.deliveredAt = null; sm.deliveredBy = null; }
  if (status === 'delivered') { sm.startedAt = sm.startedAt || now; sm.deliveredAt = now; sm.deliveredBy = adminUserId; }
  briefing.sobMedida = sm;
  await db.run('UPDATE etha_projects SET briefing_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(briefing), now, proj.id);
  return { projectId: proj.id, status: statusOf(sm), startedAt: sm.startedAt || null, deliveredAt: sm.deliveredAt || null };
}

/** Envia um arquivo do pedido (só fotos e anexos do Site daquela conta; nunca material clínico). */
export async function serveSobMedidaFile(db, res, projectId, fileId, download) {
  const detail = await sobMedidaDetail(db, projectId);
  const meta = detail.files.find((f) => f.id === fileId);
  if (!meta) throw Object.assign(new Error('Arquivo não encontrado neste pedido.'), { status: 404, code: 'FILE_NOT_FOUND' });
  const row = await db.get('SELECT * FROM private_files WHERE id = ?', fileId);
  const binary = await readPrivateFileBinary(row);
  if (!binary) throw Object.assign(new Error('Arquivo indisponível no armazenamento.'), { status: 404, code: 'FILE_UNAVAILABLE' });
  const safeName = String(row.original_name || 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  res.writeHead(200, {
    'Content-Type': row.detected_mime || 'application/octet-stream', 'Content-Length': binary.length,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeName}"`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(binary);
}
