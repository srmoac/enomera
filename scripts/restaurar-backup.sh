#!/usr/bin/env bash
# Restaura um backup cifrado num banco Postgres VAZIO (ex.: um branch novo no Neon).
# Uso: BACKUP_PASSPHRASE=... DESTINO_URL=... scripts/restaurar-backup.sh enomera-banco-....dump.gpg
# Não use o banco de produção como destino: crie um branch no Neon e restaure nele primeiro.
set -euo pipefail
ARQ="${1:?Informe o arquivo .dump.gpg}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE}"
: "${DESTINO_URL:?Falta DESTINO_URL (banco vazio que vai receber os dados)}"
PASS_FILE="$(mktemp)"; trap 'rm -f "$PASS_FILE"' EXIT
printf '%s' "$BACKUP_PASSPHRASE" > "$PASS_FILE"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS_FILE" --decrypt "$ARQ" \
  | pg_restore --dbname="${DESTINO_URL/-pooler./.}" --no-owner --no-privileges --exit-on-error
echo "Restauração concluída."
