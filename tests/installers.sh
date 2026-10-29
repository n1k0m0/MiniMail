#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary=$(mktemp -d -t minimail-install-XXXXXX)
project="$temporary/project with spaces"
mkdir -p "$project/scripts" "$temporary/bin"
cp "$root/scripts/install.sh" "$root/scripts/compose.sh" "$project/scripts/"
cp "$root/compose.yaml" "$project/compose.yaml"
cat > "$temporary/bin/docker" <<'MOCK'
#!/bin/sh
printf '%s\n' "$@" >> "$MINIMAIL_INSTALL_TEST_LOG"
case "$*" in *server/install-status.js*) echo configured ;; esac
MOCK
chmod +x "$temporary/bin/docker"
export PATH="$temporary/bin:$PATH"
export MINIMAIL_INSTALL_TEST_LOG="$temporary/docker.log"
sh "$project/scripts/install.sh" test-admin
cp "$project/.env" "$temporary/environment-before"
sh "$project/scripts/install.sh" test-admin
cmp "$project/.env" "$temporary/environment-before"
key=$(sed -n 's/^APP_ENCRYPTION_KEY=//p' "$project/.env")
[ "${#key}" = 64 ]
[ "$(stat -c '%a' "$project/.env")" = 600 ]
sh "$project/scripts/compose.sh" --vpn --geoip config
grep -F "$project/compose.vpn.yaml" "$temporary/docker.log" >/dev/null
grep -F "$project/compose.geoip.yaml" "$temporary/docker.log" >/dev/null
if grep -q 'server/create-admin.js' "$temporary/docker.log"; then echo 'Existing installation must not recreate administrator' >&2; exit 1; fi
rm -- "$project/.env" "$project/compose.yaml" "$project/scripts/install.sh" "$project/scripts/compose.sh" "$temporary/bin/docker" "$temporary/docker.log" "$temporary/environment-before"
rmdir -- "$project/scripts" "$project" "$temporary/bin" "$temporary"
echo 'Shell installer and Compose wrapper tests passed.'
