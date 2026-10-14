<p align="center">
  <img src="docs/assets/dagger.svg" width="220" alt="Interlocking modules feeding a dagger-shaped automation pipeline">
</p>

<h1 align="center">dagger</h1>

<p align="center">
  Reusable Dagger modules.
</p>

## Modules

Each module is a [Dang](https://docs.dagger.io/reference/sdks/dang) module for
Dagger 1.0, tagged on its own as `<module>/v<version>`.

### cargo

Checks a Cargo workspace — formatting, Clippy with warnings as errors, and tests
— and keeps `Cargo.lock` in step with the manifests.

```toml
[modules.cargo]
source = "github.com/langri-sha/dagger/cargo@cargo/v0.1.0"

[modules.cargo.settings]
baseImageAddress = "rust:1-slim" # default
```

### ci

Checks for pnpm workspaces that Dagger's official modules don't cover:
TypeScript type-checking, and generators that re-run projen and tidy the
`package.json` files.

```toml
[modules.ci]
source = "github.com/langri-sha/dagger/ci@ci/v0.1.0"

[modules.ci.settings]
baseImageAddress = "node:24-slim" # default
```

### terraform

Checks the Terraform under `terraform/` — formatting, validation and tests —
without needing cloud credentials, and keeps the provider lock file current. It
runs the Terraform version the root module pins.

```toml
[modules.terraform]
source = "github.com/langri-sha/dagger/terraform@terraform/v0.1.0"

[modules.terraform.settings]
rootModule = "terraform/web" # default: terraform
```

### typescript

Type-checks a pnpm workspace's project references with `tsc --build`, using the
TypeScript version the lock file installs. `projects` lists what to build, for
tsconfig files the root one doesn't reference.

```toml
[modules.typescript]
source = "github.com/langri-sha/dagger/typescript@typescript/v0.1.0"

[modules.typescript.settings]
baseImageAddress = "node:24-slim" # default
projects = ["."] # default
```

## Python

Python tooling comes from upstream rather than from here:
[`github.com/dagger/python/ruff`](https://github.com/dagger/python/tree/main/ruff)
for linting and formatting, and
[`github.com/dagger/python/ty`](https://github.com/dagger/python/tree/main/ty)
for type-checking. Their tags are `v<version>` at the repository root.

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
