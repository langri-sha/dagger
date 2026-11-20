#!/usr/bin/env bash
set -euo pipefail

module=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/rules.json" <<'JSON'
[
  {"glob":"ci/**","affects":{"checks":["*"]}},
  {"glob":"terraform/web/**","affects":{"checks":["terraform-web/validate"]}},
  {"glob":"terraform/**","affects":{"checks":["terraform-placement"]}},
  {"glob":"**","affects":{"checks":["*"]}}
]
JSON

cat >"$scratch/checks" <<'EOF_CHECKS'
dag+check://?check=lint
dag+check://?check=terraform-web/test
dag+check://?check=terraform-web/validate
dag+check://?check=terraform-placement/fmt
dag+check://?check=terraform-placement/test
EOF_CHECKS

resolve() {
  dagger -m "$module" call resolve \
    --rules="$scratch/rules.json" \
    --changes="$scratch/changes" \
    --checks="$scratch/checks" "$@"
}

printf 'D\0terraform/web/.terraform.lock.hcl\0A\0terraform/new input.tf\0' >"$scratch/changes"
resolve --always=lint | jq -e '
  .args == ["--check", "lint", "--check", "terraform-placement/fmt",
            "--check", "terraform-placement/test", "--check", "terraform-web/validate"]
  and (.summary | contains("terraform/web/**"))
' >/dev/null

printf 'M\0terraform/web/main.tf\0A\0new/file\0' >"$scratch/changes"
resolve | jq -e '.args == []' >/dev/null

printf 'M\0ci/scope.json\0' >"$scratch/changes"
resolve | jq -e '.args == [] and (.summary | contains("manifest changed"))' >/dev/null

printf 'M\0terraform/web/main.tf\0' >"$scratch/changes"
resolve --always=missing | jq -e '.args == [] and (.summary | contains("matches missing"))' >/dev/null

printf 'M\0terraform/web/main.tf' >"$scratch/changes"
resolve | jq -e '.args == [] and (.summary | contains("Incomplete changed path list"))' >/dev/null
