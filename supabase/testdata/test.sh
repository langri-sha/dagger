#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local dir=$scratch/$1
  mkdir -p "$dir/modules/supabase"
  cp -r "$here/workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$module/Dockerfile" "$dir/modules/supabase/"
  printf '[modules.supabase]\nsource = "modules/supabase"\nentrypoint = true\n' >"$dir/dagger.toml"
}

calls() {
  local name=$1 expected=$2 output
  shift 2
  echo "== $name: dagger call $* prints $expected"
  output=$(cd "$scratch/$name" && dagger call "$@")
  [[ $output == "$expected" ]] || {
    echo "got: $output" >&2
    return 1
  }
}

call_fails_with() {
  local name=$1 message=$2 output
  shift 2
  echo "== $name: dagger call $* fails with: $message"
  if output=$(cd "$scratch/$name" && dagger call "$@" 2>&1); then
    echo "expected failure" >&2
    return 1
  fi
  grep -qF "$message" <<<"$output" || {
    echo "$output" >&2
    echo "missing: $message" >&2
    return 1
  }
}

export NOT_A_TOKEN=not-a-token

fixture project
calls project abcdefghijklmnopqrst project-ref
call_fails_with project "Invalid access token format" migrate --token=env:NOT_A_TOKEN
call_fails_with project "Invalid access token format" deploy --token=env:NOT_A_TOKEN

fixture without-project-id
printf '[api]\nenabled = true\n' >"$scratch/without-project-id/supabase/config.toml"
call_fails_with without-project-id "supabase/config.toml must set project_id" project-ref
