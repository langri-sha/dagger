#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
module=$(dirname "$here")
modules=$(dirname "$module")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

fixture() {
  local dir=$scratch/$1 environment=$2 settings=${3:-}
  mkdir -p "$dir/modules/next" "$dir/modules/typescript"
  cp -r "$here/workspace/." "$dir/"
  git -C "$dir" init --quiet
  cp "$module/main.dang" "$module/dagger-module.toml" "$module/build-with-secrets.sh" "$dir/modules/next/"
  cp "$modules/typescript/main.dang" "$modules/typescript/dagger-module.toml" "$dir/modules/typescript/"
  cat >"$dir/dagger.toml" <<EOF
[modules.site]
source = "modules/next"

[modules.site.settings]
app = "apps/site"
outDir = "dist"
environment = [$environment]
$settings
EOF
}

passes() {
  local name=$1
  echo "== $name: dagger check passes"
  (cd "$scratch/$name" && dagger check 2>&1 | tee "$scratch/$name.log"; exit "${PIPESTATUS[0]}")
}

fails_with() {
  local name=$1 message=$2 output
  echo "== $name: dagger check fails with: $message"
  if output=$(cd "$scratch/$name" && dagger check 2>&1); then
    echo "expected failure" >&2
    return 1
  fi
  printf '%s\n' "$output" >"$scratch/$name.log"
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

mounts_cache() {
  local name=$1 key=$2 output
  echo "== $name: the build mounts the cache volume $key"
  output=$(cd "$scratch/$name" && dagger --progress=plain -vvv check 2>&1)
  grep -qF "cacheVolume(key: \"$key\"" <<<"$output" || {
    echo "$output" >&2
    echo "missing: $key" >&2
    return 1
  }
}

fixture builds '"GREETING=Hello from the fixture"'
passes builds
mounts_cache builds next-apps/site
exports builds index.html "Hello from the fixture"
test ! -e "$scratch/builds-out/cache"

fixture keyed-cache '"GREETING=Hello from the fixture"' 'cacheKey = "site-docs"'
mounts_cache keyed-cache next-site-docs

secret_page() {
  printf "export default function Page() {\n  return <p>{process.env.API_TOKEN ? 'token loaded' : 'token missing'}</p>\n}\n" >"$scratch/$1/apps/site/app/page.jsx"
}

secret_env_fixture() {
  local name=$1
  fixture "$name" '"GREETING=Hello from the fixture"' "secretEnvFile = \"file:$scratch/$name.env\""
  secret_page "$name"
}

omits() {
  local name=$1 content=$2
  echo "== $name: the log and output leave out: $content"
  if grep -rqF "$content" "$scratch/$name.log" "$scratch/$name-out" 2>/dev/null; then
    echo "found: $content" >&2
    return 1
  fi
}

printf '# build secrets\n\nAPI_TOKEN=s3cret value=with-equals\nOTHER=1\n' >"$scratch/secret-env.env"
secret_env_fixture secret-env
passes secret-env
exports secret-env index.html "token loaded"
omits secret-env "s3cret value"

printf 'API_TOKEN=a\nnot a pair\n' >"$scratch/malformed-secret-env.env"
secret_env_fixture malformed-secret-env
fails_with malformed-secret-env "secretEnvFile line 2 is not NAME=value."
omits malformed-secret-env "not a pair"

printf '# nothing\n\n' >"$scratch/empty-secret-env.env"
secret_env_fixture empty-secret-env
fails_with empty-secret-env "secretEnvFile has no NAME=value lines."

standalone_fixture() {
  fixture "$1" '"GREETING=Hello from the fixture"' "${2:-}"
  sed -i 's|outDir = "dist"|outDir = ".next"|' "$scratch/$1/dagger.toml"
  printf "export default {\n  output: 'standalone',\n}\n" >"$scratch/$1/apps/site/next.config.mjs"
}

runs_in_image() {
  local name=$1 script=$2 output
  shift 2
  output=$(cd "$scratch/$name" && dagger call site runtime with-exec --args=sh --args=-c --args="$script" stdout)
  printf '%s' "$output"
}

image_prints() {
  local name=$1 expected=$2 script=$3 output
  echo "== $name: the runtime image prints: $expected"
  output=$(runs_in_image "$name" "$script")
  grep -qF "$expected" <<<"$output" || {
    echo "got: $output" >&2
    echo "missing: $expected" >&2
    return 1
  }
}

standalone_fixture standalone
serve_and_fetch() {
  printf "node server.js >/dev/null 2>&1 & sleep 3; node -e 'fetch(\`http://127.0.0.1:3000%s\`).then(r => r.text()).then(console.log)'" "$1"
}

image_prints standalone "Hello from the fixture" "$(serve_and_fetch /)"
image_prints standalone "public file" "$(serve_and_fetch /notice.txt)"
image_prints standalone "node" "id -un"
image_prints standalone "no source" "test ! -e /src && echo no source"

printf 'API_TOKEN=s3cret value=with-equals\n' >"$scratch/secret-standalone.env"
standalone_fixture secret-standalone "secretEnvFile = \"file:$scratch/secret-standalone.env\""
secret_page secret-standalone
image_prints secret-standalone "token loaded" "$(serve_and_fetch /)"
image_prints secret-standalone "no secret" "grep -rqF 's3cret value' /app && echo leaked || echo no secret"

overlay_fixture() {
  local name=$1
  "${2:-fixture}" "$name" "${@:3}"
  mkdir -p "$scratch/$name/overlay/public/stories"
  printf 'overlaid page\n' >"$scratch/$name/overlay/public/stories/index.txt"
}

overlay_fixture overlaid standalone_fixture 'overlay = "overlay"'
image_prints overlaid "overlaid page" "$(serve_and_fetch /stories/index.txt)"

overlay_fixture overlaid-export fixture '"GREETING=Hello from the fixture"' 'overlay = "overlay"'
exports overlaid-export stories/index.txt "overlaid page"

echo "== builds: dagger call runtime fails without a standalone output"
if output=$(cd "$scratch/builds" && dagger call site runtime 2>&1); then
  echo "expected failure" >&2
  exit 1
fi
grep -qF 'dist/standalone is missing: set output to "standalone"' <<<"$output" || {
  echo "$output" >&2
  exit 1
}

fixture missing-import '"GREETING=Hello from the fixture"'
printf "import missing from './missing'\n\nexport default function Page() {\n  return <p>{missing}</p>\n}\n" >"$scratch/missing-import/apps/site/app/page.jsx"
fails_with missing-import "Module not found"

fixture malformed-environment '"GREETING"'
fails_with malformed-environment "GREETING is not NAME=value."
