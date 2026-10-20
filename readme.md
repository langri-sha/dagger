<p align="center">
  <img src="docs/assets/dagger.svg" width="220" alt="Interlocking modules feeding a dagger-shaped automation pipeline">
</p>

<h1 align="center">dagger</h1>

<p align="center">
  Reusable Dagger modules.
</p>

## Modules

Each module is a [Dang](https://docs.dagger.io/reference/sdks/dang) module for
Dagger 1.0, released together under one `v<version>` tag.

### actionlint

Lints the workflows in `.github/workflows` with actionlint, which also checks
the local actions they use against their `action.yml` and runs shellcheck on
their `run:` scripts. It reads `.github/actionlint.yaml` when there is one. The
module's `Dockerfile` pins the actionlint image, and Renovate updates it there.

```toml
[modules.actionlint]
source = "github.com/langri-sha/dagger/actionlint@v1.1.0"
```

### beachball

Checks that every changed package in a pnpm workspace has a Beachball change
file, and writes the missing ones with `message` and `type`. Beachball compares
HEAD to its merge base with the base branch. The module takes both from
`.merge-base`, which langri-sha/github's `merge-base` action writes from a
shallow checkout, and never reads the checkout's history. Without `.merge-base`,
the check and the generator fail.

A change to a pnpm catalog would demand change files from every package that
uses it: Beachball reads `pnpm-workspace.yaml` at the base, and `.merge-base`
doesn't carry it.

Change files carry `authorEmail`, which changelogs credit each change to.
Without it, they say `email not defined`, as the ones langri-sha/github's
post-upgrade job writes do, and changelogs leave the author out.

```toml
[modules.beachball]
source = "github.com/langri-sha/dagger/beachball@v1.0.0"

[modules.beachball.settings]
baseImageAddress = "node:24" # default
authorEmail = "renovate@example.com" # default: unset
```

### cargo

Checks a Cargo workspace — formatting, Clippy with warnings as errors, and tests
— and keeps `Cargo.lock` in step with the manifests.

```toml
[modules.cargo]
source = "github.com/langri-sha/dagger/cargo@v1.0.0"

[modules.cargo.settings]
baseImageAddress = "rust:1-slim" # default
```

### ci

Generators and fixes for pnpm workspaces that Dagger's official modules don't
cover: the generators re-run projen and tidy the `package.json` files, `fix`
applies ESLint and Prettier fixes, and `snapshots` updates Vitest snapshots.
Type-checking is in [typescript](#typescript).

`projen` runs the steps of the [projen](#projen) module's `synth` on `ci`'s
install of the workspace. It stays for workspaces that generate `ci/projen`, as
langri-sha/github's `check.yml` does. A workspace that installs the projen
module skips it, which drops it from `dagger check` too, so the two don't write
the same files:

```toml
[modules.ci.generate]
skip = ["projen"]
```

`fix` runs `eslint --fix .` and then `prettier --write .`, each when the
workspace installs it, at the version its lock file pins. Problems ESLint can't
fix are left to the [eslint](https://github.com/dagger/eslint) module's check.
It's a function rather than a generator, since a generator's stale check would
repeat that check and [prettier](https://github.com/dagger/prettier)'s. Apply
its changes from the workspace root:

```sh
dagger call -y ci fix
```

`snapshots` runs `vitest run --update --passWithNoTests` when the workspace
installs Vitest, so it accepts every snapshot that changed. It runs the whole
suite in the `baseImageAddress` container, without the
[vitest](https://github.com/dagger/vitest) module's build step, extra files or
Dagger session. The default `node:24` ships git for suites that run it; a slim
image doesn't. Like `fix`, it's a function, applied from the workspace root:

```sh
dagger call -y ci snapshots
```

Every generator reads the same tree. A single `dagger generate` applies nothing
when two of them change one file, as `projen` and `packages` can both rewrite a
`package.json`. The post-upgrade job in langri-sha/github's `check.yml` ran its
fixes in order, each on the previous one's output. To do the same, call the
fixes and then run one generator at a time, after the merge-base action that
[beachball](#beachball) needs:

```sh
dagger call -y ci fix
dagger call -y ci snapshots
dagger generate -y ci/projen
dagger generate -y ci/packages
dagger generate -y uv
dagger generate -y beachball/change
```

Checking for changes, uploading the patch and pushing it with the App token stay
in GitHub Actions.

```toml
[modules.ci]
source = "github.com/langri-sha/dagger/ci@v1.0.0"

[modules.ci.settings]
baseImageAddress = "node:24" # default
```

### next

Builds a Next.js app in a pnpm workspace with the `next` the lock file installs,
keeping Next's build cache between runs, and returns the build output;
`dagger check` checks that it builds. It builds on the [typescript](#typescript)
module's install of the workspace. Install it once per app.

```toml
[modules.web]
source = "github.com/langri-sha/dagger/next@v1.1.0"

[modules.web.settings]
app = "apps/web" # default: .
baseImageAddress = "node:24-slim" # default
outDir = "dist" # default: .next
environment = ["ASSETS_URL=https://assets.example.com"] # default: []
```

### nginx

Builds an nginx image from a Docker context and checks it as a JSON spec
declares. `config` runs `nginx -t` through the image's entrypoint, so its
templates are rendered. `responses` runs each scenario: the image as a service,
the requests sent to it, and its stdout and stderr, as `docker logs` shows them.

A scenario can add echo upstreams: nginx answering every request with fixed
headers and a body, under the hostnames it names, over HTTPS with a self-signed
certificate that the image's CA bundle can trust. `resolver` names the variable
the image's `resolver` directive reads, and points it at a DNS server that
answers those hostnames, as Docker's embedded DNS does. `content` adds built
files to the context, such as a static export from [next](#next) through a
`dag://` link, and `${NAME}` in the spec takes its value from `variables`.

```toml
[modules.web-image]
source = "github.com/langri-sha/dagger/nginx@v1.3.0"

[modules.web-image.settings]
context = "apps/web"
spec = "apps/web/nginx.json"
content = "dag://web/build" # default: none
contentPath = "dist" # default: .
dockerfile = "Dockerfile" # default
buildArgs = [] # default
variables = ["BASE_PATH=/pull/7"] # default: []
```

```json
{
  "port": 8080,
  "environment": ["PORT=8080"],
  "scenarios": [
    {
      "name": "proxy",
      "environment": ["UPSTREAM_HOST=upstream"],
      "resolver": "RESOLVER",
      "upstreams": [
        {
          "hostnames": ["upstream"],
          "tls": true,
          "trusted": true,
          "headers": ["set-cookie: a=1"],
          "body": "$request_method $request_uri host=$host"
        }
      ],
      "requests": [
        {
          "method": "GET",
          "path": "/proxy/hello",
          "headers": ["cookie: session=secret"],
          "status": 200,
          "body": "GET /hello host=upstream",
          "bodyContains": ["host=upstream"],
          "responseHeaders": ["x-content-type-options: nosniff"],
          "absentHeaders": ["set-cookie"]
        }
      ],
      "logContains": ["GET /proxy/hello"],
      "logExcludes": ["session=secret"]
    }
  ]
}
```

`port` can be left out when the image exposes a single port. Paths are sent as
they are, `..` included, and response headers match ignoring case.

A check run through `dagger call` exits 0 even when it fails. To pass settings
per run, or to run checks the workspace skips, call `verify-config` and
`verify-responses`, which fail the command:

```sh
dagger call web-image --content apps/web/dist --variables BASE_PATH=/pull/7 verify-responses
```

### projen

Synthesizes a projen project in a pnpm workspace with the projen the lock file
installs. Its `synth` generator synthesizes, installs with the lock file
unfrozen, synthesizes again and installs once more, so an upgraded projen
component writes its own output and the lock file follows what synthesis
changed. The first synthesis skips post-synthesis, which in CI installs with a
frozen lock file. Between the steps, corepack switches to a pnpm version that
synthesis bumped in `packageManager`. Node stays at `baseImageAddress`.

`dagger check` runs it as `projen/synth/stale`, which fails when synthesis or
the lock file refresh would change a file git tracks. projen's tasks are left to
the [typescript](#typescript) and [vitest](#vitest) modules and to ESLint's.
Apply its changes from the workspace root:

```sh
dagger generate -y projen
```

It builds on the [typescript](#typescript) module's install of the workspace and
uses that module's pnpm store. Both default to `node:24-slim`, so with the
defaults `dagger check` installs the workspace once for the two.

```toml
[modules.projen]
source = "github.com/langri-sha/dagger/projen@v1.5.0"

[modules.projen.settings]
baseImageAddress = "node:24-slim" # default
```

### terraform

Checks the Terraform under `terraform/` — formatting, validation and tests —
without needing cloud credentials, and keeps the provider lock file current. It
runs the Terraform version the root module pins.

```toml
[modules.terraform]
source = "github.com/langri-sha/dagger/terraform@v1.0.0"

[modules.terraform.settings]
rootModule = "terraform/web" # default: terraform
```

### typescript

Type-checks a pnpm workspace's project references with `tsc --build`, using the
TypeScript version the lock file installs. `projects` lists what to build, for
tsconfig files the root one doesn't reference.

```toml
[modules.typescript]
source = "github.com/langri-sha/dagger/typescript@v1.0.0"

[modules.typescript.settings]
baseImageAddress = "node:24-slim" # default
projects = ["."] # default
```

### vitest

Runs a pnpm workspace's Vitest suite with `pnpm exec vitest run`, using the
Vitest version the lock file installs, and fails on any failing test. It builds
on the [typescript](#typescript) module's install of the workspace, so `prepare`
scripts have generated their files and the workspace's tools are on the `PATH`.
`projects` picks Vitest projects by name.

```toml
[modules.vitest]
source = "github.com/langri-sha/dagger/vitest@v1.2.0"

[modules.vitest.settings]
baseImageAddress = "node:24" # default
projects = ["web"] # default: []
```

## Python

Python tooling comes from upstream rather than from here:
[`github.com/dagger/python/ruff`](https://github.com/dagger/python/tree/main/ruff)
for linting and formatting, and
[`github.com/dagger/python/ty`](https://github.com/dagger/python/tree/main/ty)
for type-checking. Their tags are `v<version>` at the repository root.

[`github.com/dagger/python/uv`](https://github.com/dagger/python/tree/main/uv)
keeps `uv.lock` current: its `lock` generator runs `uv lock`, and its stale
check fails on a lock file that `uv lock --check` would reject. It locks only
projects that already have a `uv.lock`, with the uv its image ships rather than
the project's. It also audits the locked dependencies as a check. Generators all
read the same tree, so when projen changes `pyproject.toml`, `uv.lock` follows
on the next `dagger generate`.

## Legacy

The previous TypeScript modules — `hermes`, `hermes-workspace`, `letta-code`,
`paperclip`, `tailscale` and `tigerfs` — are on the
[`legacy`](https://github.com/langri-sha/dagger/tree/legacy) branch.

## Working on the repository

Projen manages the repository root and writes each module's `dagger-module.toml`
from the `dagger` option in `.projenrc.ts`, which also pins the engine version
for all of them.

```sh
pnpm install
pnpm projen   # re-synthesize root config after editing .projenrc.ts
pnpm format   # prettier --write .
```
