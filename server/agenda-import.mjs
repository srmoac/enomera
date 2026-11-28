// Importar agenda e pacientes para o Agendamento (28/11/2026, pedido do Marcos após a análise da Salte).
//
// Quem vem da Doctoralia, de outro sistema ou de uma planilha própria envia um CSV ou XLSX.
// 1) preview: lê o arquivo, reconhece as colunas pelo nome (português e inglês, com ou sem acento),
//    e devolve cada linha já interpretada: paciente novo ou já cadastrado, consulta futura ou passada,
//    conflito com a agenda, linha ignorada e o motivo. Nada é gravado.
// 2) commit: grava só as linhas que a profissional manteve na prévia. Revalida tudo no servidor.
//    Pacientes entram em operational_patients (a mesma carteira do Consultório) com origin 'ambo_import'.
//    Consultas futuras entram confirmadas; passadas entram como realizadas (histórico); canceladas não entram.
// 3) revert: desfaz uma importação recém-feita, apagando só o que ela criou e que ninguém usou depois.
//
// Colunas sensíveis que o Agendamento não usa (CPF, RG, convênio, observações clínicas) são ignoradas
// e listadas na prévia, para a profissional saber que não foram trazidas.

import { nowIso, randomId } from './crypto.mjs';
import { runTransaction, writeAudit } from './db.mjs';
import { assertOfficeArchiveSafe, decodeTextSmart, loadExcelJS, parseCsvRows } from './importer.mjs';
import { normalizePersonName, sessionPriceFor, tzOffsetMinutes } from './scheduling.mjs';

export const AGENDA_IMPORT_MAX_BYTES = 3 * 1024 * 1024;
export const AGENDA_IMPORT_MAX_ROWS = 2000;

const err = (message, status, code, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

// Cabeçalho normalizado: sem acento, minúsculo, só letras e números.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const COLUMNS = {
  fullName: ['nomecompleto', 'paciente', 'nomedopaciente', 'nomepaciente', 'cliente', 'nomedocliente', 'patient', 'patientname', 'fullname', 'name'],
  firstName: ['nome', 'primeironome', 'firstname'],
  lastName: ['sobrenome', 'ultimonome', 'lastname', 'surname'],
  email: ['email', 'emaildopaciente', 'emailpaciente', 'correioeletronico', 'mail'],
  phone: ['telefone', 'celular', 'whatsapp', 'fone', 'telefonecelular', 'telefone1', 'contato', 'phone', 'mobile', 'telefonedopaciente'],
  birthDate: ['datadenascimento', 'nascimento', 'datanascimento', 'dtnascimento', 'birthdate', 'dateofbirth', 'dn'],
  dateTime: ['datahora', 'dataehora', 'datahorario', 'inicioem', 'datetime', 'start', 'startat', 'inicio'],
  date: ['data', 'dia', 'datadaconsulta', 'dataconsulta', 'datadoagendamento', 'dataagendamento', 'datadavisita', 'date'],
  time: ['hora', 'horario', 'horainicio', 'horadeinicio', 'horadaconsulta', 'horarioinicio', 'time', 'starttime'],
  endTime: ['horafim', 'horadefim', 'fim', 'termino', 'horariofinal', 'horafinal', 'endtime', 'end'],
  duration: ['duracao', 'duracaominutos', 'duracaomin', 'minutos', 'tempo', 'duration'],
  modality: ['modalidade', 'tipodeconsulta', 'tipoconsulta', 'tipodeatendimento', 'atendimento', 'tipo', 'servico', 'local', 'localdeatendimento', 'modality'],
  status: ['status', 'situacao', 'estado', 'statusdaconsulta'],
};
const IGNORED_HINTS = ['cpf', 'rg', 'convenio', 'plano', 'carteirinha', 'observacao', 'observacoes', 'obs', 'anotacao', 'anotacoes', 'prontuario', 'diagnostico', 'cid', 'valor', 'preco', 'pagamento', 'endereco', 'cep', 'profissional', 'medico', 'especialidade'];

function detectColumns(headers) {
  const map = {};
  const used = new Set();
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  // Ordem importa: "nome completo" ganha de "nome"; "data e hora" ganha de "data".
  for (const field of ['fullName', 'dateTime', 'birthDate', 'email', 'phone', 'endTime', 'time', 'date', 'duration', 'modality', 'status', 'lastName', 'firstName']) {
    const hit = normalized.find((h) => !used.has(h.raw) && COLUMNS[field].includes(h.n));
    if (hit) { map[field] = hit.raw; used.add(hit.raw); }
  }
  // "Nome" sozinho (sem sobrenome) é o nome completo.
  if (!map.fullName && map.firstName && !map.lastName) { map.fullName = map.firstName; delete map.firstName; }
  // Doctoralia e outros exportam "Paciente" e "Nome" ao mesmo tempo: fica "Paciente".
  if (map.fullName && map.firstName && !map.lastName) delete map.firstName;
  const ignored = normalized.filter((h) => !used.has(h.raw) && h.raw && IGNORED_HINTS.some((k) => h.n.startsWith(k))).map((h) => h.raw);
  const unknown = normalized.filter((h) => !used.has(h.raw) && h.raw && !ignored.includes(h.raw)).map((h) => h.raw);
  return { map, ignored, unknown };
}

function pad(n) { return String(n).padStart(2, '0'); }

// Data em várias grafias: 05/12/2026, 5/12/26, 2026-12-05, 05-12-2026, 05.12.2026.
function parseDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    return valid(y, Number(m[2]), Number(m[1]));
  }
  return null;
  function valid(y, mo, d) {
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
}

// Hora: 14:00, 14:00:00, 14h, 14h30, 9.30, "2:30 PM".
function parseTime(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const m = /(\d{1,2})(?:\s*[:h.]\s*(\d{2}))?(?::\d{2})?\s*(am|pm)?/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  if (!m[2] && !/h/.test(s) && !m[3] && !/^\d{1,2}$/.test(s)) return null;
  return `${pad(h)}:${pad(mi)}`;
}

function splitDateTime(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { date: null, time: null };
  const date = parseDate(s);
  const rest = s.replace(/^\S+\s*(?:as|às|-|,)?\s*/i, '');
  const time = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(s) ? s.slice(11, 16) : (rest && rest !== s ? parseTime(rest) : null);
  return { date, time };
}

function parseDuration(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const hm = /^(\d{1,2}):(\d{2})/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const h = /(\d+)\s*h(?:\s*(\d+))?/.exec(s);
  if (h) return Number(h[1]) * 60 + Number(h[2] || 0);
  const n = Number(s.replace(/[^\d]/g, ''));
  return n > 0 && n <= 480 ? n : null;
}

function parseModality(raw, fallback) {
  const s = norm(raw);
  if (!s) return { modality: fallback, guessed: true };
  if (/online|tele|video|remot|virtual|distancia|meet|zoom/.test(s)) return { modality: 'online', guessed: false };
  if (/presencial|consultorio|clinica|sala|endereco/.test(s)) return { modality: 'presencial', guessed: false };
  return { modality: fallback, guessed: true };
}

function parseStatus(raw) {
  const s = norm(raw);
  if (!s) return 'ok';
  if (/cancel|desmarc|excluid|removid|recusad/.test(s)) return 'cancelled';
  return 'ok';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function cleanEmail(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  return s && EMAIL_RE.test(s) && s.length <= 200 ? s : '';
}
function cleanPhone(raw) {
  const s = String(raw ?? '').trim();
  const digits = s.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? s.slice(0, 40) : '';
}
function cleanName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

// Hora local da conta → ISO com o deslocamento do fuso naquele dia.
function localToIso(date, time, timeZone) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const off = tzOffsetMinutes(timeZone, guess);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
function addMinutesIso(iso, minutes, timeZone) {
  const ms = Date.parse(iso) + minutes * 60000;
  const off = tzOffsetMinutes(timeZone, new Date(ms));
  const local = new Date(ms + off * 60000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return localToIso(date, `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`, timeZone);
}

// Lê CSV (vírgula ou ponto e vírgula, UTF-8 ou Latin-1) ou XLSX (só valores; fórmulas não rodam).
async function readSheet(fileName, buffer) {
  if (!buffer?.length) throw err('O arquivo chegou vazio.', 400, 'EMPTY_FILE');
  if (buffer.length > AGENDA_IMPORT_MAX_BYTES) throw err('Arquivo maior que 3 MB. Divida a planilha em partes.', 413, 'FILE_TOO_LARGE');
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const lower = String(fileName || '').toLowerCase();
  if (isZip) {
    if (!lower.endsWith('.xlsx') && lower.includes('.')) throw err('Envie uma planilha CSV ou XLSX.', 415, 'INVALID_SPREADSHEET');
    await assertOfficeArchiveSafe(buffer);
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch { throw err('Não foi possível abrir a planilha. Salve de novo como .xlsx ou .csv e tente outra vez.', 400, 'INVALID_XLSX'); }
    const ws = wb.worksheets.find((w) => w.rowCount > 1) || wb.worksheets[0];
    if (!ws) throw err('A planilha está vazia.', 400, 'EMPTY_FILE');
    // Algumas exportações têm linhas de título antes do cabeçalho: usa a primeira linha com 2+ células preenchidas.
    let headerRow = 1;
    for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
      let filled = 0;
      ws.getRow(r).eachCell(() => { filled++; });
      if (filled >= 2) { headerRow = r; break; }
    }
    const headers = [];
    ws.getRow(headerRow).eachCell((cell, col) => { headers[col - 1] = String(cell.text ?? cell.value ?? '').trim(); });
    const records = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const data = {};
      let any = false;
      headers.forEach((h, idx) => {
        if (!h) return;
        const v = row.getCell(idx + 1).value;
        let s = '';
        if (v instanceof Date) {
          // ExcelJS entrega datas e horas como UTC "de parede": 1899-12-30 = só hora.
          const hh = pad(v.getUTCHours()), mm = pad(v.getUTCMinutes());
          const day = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
          if (v.getUTCFullYear() < 1901) s = `${hh}:${mm}`;
          else s = (hh === '00' && mm === '00') ? day : `${day}T${hh}:${mm}`;
        } else if (v && typeof v === 'object' && 'result' in v) s = String(v.result ?? '');
        else if (v && typeof v === 'object' && 'text' in v) s = String(v.text ?? '');
        else if (v && typeof v === 'object' && 'richText' in v) s = v.richText.map((t) => t.text).join('');
        else s = String(v ?? '');
        s = s.trim();
        if (s) any = true;
        data[h] = s;
      });
      if (any) records.push({ rowNumber, data });
    });
    return { headers: headers.filter(Boolean), records };
  }
  if (lower.endsWith('.xls')) throw err('Planilha .xls antiga: abra no Excel ou no Google Planilhas e salve como .xlsx ou .csv.', 415, 'LEGACY_XLS');
  const { text } = decodeTextSmart(buffer);
  if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw err('Envie uma planilha CSV ou XLSX.', 415, 'INVALID_SPREADSHEET');
  const parsed = parseCsvRows(text);
  return { headers: parsed.headers.filter(Boolean), records: parsed.records };
}

async function accountContext(db, accountId) {
  const acc = await db.get('SELECT id, timezone, session_duration_min, modalities_json, session_price_cents, ui_preferences_json, is_demo_sandbox FROM professional_accounts WHERE id = ?', accountId);
  if (!acc) throw err('Conta não encontrada.', 404, 'ACCOUNT_NOT_FOUND');
  let modalities = [];
  try { modalities = JSON.parse(acc.modalities_json || '[]'); } catch { modalities = []; }
  return {
    acc,
    timeZone: acc.timezone || 'America/Sao_Paulo',
    duration: Number(acc.session_duration_min) > 0 ? Number(acc.session_duration_min) : 50,
    defaultModality: modalities.length === 1 ? modalities[0] : (modalities.includes('online') ? 'online' : 'presencial'),
  };
}

function patientKey(p) {
  if (p.email) return `e:${p.email}`;
  const phone = String(p.phone || '').replace(/\D/g, '').slice(-8);
  return `n:${normalizePersonName(p.name)}|${phone}`;
}

// Mesma regra estrita do resto da Core: e-mail igual, ou nome igual com o mesmo telefone.
function findExisting(existing, p) {
  const name = normalizePersonName(p.name);
  const phone = String(p.phone || '').replace(/\D/g, '');
  if (p.email) {
    const byEmail = existing.filter((x) => (x.email || '').trim().toLowerCase() === p.email);
    const sameName = byEmail.find((x) => normalizePersonName(x.full_name) === name);
    if (sameName) return sameName;
    if (byEmail.length === 1 && !byEmail[0].full_name) return byEmail[0];
    // Mesmo e-mail com nome diferente (ex.: responsável com dois filhos): é outra pessoa.
    if (byEmail.length) return null;
  }
  if (phone.length >= 8) {
    return existing.find((x) => normalizePersonName(x.full_name) === name
      && (x.phone || '').replace(/\D/g, '').endsWith(phone.slice(-8))
      && !(p.email && x.email && x.email.trim().toLowerCase() !== p.email)) || null;
  }
  return existing.find((x) => normalizePersonName(x.full_name) === name && !x.email && !x.phone) || null;
}

function overlaps(aStart, aEnd, list) {
  const s = Date.parse(aStart), e = Date.parse(aEnd);
  return list.find((x) => s < Date.parse(x.end_at) && e > Date.parse(x.start_at)) || null;
}

/** Lê o arquivo e devolve a prévia. Não grava nada. */
export async function previewAgendaImport(db, { accountId, fileName, buffer, now = Date.now() }) {
  const { headers, records } = await readSheet(fileName, buffer);
  if (!records.length) throw err('Não encontramos linhas com dados. Confira se a primeira linha tem os nomes das colunas.', 400, 'NO_ROWS');
  if (records.length > AGENDA_IMPORT_MAX_ROWS) throw err(`A planilha tem ${records.length} linhas. Importe até ${AGENDA_IMPORT_MAX_ROWS} por vez.`, 413, 'TOO_MANY_ROWS');
  const { map, ignored, unknown } = detectColumns(headers);
  if (!map.fullName && !(map.firstName && map.lastName)) {
    throw err('Não achamos a coluna com o nome do paciente. Use um cabeçalho como "Paciente" ou "Nome".', 422, 'NO_NAME_COLUMN', { headers });
  }
  const hasAgenda = Boolean(map.dateTime || map.date);
  const ctx = await accountContext(db, accountId);
  const existing = await db.all('SELECT id, full_name, email, phone, status FROM operational_patients WHERE account_id = ?', accountId);
  const active = await db.all("SELECT a.id, a.patient_id, a.start_at, a.end_at, p.full_name FROM appointments a JOIN operational_patients p ON p.id = a.patient_id WHERE a.account_id = ? AND a.status IN ('confirmed', 'reschedule_requested')", accountId);
  const allAppts = await db.all("SELECT patient_id, start_at FROM appointments WHERE account_id = ? AND status <> 'cancelled'", accountId);
  const blocks = await db.all('SELECT start_at, end_at, reason FROM availability_blocks WHERE account_id = ?', accountId);
  const get = (r, f) => (map[f] ? r.data[map[f]] ?? '' : '');

  const seenPatients = new Map();
  const fileSlots = [];
  const rows = [];
  for (const r of records) {
    const issues = [];
    const name = cleanName(map.fullName ? get(r, 'fullName') : `${get(r, 'firstName')} ${get(r, 'lastName')}`);
    const rawEmail = get(r, 'email');
    const email = cleanEmail(rawEmail);
    if (rawEmail && !email) issues.push('E-mail inválido: fica sem e-mail.');
    const phone = cleanPhone(get(r, 'phone'));
    const birthRaw = get(r, 'birthDate');
    const birthDate = parseDate(birthRaw) || '';
    if (birthRaw && !birthDate) issues.push('Data de nascimento não reconhecida: fica em branco.');
    const patient = { name, email, phone, birthDate };
    const row = { row: r.rowNumber, patient, appointment: null, state: 'ok', issues, match: null };
    if (!name) {
      row.state = 'error';
      issues.unshift('Sem nome do paciente.');
      rows.push(row);
      continue;
    }
    const key = patientKey(patient);
    const found = findExisting(existing, patient);
    if (found) row.match = { kind: 'existing', id: found.id, name: found.full_name };
    else if (seenPatients.has(key)) row.match = { kind: 'repeat', row: seenPatients.get(key) };
    else { row.match = { kind: 'new' }; seenPatients.set(key, r.rowNumber); }

    if (hasAgenda) {
      let date = null, time = null;
      if (map.dateTime) ({ date, time } = splitDateTime(get(r, 'dateTime')));
      if (map.date) {
        const dt = splitDateTime(get(r, 'date'));
        date = date || dt.date;
        time = time || dt.time;
      }
      if (map.time) time = parseTime(get(r, 'time')) || time;
      const status = parseStatus(get(r, 'status'));
      if (!date && !time) {
        // Linha só com paciente numa planilha de agenda: entra só o cadastro.
      } else if (!date || !time) {
        row.state = 'warn';
        issues.push(!date ? 'Data não reconhecida: entra só o cadastro.' : 'Horário não reconhecido: entra só o cadastro.');
      } else if (status === 'cancelled') {
        row.state = 'skip';
        issues.push('Consulta cancelada na origem: não entra na agenda.');
      } else {
        const startAt = localToIso(date, time, ctx.timeZone);
        let endAt = null;
        const endTime = parseTime(get(r, 'endTime'));
        if (endTime && endTime > time) endAt = localToIso(date, endTime, ctx.timeZone);
        const dur = parseDuration(get(r, 'duration'));
        if (!endAt) endAt = addMinutesIso(startAt, dur || ctx.duration, ctx.timeZone);
        const mod = parseModality(get(r, 'modality'), ctx.defaultModality);
        const past = Date.parse(startAt) < now;
        row.appointment = { startAt, endAt, modality: mod.modality, past, date, time };
        if (mod.guessed && map.modality && get(r, 'modality')) issues.push(`Modalidade "${String(get(r, 'modality')).slice(0, 30)}" não reconhecida: fica ${mod.modality}.`);
        const already = found && allAppts.some((a) => a.patient_id === found.id && Date.parse(a.start_at) === Date.parse(startAt));
        if (already) {
          row.state = 'skip';
          issues.push('Essa consulta já está na sua agenda.');
          row.appointment = null;
        } else if (!past) {
          const clash = overlaps(startAt, endAt, active);
          const block = overlaps(startAt, endAt, blocks);
          const inFile = overlaps(startAt, endAt, fileSlots);
          if (clash) { row.state = 'conflict'; issues.push(`Choca com a consulta de ${clash.full_name} já marcada.`); }
          else if (inFile) { row.state = 'conflict'; issues.push(`Choca com a linha ${inFile.row} desta planilha.`); }
          else if (block) { row.state = 'warn'; issues.push(`Cai num bloqueio da agenda (${block.reason || 'folga'}). Entra assim mesmo se você mantiver.`); }
          if (row.state !== 'conflict') fileSlots.push({ start_at: startAt, end_at: endAt, row: r.rowNumber });
        }
      }
    }
    if (row.state === 'ok' && issues.length) row.state = 'warn';
    rows.push(row);
  }

  const importable = rows.filter((x) => x.state === 'ok' || x.state === 'warn');
  const newPatients = new Set(importable.filter((x) => x.match?.kind === 'new').map((x) => x.row)).size;
  return {
    kind: hasAgenda ? 'agenda' : 'patients',
    fileName: String(fileName || '').slice(0, 120),
    columns: map,
    ignoredColumns: ignored,
    unknownColumns: unknown,
    timeZone: ctx.timeZone,
    defaultDurationMin: ctx.duration,
    summary: {
      rows: rows.length,
      importable: importable.length,
      newPatients,
      existingPatients: new Set(importable.filter((x) => x.match?.kind === 'existing').map((x) => x.match.id)).size,
      futureAppointments: importable.filter((x) => x.appointment && !x.appointment.past).length,
      pastAppointments: importable.filter((x) => x.appointment?.past).length,
      conflicts: rows.filter((x) => x.state === 'conflict').length,
      skipped: rows.filter((x) => x.state === 'skip').length,
      errors: rows.filter((x) => x.state === 'error').length,
    },
    rows,
  };
}

/** Grava as linhas mantidas na prévia. Revalida tudo; conflito descoberto agora vira "pulada". */
export async function commitAgendaImport(db, { accountId, actorUserId, rows, idempotencyKey = null, now = Date.now() }) {
  if (!Array.isArray(rows) || !rows.length) throw err('Nenhuma linha para importar.', 400, 'NO_ROWS');
  if (rows.length > AGENDA_IMPORT_MAX_ROWS) throw err(`Importe até ${AGENDA_IMPORT_MAX_ROWS} linhas por vez.`, 413, 'TOO_MANY_ROWS');
  const batch = String(idempotencyKey || randomId('agimp')).replace(/[^\w-]/g, '').slice(0, 60);
  return runTransaction(db, async (tx) => {
    const replay = await tx.all("SELECT id, patient_id FROM appointments WHERE account_id = ? AND idempotency_key LIKE ?", accountId, `imp_${batch}_%`);
    if (replay.length) {
      return { replay: true, created: { patients: 0, appointments: 0 }, linked: 0, skipped: [], patientIds: [], appointmentIds: replay.map((a) => a.id) };
    }
    const ctx = await accountContext(tx, accountId);
    const price = sessionPriceFor(ctx.acc);
    const existing = await tx.all('SELECT id, full_name, email, phone, status FROM operational_patients WHERE account_id = ?', accountId);
    const active = await tx.all("SELECT id, start_at, end_at FROM appointments WHERE account_id = ? AND status IN ('confirmed', 'reschedule_requested')", accountId);
    const all = await tx.all("SELECT patient_id, start_at FROM appointments WHERE account_id = ? AND status <> 'cancelled'", accountId);
    const created = new Map();
    const patientIds = [];
    const appointmentIds = [];
    const skipped = [];
    let linked = 0;
    const stamp = nowIso();
    for (let i = 0; i < rows.length; i++) {
      const input = rows[i] || {};
      const rowNo = Number(input.row) || i + 1;
      const p = {
        name: cleanName(input.patient?.name),
        email: cleanEmail(input.patient?.email),
        phone: cleanPhone(input.patient?.phone),
        birthDate: parseDate(input.patient?.birthDate) || '',
      };
      if (!p.name) { skipped.push({ row: rowNo, reason: 'Sem nome do paciente.' }); continue; }
      const key = patientKey(p);
      let patientId = created.get(key);
      if (!patientId) {
        const found = findExisting(existing, p);
        if (found) {
          patientId = found.id;
          linked++;
          // Completa o que faltava no cadastro (nunca troca o que já existe).
          await tx.run(
            "UPDATE operational_patients SET email = CASE WHEN email = '' THEN ? ELSE email END, phone = CASE WHEN phone = '' THEN ? ELSE phone END, birth_date = CASE WHEN birth_date = '' THEN ? ELSE birth_date END, updated_at = ? WHERE id = ? AND account_id = ?",
            p.email, p.phone, p.birthDate, stamp, found.id, accountId,
          );
        } else {
          patientId = randomId('pat');
          await tx.run(
            `INSERT INTO operational_patients (id, account_id, full_name, email, phone, birth_date, preferred_contact, status, origin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'ambo_import', ?, ?)`,
            patientId, accountId, p.name, p.email, p.phone, p.birthDate, p.email ? 'email' : (p.phone ? 'whatsapp' : 'email'), stamp, stamp,
          );
          existing.push({ id: patientId, full_name: p.name, email: p.email, phone: p.phone, status: 'active' });
          patientIds.push(patientId);
        }
        created.set(key, patientId);
      }
      const a = input.appointment;
      if (!a) continue;
      const startMs = Date.parse(a.startAt), endMs = Date.parse(a.endAt);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > 8 * 3600000) {
        skipped.push({ row: rowNo, reason: 'Horário inválido.' }); continue;
      }
      if (all.some((x) => x.patient_id === patientId && Date.parse(x.start_at) === startMs)) {
        skipped.push({ row: rowNo, reason: 'Consulta já estava na agenda.' }); continue;
      }
      const past = startMs < now;
      if (!past && overlaps(a.startAt, a.endAt, active)) {
        skipped.push({ row: rowNo, reason: 'O horário foi ocupado.' }); continue;
      }
      const id = randomId('apt');
      const modality = a.modality === 'presencial' ? 'presencial' : 'online';
      await tx.run(
        `INSERT INTO appointments (id, account_id, patient_id, idempotency_key, origin, modality, start_at, end_at, timezone, status, price_cents, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ambo_import', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id, accountId, patientId, `imp_${batch}_${i}`, modality, a.startAt, a.endAt, ctx.timeZone, past ? 'completed' : 'confirmed', price, stamp, stamp,
      );
      if (!past) active.push({ id, start_at: a.startAt, end_at: a.endAt });
      all.push({ patient_id: patientId, start_at: a.startAt });
      appointmentIds.push(id);
    }
    await writeAudit(tx, {
      actorUserId, actorType: 'professional', accountId, action: 'agenda.import', resourceType: 'import', resourceId: batch,
      meta: { patients: patientIds.length, appointments: appointmentIds.length, linked, skipped: skipped.length },
    });
    return { replay: false, batch, created: { patients: patientIds.length, appointments: appointmentIds.length }, linked, skipped, patientIds, appointmentIds };
  }, `sched:${accountId}`);
}

/** Desfaz uma importação: apaga só o que ela criou (origin 'ambo_import') e que não foi usado depois. */
export async function revertAgendaImport(db, { accountId, actorUserId, patientIds = [], appointmentIds = [] }) {
  const appts = (Array.isArray(appointmentIds) ? appointmentIds : []).map(String).slice(0, AGENDA_IMPORT_MAX_ROWS);
  const pats = (Array.isArray(patientIds) ? patientIds : []).map(String).slice(0, AGENDA_IMPORT_MAX_ROWS);
  return runTransaction(db, async (tx) => {
    let removedAppointments = 0, removedPatients = 0, kept = 0;
    for (const id of appts) {
      const r = await tx.run("DELETE FROM appointments WHERE id = ? AND account_id = ? AND origin = 'ambo_import' AND version = 1", id, accountId);
      removedAppointments += Number(r?.changes ?? 0);
    }
    for (const id of pats) {
      const p = await tx.get("SELECT id FROM operational_patients WHERE id = ? AND account_id = ? AND origin = 'ambo_import'", id, accountId);
      if (!p) continue;
      const used = await tx.get(
        `SELECT
           (SELECT COUNT(*) FROM appointments WHERE patient_id = ?) +
           (SELECT COUNT(*) FROM clinical_notes WHERE patient_id = ?) +
           (SELECT COUNT(*) FROM consultation_requests WHERE patient_id = ?) +
           (SELECT COUNT(*) FROM patient_invitations WHERE patient_id = ?) AS n`,
        id, id, id, id,
      );
      if (Number(used?.n) > 0) { kept++; continue; }
      await tx.run('DELETE FROM operational_patients WHERE id = ? AND account_id = ?', id, accountId);
      removedPatients++;
    }
    await writeAudit(tx, { actorUserId, actorType: 'professional', accountId, action: 'agenda.import_revert', resourceType: 'import', resourceId: 'revert', meta: { removedAppointments, removedPatients, kept } });
    return { removedAppointments, removedPatients, kept };
  }, `sched:${accountId}`);
}
