#!/usr/bin/env bash
set -euo pipefail

module=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

git init -q -b main "$scratch/repo"
cd "$scratch/repo"
git config user.name Fixture
git config user.email fixture@example.com

mkdir -p ci terraform/web
cat >dagger.toml <<'TOML'
[modules.fixture]
source = "."
main = true

[modules.terraform-placement]
source = "placement"
TOML

cat >dagger-module.toml <<'TOML'
name = "fixture"
engineVersion = "v1.0.0-beta.28"
[runtime]
source = "dang"
TOML

cat >main.dang <<'DANG'
type Fixture {
  pub lint: Void @check {}
  pub validate: Void @check {}
}
DANG

mkdir placement
sed 's/"fixture"/"placement"/' dagger-module.toml >placement/dagger-module.toml
cat >placement/main.dang <<'DANG'
type Placement {
  pub fmt: Void @check {}
  pub test: Void @check {}
}
DANG

cat >ci/scope.json <<'JSON'
[
  {"glob":"ci/**","affects":{"checks":["*"]}},
  {"globs":["terraform/web/.terraform.lock.hcl","**/*.md","docs/**/*"],"affects":{"checks":["validate"]}},
  {"glob":"terraform/**","affects":{"checks":["terraform-placement"]}},
  {"glob":"**","affects":{"checks":["*"]}}
]
JSON

printf 'base\n' >terraform/web/.terraform.lock.hcl
git add .
git commit -qm Base
git switch -qc pr
git mv terraform/web/.terraform.lock.hcl 'terraform/new input.tf'
printf 'readme\n' >README.md
git add README.md
git commit -qm Rename
git commit --allow-empty -qm "Advance PR head"
git switch -q main
git merge -q --no-ff --no-edit pr

resolve() (
  checkout=$1
  shift
  cd "$checkout"
  dagger -m "$module" call resolve-merge \
    --merge-sha="$(git rev-parse HEAD)" \
    --head-sha="$(git rev-parse HEAD^2)" "$@"
)

git clone -q --depth 2 "file://$scratch/repo" "$scratch/shallow"
resolve "$scratch/shallow" --always=lint | jq -e '
  .args == ["--check", "lint", "--check", "terraform-placement/fmt",
            "--check", "terraform-placement/test", "--check", "validate"]
  and (.summary | contains("terraform/web/.terraform.lock.hcl"))
' >/dev/null

resolve "$scratch/shallow" --always=missing | jq -e '
  .args == [] and (.summary | contains("matches missing"))
' >/dev/null

resolve "$scratch/shallow" --head-sha="$(git rev-parse HEAD^1)" | jq -e '
  .args == [] and (.summary | contains("does not match the expected pull request merge commit"))
' >/dev/null

git switch -qc change-rules
printf 'invalid json\n' >ci/scope.json
git commit -qam "Change scope rules"
git switch -q main
git merge -q --no-ff --no-edit change-rules

resolve "$scratch/repo" | jq -e '
  .args == [] and (.summary | contains("manifest changed"))
' >/dev/null

for unsupported in '{docs/**,notes/**}' 'docs/**/**'; do
  git switch -q --detach pr
  jq --arg pattern "$unsupported" '.[1].globs[-1] = $pattern' ci/scope.json >"$scratch/rules.json"
  cp "$scratch/rules.json" ci/scope.json
  git commit -qam "Use an unsupported pattern"
  base=$(git rev-parse HEAD)

  printf 'notes\n' >README.md
  git commit -qam "Change Markdown"
  head=$(git rev-parse HEAD)
  git switch -q --detach "$base"
  git merge -q --no-ff --no-edit "$head"

  resolve "$scratch/repo" | jq -e '
    .args == [] and (.summary | contains("Unsupported scope glob"))
  ' >/dev/null
done
