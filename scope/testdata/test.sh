#!/usr/bin/env bash
set -euo pipefail

module=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

git init -q -b main "$scratch/repo"
cd "$scratch/repo"
git config user.name Fixture
git config user.email fixture@example.com

mkdir -p scope terraform/web
cp "$module"/{dagger-module.toml,main.dang} scope/
cat >dagger.toml <<'TOML'
[modules.fixture]
source = "."
main = true

[modules.terraform-placement]
source = "placement"

[modules.scope]
source = "scope"

[[modules.scope.settings.rules]]
globs = ["terraform/web/.terraform.lock.hcl", "docs/**/*"]
affects = { apps = ["web"], checks = ["validate"] }
reason = "Validate lock files and documentation."
source = "dagger.toml"

[[modules.scope.settings.rules]]
glob = "**/*.md"
affects = { checks = [] }

[[modules.scope.settings.rules]]
glob = "terraform/**"
affects.checks = ["terraform-placement"]

[[modules.scope.settings.rules]]
glob = "**"
[modules.scope.settings.rules.affects]
checks = ["*"]
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
scoped='
  .args == ["--check", "lint", "--check", "terraform-placement/fmt",
            "--check", "terraform-placement/test", "--check", "validate"]
  and (.summary | contains("terraform/web/.terraform.lock.hcl"))
'
resolve "$scratch/shallow" --always=lint | jq -e "$scoped" >/dev/null
(
  cd "$scratch/shallow"
  dagger call scope resolve-merge --always=lint \
    --merge-sha="$(git rev-parse HEAD)" --head-sha="$(git rev-parse HEAD^2)"
) | jq -e "$scoped" >/dev/null

resolve "$scratch/shallow" --always=missing | jq -e '
  .args == [] and (.summary | contains("matches missing"))
' >/dev/null

resolve "$scratch/shallow" --head-sha="$(git rev-parse HEAD^1)" | jq -e '
  .args == [] and (.summary | contains("does not match the expected pull request merge commit"))
' >/dev/null

git switch -qc change-rules
sed -i 's/checks = \["validate"\]/checks = ["lint"]/' dagger.toml
git commit -qam "Change scope rules"
git switch -q main
git merge -q --no-ff --no-edit change-rules

resolve "$scratch/repo" | jq -e '
  .args == [] and (.summary | contains("dagger.toml changed"))
' >/dev/null

mergeMarkdownChange() {
  local base head
  git commit -qam "$1"
  base=$(git rev-parse HEAD)

  printf 'notes\n' >README.md
  git commit -qam "Change Markdown"
  head=$(git rev-parse HEAD)
  git switch -q --detach "$base"
  git merge -q --no-ff --no-edit "$head"
}

git switch -q --detach pr
sed -i '/^\[\[modules.scope.settings.rules\]\]/,$d' dagger.toml
mergeMarkdownChange "Remove scope rules"

resolve "$scratch/repo" | jq -e '
  .args == [] and (.summary | contains("missing required field"))
' >/dev/null

git switch -q --detach pr
sed -i 's/checks = \["validate"\]/checks = "validate"/' dagger.toml
mergeMarkdownChange "Use an invalid check list"

resolve "$scratch/repo" | jq -e '
  .args == [] and (.summary | contains("affects.checks"))
' >/dev/null

for unsupported in '{docs/**,notes/**}' 'docs/**/**'; do
  git switch -q --detach pr
  sed -i "s@docs/[*][*]/[*]@$unsupported@" dagger.toml
  mergeMarkdownChange "Use an unsupported pattern"

  resolve "$scratch/repo" | jq -e '
    .args == [] and (.summary | contains("Unsupported scope glob"))
  ' >/dev/null
done
