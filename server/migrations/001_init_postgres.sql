-- Enomera Core Schema v1 (PostgreSQL / Neon Postgres compatible)
-- Apply with: psql "$DATABASE_URL" -f server/migrations/001_init_postgres.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'professional',
  email_verified_at TIMESTAMPTZ,
  mfa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  modalities_json JSONB NOT NULL DEFAULT '["online","presencial"]'::jsonb,
  online_meeting_url TEXT NOT NULL DEFAULT 'https://meet.exemplo.invalid/sala-helena',
  online_instructions TEXT NOT NULL DEFAULT 'Teste fone e câmera 5 minutos antes. O link fica liberado 15 minutos antes da consulta.',
  online_unlock_minutes INTEGER NOT NULL DEFAULT 15,
  in_person_address TEXT NOT NULL DEFAULT 'Pinheiros, São Paulo - SP (endereço completo após confirmação)',
  ui_preferences_json JSONB NOT NULL DEFAULT '{"reducedMotion":false,"density":"comfortable","draftReminders":true}'::jsonb,
  photo_file_id TEXT,
  is_demo_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_memberships (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  can_access_clinical BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  account_id TEXT,
  patient_id TEXT,
  mfa_verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_handoff_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_origin TEXT NOT NULL,
  return_path TEXT NOT NULL DEFAULT '/',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  status TEXT NOT NULL,
  billing_mode TEXT NOT NULL DEFAULT 'monthly',
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, product)
);

CREATE TABLE IF NOT EXISTS commercial_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  items_json JSONB NOT NULL,
  due_today_cents INTEGER NOT NULL,
  recurring_monthly_cents INTEGER NOT NULL,
  balance_on_approval_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  summary_json JSONB NOT NULL,
  status TEXT NOT NULL,
  is_simulated BOOLEAN NOT NULL DEFAULT TRUE,
  receipt_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commercial_orders(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES professional_accounts(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES operational_patients(id) ON DELETE CASCADE,
  request_id TEXT,
  idempotency_key TEXT,
  origin TEXT NOT NULL DEFAULT 'minne',
  modality TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  status TEXT NOT NULL DEFAULT 'confirmed',
  price_cents INTEGER NOT NULL DEFAULT 22000,
  cancelled_by TEXT,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_appointments_active_slot
  ON appointments(account_id, start_at)
  WHERE status IN ('confirmed', 'reschedule_requested');

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
