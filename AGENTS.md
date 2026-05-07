# AGENTS.md

Context for AI coding agents working in this repo.

## What this is

A monorepo of small, independent Dagger TypeScript modules used by the
maintainer's personal infrastructure (workspaces, CLI runners,
ghost.build-backed FUSE mounts). Modules can be installed individually
from this repo:

```sh
dagger install github.com/langri-sha/dagger/<module>@main
```

Or, when iterating locally, by relative path from a sibling repo:

```sh
dagger install ../dagger/<module>
```

## Modules

Each top-level directory is one Dagger module:

| Module | Purpose |
|---|---|
| `tigerfs/` | install, migrate, mount [TigerFS](https://tigerfs.io); `.build/` app provisioning helpers; `snapshot()` for FUSE-free consumers |
| `hermes/` | install the [`hermes-agent`](https://github.com/NousResearch/hermes-agent) CLI in a container; pre-build the dashboard web bundle |
| `tailscale/` | install tailscale + tailscaled and run them in userspace-networking mode (no caps); daemon / serve / proxy-env snippets |
| `letta-code/` | run the `@letta-ai/letta-code` CLI in a hardened container |
| `paperclip/` | build and run `paperclipai/paperclip`; locks `/paperclip` cache volume for embedded PGlite/state; optional userspace Tailscale via `tailscale` |
| `hermes-workspace/` | hardened build of `outsourc-e/hermes-workspace` v2.1.3, depends on `tigerfs` |

Adding a new module: scaffold a sibling directory mirroring the layout
below, then update `README.md` so the public index stays accurate.

## Module layout

Every module follows the same skeleton (`dagger develop` generates `sdk/`
on first init):

```
<module>/
  dagger.json     # name, engineVersion, sdk { source: "typescript" }, dependencies
  package.json    # type: module + typescript dep
  tsconfig.json   # paths map @dagger.io/dagger -> ./sdk/index.ts
  src/index.ts    # one @object() class with @func() methods
  sdk/            # generated — gitignored
  LICENSE
```

The class name in `src/index.ts` is derived from the module name in
`dagger.json` (`hermes-workspace` → `HermesWorkspace`). Don't rename one
without the other.

## Inter-module dependencies

`hermes-workspace` depends on `tigerfs` via:

```json
"dependencies": [
  { "name": "tigerfs", "source": "../tigerfs" }
]
```

This works while iterating locally. When publishing to consumers, the
local-path source is fine if they clone the whole repo; otherwise switch
to the remote form `github.com/langri-sha/dagger/tigerfs@main`.

When a dependency's API changes, run `dagger develop` in the dependent
module so its `sdk/client.gen.ts` regenerates and TypeScript sees the
new signatures.

## Architectural posture (TigerFS + privileged FUSE)

Past iterations of `hermes-workspace` leaned on FUSE-in-the-consumer-
container, which forces `insecureRootCapabilities=true` and a root
bootstrap phase to do `mount --bind`. That works but it's expensive in
trust and complexity, and it tied agent persistence to a single
container's lifecycle.

The preferred posture for new work is **host-level / snapshot /
network-service** patterns over privileged FUSE-in-Dagger. Concretely:

- **Snapshot** — `dag.tigerfs().snapshot(connection, ghostKey, app)`
  does the FUSE work in an ephemeral helper container and hands the
  consumer a plain `Directory`. Use for seeding, config bundles, and
  ephemeral builds where the consumer doesn't need writes.
- **Cache volume** — for per-agent runtime state that doesn't need
  durable cross-machine storage, prefer `withMountedCache(...)`. The
  tradeoff is data is local to the engine; the upside is no FUSE, no
  caps, no bootstrap dance.
- **Network service** — TigerFS over a Postgres connection string is
  another no-FUSE escape hatch (consumers connect over TCP and bypass
  the file layer entirely). Worth it when consumers are SQL-friendly
  workloads, not file-tools.
- **FUSE in consumer** — only when persistent, live writes from the
  consumer must round-trip to ghost.build. Today only `hermes-workspace`
  does this; new modules should not adopt the pattern without a clear
  reason.

## Conventions

- **Atomic commits.** One change per commit. The maintainer is strict
  about this — bundling unrelated edits will get rolled back.
- **No idempotent fluff.** `cmd || true`, swallowed errors, "tolerate
  pre-existing state" patterns are explicitly disliked. Prefer strict
  failure with a clear error over silent recovery.
- **Don't speculate, verify.** Before claiming "this won't work because
  X", actually try X. Tigerfs limitations were misdiagnosed twice this
  way; binary blobs DO round-trip through `plaintext` apps.
- **Comments explain *why*, not *what*.** The reader can see what the
  code does. They can't see why a mount-bind was chosen over a
  cache-volume, or why `tigerfs migrate` (not `create`) is the right
  call against ghost-provisioned DBs.
- **No emojis** unless explicitly requested.

## Common commands

```sh
# inside any module
dagger develop                    # regenerate sdk/ after dagger.json edits
dagger functions                  # list exposed @func() methods
dagger call <fn> --arg=value      # invoke one
dagger -m ../<module> call <fn>   # invoke from a sibling repo without `cd`-ing
```

`bin/dev` and `bin/run` scripts in sibling repos (`agents/bin/dev`,
`letta/bin/run`) use the `dagger -m ../dagger/<module>` form so the
working dir stays at the consumer repo (so `--source=.` still resolves
correctly).
