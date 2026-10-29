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
  mkdir -p "$1/changesets-module"
  cp -r "$here/workspace/." "$1/"
  cp "$module/main.dang" "$module/dagger-module.toml" "$1/changesets-module/"
  printf '[modules.changesets]\nsource = "changesets-module"\n' >"$1/dagger.toml"
}

fixture() {
  local repo
  repo=$(repository "$1")
  workspace "$repo"
  git -C "$repo" init --quiet -b main
  git -C "$repo" add -A
  (cd "$repo" && commit -m base)
  git -C "$repo" checkout --quiet -b feature
}

change_index() {
  local repo
  repo=$(repository "$1")
  echo 'module.exports = 2' >"$repo/index.js"
  (cd "$repo" && commit -am change)
}

delete_index() {
  local repo
  repo=$(repository "$1")
  git -C "$repo" rm --quiet index.js
  (cd "$repo" && commit -m "Delete the index")
}

add_change_file() {
  local repo
  repo=$(repository "$1")
  printf -- '---\n"fixture": patch\n---\n\nChange the index\n' >"$repo/.changeset/change-index.md"
  git -C "$repo" add .changeset
  (cd "$repo" && commit -m "Add a change file")
}

add_empty_change_file() {
  local repo
  repo=$(repository "$1")
  printf -- '---\n\n---\n' >"$repo/.changeset/no-release.md"
  git -C "$repo" add .changeset
  (cd "$repo" && commit -m "Add an empty change file")
}

add_file_on_main() {
  local repo
  repo=$(repository "$1")
  git -C "$repo" checkout --quiet main
  echo 'Notes' >"$repo/notes.md"
  git -C "$repo" add notes.md
  (cd "$repo" && commit -m "Add notes")
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

generates_nothing() {
  local name=$1 before
  before=$(change_files "$name")
  (cd "$scratch/$name" && dagger generate -y)
  test "$(change_files "$name")" = "$before"
}

change_files() {
  find "$scratch/$1/.changeset" -name '*.md' | sort
}

generate_fails_with() {
  local name=$1 message=$2 output
  if output=$(cd "$scratch/$name" && dagger generate -y 2>&1); then
    echo "expected failure" >&2
    return 1
  fi
  grep -qF "$message" <<<"$output" || {
    echo "$output" >&2
    echo "missing: $message" >&2
    return 1
  }
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
change_index merge-without-change-file
merge_pull_request merge-without-change-file
check_out merge-without-change-file
fails_with merge-without-change-file "no changesets were found"

fixture merge-with-change-file
change_index merge-with-change-file
add_change_file merge-with-change-file
merge_pull_request merge-with-change-file
check_out merge-with-change-file
passes merge-with-change-file
generates_nothing merge-with-change-file

fixture merge-with-empty-change-file
change_index merge-with-empty-change-file
add_empty_change_file merge-with-empty-change-file
merge_pull_request merge-with-empty-change-file
check_out merge-with-empty-change-file
passes merge-with-empty-change-file

fixture deletion-without-change-file
delete_index deletion-without-change-file
merge_pull_request deletion-without-change-file
check_out deletion-without-change-file
fails_with deletion-without-change-file "no changesets were found"

fixture target-moved
change_index target-moved
add_change_file target-moved
add_file_on_main target-moved
merge_pull_request target-moved
check_out target-moved
passes target-moved

fixture empty-merge
change_index empty-merge
revert_change empty-merge
merge_pull_request empty-merge
check_out empty-merge
passes empty-merge
generates_nothing empty-merge

fixture no-hand-over
change_index no-hand-over
merge_pull_request no-hand-over
clone no-hand-over
fails_with no-hand-over "run the action before dagger check"

fixture generate
change_index generate
merge_pull_request generate
check_out generate
fails_with generate "no changesets were found"
(cd "$scratch/generate" && dagger generate -y)
test "$(change_files generate | wc -l)" -eq 1
test "$(cat "$(change_files generate)")" = "$(printf -- '---\n\n---')"

fixture generate-without-hand-over
change_index generate-without-hand-over
merge_pull_request generate-without-hand-over
clone generate-without-hand-over
generate_fails_with generate-without-hand-over "run the action before dagger check"
