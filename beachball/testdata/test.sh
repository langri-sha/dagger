#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

commit() {
  git -c user.name=fixture -c user.email=fixture@example.com commit --quiet "$@"
}

repository() {
  echo "$scratch/repositories/$1"
}

workspace() {
  mkdir -p "$1/beachball-module"
  cp -r "$here/workspace/." "$1/"
  cp "$module/main.dang" "$module/dagger-module.toml" "$1/beachball-module/"
  printf '[modules.beachball]\nsource = "beachball-module"\n' >"$1/dagger.toml"
}

fixture() {
  local repo
  repo=$(repository "$1")
  workspace "$repo"
  git -C "$repo" init --quiet -b main
  git -C "$repo" add -A
  (cd "$repo" && commit -m base)
  git -C "$repo" checkout --quiet -b feature
  echo 'module.exports = 2' >"$repo/packages/foo/index.js"
  (cd "$repo" && commit -am change)
}

add_change_file() {
  local repo
  repo=$(repository "$1")
  mkdir -p "$repo/change"
  printf '{"type":"patch","comment":"Change foo","packageName":"foo","email":"fixture@example.com","dependentChangeType":"patch"}\n' >"$repo/change/foo-0000.json"
  git -C "$repo" add change
  (cd "$repo" && commit -m "Add a change file")
}

add_package_on_main() {
  local repo
  repo=$(repository "$1")
  git -C "$repo" checkout --quiet main
  mkdir -p "$repo/packages/bar"
  printf '{"name":"bar","version":"1.0.0"}\n' >"$repo/packages/bar/package.json"
  git -C "$repo" add packages/bar
  (cd "$repo" && commit -m "Add bar")
}

revert_change() {
  local repo
  repo=$(repository "$1")
  git -C "$repo" revert --no-commit HEAD
  (cd "$repo" && commit -m "Revert the change")
}

merge_pull_request() {
  local repo
  repo=$(repository "$1")
  git -C "$repo" checkout --quiet main
  (cd "$repo" && git -c user.name=fixture -c user.email=fixture@example.com merge --quiet --no-ff feature -m "Merge pull request")
  git -C "$repo" checkout --quiet --detach
  git -C "$repo" branch --quiet -D main feature
}

clone() {
  git clone --quiet --depth 1 "file://$(repository "$1")" "$scratch/$1"
}

hand_over() {
  local repo dir sha
  repo=$(repository "$1")
  dir=$scratch/$1/.merge-base
  sha=$(git -C "$repo" merge-base HEAD^1 HEAD^2)
  mkdir "$dir"
  echo "$sha" >"$dir/sha"
  echo main >"$dir/ref"
  git -C "$repo" -c core.quotePath=false diff --name-status --no-renames -z "$sha" HEAD^2 >"$dir/changes"
}

check_out() {
  clone "$1"
  hand_over "$1"
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

fixture merge-without-change-file
merge_pull_request merge-without-change-file
check_out merge-without-change-file
fails_with merge-without-change-file "Change files are needed"

fixture merge-with-change-file
add_change_file merge-with-change-file
merge_pull_request merge-with-change-file
check_out merge-with-change-file
passes merge-with-change-file

fixture target-moved
add_change_file target-moved
add_package_on_main target-moved
merge_pull_request target-moved
check_out target-moved
passes target-moved

fixture empty-merge
revert_change empty-merge
merge_pull_request empty-merge
check_out empty-merge
passes empty-merge
(cd "$scratch/empty-merge" && dagger generate -y)
test ! -e "$scratch/empty-merge/change"

fixture no-hand-over
merge_pull_request no-hand-over
clone no-hand-over
fails_with no-hand-over "run the action before dagger check"

fixture generate
merge_pull_request generate
check_out generate
(cd "$scratch/generate" && dagger generate -y)
test "$(find "$scratch/generate/change" -name '*.json' | wc -l)" -eq 1
grep -q '"packageName": "foo"' "$scratch/generate"/change/*.json
