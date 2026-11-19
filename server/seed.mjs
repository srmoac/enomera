import { addDaysIso, hashPassword, nowIso, randomId } from './crypto.mjs';
import { getDb, runTransaction } from './db.mjs';

export async function seedDatabase(db) {
  // On Postgres (shared preview/production), demo seeding is strictly opt-in via ENOMERA_SEED_DEMO=true
  // In local SQLite dev/tests, demo seeding runs unless ENOMERA_SEED_DEMO=false
  const targetDb = db || await getDb();
  if (process.env.ENOMERA_SEED_DEMO === 'false') {
    return { seeded: false, reason: 'disabled_by_env' };
  }
  if (targetDb.dialect === 'postgres' && process.env.ENOMERA_SEED_DEMO !== 'true') {
    return { seeded: false, reason: 'opt_in_required_on_postgres' };
  }
  const existingHelena = await targetDb.get("SELECT id FROM users WHERE email = 'helena@helenaduartepsi.com.br'");
  if (existingHelena) {
    return { seeded: false, reason: 'already_seeded' };
  }

  return runTransaction(targetDb, async (tx) => {
    const again = await tx.get("SELECT id FROM users WHERE email = 'helena@helenaduartepsi.com.br'");
    if (again) return { seeded: false, reason: 'already_seeded' };
    const now = nowIso();

    // 1. Fictional Demo Professional: Helena Duarte (Full Suite: Ambo + Minne + Etha)
    const helenaUserId = 'usr_helena_demo';
    const helenaAccId = 'acc_helena_demo';
    const helenaPwd = hashPassword('HelenaDemo!2026');
    await tx.run(
      `INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, is_demo, created_at, updated_at)
       VALUES (?, 'helena@helenaduartepsi.com.br', ?, ?, 'Helena Duarte', 'professional', ?, 1, 1, ?, ?)`,
      helenaUserId, helenaPwd.hash, helenaPwd.salt, now, now, now
    );

    await tx.run(
      `INSERT INTO professional_accounts (
        id, owner_user_id, slug, display_name, crp_or_crm, specialty, bio, city, timezone,
        session_duration_min, session_price_cents, modalities_json, online_meeting_url,
        online_instructions, online_unlock_minutes, in_person_address, is_demo_sandbox, created_at, updated_at
      ) VALUES (?, ?, 'helena-duarte', 'Helena Duarte', 'CRP 06/148290', 'Psicologia',
        'Psicóloga clínica com escuta voltada a adultos e adolescentes, online e presencial.',
        'São Paulo, SP', 'America/Sao_Paulo', 50, 22000, '["online","presencial"]',
        'https://meet.exemplo.invalid/helena-duarte-sessao',
        'Teste fone e câmera 5 minutos antes. O acesso abre automaticamente 15 minutos antes do horário confirmado.',
        15, 'Pinheiros, São Paulo - SP (endereço completo após confirmação)', 1, ?, ?)`,
      helenaAccId, helenaUserId, now, now
    );

    await tx.run(
      `INSERT INTO account_memberships (id, account_id, user_id, role, can_access_clinical, created_at)
       VALUES ('mem_helena_demo', ?, ?, 'owner', 1, ?)`,
      helenaAccId, helenaUserId, now
    );

    for (const prod of ['ambo', 'minne', 'etha']) {
      await tx.run(
        `INSERT INTO entitlements (id, account_id, product, status, billing_mode, current_period_end, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        randomId('ent'), helenaAccId, prod, prod === 'etha' ? 'one_time_plus_hosting' : 'monthly', addDaysIso(30), now
      );
    }

    for (const weekday of [1, 2, 3, 4, 5]) {
      await tx.run(
        `INSERT INTO availability_rules (id, account_id, weekday, start_time, end_time, modality, active, created_at)
         VALUES (?, ?, ?, '09:00', '18:00', 'both', 1, ?)`,
        randomId('avr'), helenaAccId, weekday, now
      );
    }

    const patAna = 'pat_ana_demo';
    const patBruno = 'pat_bruno_demo';
    await tx.run(
      `INSERT INTO operational_patients (id, account_id, full_name, email, phone, preferred_contact, status, origin, summary_operational, created_at, updated_at)
       VALUES (?, ?, 'Ana Oliveira', 'ana.oliveira@exemplo.invalid', '(11) 98111-2233', 'email', 'active', 'minne_manual', 'Acompanhamento semanal', ?, ?)`,
      patAna, helenaAccId, now, now
    );
    await tx.run(
      `INSERT INTO operational_patients (id, account_id, full_name, email, phone, preferred_contact, status, origin, summary_operational, created_at, updated_at)
       VALUES (?, ?, 'Bruno Costa', 'bruno.costa@exemplo.invalid', '(11) 98222-3344', 'whatsapp', 'active', 'ambo_invite', 'Paciente atual via convite', ?, ?)`,
      patBruno, helenaAccId, now, now
    );

    const anaNoteId = 'note_ana_demo';
    await tx.run(
      `INSERT INTO clinical_notes (id, account_id, patient_id, record_origin, occurred_at, status, created_at, updated_at)
       VALUES (?, ?, ?, 'minne_session', ?, 'concluded', ?, ?)`,
      anaNoteId, helenaAccId, patAna, addDaysIso(-3), now, now
    );
    await tx.run(
      `INSERT INTO clinical_note_versions (id, note_id, account_id, version_number, author_user_id, author_display_name, blocks_json, change_reason, created_at)
       VALUES ('ver_ana_demo_1', ?, ?, 1, ?, 'Helena Duarte', ?, 'Registro inicial de demonstração', ?)`,
      anaNoteId, helenaAccId, helenaUserId,
      JSON.stringify([{ id: 'b1', type: 'paragraph', text: 'Registro clínico fictício exclusivo da profissional Helena Duarte — jamais acessível ao paciente ou à operação Etha.' }]),
      now
    );

    const ethaProjId = 'etha_helena_demo';
    const ethaVerId = 'ethav_helena_pub_1';
    const publishedContent = {
      displayName: 'Helena Duarte',
      crp: 'CRP 06/148290',
      headline: 'Psicoterapia para adultos e adolescentes com escuta ética, clareza e ritmo possível.',
      subheadline: 'Atendimento online para todo o Brasil e presencial em Pinheiros, São Paulo.',
      about: 'Psicóloga clínica com atuação voltada a questões contemporâneas de rotina, relações e travessias pessoais.',
      ctaLabel: 'Solicitar primeira consulta',
      ctaMode: 'ambo',
      amboSlug: 'helena-duarte',
      customContactUrl: '',
    };
    await tx.run(
      `INSERT INTO etha_projects (
        id, account_id, format, status, briefing_step, briefing_json, blockers_json,
        cta_mode, domain_name, domain_status, published_version_id, published_at, created_at, updated_at
      ) VALUES (?, ?, 'one_page', 'published_staging', 4, ?, '[]', 'ambo', 'helenaduartepsi.com.br', 'pending_owner_dns', ?, ?, ?, ?)`,
      ethaProjId, helenaAccId, JSON.stringify({ tone: 'Editorial acolhedor', palette: '#662E42' }), ethaVerId, now, now, now
    );
    await tx.run(
      `INSERT INTO etha_content_versions (id, project_id, account_id, version_number, stage, content_json, created_by_user_id, approved_by_user_id, approved_at, published_at, created_at)
       VALUES (?, ?, ?, 1, 'published', ?, ?, ?, ?, ?, ?)`,
      ethaVerId, ethaProjId, helenaAccId, JSON.stringify(publishedContent), helenaUserId, helenaUserId, now, now, now
    );

    // 2. Second Isolated Demo Professional: Dr. Paulo Mendes (Minne Solo — tests tenant isolation)
    const pauloUserId = 'usr_paulo_demo';
    const pauloAccId = 'acc_paulo_demo';
    const pauloPwd = hashPassword('PauloDemo!2026');
    await tx.run(
      `INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, is_demo, created_at, updated_at)
       VALUES (?, 'paulo@consultorio-exemplo.com.br', ?, ?, 'Dr. Paulo Mendes', 'professional', ?, 1, 1, ?, ?)`,
      pauloUserId, pauloPwd.hash, pauloPwd.salt, now, now, now
    );
    await tx.run(
      `INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, crp_or_crm, specialty, is_demo_sandbox, created_at, updated_at)
       VALUES (?, ?, 'paulo-mendes', 'Dr. Paulo Mendes', 'CRM-SP 192840', 'Psiquiatria', 1, ?, ?)`,
      pauloAccId, pauloUserId, now, now
    );
    await tx.run(
      `INSERT INTO account_memberships (id, account_id, user_id, role, can_access_clinical, created_at)
       VALUES ('mem_paulo_demo', ?, ?, 'owner', 1, ?)`,
      pauloAccId, pauloUserId, now
    );
    await tx.run(
      `INSERT INTO entitlements (id, account_id, product, status, billing_mode, current_period_end, updated_at)
       VALUES (?, ?, 'minne', 'active', 'monthly', ?, ?)`,
      randomId('ent'), pauloAccId, addDaysIso(30), now
    );

    // 3. Etha Delivery Operator: Marcos Martins (ZERO clinical access!)
    const marcosUserId = 'usr_marcos_operator';
    const marcosPwd = hashPassword('MarcosOps!2026');
    await tx.run(
      `INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, is_demo, created_at, updated_at)
       VALUES (?, 'marcos@enomera-ops.exemplo.com.br', ?, ?, 'Marcos Martins', 'operator', ?, 1, 1, ?, ?)`,
      marcosUserId, marcosPwd.hash, marcosPwd.salt, now, now, now
    );

    return { seeded: true };
  }, 'seed_demo_data');
}

if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) {
  const res = await seedDatabase();
  console.log('Seed result:', res);
}
