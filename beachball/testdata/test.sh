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

public_remote=https://github.com/langri-sha/dagger.git
public_root=5568a8d949e0b3ca615fb6f488c3eb378bc7b072

public_fixture() {
  local dir=$scratch/$1
  [[ -d $scratch/public ]] || git clone --quiet --no-checkout "$public_remote" "$scratch/public"
  git clone --quiet "$scratch/public" "$dir"
  git -C "$dir" remote set-url origin "$public_remote"
  git -C "$dir" checkout --quiet -b feature "$public_root"
  git -C "$dir" branch --quiet -D main
  git -C "$dir" rm --quiet -r .
  workspace "$dir"
  git -C "$dir" add -A
  (cd "$dir" && commit -m "Add a workspace")
}

add_change_file() {
  mkdir -p "$1/change"
  printf '{"type":"patch","comment":"Change foo","packageName":"foo","email":"fixture@example.com","dependentChangeType":"patch"}\n' >"$1/change/foo-0000.json"
  git -C "$1" add change
  (cd "$1" && commit -m "Add a change file")
}

add_package_on_main() {
  git -C "$1" checkout --quiet main
  mkdir -p "$1/packages/bar"
  printf '{"name":"bar","version":"1.0.0"}\n' >"$1/packages/bar/package.json"
  git -C "$1" add packages/bar
  (cd "$1" && commit -m "Add bar")
}

revert_change() {
  git -C "$1" revert --no-commit HEAD
  (cd "$1" && commit -m "Revert the change")
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

passes_warning() {
  local name=$1 message=$2 output
  echo "== $name: dagger check passes, warning: $message"
  output=$(cd "$scratch/$name" && dagger check --progress plain 2>&1) || {
    echo "$output" >&2
    return 1
  }
  grep -qF "$message" <<<"$output" || {
    echo "$output" >&2
    echo "missing: $message" >&2
    return 1
  }
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
passes_warning merge-with-change-file "comparing against HEAD^1"

fixture target-moved
add_change_file "$scratch/target-moved"
add_package_on_main "$scratch/target-moved"
merge_pull_request "$scratch/target-moved"
passes_warning target-moved "comparing against HEAD^1"

fixture empty-merge
revert_change "$scratch/empty-merge"
merge_pull_request "$scratch/empty-merge"
passes_warning empty-merge "comparing against HEAD^1"
(cd "$scratch/empty-merge" && dagger generate -y)
test ! -e "$scratch/empty-merge/change"

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

public_fixture public-without-change-file
fails_with public-without-change-file "Change files are needed"

public_fixture public-with-change-file
add_change_file "$scratch/public-with-change-file"
passes public-with-change-file
if grep -F refs/heads/main "$scratch/public-with-change-file/dagger.lock"; then
  echo "the remote branch is pinned in dagger.lock" >&2
  exit 1
fi
