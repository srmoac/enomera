#!/usr/bin/env bash
# Backup cifrado do banco da Enomera (Neon Postgres).
# Uso: DATABASE_URL=... BACKUP_PASSPHRASE=... scripts/backup-banco.sh [pasta-de-saída]
# Gera enomera-banco-AAAA-MM-DD-HHMM.dump.gpg (pg_dump formato custom, cifrado AES-256)
# e confere que o arquivo abre e lista as tabelas antes de terminar.
# Nunca imprime o endereço do banco nem a frase-senha.
set -euo pipefail

OUT_DIR="${1:-backup}"
: "${DATABASE_URL:?Falta DATABASE_URL (endereço do banco)}"
: "${BACKUP_PASSPHRASE:?Falta BACKUP_PASSPHRASE (frase-senha do backup)}"
if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "A frase-senha do backup precisa ter pelo menos 20 caracteres." >&2
  exit 1
fi

# pg_dump precisa da conexão direta do Neon (sem o pooler).
DB_URL="${DATABASE_URL/-pooler./.}"
PG_BIN="${PG_BIN:-}"
PG_DUMP="${PG_BIN:+$PG_BIN/}pg_dump"
PG_RESTORE="${PG_BIN:+$PG_BIN/}pg_restore"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
FILE="$OUT_DIR/enomera-banco-$STAMP.dump.gpg"
PASS_FILE="$(mktemp)"
trap 'rm -f "$PASS_FILE"' EXIT
printf '%s' "$BACKUP_PASSPHRASE" > "$PASS_FILE"

"$PG_DUMP" --dbname="$DB_URL" --format=custom --compress=6 --no-owner --no-privileges \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS_FILE" \
        --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 \
        --compress-algo none --output "$FILE"

# Conferência: decifra e lista o conteúdo sem restaurar nada.
TABLES="$(gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASS_FILE" --decrypt "$FILE" \
  | "$PG_RESTORE" --list | grep -c ' TABLE DATA ' || true)"
if [ "${TABLES:-0}" -lt 1 ]; then
  echo "O backup foi gerado mas não contém tabelas. Algo deu errado." >&2
  exit 1
fi
SIZE="$(du -h "$FILE" | cut -f1)"
echo "Backup pronto: $(basename "$FILE") ($SIZE, $TABLES tabelas com dados)"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "file=$FILE"; echo "name=$(basename "$FILE" .dump.gpg)"; echo "tables=$TABLES"; echo "size=$SIZE"; } >> "$GITHUB_OUTPUT"
fi
