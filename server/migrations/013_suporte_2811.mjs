// Migração 013 (28/11/2026): chat de ajuda (suporte automatizado).
// support_questions guarda duas coisas, para a base de respostas melhorar sozinha:
//   kind 'sem_resposta' → pergunta que o chat não soube responder (só o texto e a página);
//   kind 'chamado'      → pedido de falar com uma pessoa por e-mail (nome, e-mail, mensagem).
// Fica 90 dias (rotina de retenção) e só o operador lê.
export const version = '013_suporte_2811';
export const description = 'Chat de ajuda: perguntas sem resposta e chamados para uma pessoa';

export async function apply(tx) {
  await tx.exec(`CREATE TABLE IF NOT EXISTS support_questions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    question TEXT NOT NULL DEFAULT '',
    page TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    transcript_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'novo',
    created_at TEXT NOT NULL
  )`);
  await tx.exec('CREATE INDEX IF NOT EXISTS idx_support_questions_kind_created ON support_questions (kind, created_at)');
}
