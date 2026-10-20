#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
modules=$(dirname "$module")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

commit() {
  git -c user.name=fixture -c user.email=fixture@example.com commit --quiet "$@"
}

fixture() {
  local dir=$scratch/$1 settings=${2:-}
  mkdir -p "$dir/modules/projen" "$dir/modules/typescript"
  cp -r "$here/workspace/." "$dir/"
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/modules/projen/"
  cp "$modules/typescript/main.dang" "$modules/typescript/dagger-module.toml" "$dir/modules/typescript/"
  printf '[modules.projen]\nsource = "modules/projen"\n\n[modules.projen.settings]\n%s\n' "$settings" >"$dir/dagger.toml"
  git -C "$dir" init --quiet -b main
  git -C "$dir" add -A
  (cd "$dir" && commit -m base)
}

upgrade_stamp() {
  local dir=$scratch/$1
  sed 's/stamp@file:stamp-1/stamp@file:stamp-2/' "$dir/projenrc.js" >"$dir/projenrc.js.next"
  mv "$dir/projenrc.js.next" "$dir/projenrc.js"
  (cd "$dir" && commit -am "Upgrade stamp")
}

edit_stamp() {
  printf '0\n' >"$scratch/$1/stamp.txt"
  (cd "$scratch/$1" && commit -am "Edit the stamp")
}

stamp_is() {
  local name=$1 stamp=$2
  echo "== $name: stamp $stamp"
  test "$(cat "$scratch/$name/stamp.txt")" = "$stamp"
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

generate() {
  local name=$1
  echo "== $name: dagger generate"
  (cd "$scratch/$name" && dagger generate -y)
}

fixture synthesized
passes synthesized

fixture upgraded-component
upgrade_stamp upgraded-component
fails_with upgraded-component "projen/synth/stale: generated files are not up to date"
generate upgraded-component
stamp_is upgraded-component 2
grep -qF '"stamp": "file:stamp-2"' "$scratch/upgraded-component/package.json"
grep -qF 'stamp@file:stamp-2' "$scratch/upgraded-component/pnpm-lock.yaml"
passes upgraded-component

fixture edited-output
edit_stamp edited-output
fails_with edited-output "projen/synth/stale: generated files are not up to date"
generate edited-output
stamp_is edited-output 1
passes edited-output

fixture image-with-git 'baseImageAddress = "node:24"'
passes image-with-git
