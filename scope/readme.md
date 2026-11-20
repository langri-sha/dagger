# Scope

Resolve the Dagger checks affected by a pull request. Check out the merge commit
with both parents available before calling the module. On GitHub Actions, set
checkout's fetch depth to 2 for pull requests.

Declare the manifest path relative to the repository root in `dagger.toml`.

```toml
[modules.scope]
source = "github.com/langri-sha/dagger/scope@vX.Y.Z"

[modules.scope.settings]
manifest = "policies/dagger-checks.json"
```

```bash
dagger -m github.com/langri-sha/dagger/scope@vX.Y.Z call resolve-merge \
  --merge-sha="$GITHUB_SHA" --head-sha="$HEAD_SHA"
```

Set `HEAD_SHA` to the pull request's head SHA. The module verifies the checkout,
compares the merge commit to its first parent, and reads both `dagger.toml` and
the configured manifest from that parent. It discovers available checks from the
workspace under test. Changes to either file, missing configuration, or invalid
rules select the full suite.

The manifest is a JSON array. Each rule has a `glob` string or a `globs` list.
The first rule with any matching pattern wins, including for dotfiles. Patterns
support literal paths, `*` within one path segment, and `**` as a whole segment.
Use an explicit list for alternatives. A trailing `/**` also matches the path
before the slash, so use `/**/*` for descendants only. Adjacent `**` segments
and other unsupported patterns run the full suite.

`affects.checks` names modules such as `terraform-web`, individual checks such
as `ruff/projects/lint`, or root checks such as `lint`. `--always=lint` includes
lint in every scoped run. The final rule must use `"glob": "**"` or
`"globs": ["**"]` and select `"checks": ["*"]`.

The result is JSON with an `args` array and a Markdown `summary`. Invoke
`dagger check` with those arguments. Run the full suite when the module errors
or returns an empty array.
