# typescript

Type-checks a [pnpm] workspace's project references with `tsc --build`, using
the [TypeScript] version the lock file installs. `projects` lists what to build,
for tsconfig files the root one doesn't reference.

The install runs in layers: the lock file, pnpm's settings, patches and every
workspace manifest install the dependencies and build them, and only then comes
the rest of the source, where `pnpm rebuild --pending` runs the workspace's own
lifecycle scripts. An edit to any other file reuses the dependency layers.

The `publishable` check runs every package's `prepublishOnly` script, the
workspace root's too, as publishing would, so a build that only fails at release
fails the pull request, then validates each `.jsii` they write with `jsii-tree`.
It does nothing unless `prepublish` is set, since those scripts build and may
have side effects.

```toml
[modules.typescript]
source = "github.com/langri-sha/dagger/typescript@v1.0.0"

[modules.typescript.settings]
baseImageAddress = "node:24-slim" # default
projects = ["."] # default
prepublish = false # default
```

[typescript]: https://www.typescriptlang.org/docs/
[pnpm]: https://pnpm.io/
