// Chat de ajuda da Enomera (28/11/2026). O chat responde no navegador, a partir de
// /eno-suporte-base.json, sem custo. O servidor só guarda:
//   - perguntas sem resposta (para a base melhorar toda semana);
//   - chamados "falar com uma pessoa" por e-mail, que chegam ao e-mail oficial da Enomera.
import { nowIso, randomId } from './crypto.mjs';
import { sendTransactionalEmail } from './mailer.mjs';

export const SUPPORT_INBOX = () => (process.env.ENOMERA_SUPPORT_EMAIL || 'contatoenomera@gmail.com').trim();
export const SUPPORT_WHATSAPP = '5513912352841';

const clip = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanPage(v) {
  // Só o caminho da página (sem consulta nem âncora): evita guardar códigos ou e-mails de links.
  const s = clip(v, 300);
  try { return new URL(s, 'https://enomera.vercel.app').pathname.slice(0, 200); } catch { return ''; }
}

function cleanTranscript(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(-12).map((m) => ({ de: m?.de === 'pessoa' ? 'pessoa' : 'chat', texto: clip(m?.texto, 600) })).filter((m) => m.texto);
}

export async function recordUnanswered(db, body) {
  const question = clip(body?.pergunta, 500);
  if (question.length < 2) throw Object.assign(new Error('Pergunta vazia.'), { status: 400, code: 'EMPTY_QUESTION' });
  const id = randomId('sup');
  await db.run(
    `INSERT INTO support_questions (id, kind, question, page, created_at) VALUES (?, 'sem_resposta', ?, ?, ?)`,
    id, question, cleanPage(body?.pagina), nowIso()
  );
  return { id };
}

export async function createTicket(db, body) {
  const name = clip(body?.nome, 120);
  const email = clip(body?.email, 200).toLowerCase();
  const message = clip(body?.mensagem, 2000);
  if (!EMAIL_RE.test(email)) throw Object.assign(new Error('Confira o e-mail para a gente conseguir responder.'), { status: 400, code: 'INVALID_EMAIL', field: 'email' });
  if (message.length < 3) throw Object.assign(new Error('Escreva a sua dúvida em poucas palavras.'), { status: 400, code: 'EMPTY_MESSAGE', field: 'mensagem' });
  const transcript = cleanTranscript(body?.conversa);
  const page = cleanPage(body?.pagina);
  const id = randomId('sup');
  await db.run(
    `INSERT INTO support_questions (id, kind, question, page, name, email, message, transcript_json, created_at)
     VALUES (?, 'chamado', ?, ?, ?, ?, ?, ?, ?)`,
    id, clip(body?.pergunta, 500), page, name, email, message, JSON.stringify(transcript), nowIso()
  );
  const lines = [
    `Nova mensagem pelo chat de ajuda da Enomera.`,
    '',
    `Nome: ${name || '(não informado)'}`,
    `E-mail para responder: ${email}`,
    `Página: ${page || '(desconhecida)'}`,
    '',
    'Mensagem:',
    message,
  ];
  if (transcript.length) {
    lines.push('', 'Conversa com o chat antes do pedido:');
    for (const m of transcript) lines.push(`${m.de === 'pessoa' ? 'Pessoa' : 'Chat'}: ${m.texto}`);
  }
  lines.push('', `Responda direto para ${email}. Chamado ${id}.`);
  let delivered = false;
  try {
    const out = await sendTransactionalEmail(db, {
      recipient: SUPPORT_INBOX(),
      subject: `Ajuda: ${name || email} pelo chat`,
      textBody: lines.join('\n'),
      purpose: 'support_ticket',
    });
    delivered = Boolean(out?.sentExternally);
  } catch (err) {
    // O chamado já está guardado; o e-mail é só o aviso. Não falha para a pessoa.
    console.error('[suporte] aviso por e-mail não enviado:', err?.message || err);
  }
  return { id, delivered };
}

export async function listSupport(db, { days = 30 } = {}) {
  const since = new Date(Date.now() - Math.min(90, Math.max(1, Number(days) || 30)) * 86400000).toISOString();
  const rows = await db.all(
    `SELECT id, kind, question, page, name, email, message, status, created_at FROM support_questions
     WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500`, since
  );
  return { since, items: rows };
}
