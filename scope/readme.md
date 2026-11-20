# Scope

Resolve the Dagger checks affected by a Git diff. CI supplies the rules from the
tested base commit and the check list from the workspace it will check.

```bash
git diff --name-status --no-renames -z "$base_sha" HEAD -- > changes
git show "$base_sha:ci/scope.json" > rules.json
dagger check -l -f link > checks

dagger -m github.com/langri-sha/dagger/scope@vX.Y.Z call resolve \
  --rules=rules.json --changes=changes --checks=checks
```

`ci/scope.json` is an ordered array. Each rule has a Picomatch `glob` and an
`affects.checks` array of check selectors. A selector can name a module such as
`terraform-web`, an individual check such as `ruff/projects/lint`, or a root
check such as `lint`. `--always=lint` includes lint in every scoped run. Rules
use the first match for each path, including dotfiles. The final rule must use
`"glob": "**"` and `"checks": ["*"]`.

The result is JSON with an `args` array and a Markdown `summary`. Invoke
`dagger check` with those arguments. An empty array means run every check,
including when the rules are invalid, a change matches `*`, or the rules file
itself changed.
