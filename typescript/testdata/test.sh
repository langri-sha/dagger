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
