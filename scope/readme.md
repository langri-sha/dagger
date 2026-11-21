# Scope

Resolve the Dagger checks affected by a pull request. Check out the merge commit
with both parents available before calling the module. On GitHub Actions, set
checkout's fetch depth to 2 for pull requests.

Declare the ordered scope rules in `dagger.toml`.

```toml
[modules.scope]
source = "github.com/langri-sha/dagger/scope@vX.Y.Z"

[[modules.scope.settings.rules]]
globs = ["**/*.md", "docs/**/*"]
affects = { checks = ["lint"] }

[[modules.scope.settings.rules]]
glob = "**"
affects = { checks = ["*"] }
```

```bash
dagger -m github.com/langri-sha/dagger/scope@vX.Y.Z call resolve-merge \
  --merge-sha="$GITHUB_SHA" --head-sha="$HEAD_SHA"
```

Set `HEAD_SHA` to the pull request's head SHA. The module verifies the checkout,
compares the merge commit to its first parent, and reads that parent's
`dagger.toml`. It discovers available checks from the workspace under test.
Changes to `dagger.toml`, missing configuration, or invalid rules select the
full suite.

Each rule has a `glob` string or a `globs` list. The first rule with any
matching pattern wins, including for dotfiles. Patterns support literal paths,
`*` within one path segment, and `**` as a whole segment. Use an explicit list
for alternatives. A trailing `/**` also matches the path before the slash, so
use `/**/*` for descendants only. Adjacent `**` segments and other unsupported
patterns run the full suite.

`affects.checks` names modules such as `terraform-web`, individual checks such
as `ruff/projects/lint`, or root checks such as `lint`. `--always=lint` includes
lint in every scoped run. The final rule must use `glob = "**"` or
`globs = ["**"]` and select `affects.checks = ["*"]`. The resolver ignores extra
rule metadata.

The result is JSON with an `args` array and a Markdown `summary`. Invoke
`dagger check` with those arguments. Run the full suite when the module errors
or returns an empty array.
