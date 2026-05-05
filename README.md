# dagger

Reusable Dagger TypeScript modules for personal infrastructure.

## Modules

- [`tigerfs/`](./tigerfs) — install, create, migrate, and mount [TigerFS](https://tigerfs.io)
  filesystems backed by Postgres (Ghost.build / Tiger Cloud). Includes helpers
  for the `.build/` app provisioning workflow.
- [`letta-code/`](./letta-code) — run the
  [`@letta-ai/letta-code`](https://www.npmjs.com/package/@letta-ai/letta-code)
  CLI inside a hardened container, with chainable `container`, `code`,
  `run`, and `terminal` functions.
- [`hermes-workspace/`](./hermes-workspace) — hardened build of
  [outsourc-e/hermes-workspace](https://github.com/outsourc-e/hermes-workspace)
  v2.1.3 with chainable `withAperture`, `withLocalClaude`,
  `withLocalCodex`, `withQwenOllama`, `withTigerFs`, and a root-phase
  bootstrap that mounts per-agent ghost.build TigerFS volumes (via the
  tigerfs module) and bind-mounts them over the standard agent home dirs
  before dropping privileges.

## Using a module locally

```sh
cd /path/to/your-project/.dagger
# add as local dependency
dagger install ../../dagger/tigerfs
```

## Using a module remotely

```sh
dagger install github.com/langri-sha/dagger/tigerfs@main
```
