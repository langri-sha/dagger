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
  local dir settings=${3:-}
  dir=$(workspace "$1")
  mkdir -p "$dir/ci-module"
  cp -r "$here/$2/." "$dir/"
  cp "$module/main.dang" "$module/dagger-module.toml" "$dir/ci-module/"
  printf '[modules.ci]\nsource = "ci-module"\n\n[modules.ci.settings]\n%s\n' "$settings" >"$dir/dagger.toml"
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

add_unfixed_files() {
  local dir
  dir=$(workspace "$1")
  cat >"$dir/src/unfixed.js" <<'EOF'
let greeting = "Hello";
export const unused = () => { let ignored = 1 }
export default greeting
EOF
  printf '*  one\n*  two\n' >"$dir/notes.md"
  git -C "$dir" add -A
  (cd "$dir" && commit -m "Add unfixed files")
}

break_eslint_config() {
  local dir
  dir=$(workspace "$1")
  printf 'export default [\n' >"$dir/eslint.config.js"
  (cd "$dir" && commit -am "Break the ESLint config")
}

change_greeting() {
  local dir
  dir=$(workspace "$1")
  printf 'export const greet = (name) => `Hi, ${name}!`\n' >"$dir/src/greeting.js"
  (cd "$dir" && commit -am "Change the greeting")
}

passes() {
  local name=$1 check=$2
  echo "== $name: $check passes"
  (cd "$(workspace "$name")" && dagger check "$check")
}

calls() {
  local name=$1 function=$2
  echo "== $name: dagger call ci $function"
  (cd "$(workspace "$name")" && dagger call -y ci "$function")
}

call_fails_with() {
  local name=$1 function=$2 message=$3 output
  echo "== $name: dagger call ci $function fails with: $message"
  if output=$(cd "$(workspace "$name")" && dagger call -y ci "$function" 2>&1); then
    echo "expected failure" >&2
    return 1
  fi
  grep -qF "$message" <<<"$output" || {
    echo "$output" >&2
    echo "missing: $message" >&2
    return 1
  }
}

unchanged() {
  local dir
  dir=$(workspace "$1")
  echo "== $1: unchanged"
  git -C "$dir" add -A
  git -C "$dir" diff --cached --exit-code -- . ':!dagger.lock'
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

fixture fixed node
calls fixed fix
unchanged fixed
calls fixed snapshots
unchanged fixed

fixture unfixed node
add_unfixed_files unfixed
calls unfixed fix
diff - "$(workspace unfixed)/src/unfixed.js" <<'EOF'
const greeting = 'Hello'
export const unused = () => {
  const ignored = 1
}
export default greeting
EOF
diff - "$(workspace unfixed)/notes.md" <<'EOF'
- one
- two
EOF

fixture broken-eslint-config node
break_eslint_config broken-eslint-config
call_fails_with broken-eslint-config fix "eslint --fix failed (exit 2)"

fixture without-eslint-and-prettier projen
calls without-eslint-and-prettier fix
unchanged without-eslint-and-prettier

fixture changed-greeting node
change_greeting changed-greeting
calls changed-greeting snapshots
grep -qF '"Hi, world!"' "$(workspace changed-greeting)/src/__snapshots__/greeting.test.js.snap"

fixture image-without-git node 'baseImageAddress = "node:24-slim"'
call_fails_with image-without-git snapshots "spawnSync git ENOENT"

fixture without-vitest projen
calls without-vitest snapshots
unchanged without-vitest
