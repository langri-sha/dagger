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

### terraform

Credential-free checks for the Terraform sources under `terraform/`: `fmt`,
`validate` and `test`, and a `lock` generator for the dependency lock file. The
root module is initialized with `-backend=false`, and its exact
`required_version` picks the Terraform image.

```toml
[modules.terraform]
source = "github.com/langri-sha/dagger/terraform@terraform/v0.1.0"

[modules.terraform.settings]
rootModule = "terraform/web" # default: terraform
```

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
