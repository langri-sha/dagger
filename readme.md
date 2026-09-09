<p align="center">
  <img src="docs/assets/dagger.svg" width="220" alt="Interlocking modules feeding a dagger-shaped automation pipeline">
</p>

<h1 align="center">dagger</h1>

<p align="center">
  Reusable Dagger TypeScript modules for personal infrastructure.
</p>

## Modules

- [`tigerfs/`](./tigerfs) — install, migrate, and mount
  [TigerFS](https://tigerfs.io) filesystems backed by Postgres (Ghost.build /
  Tiger Cloud). Includes `.build/` app provisioning helpers and a `snapshot()`
  function that hands consumers a Dagger `Directory` instead of forcing FUSE
  into their container.
- [`hermes/`](./hermes) — drop the
  [`hermes-agent`](https://github.com/NousResearch/hermes-agent) CLI into a
  container via the upstream installer; pre-build the dashboard `web/` bundle so
  `hermes dashboard` doesn't npm-install at first launch.
- [`tailscale/`](./tailscale) — install [tailscale](https://tailscale.com/) and
  run `tailscaled` in userspace-networking mode (no CAP_NET_ADMIN, no
  /dev/net/tun); helpers for `tailscale up`, `tailscale serve`, and `HTTP_PROXY`
  env wiring.
- [`letta-code/`](./letta-code) — run the
  [`@letta-ai/letta-code`](https://www.npmjs.com/package/@letta-ai/letta-code)
  CLI inside a hardened container, with chainable `container`, `code`, `run`,
  and `terminal` functions.
- [`paperclip/`](./paperclip) — build and run
  [`paperclipai/paperclip`](https://github.com/paperclipai/paperclip) as a
  Dagger service, with `/paperclip` on a locked cache volume for embedded
  PGlite/state and optional userspace Tailscale wiring via the local `tailscale`
  module.
- [`hermes-workspace/`](./hermes-workspace) — hardened build of
  [outsourc-e/hermes-workspace](https://github.com/outsourc-e/hermes-workspace)
  v2.1.3 with chainable `withAperture`, `withLocalClaude`, `withLocalCodex`,
  `withQwenOllama`, `withTigerFs`, and a root-phase bootstrap that mounts
  per-agent ghost.build TigerFS volumes (via the tigerfs module) and bind-mounts
  them over the standard agent home dirs before dropping privileges.

## TigerFS access patterns

There are three ways to wire up TigerFS in a Dagger pipeline. Pick by who needs
to write:

| Pattern                                                                     | Writes                          | Caps            | When to reach for it                                                |
| --------------------------------------------------------------------------- | ------------------------------- | --------------- | ------------------------------------------------------------------- |
| **`snapshot()`**                                                            | none (read-only at consumer)    | none            | seeding, config bundles, ephemeral builds                           |
| **Cache volume**                                                            | container-local                 | none            | per-agent runtime state that doesn't need cross-machine durability  |
| **FUSE in consumer** (via `mountSnippet` + `insecureRootCapabilities=true`) | live, persistent in ghost.build | `CAP_SYS_ADMIN` | long-lived workspaces where every write must round-trip to Postgres |

The earlier hermes-workspace integration leaned hard on FUSE-in-consumer and
paid the price (silent-write traps, root bootstrap, bind-mount plumbing).
`snapshot()` is the lower-friction default for everything that doesn't strictly
need live writes back to ghost.

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

## Working on the modules

Each module stays an independent Dagger module with its own `dagger.json` and
Yarn-managed manifest — they are not pnpm workspace packages. Projen manages the
repository root and synthesizes every `dagger.json` from `.projenrc.ts`; the
root `node_modules/` exists just to run the tooling.

```sh
pnpm install
pnpm dagger:develop   # regenerate sdk/ in every module
pnpm check:types      # typecheck every module against its generated sdk/
pnpm projen           # re-synthesize root config after editing .projenrc.ts
```

`dagger develop` regenerates each module's `package.json`, `tsconfig.json`,
`yarn.lock` and `sdk/`, so those are left out of Projen's and Prettier's scope.
The manifests are the other way round: they are synthesized from the `dagger`
option in `.projenrc.ts`, which is also where the engine version is pinned and
where Renovate moves it. Declare a new module there rather than writing its
`dagger.json` by hand. See [`AGENTS.md`](./AGENTS.md) for the full ownership
split and for adding a new module.
