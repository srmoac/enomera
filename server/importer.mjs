import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import path from 'node:path';
import { detectFileMagic, nowIso, randomId, sha256Hex } from './crypto.mjs';
import { runTransaction, writeAudit } from './db.mjs';
import { savePrivateFile } from './storage.mjs';

const MAX_ZIP_ENTRIES = 50;
const MAX_ZIP_UNCOMPRESSED = 25 * 1024 * 1024; // 25 MB

export const SUPPORTED_IMPORT_FORMATS = {
  pasted_text: { supported: true, label: 'Texto colado (revisão obrigatória antes de salvar)' },
  pdf: { supported: true, label: 'PDF com texto extraível (original preservado em área privada)' },
  pdf_scanned: { supported: true, label: 'PDF escaneado / sem texto (original preservado; OCR externo não habilitado)' },
  docx: { supported: true, label: 'DOCX (texto extraído com Mammoth + original preservado)' },
  legacy_doc: { supported: false, label: 'DOC antigo (.doc) não suportado sem conversor validado — converta para .docx ou .pdf' },
  txt: { supported: true, label: 'TXT (UTF-8 ou Latin-1)' },
  csv: { supported: true, label: 'CSV (vírgula ou ponto-e-vírgula, UTF-8 ou Latin-1, mapeamento de colunas)' },
  xlsx: { supported: true, label: 'XLSX (ExcelJS, leitura somente de valores sem executar fórmulas/macros)' },
  json: { supported: true, label: 'JSON estruturado (adaptadores versionados: enomera-export-v1, generic-clinical-json-v1)' },
  jpg_png: { supported: true, label: 'Imagens JPG/PNG (anexo original preservado; OCR externo não contratado)' },
  zip: { supported: true, label: 'Lote ZIP (até 50 arquivos / 25 MB, pastas ou manifesto.json, proteção contra path traversal e zip bomb)' },
};

function decodeTextSmart(buffer) {
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    return { text: buffer.toString('latin1'), encoding: 'latin1', warning: 'Arquivo decodificado em Latin-1 (ISO-8859-1) por conter caracteres fora de UTF-8.' };
  }
  return { text: utf8.replace(/^\uFEFF/, ''), encoding: 'utf-8', warning: null };
}

function parseFlexibleDate(raw) {
  if (!raw) return { iso: null, warning: 'Data do atendimento ausente (registrada como desconhecida).' };
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parsed = Date.parse(s.length === 10 ? `${s}T12:00:00-03:00` : s);
    if (!Number.isNaN(parsed)) return { iso: new Date(parsed).toISOString(), warning: null };
  }
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (br) {
    const [, dd, mm, yyyy] = br;
    const d = Number(dd), m = Number(mm), y = Number(yyyy);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1950 && y <= 2100) {
      return { iso: `${yyyy}-${mm}-${dd}T12:00:00-03:00`, warning: null };
    }
  }
  return { iso: null, warning: `Data ambígua ou inválida ("${s.slice(0, 40)}") — mantida como desconhecida para revisão.` };
}

function parseCsvRows(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === sep) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim());
        if (row.some((x) => x.length > 0)) rows.push(row);
        row = []; cell = '';
      } else {
        cell += ch;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((x) => x.length > 0)) rows.push(row);
  }
  if (rows.length === 0) return { separator: sep, headers: [], records: [] };
  const headers = rows[0];
  const records = rows.slice(1).map((r, idx) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h || `col_${i + 1}`] = r[i] ?? ''; });
    return { rowNumber: idx + 2, data: obj };
  });
  return { separator: sep, headers, records };
}

function normalizeColumnMap(rawObj, customMapping = null) {
  const known = {
    patientName: ['paciente', 'nome', 'patient_name', 'full_name', 'nome_paciente'],
    patientEmail: ['email', 'e-mail', 'patient_email'],
    patientPhone: ['telefone', 'celular', 'whatsapp', 'phone', 'patient_phone'],
    occurredAt: ['data', 'data_atendimento', 'data_sessao', 'occurred_at', 'date'],
    declaredAuthor: ['autor', 'profissional', 'autoria', 'declared_author', 'author'],
    content: ['registro', 'evolucao', 'evolução', 'conteudo', 'conteúdo', 'texto', 'content', 'notes', 'prontuario', 'prontuário'],
    sourceKey: ['id_origem', 'source_key', 'codigo', 'external_id', 'id'],
  };
  const extracted = {};
  const unrecognized = {};
  const mapUsed = customMapping || {};

  for (const [k, v] of Object.entries(rawObj)) {
    const lk = k.trim().toLowerCase();
    let matchedField = null;
    for (const [target, aliases] of Object.entries(known)) {
      if (mapUsed[target] && mapUsed[target] === k) { matchedField = target; break; }
      if (aliases.includes(lk)) { matchedField = target; break; }
    }
    if (matchedField) extracted[matchedField] = String(v ?? '').trim();
    else if (String(v ?? '').trim()) unrecognized[k] = String(v).trim();
  }
  return { extracted, unrecognized };
}

async function matchPatientAmbiguity(db, accountId, { patientIdHint = null, patientName = '', patientEmail = '' }) {
  if (patientIdHint) {
    const exact = await db.get('SELECT id, full_name FROM operational_patients WHERE id = ? AND account_id = ?', patientIdHint, accountId);
    if (exact) return { targetPatientId: exact.id, ambiguous: false, proposedPatient: null };
  }
  const all = await db.all('SELECT id, full_name, email, phone FROM operational_patients WHERE account_id = ?', accountId);
  const normEmail = (patientEmail || '').trim().toLowerCase();
  const normName = (patientName || '').trim().toLowerCase();

  const matches = all.filter((p) =>
    (normEmail && p.email.trim().toLowerCase() === normEmail) ||
    (normName && p.full_name.trim().toLowerCase() === normName)
  );
  if (matches.length === 1) {
    return { targetPatientId: matches[0].id, ambiguous: false, proposedPatient: null };
  }
  if (matches.length > 1) {
    return {
      targetPatientId: null,
      ambiguous: true,
      warning: `Associação ambígua: ${matches.length} pacientes correspondem a "${patientName || patientEmail}". Escolha manualmente antes de confirmar.`,
      proposedPatient: null,
    };
  }
  if (patientName) {
    return {
      targetPatientId: null,
      ambiguous: true,
      warning: `Paciente "${patientName}" não encontrado. Confirme se deseja criar novo cadastro ou vincular a um paciente existente.`,
      proposedPatient: { fullName: patientName, email: patientEmail || '', phone: '' },
    };
  }
  return {
    targetPatientId: null,
    ambiguous: true,
    warning: 'Documento sem paciente identificado. Associe manualmente a um paciente antes de confirmar.',
    proposedPatient: null,
  };
}

async function detectDuplicateNote(db, accountId, contentSha, sourceKey) {
  if (sourceKey) {
    const byKey = await db.get(
      `SELECT id FROM clinical_notes
       WHERE account_id = ? AND source_reference_key = ? AND status != 'reverted'`,
      accountId, sourceKey
    );
    if (byKey) return { duplicateNoteId: byKey.id, reason: `Chave de origem "${sourceKey}" já importada anteriormente.` };
  }
  const byHash = await db.get(
    `SELECT cn.id FROM import_items ii
     JOIN clinical_notes cn ON cn.id = ii.created_note_id
     WHERE ii.account_id = ? AND ii.content_sha256 = ? AND ii.status = 'imported' AND cn.status != 'reverted'
     LIMIT 1`,
    accountId, contentSha
  );
  if (byHash) return { duplicateNoteId: byHash.id, reason: 'Conteúdo idêntico (SHA-256) já importado em lote anterior.' };
  return null;
}

async function extractSingleFile(buffer, filename) {
  const magic = detectFileMagic(buffer, filename);
  if (magic.format === 'legacy_doc') {
    return {
      format: 'legacy_doc',
      text: '',
      warnings: ['Formato .doc antigo não suportado sem conversor validado. Converta o arquivo para .docx ou .pdf e reenvie.'],
      error: 'Formato .doc antigo não suportado.',
    };
  }
  if (!magic.safe) {
    return {
      format: 'unsupported',
      text: '',
      warnings: ['Assinatura binária não reconhecida ou arquivo corrompido.'],
      error: 'Arquivo inválido ou formato não suportado.',
    };
  }
  if (magic.format === 'txt') {
    const dec = decodeTextSmart(buffer);
    return { format: 'txt', text: dec.text, warnings: dec.warning ? [dec.warning] : [] };
  }
  if (magic.format === 'docx') {
    try {
      const res = await mammoth.extractRawText({ buffer });
      const text = (res.value || '').trim();
      const warnings = (res.messages || []).map((m) => m.message).slice(0, 5);
      if (!text) warnings.push('DOCX sem texto extraível; arquivo original mantido em anexo privado.');
      return { format: 'docx', text, warnings };
    } catch {
      return { format: 'docx', text: '', warnings: ['Falha ao ler estrutura DOCX (arquivo possivelmente corrompido).'], error: 'DOCX corrompido ou ilegível.' };
    }
  }
  if (magic.format === 'pdf') {
    let parser = null;
    try {
      parser = new PDFParse({ data: new Uint8Array(buffer) });
      const out = await parser.getText();
      const text = (out?.text || '').replace(/\u0000/g, '').trim();
      if (!text || text.length < 12) {
        return {
          format: 'pdf_scanned',
          text: '',
          warnings: [
            'PDF sem texto extraível (possível digitalização/imagem). O arquivo original foi preservado em armazenamento privado.',
            'OCR externo/IA não contratado nem habilitado: nenhum texto foi inventado; revise e transcreva se necessário.',
          ],
        };
      }
      return { format: 'pdf', text, warnings: [] };
    } catch (err) {
      const msg = String(err?.name || err?.message || '');
      if (/password/i.test(msg)) {
        return { format: 'pdf', text: '', warnings: ['PDF protegido por senha. Remova a proteção ou forneça cópia desbloqueada.'], error: 'PDF protegido por senha.' };
      }
      return { format: 'pdf', text: '', warnings: ['PDF corrompido ou ilegível.'], error: 'PDF corrompido.' };
    } finally {
      if (parser) { try { await parser.destroy(); } catch {} }
    }
  }
  if (magic.format === 'jpg' || magic.format === 'png') {
    return {
      format: magic.format,
      text: '',
      warnings: [
        `Imagem ${magic.format.toUpperCase()} anexada ao histórico externo em área privada.`,
        'OCR externo não contratado/não habilitado: nenhuma transcrição automática foi inventada; o original permanece consultável.',
      ],
    };
  }
  return { format: magic.format, text: '', warnings: [] };
}

export async function generateSpreadsheetTemplateBuffer(format = 'csv') {
  const headers = ['paciente', 'email', 'telefone', 'data_atendimento', 'autor', 'id_origem', 'registro'];
  const sampleRow = [
    'Paciente Exemplo Fictício',
    'paciente.exemplo@exemplo.invalid',
    '(11) 99999-0000',
    '2026-09-10',
    'Helena Duarte (CRP 06/148290)',
    'EXT-001',
    'Histórico externo fictício de exemplo para conferência antes de confirmar a importação.',
  ];
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Importacao_Minne');
    ws.addRow(headers);
    ws.addRow(sampleRow);
    const ab = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(ab), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'modelo-importacao-minne.xlsx' };
  }
  const csv = [headers.join(';'), sampleRow.map((v) => `"${v.replace(/"/g, '""')}"`).join(';')].join('\n');
  return { buffer: Buffer.from('\uFEFF' + csv, 'utf8'), mime: 'text/csv; charset=utf-8', filename: 'modelo-importacao-minne.csv' };
}

export async function stageImportBatch(db, {
  accountId,
  userId,
  sourceKind, // pasted_text | document | spreadsheet | structured_json | scan | batch_zip
  targetPatientId = null,
  pastedText = null,
  declaredAuthor = null,
  occurredAtRaw = null,
  sourceSystem = null,
  sourceKey = null,
  adapterId = 'auto',
  columnMapping = null,
  files = [], // [{ originalName, buffer }]
}) {
  const batchId = randomId('imp');
  const now = nowIso();
  const batchWarnings = [];
  const stagedItems = [];

  const pushItem = async (item) => {
    const dup = await detectDuplicateNote(db, accountId, item.contentSha, item.sourceKey);
    const warnings = [...(item.warnings || [])];
    let status = item.error ? 'failed' : 'staged';
    let resolutionAction = 'pending';
    if (!item.error) {
      if (dup) {
        status = 'duplicate_review';
        warnings.push(dup.reason);
      } else if (!item.targetPatientId) {
        status = 'needs_resolution';
      } else {
        resolutionAction = 'attach_existing';
      }
    }
    stagedItems.push({
      id: randomId('impi'),
      ...item,
      duplicateOfNoteId: dup?.duplicateNoteId || null,
      warnings,
      status,
      resolutionAction,
    });
  };

  if (sourceKind === 'pasted_text') {
    const text = String(pastedText || '').trim();
    if (!text) throw Object.assign(new Error('Cole o texto do registro para iniciar a preparação.'), { status: 400, code: 'EMPTY_TEXT' });
    const dt = parseFlexibleDate(occurredAtRaw);
    const match = await matchPatientAmbiguity(db, accountId, { patientIdHint: targetPatientId });
    const warnings = [dt.warning, match.warning].filter(Boolean);
    if (!declaredAuthor) warnings.push('Autoria informada na fonte ausente (registrada como desconhecida).');
    await pushItem({
      fileId: null,
      originalFilename: 'texto-colado.txt',
      detectedFormat: 'text',
      contentSha: sha256Hex(text),
      sourceKey: sourceKey || null,
      extractedText: text,
      extractedFields: { sourceSystem: sourceSystem || 'Texto colado manualmente' },
      unrecognizedFields: {},
      occurredAt: dt.iso,
      declaredAuthor: declaredAuthor || null,
      targetPatientId: match.targetPatientId,
      proposedPatient: match.proposedPatient,
      warnings,
      error: null,
    });
  } else if (sourceKind === 'spreadsheet') {
    const file = files[0];
    if (!file) throw Object.assign(new Error('Envie um arquivo CSV ou XLSX.'), { status: 400, code: 'MISSING_FILE' });
    const saved = await savePrivateFile(db, { accountId, ownerUserId: userId, scope: 'minne_clinical', originalName: file.originalName, buffer: file.buffer });
    let rows = [];
    if (saved.detectedFormat === 'csv') {
      const dec = decodeTextSmart(file.buffer);
      if (dec.warning) batchWarnings.push(dec.warning);
      const parsed = parseCsvRows(dec.text);
      rows = parsed.records;
    } else if (saved.detectedFormat === 'xlsx') {
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(file.buffer);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error('Planilha vazia');
        const headers = [];
        ws.getRow(1).eachCell((cell, colNum) => {
          headers[colNum - 1] = String(cell.text ?? cell.value ?? `col_${colNum}`).trim();
        });
        ws.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const obj = {};
          let nonEmpty = false;
          headers.forEach((h, idx) => {
            const val = row.getCell(idx + 1).value;
            // NEVER evaluate formulas/macros: only read primitive/result text
            let str = '';
            if (val && typeof val === 'object' && 'result' in val) str = String(val.result ?? '');
            else if (val && typeof val === 'object' && 'text' in val) str = String(val.text ?? '');
            else if (val instanceof Date) str = val.toISOString().slice(0, 10);
            else str = String(val ?? '');
            if (str.trim()) nonEmpty = true;
            obj[h] = str.trim();
          });
          if (nonEmpty) rows.push({ rowNumber: rowNum, data: obj });
        });
      } catch {
        throw Object.assign(new Error('Não foi possível ler o arquivo XLSX (corrompido ou inválido).'), { status: 400, code: 'INVALID_XLSX' });
      }
    } else {
      throw Object.assign(new Error('Envie uma planilha CSV ou XLSX válida.'), { status: 415, code: 'INVALID_SPREADSHEET' });
    }

    for (const r of rows) {
      const { extracted, unrecognized } = normalizeColumnMap(r.data, columnMapping);
      const text = extracted.content || '';
      const dt = parseFlexibleDate(extracted.occurredAt);
      const match = await matchPatientAmbiguity(db, accountId, {
        patientIdHint: targetPatientId,
        patientName: extracted.patientName,
        patientEmail: extracted.patientEmail,
      });
      const warnings = [dt.warning, match.warning].filter(Boolean);
      if (Object.keys(unrecognized).length > 0) warnings.push(`Campos não reconhecidos preservados: ${Object.keys(unrecognized).join(', ')}`);
      const rowError = !text && !extracted.patientName ? `Linha ${r.rowNumber}: faltam nome do paciente e conteúdo clínico.` : null;
      await pushItem({
        fileId: saved.id,
        originalFilename: `${saved.originalName}#linha-${r.rowNumber}`,
        detectedFormat: saved.detectedFormat,
        contentSha: sha256Hex(`${extracted.patientName || ''}|${extracted.occurredAt || ''}|${text}`),
        sourceKey: extracted.sourceKey || null,
        extractedText: text,
        extractedFields: extracted,
        unrecognizedFields: unrecognized,
        occurredAt: dt.iso,
        declaredAuthor: extracted.declaredAuthor || null,
        targetPatientId: match.targetPatientId,
        proposedPatient: match.proposedPatient
          ? { ...match.proposedPatient, phone: extracted.patientPhone || '' }
          : null,
        warnings,
        error: rowError,
      });
    }
  } else if (sourceKind === 'structured_json') {
    const file = files[0];
    const rawText = file ? decodeTextSmart(file.buffer).text : String(pastedText || '');
    let saved = null;
    if (file) saved = await savePrivateFile(db, { accountId, ownerUserId: userId, scope: 'minne_clinical', originalName: file.originalName, buffer: file.buffer });
    let parsed;
    try { parsed = JSON.parse(rawText); } catch {
      throw Object.assign(new Error('JSON inválido: verifique a sintaxe do arquivo exportado.'), { status: 400, code: 'INVALID_JSON' });
    }
    const detectedAdapter = parsed.schemaVersion === 'enomera-export-v1'
      ? 'enomera-export-v1'
      : (parsed.schemaVersion === 'generic-clinical-json-v1' || Array.isArray(parsed.records))
        ? 'generic-clinical-json-v1'
        : null;
    if (!detectedAdapter) {
      throw Object.assign(
        new Error('Formato JSON não reconhecido. Adaptadores suportados e versionados: "enomera-export-v1" e "generic-clinical-json-v1".'),
        { status: 422, code: 'UNSUPPORTED_JSON_ADAPTER' }
      );
    }
    const itemsList = Array.isArray(parsed.records) ? parsed.records : [];
    for (let i = 0; i < itemsList.length; i++) {
      const rec = itemsList[i];
      const text = String(rec.content || rec.text || (Array.isArray(rec.blocks) ? rec.blocks.map((b) => b.text || '').join('\n') : '')).trim();
      const dt = parseFlexibleDate(rec.occurredAt || rec.date);
      const match = await matchPatientAmbiguity(db, accountId, {
        patientIdHint: targetPatientId,
        patientName: rec.patient?.fullName || rec.patientName || '',
        patientEmail: rec.patient?.email || rec.patientEmail || '',
      });
      const unrecognized = {};
      for (const [k, v] of Object.entries(rec)) {
        if (!['id', 'sourceKey', 'patient', 'patientName', 'patientEmail', 'occurredAt', 'date', 'declaredAuthor', 'author', 'content', 'text', 'blocks'].includes(k)) {
          unrecognized[k] = v;
        }
      }
      await pushItem({
        fileId: saved?.id || null,
        originalFilename: `${saved?.originalName || 'export.json'}#${i + 1}`,
        detectedFormat: 'json',
        contentSha: sha256Hex(JSON.stringify({ k: rec.sourceKey || rec.id || i, text })),
        sourceKey: rec.sourceKey || rec.id || null,
        extractedText: text,
        extractedFields: { adapter: detectedAdapter, sourceSystem: parsed.sourceSystem || detectedAdapter },
        unrecognizedFields: unrecognized,
        occurredAt: dt.iso,
        declaredAuthor: rec.declaredAuthor || rec.author || null,
        targetPatientId: match.targetPatientId,
        proposedPatient: match.proposedPatient ? { ...match.proposedPatient, phone: rec.patient?.phone || '' } : null,
        warnings: [dt.warning, match.warning].filter(Boolean),
        error: !text ? 'Registro JSON sem texto clínico.' : null,
      });
    }
  } else if (sourceKind === 'document' || sourceKind === 'scan') {
    if (files.length === 0) throw Object.assign(new Error('Selecione ao menos um arquivo.'), { status: 400, code: 'MISSING_FILE' });
    for (const file of files) {
      let saved = null;
      const magic = detectFileMagic(file.buffer, file.originalName);
      if (magic.format === 'legacy_doc') {
        await pushItem({
          fileId: null,
          originalFilename: file.originalName,
          detectedFormat: 'legacy_doc',
          contentSha: sha256Hex(file.buffer),
          sourceKey: null,
          extractedText: '',
          extractedFields: {},
          unrecognizedFields: {},
          occurredAt: null,
          declaredAuthor: null,
          targetPatientId: null,
          proposedPatient: null,
          warnings: ['Formato .doc antigo não suportado. Converta para .docx ou .pdf e envie novamente.'],
          error: 'Formato .doc antigo não suportado.',
        });
        continue;
      }
      if (!magic.safe) {
        await pushItem({
          fileId: null,
          originalFilename: file.originalName,
          detectedFormat: 'unsupported',
          contentSha: sha256Hex(file.buffer),
          sourceKey: null,
          extractedText: '',
          extractedFields: {},
          unrecognizedFields: {},
          occurredAt: null,
          declaredAuthor: null,
          targetPatientId: null,
          proposedPatient: null,
          warnings: ['Arquivo inválido ou tipo não suportado.'],
          error: 'Tipo de arquivo não suportado.',
        });
        continue;
      }
      saved = await savePrivateFile(db, { accountId, ownerUserId: userId, scope: 'minne_clinical', originalName: file.originalName, buffer: file.buffer });
      const ex = await extractSingleFile(file.buffer, file.originalName);
      const dt = parseFlexibleDate(occurredAtRaw);
      const match = await matchPatientAmbiguity(db, accountId, { patientIdHint: targetPatientId });
      await pushItem({
        fileId: saved.id,
        originalFilename: saved.originalName,
        detectedFormat: ex.format,
        contentSha: saved.sha256,
        sourceKey: sourceKey || null,
        extractedText: ex.text,
        extractedFields: { fileName: saved.originalName, mime: saved.detectedMime },
        unrecognizedFields: {},
        occurredAt: dt.iso,
        declaredAuthor: declaredAuthor || null,
        targetPatientId: match.targetPatientId,
        proposedPatient: match.proposedPatient,
        warnings: [...ex.warnings, dt.warning, match.warning].filter(Boolean),
        error: ex.error || null,
      });
    }
  } else if (sourceKind === 'batch_zip') {
    const zipFile = files[0];
    if (!zipFile) throw Object.assign(new Error('Envie um arquivo ZIP para importação em lote.'), { status: 400, code: 'MISSING_ZIP' });
    let zip;
    try { zip = await JSZip.loadAsync(zipFile.buffer); } catch {
      throw Object.assign(new Error('Arquivo ZIP corrompido ou estrutura inválida.'), { status: 400, code: 'INVALID_ZIP' });
    }
    const entries = Object.values(zip.files).filter((e) => !e.dir && !e.name.startsWith('__MACOSX/'));
    if (entries.length === 0) throw Object.assign(new Error('ZIP vazio (nenhum arquivo encontrado).'), { status: 400, code: 'EMPTY_ZIP' });
    if (entries.length > MAX_ZIP_ENTRIES) {
      throw Object.assign(new Error(`Lote excede o limite máximo de ${MAX_ZIP_ENTRIES} arquivos por ZIP.`), { status: 413, code: 'ZIP_TOO_MANY_FILES' });
    }

    // Optional manifest.json mapping file -> { patientName, patientEmail, occurredAt, declaredAuthor, sourceKey }
    let manifestMap = {};
    const manifestEntry = entries.find((e) => path.posix.basename(e.name).toLowerCase() === 'manifest.json');
    if (manifestEntry) {
      try {
        const mBuf = await manifestEntry.async('nodebuffer');
        const mJson = JSON.parse(mBuf.toString('utf8'));
        if (Array.isArray(mJson.items)) {
          for (const it of mJson.items) {
            if (it.file) manifestMap[it.file] = it;
          }
        }
      } catch {
        batchWarnings.push('manifest.json inválido no ZIP; usando nomes das pastas para sugerir pacientes.');
      }
    }

    let totalUncompressed = 0;
    for (const entry of entries) {
      if (entry === manifestEntry) continue;
      if (entry.name.includes('..') || path.posix.isAbsolute(entry.name)) {
        batchWarnings.push(`Entrada ignorada por segurança (path traversal): ${entry.name}`);
        continue;
      }
      const buf = await entry.async('nodebuffer');
      totalUncompressed += buf.length;
      if (totalUncompressed > MAX_ZIP_UNCOMPRESSED) {
        throw Object.assign(new Error('Conteúdo descompactado do ZIP excede o limite de segurança (25 MB).'), { status: 413, code: 'ZIP_BOMB_GUARD' });
      }
      const base = path.posix.basename(entry.name);
      const parts = entry.name.split('/').filter(Boolean);
      const folderPatientHint = parts.length >= 2 ? parts[0].replace(/[_-]+/g, ' ').trim() : '';
      const meta = manifestMap[entry.name] || manifestMap[base] || {};

      const magic = detectFileMagic(buf, base);
      if (magic.format === 'zip') {
        await pushItem({
          fileId: null, originalFilename: entry.name, detectedFormat: 'unsupported',
          contentSha: sha256Hex(buf), sourceKey: null, extractedText: '', extractedFields: {}, unrecognizedFields: {},
          occurredAt: null, declaredAuthor: null, targetPatientId: null, proposedPatient: null,
          warnings: ['ZIP aninhado não é descompactado automaticamente por segurança.'], error: 'ZIP aninhado bloqueado.',
        });
        continue;
      }
      if (!magic.safe) {
        await pushItem({
          fileId: null, originalFilename: entry.name, detectedFormat: magic.format,
          contentSha: sha256Hex(buf), sourceKey: null, extractedText: '', extractedFields: {}, unrecognizedFields: {},
          occurredAt: null, declaredAuthor: null, targetPatientId: null, proposedPatient: null,
          warnings: [magic.format === 'legacy_doc' ? 'Arquivo .doc antigo não suportado (converta para .docx ou .pdf).' : 'Formato não suportado no lote.'],
          error: 'Formato não suportado.',
        });
        continue;
      }
      const saved = await savePrivateFile(db, { accountId, ownerUserId: userId, scope: 'minne_clinical', originalName: base, buffer: buf });
      const ex = await extractSingleFile(buf, base);
      const dt = parseFlexibleDate(meta.occurredAt || meta.date);
      const match = await matchPatientAmbiguity(db, accountId, {
        patientIdHint: targetPatientId,
        patientName: meta.patientName || folderPatientHint,
        patientEmail: meta.patientEmail || '',
      });
      await pushItem({
        fileId: saved.id,
        originalFilename: entry.name,
        detectedFormat: ex.format,
        contentSha: saved.sha256,
        sourceKey: meta.sourceKey || null,
        extractedText: ex.text,
        extractedFields: { zipPath: entry.name, folderHint: folderPatientHint || null },
        unrecognizedFields: {},
        occurredAt: dt.iso,
        declaredAuthor: meta.declaredAuthor || null,
        targetPatientId: match.targetPatientId,
        proposedPatient: match.proposedPatient,
        warnings: [...ex.warnings, dt.warning, match.warning].filter(Boolean),
        error: ex.error || null,
      });
    }
  } else {
    throw Object.assign(new Error('Origem de importação inválida.'), { status: 400, code: 'INVALID_SOURCE_KIND' });
  }

  await runTransaction(db, async (tx) => {
    await tx.run(
      `INSERT INTO import_batches (id, account_id, created_by_user_id, source_kind, adapter_id, status, total_items, warnings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'staging', ?, ?, ?, ?)`,
      batchId, accountId, userId, sourceKind, adapterId, stagedItems.length, JSON.stringify(batchWarnings), now, now
    );

    const insSql = `
      INSERT INTO import_items (
        id, batch_id, account_id, file_id, original_filename, detected_format, content_sha256, source_key,
        extracted_text, extracted_fields_json, unrecognized_fields_json, warnings_json, occurred_at, declared_author,
        target_patient_id, proposed_patient_json, resolution_action, duplicate_of_note_id, status, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    for (const it of stagedItems) {
      await tx.run(
        insSql,
        it.id, batchId, accountId, it.fileId, it.originalFilename, it.detectedFormat, it.contentSha, it.sourceKey,
        it.extractedText, JSON.stringify(it.extractedFields), JSON.stringify(it.unrecognizedFields), JSON.stringify(it.warnings),
        it.occurredAt, it.declaredAuthor, it.targetPatientId, it.proposedPatient ? JSON.stringify(it.proposedPatient) : null,
        it.resolutionAction, it.duplicateOfNoteId, it.status, it.error, now, now
      );
    }
    await writeAudit(tx, { actorUserId: userId, actorType: 'professional', accountId, action: 'import.stage', resourceType: 'import_batch', resourceId: batchId, meta: { sourceKind, totalItems: stagedItems.length } });
  });

  return getImportBatchDetail(db, accountId, batchId);
}

export async function getImportBatchDetail(db, accountId, batchId) {
  const batch = await db.get('SELECT * FROM import_batches WHERE id = ? AND account_id = ?', batchId, accountId);
  if (!batch) return null;
  const rows = await db.all('SELECT * FROM import_items WHERE batch_id = ? AND account_id = ? ORDER BY created_at ASC, id ASC', batchId, accountId);
  const items = rows.map((it) => ({
    ...it,
    extractedFields: JSON.parse(it.extracted_fields_json || '{}'),
    unrecognizedFields: JSON.parse(it.unrecognized_fields_json || '{}'),
    warnings: JSON.parse(it.warnings_json || '[]'),
    proposedPatient: it.proposed_patient_json ? JSON.parse(it.proposed_patient_json) : null,
  }));
  return {
    ...batch,
    warnings: JSON.parse(batch.warnings_json || '[]'),
    items,
  };
}

export async function resolveImportItem(db, { accountId, batchId, itemId, resolutionAction, targetPatientId = null, proposedPatient = null, occurredAt = undefined, declaredAuthor = undefined, extractedText = undefined }) {
  const batch = await db.get('SELECT * FROM import_batches WHERE id = ? AND account_id = ?', batchId, accountId);
  if (!batch || !['staging', 'partial_failed'].includes(batch.status)) {
    throw Object.assign(new Error('Lote não pode ser alterado neste estado.'), { status: 409, code: 'BATCH_LOCKED' });
  }
  const item = await db.get('SELECT * FROM import_items WHERE id = ? AND batch_id = ? AND account_id = ?', itemId, batchId, accountId);
  if (!item) throw Object.assign(new Error('Item de importação não encontrado.'), { status: 404, code: 'ITEM_NOT_FOUND' });

  let nextStatus = item.status;
  if (resolutionAction === 'skip_duplicate') {
    nextStatus = 'staged';
  } else if (resolutionAction === 'attach_existing') {
    const p = await db.get('SELECT id FROM operational_patients WHERE id = ? AND account_id = ?', targetPatientId, accountId);
    if (!p) throw Object.assign(new Error('Paciente selecionado não encontrado.'), { status: 404, code: 'PATIENT_NOT_FOUND' });
    nextStatus = 'staged';
  } else if (resolutionAction === 'create_patient') {
    if (!proposedPatient?.fullName?.trim()) throw Object.assign(new Error('Informe o nome completo para criar o paciente.'), { status: 400, code: 'PATIENT_NAME_REQUIRED' });
    nextStatus = 'staged';
  }

  await db.run(
    `UPDATE import_items SET
      resolution_action = ?,
      target_patient_id = ?,
      proposed_patient_json = ?,
      occurred_at = COALESCE(?, occurred_at),
      declared_author = COALESCE(?, declared_author),
      extracted_text = COALESCE(?, extracted_text),
      status = ?,
      error_message = NULL,
      updated_at = ?
    WHERE id = ?`,
    resolutionAction,
    resolutionAction === 'attach_existing' ? targetPatientId : null,
    resolutionAction === 'create_patient' ? JSON.stringify(proposedPatient) : item.proposed_patient_json,
    occurredAt === undefined ? null : occurredAt,
    declaredAuthor === undefined ? null : declaredAuthor,
    extractedText === undefined ? null : extractedText,
    nextStatus,
    nowIso(),
    itemId
  );
  return getImportBatchDetail(db, accountId, batchId);
}

export async function commitImportBatch(db, { accountId, userId, userDisplayName, batchId, idempotencyKey = null, retryFailedOnly = false }) {
  const batch = await db.get('SELECT * FROM import_batches WHERE id = ? AND account_id = ?', batchId, accountId);
  if (!batch) throw Object.assign(new Error('Lote de importação não encontrado.'), { status: 404, code: 'BATCH_NOT_FOUND' });
  if (batch.status === 'cancelled' || batch.status === 'reverted') {
    throw Object.assign(new Error('Este lote foi cancelado ou revertido.'), { status: 409, code: 'BATCH_NOT_ACTIVE' });
  }
  if (batch.status === 'completed' || (idempotencyKey && batch.idempotency_key === idempotencyKey && !retryFailedOnly)) {
    return { batch: await getImportBatchDetail(db, accountId, batchId), idempotentReplay: true };
  }

  const now = nowIso();
  const claimed = await db.run(
    "UPDATE import_batches SET status = 'committing', idempotency_key = COALESCE(?, idempotency_key), updated_at = ? WHERE id = ? AND status IN ('staging', 'partial_failed')",
    idempotencyKey, now, batchId
  );
  if (!claimed || Number(claimed.changes || 0) !== 1) {
    return { batch: await getImportBatchDetail(db, accountId, batchId), idempotentReplay: true };
  }
  const items = await db.all('SELECT * FROM import_items WHERE batch_id = ? AND account_id = ? ORDER BY created_at ASC, id ASC', batchId, accountId);

  let imported = batch.imported_count || 0;
  let skipped = batch.skipped_count || 0;
  let failed = 0;

  for (const item of items) {
    if (item.status === 'imported' || item.status === 'skipped') continue;
    if (retryFailedOnly && !['failed', 'staged'].includes(item.status)) continue;

    try {
      await runTransaction(db, async (tx) => {
        if (item.resolution_action === 'skip_duplicate') {
          await tx.run("UPDATE import_items SET status = 'skipped', updated_at = ? WHERE id = ?", nowIso(), item.id);
          skipped++;
          return;
        }
        if (item.status === 'failed' && item.error_message && item.resolution_action === 'pending') {
          throw new Error(item.error_message);
        }
        if (item.status === 'duplicate_review' && item.resolution_action === 'pending') {
          throw new Error('Duplicata detectada — escolha ignorar ou confirmar importação antes de concluir.');
        }

        let patientId = item.target_patient_id;
        let createdPatientId = null;

        if (item.resolution_action === 'create_patient') {
          const prop = item.proposed_patient_json ? JSON.parse(item.proposed_patient_json) : null;
          if (!prop?.fullName?.trim()) throw new Error('Dados do novo paciente incompletos.');
          const existingInAccount = await tx.get('SELECT id FROM operational_patients WHERE account_id = ? AND lower(full_name) = lower(?)', accountId, prop.fullName.trim());
          if (existingInAccount) {
            patientId = existingInAccount.id;
          } else {
            patientId = randomId('pat');
            createdPatientId = patientId;
            await tx.run(
              `INSERT INTO operational_patients (id, account_id, full_name, email, phone, preferred_contact, status, origin, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'email', 'active', 'minne_import', ?, ?)`,
              patientId, accountId, prop.fullName.trim(), prop.email || '', prop.phone || '', nowIso(), nowIso()
            );
          }
        }

        if (!patientId) {
          throw new Error('Associação de paciente pendente — escolha um paciente existente ou crie um novo cadastro.');
        }

        const noteId = randomId('note');
        const ts = nowIso();
        const fileIds = item.file_id ? [item.file_id] : [];
        const blocks = [
          {
            id: randomId('blk'),
            type: 'section',
            title: `Histórico externo importado (${item.original_filename || item.detected_format})`,
            text: item.extracted_text || '[Documento/digitalização preservado em anexo privado sem texto extraído]',
          },
        ];

        await tx.run(
          `INSERT INTO clinical_notes (
            id, account_id, patient_id, appointment_id, record_origin, occurred_at, source_author_declared,
            source_system, source_reference_key, import_batch_id, import_item_id, imported_by_user_id, imported_at,
            attachment_file_ids_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, 'external_import', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'concluded', ?, ?)`,
          noteId, accountId, patientId, item.occurred_at || null, item.declared_author || null,
          batch.source_kind, item.source_key || null, batchId, item.id, userId, ts,
          JSON.stringify(fileIds), ts, ts
        );

        await tx.run(
          `INSERT INTO clinical_note_versions (id, note_id, account_id, version_number, author_user_id, author_display_name, blocks_json, change_reason, created_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
          randomId('ver'), noteId, accountId, userId,
          `Importado por ${userDisplayName}${item.declared_author ? ` (autoria declarada na fonte: ${item.declared_author})` : ' (autoria na fonte: desconhecida)'}`,
          JSON.stringify(blocks),
          `Importação lote ${batchId}`,
          ts
        );

        await tx.run(
          `UPDATE import_items SET status = 'imported', created_note_id = ?, created_patient_id = ?, error_message = NULL, updated_at = ?
           WHERE id = ?`,
          noteId, createdPatientId, ts, item.id
        );
        imported++;
      });
    } catch (err) {
      failed++;
      await db.run("UPDATE import_items SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?", err.message || 'Erro ao importar item.', nowIso(), item.id);
    }
  }

  const allStatuses = await db.all('SELECT status FROM import_items WHERE batch_id = ? AND account_id = ?', batchId, accountId);
  const importedFinal = allStatuses.filter((x) => x.status === 'imported').length;
  const skippedFinal = allStatuses.filter((x) => x.status === 'skipped').length;
  const failedOrPendingFinal = allStatuses.filter((x) => !['imported', 'skipped', 'reverted'].includes(x.status)).length;
  const finalStatus = failedOrPendingFinal > 0 ? 'partial_failed' : 'completed';
  await db.run(
    `UPDATE import_batches SET status = ?, imported_count = ?, skipped_count = ?, failed_count = ?, committed_at = ?, updated_at = ?
     WHERE id = ?`,
    finalStatus, importedFinal, skippedFinal, failedOrPendingFinal, nowIso(), nowIso(), batchId
  );

  await writeAudit(db, { actorUserId: userId, actorType: 'professional', accountId, action: 'import.commit', resourceType: 'import_batch', resourceId: batchId, meta: { finalStatus, imported: importedFinal, skipped: skippedFinal, failed: failedOrPendingFinal } });
  return { batch: await getImportBatchDetail(db, accountId, batchId), idempotentReplay: false };
}

export async function cancelImportBatch(db, { accountId, userId, batchId }) {
  const batch = await db.get('SELECT * FROM import_batches WHERE id = ? AND account_id = ?', batchId, accountId);
  if (!batch) throw Object.assign(new Error('Lote não encontrado.'), { status: 404, code: 'BATCH_NOT_FOUND' });
  if (batch.status !== 'staging') throw Object.assign(new Error('Somente lotes em preparação podem ser cancelados/descartados.'), { status: 409, code: 'BATCH_NOT_STAGING' });
  await db.run("UPDATE import_batches SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), batchId);
  await writeAudit(db, { actorUserId: userId, actorType: 'professional', accountId, action: 'import.cancel', resourceType: 'import_batch', resourceId: batchId });
  return getImportBatchDetail(db, accountId, batchId);
}

export async function revertImportBatch(db, { accountId, userId, batchId }) {
  return runTransaction(db, async (tx) => {
    const batch = await tx.get('SELECT * FROM import_batches WHERE id = ? AND account_id = ?', batchId, accountId);
    if (!batch) throw Object.assign(new Error('Lote não encontrado.'), { status: 404, code: 'BATCH_NOT_FOUND' });
    if (!['completed', 'partial_failed'].includes(batch.status)) {
      throw Object.assign(new Error('Apenas lotes concluídos podem ser revertidos.'), { status: 409, code: 'BATCH_NOT_REVERTIBLE' });
    }
    const items = await tx.all("SELECT * FROM import_items WHERE batch_id = ? AND account_id = ? AND status = 'imported'", batchId, accountId);
    let revertedNotes = 0;
    let preservedEditedNotes = 0;
    const now = nowIso();
    for (const it of items) {
      if (!it.created_note_id) continue;
      const verRow = await tx.get('SELECT COUNT(*) as c FROM clinical_note_versions WHERE note_id = ?', it.created_note_id);
      if (Number(verRow.c) > 1) {
        preservedEditedNotes++;
        continue;
      }
      await tx.run("UPDATE clinical_notes SET status = 'reverted', updated_at = ? WHERE id = ?", now, it.created_note_id);
      await tx.run("UPDATE import_items SET status = 'reverted', updated_at = ? WHERE id = ?", now, it.id);
      revertedNotes++;
    }
    await tx.run("UPDATE import_batches SET status = 'reverted', reverted_at = ?, updated_at = ? WHERE id = ?", now, now, batchId);
    await writeAudit(tx, { actorUserId: userId, actorType: 'professional', accountId, action: 'import.revert', resourceType: 'import_batch', resourceId: batchId, meta: { revertedNotes, preservedEditedNotes } });
    return { batch: await getImportBatchDetail(tx, accountId, batchId), revertedNotes, preservedEditedNotes };
  });
}
