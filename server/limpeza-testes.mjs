// Limpeza única das contas de teste do piloto (Marcos, 28/11/2026: "todos esses são testes, pode tirar tudo,
// inclusive todos esses logins do piloto").
// Apaga toda conta de profissional e todo login de profissional que não seja:
// - de demonstração (is_demo_sandbox / is_demo, como a Helena Duarte);
// - de quem entrou pelos 2 convites exclusivos (Jessica e Felipe);
// - o administrador do painel do piloto.
// Roda uma vez só, em produção, e fica registrada em schema_migrations.
import { nowIso } from './crypto.mjs';
import { writeAudit } from './db.mjs';
import { EXCLUSIVE_INVITE_IDS } from './pilot-free.mjs';
import { purgeAccount } from './retention.mjs';

export const CLEANUP_VERSION = 'limpeza_testes_piloto_2811';

const inList = (ids) => ids.map(() => '?').join(', ') || "''";

/** Lista (dryRun) ou apaga as contas de teste. Devolve só contagens e endereços dos sites, sem dado pessoal. */
export async function purgeTestAccounts(db, { dryRun = false } = {}) {
  const keepParticipants = await db.all(
    `SELECT user_id FROM pilot_participants WHERE kind = 'admin' OR invite_id IN (${inList(EXCLUSIVE_INVITE_IDS)})`, ...EXCLUSIVE_INVITE_IDS);
  const keep = new Set(keepParticipants.map((r) => r.user_id));
  for (const r of await db.all("SELECT id FROM users WHERE is_demo = 1 OR role != 'professional'")) keep.add(r.id);

  const accounts = (await db.all('SELECT id, slug, owner_user_id FROM professional_accounts WHERE is_demo_sandbox = 0'))
    .filter((a) => !keep.has(a.owner_user_id));
  const users = (await db.all("SELECT id FROM users WHERE role = 'professional' AND is_demo = 0")).filter((u) => !keep.has(u.id));
  const participants = (await db.all("SELECT id, user_id FROM pilot_participants WHERE kind != 'admin'"))
    .filter((p) => !keep.has(p.user_id));

  const out = { dryRun, accounts: accounts.length, slugs: accounts.map((a) => a.slug).sort(), users: users.length, participants: participants.length, errors: 0 };
  if (dryRun) return out;

  for (const a of accounts) {
    try { await purgeAccount(db, a.id); } catch (err) {
      out.errors += 1;
      console.error('[limpeza] conta não apagada:', a.id, err?.message || err);
    }
  }
  for (const p of participants) {
    await db.run('DELETE FROM pilot_events WHERE participant_id = ?', p.id);
    await db.run('DELETE FROM pilot_devices WHERE participant_id = ?', p.id);
    await db.run('DELETE FROM pilot_participants WHERE id = ?', p.id);
  }
  for (const u of users) {
    try {
      const member = await db.get('SELECT COUNT(*) AS c FROM account_memberships WHERE user_id = ?', u.id);
      if (Number(member?.c || 0)) continue;
      await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      await db.run('DELETE FROM verification_tokens WHERE user_id = ?', u.id).catch(() => {});
      await db.run("DELETE FROM users WHERE id = ? AND role = 'professional' AND is_demo = 0", u.id);
    } catch (err) {
      out.errors += 1;
      console.error('[limpeza] login não apagado:', u.id, err?.message || err);
    }
  }
  await writeAudit(db, { actorType: 'system', action: 'pilot.test_accounts_purged', resourceType: 'pilot', resourceId: CLEANUP_VERSION,
    meta: { accounts: out.accounts, users: out.users, participants: out.participants, errors: out.errors } });
  return out;
}

/** Chamado depois das migrações: só em produção na Vercel e uma vez só. */
export async function runTestCleanupOnce(db, { force = false } = {}) {
  if (!force && process.env.VERCEL_ENV !== 'production') return null;
  const done = await db.get('SELECT version FROM schema_migrations WHERE version = ?', CLEANUP_VERSION);
  if (done) return null;
  const out = await purgeTestAccounts(db);
  await db.run('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING',
    CLEANUP_VERSION, `Limpeza das contas de teste do piloto: ${out.accounts} contas, ${out.users} logins (${out.slugs.join(', ')})`.slice(0, 900), nowIso());
  console.log('[limpeza] contas de teste do piloto apagadas:', JSON.stringify(out));
  return out;
}
