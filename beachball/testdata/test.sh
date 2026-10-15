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
  mkdir -p "$1/beachball-module"
  cp -r "$here/workspace/." "$1/"
  cp "$module/main.dang" "$module/dagger-module.toml" "$1/beachball-module/"
  printf '[modules.beachball]\nsource = "beachball-module"\n' >"$1/dagger.toml"
}

fixture() {
  local dir=$scratch/$1
  workspace "$dir"
  git -C "$dir" init --quiet -b main
  git -C "$dir" add -A
  (cd "$dir" && commit -m base)
  git -C "$dir" remote add origin https://github.com/example/fixture.git
  git -C "$dir" checkout --quiet -b feature
  echo 'module.exports = 2' >"$dir/packages/foo/index.js"
  (cd "$dir" && commit -am change)
}

add_change_file() {
  mkdir -p "$1/change"
  printf '{"type":"patch","comment":"Change foo","packageName":"foo","email":"fixture@example.com","dependentChangeType":"patch"}\n' >"$1/change/foo-0000.json"
  git -C "$1" add change
  (cd "$1" && commit -m "Add a change file")
}

merge_pull_request() {
  git -C "$1" checkout --quiet main
  (cd "$1" && git -c user.name=fixture -c user.email=fixture@example.com merge --quiet --no-ff feature -m "Merge pull request")
  git -C "$1" checkout --quiet --detach
  git -C "$1" branch --quiet -D main feature
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
merge_pull_request "$scratch/merge-without-change-file"
fails_with merge-without-change-file "Change files are needed"

fixture merge-with-change-file
add_change_file "$scratch/merge-with-change-file"
merge_pull_request "$scratch/merge-with-change-file"
passes merge-with-change-file

fixture no-merge-commit
git -C "$scratch/no-merge-commit" checkout --quiet --detach
fails_with no-merge-commit "HEAD is not a merge commit"

fixture shallow-source
merge_pull_request "$scratch/shallow-source"
git clone --quiet --depth 1 "file://$scratch/shallow-source" "$scratch/shallow"
cp -r "$scratch/shallow-source/beachball-module" "$scratch/shallow-source/dagger.toml" "$scratch/shallow/"
fails_with shallow "set fetch-depth: 0"

fixture generate
merge_pull_request "$scratch/generate"
(cd "$scratch/generate" && dagger generate -y)
test "$(find "$scratch/generate/change" -name '*.json' | wc -l)" -eq 1
grep -q '"packageName": "foo"' "$scratch/generate"/change/*.json
