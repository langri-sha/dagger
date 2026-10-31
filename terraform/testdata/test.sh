#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local name=$1 workspace=$2 settings=${3:-} root=${4:-terraform/web}
  local dir=$scratch/$name
  mkdir -p "$dir/modules/terraform"
  cp -r "$here/$workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/modules/terraform/"
  cat >"$dir/dagger.toml" <<TOML
[modules.terraform]
source = "modules/terraform"

[modules.terraform.settings]
rootModule = "$root"
$settings
TOML
}

passes() {
  local name=$1
  echo "== $name: dagger check passes"
  (cd "$scratch/$name" && dagger check)
}

fails_with() {
  local name=$1 message=$2 output
  echo "== $name: dagger check fails with: $message"
  if output=$(cd "$scratch/$name" && dagger check 2>&1); then
    echo "expected failure" >&2
    return 1
  fi
  grep -qF "$message" <<<"$output" || {
    echo "$output" >&2
    echo "missing: $message" >&2
    return 1
  }
}

fixture plain plain
passes plain

fixture plain-cache-key plain 'cacheKey = "plain-web"'
passes plain-cache-key

fixture invite-included invite 'include = ["templates/**"]'
passes invite-included

fixture invite-excluded invite
fails_with invite-excluded "no file exists at"

fixture absolute-include invite 'include = ["/templates/**"]'
fails_with absolute-include "include /templates/** must be relative to the workspace root"

fixture parent-include invite 'include = ["templates/../../secrets/**"]'
fails_with parent-include "include templates/../../secrets/** must be relative to the workspace root"

fixture absolute-root plain "" /terraform/web
fails_with absolute-root "rootModule /terraform/web must be relative to the workspace root"

fixture parent-root plain "" terraform/../../web
fails_with parent-root "rootModule terraform/../../web must be relative to the workspace root"
