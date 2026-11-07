#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local name=$1 project=$2 settings=${3:-}
  local dir=$scratch/$name
  mkdir -p "$dir/modules/zig"
  cp -r "$here/$project/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/fetch-toolchain.sh" "$module/verify-toolchain.sh" "$module/dagger-module.toml" "$dir/modules/zig/"
  cat >"$dir/dagger.toml" <<TOML
[modules.zig]
source = "modules/zig"

[modules.zig.settings]
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

zig_version() {
  (cd "$scratch/$1" && dagger call zig environment with-exec --args=zig,version stdout | tr -d '[:space:]')
}

rejects_forged_signature() {
  local output
  git -C "$scratch" init --quiet
  echo "== a signature for another file, with a forged trusted comment appended, is rejected"
  if output=$(cd "$scratch" && dagger core container from --address=alpine:3 \
    with-exec --args=apk,add,--no-cache,curl,minisign \
    with-file --path=/verify-toolchain.sh --source="$module/verify-toolchain.sh" \
    with-file --path=/forge-signature.sh --source="$here/forge-signature.sh" \
    with-exec --args=sh,/forge-signature.sh stdout 2>&1); then
    echo "expected failure" >&2
    return 1
  fi
  grep -qF "is for another file" <<<"$output" || {
    echo "$output" >&2
    echo "missing: is for another file" >&2
    return 1
  }
}

fixture passing passing
passes passing

fixture failing failing
fails_with failing "expected 5, found 4"

fixture steps passing 'steps = ["greet"]'
passes steps

fixture unknown-step passing 'steps = ["missing"]'
fails_with unknown-step "no step named 'missing'"

fixture build-args passing 'args = ["-Dmissing=1"]'
fails_with build-args "invalid option: -Dmissing"

fixture default-version passing
echo "== default-version: the module's pinned release"
[[ $(zig_version default-version) == 0.15.2 ]]

fixture pinned-version passing 'version = "0.14.1"'
echo "== pinned-version: the release the setting names"
[[ $(zig_version pinned-version) == 0.14.1 ]]
passes pinned-version

fixture unpublished-version passing 'version = "0.0.1"'
fails_with unpublished-version "returned error: 404"

fixture cache-key passing 'cacheKey = "sample"'
passes cache-key

fixture injected-version passing 'version = "0.15.2; true"'
fails_with injected-version "must be a release such as 0.15.2"

fixture partial-version passing 'version = "0.15"'
fails_with partial-version "must be a release such as 0.15.2"

rejects_forged_signature
