# projen

Synthesizes a [projen] project in a [pnpm] workspace with the projen the lock
file installs. Its `synth` generator synthesizes, installs with the lock file
unfrozen, synthesizes again and installs once more, so an upgraded projen
component writes its own output and the lock file follows what synthesis
changed. The first synthesis skips post-synthesis, which in CI installs with a
frozen lock file. Between the steps, corepack switches to a pnpm version that
synthesis bumped in `packageManager`. Node stays at `baseImageAddress`, with git
and CA certificates installed on top, which the slim image lacks.

`dagger check` runs it as `projen/synth/stale`, which fails when synthesis or
the lock file refresh would change a file git tracks. projen's tasks are left to
the [typescript] and [vitest] modules and to ESLint's. Apply its changes from
the workspace root:

```sh
dagger generate -y projen
```

It builds on the [typescript] module's install of the workspace and uses that
module's pnpm store. Both default to `node:24-slim`, so with the defaults
`dagger check` installs the workspace once for the two.

```toml
[modules.projen]
source = "github.com/langri-sha/dagger/projen@v1.5.0"

[modules.projen.settings]
baseImageAddress = "node:24-slim" # default
```

[typescript]: ../typescript/readme.md
[vitest]: ../vitest/readme.md
[projen]: https://projen.io/
[pnpm]: https://pnpm.io/
