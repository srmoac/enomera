// Migração 011 (integração de 27/11/2026). Idempotente nos dois bancos (SQLite local e Postgres).
// 1) A coluna online_meeting_url nasceu com o link fictício da demonstração como padrão. Contas reais
//    criadas por convite herdavam esse link: a configuração vinha preenchida com ele e o paciente
//    receberia um link que não abre. Contas reais ficam sem link até a profissional informar o dela;
//    contas de demonstração (is_demo_sandbox = 1) não mudam.
// 2) Ações da profissional no Agendamento: recusar pedido (mensagem e data) e propor outro horário
//    (pedido de remarcação iniciado por quem atende).

export const version = '011_integracao_2711';
export const description = 'Sala online sem link fictício; recusa de pedido e proposta de horário pela profissional';
export const DEMO_MEETING_URL = 'https://meet.exemplo.invalid/sala-helena';

async function addColumn(tx, table, name, definition) {
  if (tx.dialect === 'sqlite') {
    const cols = await tx.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === name)) await tx.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  } else {
    await tx.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
  }
}

export async function apply(tx) {
  await tx.run('UPDATE professional_accounts SET online_meeting_url = ? WHERE online_meeting_url = ? AND is_demo_sandbox = 0', '', DEMO_MEETING_URL);
  await addColumn(tx, 'consultation_requests', 'decline_message', "TEXT NOT NULL DEFAULT ''");
  await addColumn(tx, 'consultation_requests', 'declined_at', 'TEXT');
  await addColumn(tx, 'reschedule_requests', 'initiated_by', "TEXT NOT NULL DEFAULT 'patient'");
}
