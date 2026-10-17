#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
modules=$(dirname "$module")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local dir=$scratch/$1 settings=${2:-}
  mkdir -p "$dir/modules/vitest" "$dir/modules/typescript"
  cp -r "$here/workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/modules/vitest/"
  cp "$modules/typescript/main.dang" "$modules/typescript/dagger-module.toml" "$dir/modules/typescript/"
  printf '[modules.vitest]\nsource = "modules/vitest"\n\n[modules.vitest.settings]\n%s\n' "$settings" >"$dir/dagger.toml"
}

add_failing_test() {
  printf "import { expect, test } from 'vitest'\n\ntest('fails on purpose', () => {\n  expect(1).toBe(2)\n})\n" >"$scratch/$1/packages/basics/fail.test.js"
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

fixture suite
passes suite

fixture failing-test
add_failing_test failing-test
fails_with failing-test "fails on purpose"

fixture selected-project 'projects = ["generated"]'
add_failing_test selected-project
passes selected-project

fixture image-without-git 'baseImageAddress = "node:24-slim"'
fails_with image-without-git "spawnSync git ENOENT"
