#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

commit() {
  git -c user.name=fixture -c user.email=fixture@example.com commit --quiet "$@"
}

workspace() {
  echo "$scratch/$1"
}

fixture() {
  local dir
  dir=$(workspace "$1")
  mkdir -p "$dir/ci-module"
  cp -r "$here/$2/." "$dir/"
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/ci-module/"
  printf '[modules.ci]\nsource = "ci-module"\n' >"$dir/dagger.toml"
  git -C "$dir" init --quiet -b main
  git -C "$dir" add -A
  (cd "$dir" && commit -m base)
}

upgrade_stamp() {
  local dir
  dir=$(workspace "$1")
  sed 's/stamp@file:stamp-1/stamp@file:stamp-2/' "$dir/projenrc.js" >"$dir/projenrc.js.next"
  mv "$dir/projenrc.js.next" "$dir/projenrc.js"
  (cd "$dir" && commit -am "Upgrade stamp")
}

passes() {
  local name=$1 check=$2
  echo "== $name: $check passes"
  (cd "$(workspace "$name")" && dagger check "$check")
}

generate() {
  local name=$1 generator=$2
  echo "== $name: dagger generate $generator"
  (cd "$(workspace "$name")" && dagger generate -y "$generator")
}

fixture synthesized projen
passes synthesized ci/projen/stale

fixture upgraded-component projen
upgrade_stamp upgraded-component
generate upgraded-component ci/projen
test "$(cat "$(workspace upgraded-component)/stamp.txt")" = 2
grep -qF '"stamp": "file:stamp-2"' "$(workspace upgraded-component)/package.json"
grep -qF 'stamp@file:stamp-2' "$(workspace upgraded-component)/pnpm-lock.yaml"
passes upgraded-component ci/projen/stale
