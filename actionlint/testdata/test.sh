#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local dir=$scratch/$1
  mkdir -p "$dir/actionlint-module"
  cp -r "$here/workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$module/Dockerfile" "$dir/actionlint-module/"
  printf '[modules.actionlint]\nsource = "actionlint-module"\n' >"$dir/dagger.toml"
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

fixture clean
passes clean

fixture unknown-input
sed -i 's/name: fixture/nmae: fixture/' "$scratch/unknown-input/.github/workflows/check.yml"
fails_with unknown-input 'input "nmae" is not defined in action "Greet"'

fixture unquoted-variable
sed -i 's/echo "$GITHUB_SHA"/echo $GITHUB_SHA/' "$scratch/unquoted-variable/.github/workflows/check.yml"
fails_with unquoted-variable "SC2086"
