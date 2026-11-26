// Migração 009 (auditoria de 26/11/2026). Idempotente nos dois bancos (SQLite local e Postgres).
// Novas migrações ficam em arquivos próprios nesta pasta; as de 003 a 008 seguem em db.mjs
// porque já foram aplicadas em produção e dependem de funções dos módulos do piloto.

export const version = '009_auditoria_2611';
export const description = 'Cobrança (carência, implantação), aceite dos Termos, consentimento do paciente e exclusão de conta';

async function addColumn(tx, table, name, definition) {
  if (tx.dialect === 'sqlite') {
    const cols = await tx.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === name)) await tx.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  } else {
    await tx.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${name} ${definition}`);
  }
}

export async function apply(tx, { ensureBillingTables, seedInvitesExpireAt }) {
  await ensureBillingTables(tx);
  await addColumn(tx, 'billing_subscriptions', 'overdue_since', 'TEXT');
  await addColumn(tx, 'billing_subscriptions', 'setup_payment_id', 'TEXT');

  // Aceite explícito dos Termos e da Política (versão e data), gravado na criação da conta.
  await addColumn(tx, 'users', 'terms_accepted_at', 'TEXT');
  await addColumn(tx, 'users', 'terms_version', 'TEXT');

  // Consentimento do paciente para tratar os dados do pedido de consulta (LGPD, art. 11).
  await addColumn(tx, 'consultation_requests', 'consent_at', 'TEXT');
  await addColumn(tx, 'consultation_requests', 'consent_version', 'TEXT');
  await addColumn(tx, 'consultation_requests', 'consent_ip_hash', 'TEXT');

  // Exclusão de conta pedida pelo profissional: fica só para leitura até a data marcada.
  await addColumn(tx, 'professional_accounts', 'deletion_requested_at', 'TEXT');
  await addColumn(tx, 'professional_accounts', 'deletion_scheduled_for', 'TEXT');

  // Convites do piloto que estavam sem validade: os ainda abertos passam a vencer no fim do piloto.
  await tx.run('UPDATE pilot_invites SET expires_at = ? WHERE expires_at IS NULL AND used_at IS NULL AND revoked_at IS NULL', seedInvitesExpireAt);
}
