#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
vpn=0
geoip=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --vpn) vpn=1; shift ;;
    --geoip) geoip=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [ ! -f "$root/.env" ]; then echo 'Create .env first; see scripts/install.sh.' >&2; exit 1; fi
if [ "$geoip" = 1 ]; then set -- -f "$root/compose.geoip.yaml" "$@"; fi
if [ "$vpn" = 1 ]; then set -- -f "$root/compose.vpn.yaml" "$@"; fi
exec docker compose --project-directory "$root" --env-file "$root/.env" -f "$root/compose.yaml" "$@"
