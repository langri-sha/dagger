#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
modules=$(dirname "$module")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local dir=$scratch/$1 environment=$2
  mkdir -p "$dir/modules/next" "$dir/modules/typescript"
  cp -r "$here/workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/modules/next/"
  cp "$modules/typescript/main.dang" "$modules/typescript/dagger-module.toml" "$dir/modules/typescript/"
  cat >"$dir/dagger.toml" <<EOF
[modules.site]
source = "modules/next"

[modules.site.settings]
app = "apps/site"
outDir = "dist"
environment = [$environment]
EOF
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

exports() {
  local name=$1 file=$2 content=$3
  echo "== $name: the build exports $file with: $content"
  (cd "$scratch/$name" && dagger call site build export --path "$scratch/$name-out")
  grep -qF "$content" "$scratch/$name-out/$file" || {
    echo "missing: $content" >&2
    return 1
  }
}

fixture builds '"GREETING=Hello from the fixture"'
passes builds
exports builds index.html "Hello from the fixture"
test ! -e "$scratch/builds-out/cache"

fixture missing-import '"GREETING=Hello from the fixture"'
printf "import missing from './missing'\n\nexport default function Page() {\n  return <p>{missing}</p>\n}\n" >"$scratch/missing-import/apps/site/app/page.jsx"
fails_with missing-import "Module not found"

fixture malformed-environment '"GREETING"'
fails_with malformed-environment "GREETING is not NAME=value."
