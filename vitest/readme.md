# vitest

Runs a [pnpm] workspace's [Vitest] suite with `pnpm exec vitest run`, using the
Vitest version the lock file installs, and fails on any failing test. It builds
on the [typescript] module's install of the workspace, so `prepare` scripts have
generated their files and the workspace's tools are on the `PATH`. `projects`
picks Vitest projects by name, and `filters` the test files, by substrings of
their paths. The default image is `node:24-slim`, like the typescript module's,
so the two share one install; it has no `git`, so a suite that runs it needs
`node:24`.

```toml
[modules.vitest]
source = "github.com/langri-sha/dagger/vitest@v1.2.0"

[modules.vitest.settings]
baseImageAddress = "node:24-slim" # default
projects = ["web"] # default: []
filters = ["functions/"] # default: []
```

[typescript]: ../typescript/readme.md
[vitest]: https://vitest.dev/
[pnpm]: https://pnpm.io/
