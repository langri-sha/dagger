# actionlint

Lints the workflows in `.github/workflows` with [actionlint], which also checks
the local actions they use against their `action.yml` and runs [ShellCheck] on
their `run:` scripts. It reads `.github/actionlint.yaml` when there is one. The
module's `Dockerfile` pins the actionlint image, and Renovate updates it there.

```toml
[modules.actionlint]
source = "github.com/langri-sha/dagger/actionlint@v1.1.0"
```

[actionlint]: https://github.com/rhysd/actionlint
[shellcheck]: https://www.shellcheck.net/
