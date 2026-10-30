#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary=$(mktemp -d -t minimail-update-test-XXXXXX)
trap 'rm -rf "$temporary"' EXIT
revision=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
docker build --build-arg VERSION=0.0.0 --build-arg REVISION="$revision" -t minimail-update-e2e:old "$root"
docker build --build-arg VERSION=999.0.0-rc.1 --build-arg REVISION="$revision" -t minimail-update-e2e:new "$root"
docker build -f "$root/database/Dockerfile" -t minimail-update-e2e:database "$root"
export MINIMAIL_DOCKER_TEST=1
export MINIMAIL_TEST_OLD_IMAGE=minimail-update-e2e:old
export MINIMAIL_TEST_NEW_IMAGE=minimail-update-e2e:new
export MINIMAIL_TEST_DB_IMAGE=minimail-update-e2e:database
baseline=$(cd "$root/updater" && go run . release-info --channel preview)
baseline=$(printf '%s' "$baseline" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("image", ""))')
if [ -n "$baseline" ]; then
  docker pull "$baseline"
else
  # First release: upgrade the audited version used before release management.
  baseline_revision=1678969221965f75f93a4571561eed33a7d424bc
  git -C "$root" cat-file -e "$baseline_revision" || git -C "$root" fetch origin "$baseline_revision"
  mkdir "$temporary/baseline"
  git -C "$root" archive "$baseline_revision" | tar -xf - -C "$temporary/baseline"
  baseline=minimail-update-e2e:baseline
  docker build -t "$baseline" "$temporary/baseline"
fi
export MINIMAIL_TEST_BASELINE_IMAGE="$baseline"
(cd "$root/updater" && go test -c -o "$temporary/update-e2e.test")
python3 "$root/tests/update-e2e.py" "$temporary/update-e2e.test" -test.v -test.run '^TestDocker(Lifecycle|PreviousReleaseUpgrade)$'
