-- Enomera Core Schema v1 (PostgreSQL / Neon Postgres — 100% parity with 001_init.sql)

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'professional',
  email_verified_at TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS professional_accounts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  crp_or_crm TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT 'Psicologia',
  bio TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'São Paulo, SP',
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  session_duration_min INTEGER NOT NULL DEFAULT 50,
  session_price_cents INTEGER NOT NULL DEFAULT 22000,
  modalities_json TEXT NOT NULL DEFAULT '["online","presencial"]',
  online_meeting_url TEXT NOT NULL DEFAULT 'https://meet.exemplo.invalid/sala-helena',
  online_instructions TEXT NOT NULL DEFAULT 'Teste fone e câmera 5 minutos antes. O link fica liberado 15 minutos antes da consulta.',
  online_unlock_minutes INTEGER NOT NULL DEFAULT 15,
  in_person_address TEXT NOT NULL DEFAULT 'Pinheiros, São Paulo - SP (endereço completo após confirmação)',
  ui_preferences_json TEXT NOT NULL DEFAULT '{"reducedMotion":false,"density":"comfortable","draftReminders":true}',
  photo_file_id TEXT,
  is_demo_sandbox INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_memberships (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  can_access_clinical INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  account_id TEXT,
  patient_id TEXT,
  mfa_verified_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_handoff_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_origin TEXT NOT NULL,
  return_path TEXT NOT NULL DEFAULT '/',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  target_contact TEXT NOT NULL,
  user_id TEXT,
  account_id TEXT,
  patient_id TEXT,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  status TEXT NOT NULL,
  billing_mode TEXT NOT NULL DEFAULT 'monthly',
  trial_ends_at TEXT,
  current_period_end TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, product)
);

CREATE TABLE IF NOT EXISTS commercial_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  items_json TEXT NOT NULL,
  due_today_cents INTEGER NOT NULL,
  recurring_monthly_cents INTEGER NOT NULL,
  balance_on_approval_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL,
  status TEXT NOT NULL,
  is_simulated INTEGER NOT NULL DEFAULT 1,
  receipt_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commercial_orders(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pilot_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  specialty TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_rules (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  modality TEXT NOT NULL DEFAULT 'both',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_blocks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'Indisponível',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operational_patients (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  birth_date TEXT NOT NULL DEFAULT '',
  preferred_contact TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL DEFAULT 'active',
  origin TEXT NOT NULL DEFAULT 'minne_manual',
  summary_operational TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_guardians (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES operational_patients(id) ON DELETE CASCADE,
  guardian_name TEXT NOT NULL,
  relation TEXT NOT NULL,
  contact TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_invitations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES operational_patients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'email',
  target_contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consultation_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  patient_id TEXT REFERENCES operational_patients(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  protocol_code TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'ambo',
  modality TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  patient_email TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  patient_birth TEXT NOT NULL DEFAULT '',
  guardian_json TEXT,
  preferences_json TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'preference_sent',
  duplicate_candidate_id TEXT,
  appointment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES operational_patients(id) ON DELETE CASCADE,
  request_id TEXT REFERENCES consultation_requests(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  origin TEXT NOT NULL DEFAULT 'minne',
  modality TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  status TEXT NOT NULL DEFAULT 'confirmed',
  price_cents INTEGER NOT NULL DEFAULT 22000,
  cancelled_by TEXT,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_active_slot
  ON appointments(account_id, start_at)
  WHERE status IN ('confirmed', 'reschedule_requested');

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_idempotency
  ON appointments(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS reschedule_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES operational_patients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  original_start_at TEXT NOT NULL,
  original_end_at TEXT NOT NULL,
  requested_start_at TEXT,
  requested_end_at TEXT,
  preferences_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by_user_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(appointment_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES operational_patients(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  record_origin TEXT NOT NULL DEFAULT 'minne_session',
  occurred_at TEXT,
  source_author_declared TEXT,
  source_system TEXT,
  source_reference_key TEXT,
  import_batch_id TEXT,
  import_item_id TEXT,
  imported_by_user_id TEXT,
  imported_at TEXT,
  attachment_file_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_note_versions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES clinical_notes(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES users(id),
  author_display_name TEXT NOT NULL,
  blocks_json TEXT NOT NULL,
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(note_id, version_number)
);

CREATE TABLE IF NOT EXISTS clinical_drafts (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL UNIQUE REFERENCES clinical_notes(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  base_version_id TEXT,
  blocks_json TEXT NOT NULL,
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS private_files (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  detected_mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_backend TEXT NOT NULL DEFAULT 'vercel_blob_private',
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  source_kind TEXT NOT NULL,
  adapter_id TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'staging',
  idempotency_key TEXT,
  total_items INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  committed_at TEXT,
  reverted_at TEXT
);

CREATE TABLE IF NOT EXISTS import_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  file_id TEXT REFERENCES private_files(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL DEFAULT '',
  detected_format TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  source_key TEXT,
  extracted_text TEXT NOT NULL DEFAULT '',
  extracted_fields_json TEXT NOT NULL DEFAULT '{}',
  unrecognized_fields_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  occurred_at TEXT,
  declared_author TEXT,
  target_patient_id TEXT REFERENCES operational_patients(id) ON DELETE SET NULL,
  proposed_patient_json TEXT,
  resolution_action TEXT NOT NULL DEFAULT 'pending',
  duplicate_of_note_id TEXT,
  status TEXT NOT NULL DEFAULT 'staged',
  error_message TEXT,
  created_note_id TEXT REFERENCES clinical_notes(id) ON DELETE SET NULL,
  created_patient_id TEXT REFERENCES operational_patients(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etha_settings (
  id TEXT PRIMARY KEY,
  capacity_limit INTEGER NOT NULL DEFAULT 3,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etha_waitlist (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  desired_format TEXT NOT NULL DEFAULT 'one_page',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etha_projects (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES professional_accounts(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'one_page',
  identity_addon INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'briefing',
  briefing_step INTEGER NOT NULL DEFAULT 1,
  briefing_json TEXT NOT NULL DEFAULT '{}',
  attachment_file_ids_json TEXT NOT NULL DEFAULT '[]',
  blockers_json TEXT NOT NULL DEFAULT '[]',
  cta_mode TEXT NOT NULL DEFAULT 'ambo',
  custom_contact_url TEXT NOT NULL DEFAULT '',
  domain_name TEXT NOT NULL DEFAULT '',
  domain_status TEXT NOT NULL DEFAULT 'pending_owner_dns',
  published_version_id TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS etha_content_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES etha_projects(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  stage TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  approved_by_user_id TEXT,
  approved_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version_number)
);

CREATE TABLE IF NOT EXISTS etha_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES etha_projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES etha_content_versions(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL DEFAULT 1,
  comments_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_product TEXT NOT NULL,
  target_product TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'synced',
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_type TEXT NOT NULL,
  account_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_outbox_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_preview TEXT NOT NULL,
  purpose TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'not_configured_local_outbox',
  created_at TEXT NOT NULL
);
