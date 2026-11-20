# Scope

Resolve the Dagger checks affected by a pull request. Check out the merge commit
with both parents available before calling the module. On GitHub Actions, set
checkout's fetch depth to 2 for pull requests.

```bash
dagger -m github.com/langri-sha/dagger/scope@vX.Y.Z call resolve-merge \
  --merge-sha="$GITHUB_SHA" --head-sha="$HEAD_SHA"
```

Set `HEAD_SHA` to the pull request's head SHA. The module verifies the checkout,
compares the merge commit to its first parent, and reads `ci/scope.json` from
that parent. It discovers available checks from the workspace under test.

`ci/scope.json` is an ordered array. Each rule has a Picomatch `glob` and an
`affects.checks` array of check selectors. A selector can name a module such as
`terraform-web`, an individual check such as `ruff/projects/lint`, or a root
check such as `lint`. `--always=lint` includes lint in every scoped run. Rules
use the first match for each path, including dotfiles. The final rule must use
`"glob": "**"` and `"checks": ["*"]`.

The result is JSON with an `args` array and a Markdown `summary`. Invoke
`dagger check` with those arguments. Run the full suite when the module errors
or returns an empty array.
