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
key_count=$(grep -c '^APP_ENCRYPTION_KEY=' "$root/.env" || true)
if [ "$key_count" -ne 1 ] || ! tr -d '\r' < "$root/.env" | grep -Eq '^APP_ENCRYPTION_KEY=[a-fA-F0-9]{64}$'; then
  echo 'Set exactly one APP_ENCRYPTION_KEY in .env to 64 hexadecimal characters. Existing keys are never replaced.' >&2
  exit 1
fi
# Generate missing database passwords without replacing existing credentials.
for name in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD; do
  count=$(grep -c "^$name=" "$root/.env" || true)
  [ "$count" -le 1 ] || { echo "Duplicate $name in .env" >&2; exit 1; }
  if ! grep -Eq "^$name=.+$" "$root/.env"; then
    command -v openssl >/dev/null || { echo 'Install OpenSSL first.' >&2; exit 1; }
    password=$(openssl rand -hex 32)
    temporary=$(mktemp "$root/.env.XXXXXX")
    awk -v name="$name" '$0 !~ "^" name "=" { print }' "$root/.env" > "$temporary"
    printf '%s=%s\n' "$name" "$password" >> "$temporary"
    mv -- "$temporary" "$root/.env"
    unset password
  fi
done
chmod 600 "$root/.env"
sh "$root/scripts/compose.sh" build
sh "$root/scripts/compose.sh" up -d --wait database
status=$(sh "$root/scripts/compose.sh" run --rm --no-deps -T minimail node server/install-status.js)
if [ "$status" = needs-admin ]; then
  sh "$root/scripts/compose.sh" run --rm --no-deps minimail node server/create-admin.js "$username"
fi
sh "$root/scripts/compose.sh" up -d
echo 'MiniMail is listening on http://127.0.0.1:3000. Configure HTTPS for sign-in.'
