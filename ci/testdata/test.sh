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

passes() {
  local name=$1 check=$2
  echo "== $name: $check passes"
  (cd "$(workspace "$name")" && dagger check "$check")
}

fixture synthesized projen
passes synthesized ci/projen/stale
