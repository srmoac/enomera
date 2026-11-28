// Migração 012 (28/11/2026): sugestões de um toque e importação no Agendamento.
// appointments.reminder_sent_at guarda quando a profissional aprovou o lembrete ao paciente,
// para a sugestão "Lembrar a Ana da consulta de amanhã" não voltar depois de aprovada.
export const version = '012_sugestoes_importacao_2811';
export const description = 'Lembrete aprovado na consulta (sugestões do Agendamento)';

async function addColumn(tx, table, name, definition) {
  if (tx.dialect === 'sqlite') {
    const cols = await tx.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === name)) await tx.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  } else {
    await tx.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
  }
}

export async function apply(tx) {
  await addColumn(tx, 'appointments', 'reminder_sent_at', 'TEXT');
}
