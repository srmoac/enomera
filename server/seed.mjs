import { addDaysIso, hashPassword, nowIso, randomId } from './crypto.mjs';
import { getDb, runTransaction } from './db.mjs';

export function seedDatabase(db = getDb()) {
  const existingHelena = db.prepare("SELECT id FROM users WHERE email = 'helena@helenaduartepsi.com.br'").get();
  if (existingHelena) {
    return { seeded: false, reason: 'already_seeded' };
  }

  return runTransaction(db, () => {
    const now = nowIso();

    // 1. Fictional Demo Professional: Helena Duarte (Full Suite: Ambo + Minne + Etha)
    const helenaUserId = 'usr_helena_demo';
    const helenaAccId = 'acc_helena_demo';
    const helenaPwd = hashPassword('HelenaDemo!2026');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
      VALUES (?, 'helena@helenaduartepsi.com.br', ?, ?, 'Helena Duarte', 'professional', ?, 1, ?, ?)
    `).run(helenaUserId, helenaPwd.hash, helenaPwd.salt, now, now, now);

    db.prepare(`
      INSERT INTO professional_accounts (
        id, owner_user_id, slug, display_name, crp_or_crm, specialty, bio, city, timezone,
        session_duration_min, session_price_cents, modalities_json, online_meeting_url,
        online_instructions, online_unlock_minutes, in_person_address, is_demo_sandbox, created_at, updated_at
      ) VALUES (?, ?, 'helena-duarte', 'Helena Duarte', 'CRP 06/148290', 'Psicologia',
        'Psicóloga clínica com escuta voltada a adultos e adolescentes, online e presencial.',
        'São Paulo, SP', 'America/Sao_Paulo', 50, 22000, '["online","presencial"]',
        'https://meet.exemplo.invalid/helena-duarte-sessao',
        'Teste fone e câmera 5 minutos antes. O acesso abre automaticamente 15 minutos antes do horário confirmado.',
        15, 'Pinheiros, São Paulo - SP (endereço completo após confirmação)', 1, ?, ?)
    `).run(helenaAccId, helenaUserId, now, now);

    db.prepare(`
      INSERT INTO account_memberships (id, account_id, user_id, role, can_access_clinical, created_at)
      VALUES ('mem_helena_demo', ?, ?, 'owner', 1, ?)
    `).run(helenaAccId, helenaUserId, now);

    for (const prod of ['ambo', 'minne', 'etha']) {
      db.prepare(`
        INSERT INTO entitlements (id, account_id, product, status, billing_mode, current_period_end, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
      `).run(randomId('ent'), helenaAccId, prod, prod === 'etha' ? 'one_time_plus_hosting' : 'monthly', addDaysIso(30), now);
    }

    // Availability rules (Mon-Fri 09:00-18:00)
    for (const weekday of [1, 2, 3, 4, 5]) {
      db.prepare(`
        INSERT INTO availability_rules (id, account_id, weekday, start_time, end_time, modality, active, created_at)
        VALUES (?, ?, ?, '09:00', '18:00', 'both', 1, ?)
      `).run(randomId('avr'), helenaAccId, weekday, now);
    }

    // Operational patients for Helena (fictional demo dataset)
    const patAna = 'pat_ana_demo';
    const patBruno = 'pat_bruno_demo';
    db.prepare(`
      INSERT INTO operational_patients (id, account_id, full_name, email, phone, preferred_contact, status, origin, summary_operational, created_at, updated_at)
      VALUES (?, ?, 'Ana Oliveira', 'ana.oliveira@exemplo.invalid', '(11) 98111-2233', 'email', 'active', 'minne_manual', 'Acompanhamento semanal', ?, ?)
    `).run(patAna, helenaAccId, now, now);
    db.prepare(`
      INSERT INTO operational_patients (id, account_id, full_name, email, phone, preferred_contact, status, origin, summary_operational, created_at, updated_at)
      VALUES (?, ?, 'Bruno Costa', 'bruno.costa@exemplo.invalid', '(11) 98222-3344', 'whatsapp', 'active', 'ambo_invite', 'Paciente atual via convite', ?, ?)
    `).run(patBruno, helenaAccId, now, now);

    // One concluded clinical note for Ana (proves isolation!)
    const anaNoteId = 'note_ana_demo';
    db.prepare(`
      INSERT INTO clinical_notes (id, account_id, patient_id, record_origin, occurred_at, status, created_at, updated_at)
      VALUES (?, ?, ?, 'minne_session', ?, 'concluded', ?, ?)
    `).run(anaNoteId, helenaAccId, patAna, addDaysIso(-3), now, now);
    db.prepare(`
      INSERT INTO clinical_note_versions (id, note_id, account_id, version_number, author_user_id, author_display_name, blocks_json, change_reason, created_at)
      VALUES ('ver_ana_demo_1', ?, ?, 1, ?, 'Helena Duarte', ?, 'Registro inicial de demonstração', ?)
    `).run(
      anaNoteId, helenaAccId, helenaUserId,
      JSON.stringify([{ id: 'b1', type: 'paragraph', text: 'Registro clínico fictício exclusivo da profissional Helena Duarte — jamais acessível ao paciente ou à operação Etha.' }]),
      now
    );

    // Etha project + published staging version for Helena Duarte
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
    db.prepare(`
      INSERT INTO etha_projects (
        id, account_id, format, status, briefing_step, briefing_json, blockers_json,
        cta_mode, domain_name, domain_status, published_version_id, published_at, created_at, updated_at
      ) VALUES (?, ?, 'one_page', 'published_staging', 4, ?, '[]', 'ambo', 'helenaduartepsi.com.br', 'pending_owner_dns', ?, ?, ?, ?)
    `).run(ethaProjId, helenaAccId, JSON.stringify({ tone: 'Editorial acolhedor', palette: '#662E42' }), ethaVerId, now, now, now);
    db.prepare(`
      INSERT INTO etha_content_versions (id, project_id, account_id, version_number, stage, content_json, created_by_user_id, approved_by_user_id, approved_at, published_at, created_at)
      VALUES (?, ?, ?, 1, 'published', ?, ?, ?, ?, ?, ?)
    `).run(ethaVerId, ethaProjId, helenaAccId, JSON.stringify(publishedContent), helenaUserId, helenaUserId, now, now, now);

    // 2. Second Isolated Professional: Dr. Paulo Mendes (Minne Solo — tests tenant isolation)
    const pauloUserId = 'usr_paulo_demo';
    const pauloAccId = 'acc_paulo_demo';
    const pauloPwd = hashPassword('PauloDemo!2026');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
      VALUES (?, 'paulo@consultorio-exemplo.com.br', ?, ?, 'Dr. Paulo Mendes', 'professional', ?, 1, ?, ?)
    `).run(pauloUserId, pauloPwd.hash, pauloPwd.salt, now, now, now);
    db.prepare(`
      INSERT INTO professional_accounts (id, owner_user_id, slug, display_name, crp_or_crm, specialty, is_demo_sandbox, created_at, updated_at)
      VALUES (?, ?, 'paulo-mendes', 'Dr. Paulo Mendes', 'CRM-SP 192840', 'Psiquiatria', 1, ?, ?)
    `).run(pauloAccId, pauloUserId, now, now);
    db.prepare(`
      INSERT INTO account_memberships (id, account_id, user_id, role, can_access_clinical, created_at)
      VALUES ('mem_paulo_demo', ?, ?, 'owner', 1, ?)
    `).run(pauloAccId, pauloUserId, now);
    db.prepare(`
      INSERT INTO entitlements (id, account_id, product, status, billing_mode, current_period_end, updated_at)
      VALUES (?, ?, 'minne', 'active', 'monthly', ?, ?)
    `).run(randomId('ent'), pauloAccId, addDaysIso(30), now);

    // 3. Etha Delivery Operator: Marcos Martins (ZERO clinical access!)
    const marcosUserId = 'usr_marcos_operator';
    const marcosPwd = hashPassword('MarcosOps!2026');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, password_salt, full_name, role, email_verified_at, mfa_enabled, created_at, updated_at)
      VALUES (?, 'marcos@enomera-ops.exemplo.com.br', ?, ?, 'Marcos Martins', 'operator', ?, 1, ?, ?)
    `).run(marcosUserId, marcosPwd.hash, marcosPwd.salt, now, now, now);

    return { seeded: true };
  });
}

if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) {
  const res = seedDatabase();
  console.log('Seed result:', res);
}
