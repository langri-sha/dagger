#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT


fixture() {
  local dir=$scratch/$1
  mkdir -p "$dir/modules/typescript" "$dir/modules/probe"
  cp -r "$here/workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/modules/typescript/"
  cp "$here/probe/main.dang" "$dir/modules/probe/"
  {
    sed '/^name = /s/typescript/probe/' "$module/dagger-module.toml"
    printf '\n[[dependencies]]\nsource = "../typescript"\n'
  } >"$dir/modules/probe/dagger-module.toml"
  printf '[modules.typescript]\nsource = "modules/typescript"\n\n[modules.probe]\nsource = "modules/probe"\n' >"$dir/dagger.toml"
}

check_fixture() {
  local dir=$scratch/$1 settings=${2:-}
  mkdir -p "$dir/modules/typescript"
  cp -r "$here/publishable/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/modules/typescript/"
  printf '[modules.typescript]\nsource = "modules/typescript"\n%s' "$settings" >"$dir/dagger.toml"
}

prepublish_on=$'\n[modules.typescript.settings]\nprepublish = true\n'

publishable_passes() {
  local name=$1
  echo "== $name: publishable passes"
  (cd "$scratch/$name" && dagger check typescript:publishable >"$scratch/$name.log" 2>&1)
}

publishable_fails() {
  local name=$1 reason=$2
  echo "== $name: publishable fails on $reason"
  if (cd "$scratch/$name" && dagger check typescript:publishable >"$scratch/$name.log" 2>&1); then
    echo "publishable passed" >&2
    return 1
  fi
  grep -q "$reason" "$scratch/$name.log" || {
    echo "no $reason in the log" >&2
    return 1
  }
}

read_file() {
  local name=$1 path=$2
  (cd "$scratch/$name" && dagger call -y typescript base file --path "$path" contents 2>"$scratch/$name.log")
}

expects() {
  local name=$1 path=$2 content=$3 actual
  echo "== $name: $path is: $content"
  actual=$(read_file "$name" "$path")
  [ "$actual" = "$content" ] || {
    echo "got: $actual" >&2
    return 1
  }
}

dependency_layers() {
  local name=$1 expected=$2 exec id
  (cd "$scratch/$name" && dagger --progress=plain -vv call -y typescript base file --path /src/packages/app/generated.txt contents >"$scratch/$name.log" 2>&1)
  for exec in 'pnpm install --frozen-lockfile --ignore-scripts' 'pnpm rebuild'; do
    echo "== $name: $exec is $expected"
    id=$(grep -m1 -E "┆ withExec $exec\$" "$scratch/$name.log" | awk '{print $1}')
    if grep -qE "^$id +: ┆ Container.withExec CACHED" "$scratch/$name.log"; then
      [ "$expected" = cached ] || {
        echo "$exec was cached" >&2
        return 1
      }
    else
      [ "$expected" = rerun ] || {
        echo "$exec reran" >&2
        return 1
      }
    fi
  done
}

builds_esbuild() {
  local name=$1 magic
  echo "== $name: esbuild's postinstall replaced its launcher with the binary"
  magic=$(cd "$scratch/$name" && dagger call -y typescript base with-exec --args node,packages/app/launcher.js stdout 2>"$scratch/$name.log")
  [ "$magic" = ELF ] || {
    echo "got: $magic" >&2
    return 1
  }
}

edit() {
  local name=$1 path=$2
  printf '%s\n' "$3" >"$scratch/$name/$path"
}

fixture workspace
builds_esbuild workspace
expects workspace packages/app/generated.txt 'HELLO FROM SOURCE'

edit workspace packages/app/src/message.txt 'changed source'
expects workspace packages/app/generated.txt 'CHANGED SOURCE'
edit workspace packages/app/src/message.txt 'changed again'
dependency_layers workspace cached
builds_esbuild workspace

printf '\n# changed install input\n' >>"$scratch/workspace/pnpm-workspace.yaml"
dependency_layers workspace rerun

echo "== workspace: the scripts rerun offline against an emptied store volume"
(cd "$scratch/workspace" && dagger call -y probe reinstall --empty-store-key "$(date +%s)-$$" file --path /src/packages/app/generated.txt contents >/dev/null)

check_fixture prepublished "$prepublish_on"
publishable_passes prepublished

edit prepublished packages/scripted/prepublish.js "process.exit(1)"
publishable_fails prepublished 'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL'

check_fixture rooted "$prepublish_on"
edit rooted package.json '{"name": "fixture", "private": true, "packageManager": "pnpm@12.16.1", "scripts": {"prepublishOnly": "exit 1"}}'
publishable_fails rooted 'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL'

check_fixture jsii_incompatible "$prepublish_on"
edit jsii_incompatible packages/library/src/index.ts 'export class Greeter { public greet(extra: Map<string, string>): void {} }'
publishable_fails jsii_incompatible 'JSII3001'

check_fixture jsii_malformed "$prepublish_on"
edit jsii_malformed packages/scripted/prepublish.js "import { writeFileSync } from 'node:fs'; writeFileSync('.jsii', '{}')"
publishable_fails jsii_malformed 'exit code: 123'

check_fixture opted_out
edit opted_out packages/scripted/prepublish.js "process.exit(1)"
publishable_passes opted_out
