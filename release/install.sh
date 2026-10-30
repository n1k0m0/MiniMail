#!/bin/sh
set -eu
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$directory/minimail" install --bundle "$directory" --root "${1:-$directory}" --admin "${2:-admin}"
