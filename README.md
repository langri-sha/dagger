# dagger

Reusable Dagger TypeScript modules for personal infrastructure.

## Modules

- [`tigerfs/`](./tigerfs) — install, create, migrate, and mount [TigerFS](https://tigerfs.io)
  filesystems backed by Postgres (Ghost.build / Tiger Cloud). Includes helpers
  for the `.build/` app provisioning workflow.
- [`tailscale/`](./tailscale) — userspace-networking Tailscale sidecar (no
  CAP_NET_ADMIN), with optional `tailscale serve` exposure.
- [`hermes-workspace/`](./hermes-workspace) — hardened build of
  [outsourc-e/hermes-workspace](https://github.com/outsourc-e/hermes-workspace)
  with chainable `withAperture`, `withLocalClaude`, `withLocalCodex`,
  `withTigerFs` helpers.

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
