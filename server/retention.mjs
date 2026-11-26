// Exclusão de conta e retenção de dados, conforme a Política de Privacidade (item 6):
// - conta com exclusão pedida: 90 dias só para leitura e exportação, depois é apagada;
// - registros de acesso: 6 meses;
// - registro de e-mails enviados: 30 dias; códigos e sessões vencidos: apagados.
// A rotina roda uma vez por dia (Vercel Cron em /api/v1/internal/retention, com CRON_SECRET).
import { addDaysIso, nowIso } from './crypto.mjs';
import { runTransaction, writeAudit } from './db.mjs';
import { cancelProductBilling } from './asaas.mjs';
import { deletePrivateFileBinary } from './storage.mjs';

export const ACCOUNT_DELETION_GRACE_DAYS = 90;
export const ACCESS_LOG_RETENTION_DAYS = 183;
const EXPIRED_TOKEN_RETENTION_DAYS = 30;
const OUTBOX_RETENTION_DAYS = 30;

const daysAgoIso = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

/** Pedido de exclusão feito pelo dono da conta: cancela a cobrança e deixa tudo só para leitura por 90 dias. */
export async function requestAccountDeletion(db, { account, userId }) {
  const products = (await db.all("SELECT product FROM entitlements WHERE account_id = ? AND status IN ('active', 'trial', 'cancelled_grace')", account.id)).map((e) => e.product);
  for (const product of products) await cancelProductBilling(db, { accountId: account.id, product });
  const now = nowIso();
  const scheduledFor = addDaysIso(ACCOUNT_DELETION_GRACE_DAYS);
  await db.run("UPDATE entitlements SET status = 'read_only', cancelled_at = COALESCE(cancelled_at, ?), updated_at = ? WHERE account_id = ? AND status != 'read_only'", now, now, account.id);
  await db.run('UPDATE professional_accounts SET deletion_requested_at = ?, deletion_scheduled_for = ?, updated_at = ? WHERE id = ?', now, scheduledFor, now, account.id);
  await writeAudit(db, { actorUserId: userId, actorType: 'professional', accountId: account.id, action: 'account.deletion_request', resourceType: 'account', resourceId: account.id, meta: { scheduledFor } });
  return { requestedAt: now, scheduledFor };
}

export async function cancelAccountDeletion(db, { account, userId }) {
  const now = nowIso();
  await db.run('UPDATE professional_accounts SET deletion_requested_at = NULL, deletion_scheduled_for = NULL, updated_at = ? WHERE id = ?', now, account.id);
  await writeAudit(db, { actorUserId: userId, actorType: 'professional', accountId: account.id, action: 'account.deletion_cancel', resourceType: 'account', resourceId: account.id });
  return { ok: true };
}

/** Apaga a conta, os arquivos e o usuário dono (se não participa de outra conta). Contas de demonstração nunca são apagadas. */
export async function purgeAccount(db, accountId) {
  const account = await db.get('SELECT * FROM professional_accounts WHERE id = ?', accountId);
  if (!account || account.is_demo_sandbox) return false;
  const files = await db.all('SELECT * FROM private_files WHERE account_id = ?', accountId);
  for (const f of files) await deletePrivateFileBinary(f);
  await runTransaction(db, async (tx) => {
    await tx.run('DELETE FROM sessions WHERE account_id = ?', accountId);
    await tx.run('DELETE FROM verification_tokens WHERE account_id = ?', accountId);
    await tx.run('DELETE FROM professional_accounts WHERE id = ?', accountId);
    const others = await tx.get('SELECT COUNT(*) AS c FROM account_memberships WHERE user_id = ?', account.owner_user_id);
    if (!Number(others?.c || 0)) {
      await tx.run('DELETE FROM sessions WHERE user_id = ?', account.owner_user_id);
      await tx.run("DELETE FROM users WHERE id = ? AND role = 'professional'", account.owner_user_id);
    }
    // Fica só o registro do ato (sem dado pessoal), para comprovar que a exclusão foi cumprida.
    await writeAudit(tx, { actorType: 'system', action: 'account.purged', resourceType: 'account', resourceId: accountId, meta: { files: files.length } });
  });
  return true;
}

export async function runRetention(db) {
  const out = { accountsPurged: 0, accountErrors: 0, accessLogs: 0, tokens: 0, sessions: 0, outbox: 0 };
  const due = await db.all('SELECT id FROM professional_accounts WHERE deletion_scheduled_for IS NOT NULL AND deletion_scheduled_for <= ? AND is_demo_sandbox = 0', nowIso());
  for (const row of due) {
    try { if (await purgeAccount(db, row.id)) out.accountsPurged += 1; } catch (err) {
      out.accountErrors += 1;
      console.error('[retention] conta não apagada:', row.id, err?.message || err);
    }
  }
  const count = (r) => Number(r?.changes || 0);
  // Registros de acesso (entradas, saídas, códigos): 6 meses, como pede o Marco Civil.
  out.accessLogs = count(await db.run("DELETE FROM audit_logs WHERE action LIKE 'auth.%' AND created_at < ?", daysAgoIso(ACCESS_LOG_RETENTION_DAYS)));
  out.sessions = count(await db.run('DELETE FROM sessions WHERE expires_at < ?', daysAgoIso(ACCESS_LOG_RETENTION_DAYS)));
  out.tokens = count(await db.run('DELETE FROM verification_tokens WHERE expires_at < ?', daysAgoIso(EXPIRED_TOKEN_RETENTION_DAYS)));
  out.outbox = count(await db.run('DELETE FROM dev_outbox_messages WHERE created_at < ?', daysAgoIso(OUTBOX_RETENTION_DAYS)));
  return out;
}
