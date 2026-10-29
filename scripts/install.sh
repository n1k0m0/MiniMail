#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
username=${1:-admin}
command -v docker >/dev/null || { echo 'Install Docker Engine or Docker Desktop first.' >&2; exit 1; }
docker compose version >/dev/null
if [ ! -f "$root/.env" ]; then
  command -v openssl >/dev/null || { echo 'Install OpenSSL to generate the encryption key.' >&2; exit 1; }
  key=$(openssl rand -hex 32)
  if (set -C; printf 'APP_ENCRYPTION_KEY=%s\n' "$key" > "$root/.env"); then
    echo 'Created .env. Back it up privately with the database.'
  else
    echo 'An existing .env was preserved.'
  fi
  unset key
fi
if ! tr -d '\r' < "$root/.env" | grep -Eq '^APP_ENCRYPTION_KEY=[a-fA-F0-9]{64}$'; then
  echo 'Set APP_ENCRYPTION_KEY in .env to exactly 64 hexadecimal characters. Existing keys are never replaced.' >&2
  exit 1
fi
sh "$root/scripts/compose.sh" build
status=$(sh "$root/scripts/compose.sh" run --rm --no-deps -T minimail node server/install-status.js)
if [ "$status" = needs-admin ]; then
  sh "$root/scripts/compose.sh" run --rm --no-deps minimail node server/create-admin.js "$username"
fi
sh "$root/scripts/compose.sh" up -d
echo 'MiniMail is listening on http://127.0.0.1:3000. Configure HTTPS before remote access.'
