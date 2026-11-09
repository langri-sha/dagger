# next

Builds a [Next.js] app in a [pnpm] workspace with the `next` the lock file
installs, keeping Next's build cache between runs, and returns the build output;
`dagger check` checks that it builds. It builds on the [typescript] module's
install of the workspace. Install it once per app.

```toml
[modules.web]
source = "github.com/langri-sha/dagger/next@v1.1.0"

[modules.web.settings]
app = "apps/web" # default: .
baseImageAddress = "node:24-slim" # default
outDir = "dist" # default: .next
environment = ["ASSETS_URL=https://assets.example.com"] # default: []
cacheKey = "web-docs" # default: the app
secretEnvFile = "op://vault/web-build/env" # default: none
overlay = "build/web-overlay" # default: none
```

Next's build cache depends on the app's `basePath`. Installs of the module that
build one app with different base paths need different `cacheKey`s, so they
don't share, and keep invalidating, one cache volume.

`secretEnvFile` is a `Secret` whose value is dotenv lines: `NAME=value`, with
blank lines and `#` comments allowed. The setting takes the provider URI
(`env://`, `file://`, `op://`, `cmd://`), not the lines. The build reads the
lines as data, not shell, and exports them in the exec that runs `next build`,
from a mounted secret, so they never reach a layer, and the module logs nothing
from them. It fails when the secret has no lines or a line isn't `NAME=value`,
naming the line by number. The secret's value is part of that exec's cache key,
so changing it rebuilds. What the build itself prints or writes to the output is
outside the module's control.

`overlay` is a directory laid over the app's directory after the install and
before the build, such as a Storybook build under `public/storybook` for the app
to serve. It reaches the build output, and the `runtime` image's `public`.

`runtime` returns a slim image that serves a build whose Next config sets
`output: "standalone"`: the traced server, the static assets and `public`, run
with `node server.js` as `node` on `node:24-slim`, listening on `PORT` (3000).
It fails when the build has no standalone output. The image carries nothing of
`secretEnvFile` except what the build itself writes into the output.

```sh
dagger call web runtime --runtime-image-address=node:24-slim publish --address=ghcr.io/acme/web:latest
```

[typescript]: ../typescript/readme.md
[next.js]: https://nextjs.org/docs
[pnpm]: https://pnpm.io/
