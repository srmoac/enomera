-- Enomera Core Schema v2 — Real-user vs demo separation & performance indexes
-- Compatible with both PostgreSQL (Neon) and SQLite WAL

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_verification_lookup
  ON verification_tokens(purpose, target_contact, created_at);

CREATE INDEX IF NOT EXISTS idx_appointments_account_status
  ON appointments(account_id, status, start_at);

CREATE INDEX IF NOT EXISTS idx_consultation_requests_account
  ON consultation_requests(account_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_clinical_notes_account_patient
  ON clinical_notes(account_id, patient_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_private_files_account_scope
  ON private_files(account_id, scope);
