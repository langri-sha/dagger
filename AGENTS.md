# AGENTS.md

Context for AI coding agents working in this repo.

## What this is

A monorepo of small, independent Dagger TypeScript modules used by the
maintainer's personal infrastructure (workspaces, CLI runners,
ghost.build-backed FUSE mounts). Modules can be installed individually from this
repo:

```sh
dagger install github.com/langri-sha/dagger/<module>@main
```

Or, when iterating locally, by relative path from a sibling repo:

```sh
dagger install ../dagger/<module>
```

## Modules

Each top-level directory is one Dagger module:

| Module              | Purpose                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tigerfs/`          | install, migrate, mount [TigerFS](https://tigerfs.io); `.build/` app provisioning helpers; `snapshot()` for FUSE-free consumers                |
| `hermes/`           | install the [`hermes-agent`](https://github.com/NousResearch/hermes-agent) CLI in a container; pre-build the dashboard web bundle              |
| `tailscale/`        | install tailscale + tailscaled and run them in userspace-networking mode (no caps); daemon / serve / proxy-env snippets                        |
| `letta-code/`       | run the `@letta-ai/letta-code` CLI in a hardened container                                                                                     |
| `paperclip/`        | build and run `paperclipai/paperclip`; locks `/paperclip` cache volume for embedded PGlite/state; optional userspace Tailscale via `tailscale` |
| `hermes-workspace/` | hardened build of `outsourc-e/hermes-workspace` v2.1.3, depends on `tigerfs`                                                                   |

Adding a new module: declare it under `dagger.modules` in `.projenrc.ts`, run
`pnpm projen` to synthesize its `dagger.json`, scaffold the rest of the sibling
directory mirroring the layout below, then update `readme.md` so the public
index stays accurate. A module that is not declared has no manifest, and the
root tasks that glob `*/dagger.json` will not see it.

## Module layout

Every module follows the same skeleton (`dagger develop` generates `sdk/` on
first init):

```
<module>/
  dagger.json     # synthesized from .projenrc.ts — do not edit
  package.json    # type: module + typescript dep
  tsconfig.json   # paths map @dagger.io/dagger -> ./sdk/index.ts
  src/index.ts    # one @object() class with @func() methods
  sdk/            # generated — gitignored
  LICENSE
```

The class name in `src/index.ts` is derived from the module name in
`dagger.json` (`hermes-workspace` → `HermesWorkspace`). Don't rename one without
the other.

## Who owns which file

Projen manages the repository root, plus each module's `dagger.json`. It manages
nothing else inside a module directory, and it must not be made to:
`dagger develop` regenerates those files from the SDK's own templates, so a file
written by both tools flips back and forth on every run.

The manifest is the exception because Projen writes it in the exact field order
and formatting the Dagger CLI marshals, so `dagger develop` reads it back and
leaves it alone. Keep `dagger.engineVersion` in `.projenrc.ts` at or ahead of
the engine you develop against, or the CLI stamps a newer version in and
synthesis puts the older one back.

| Owner                                   | Files                                                                                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projen (`.projenrc.ts` → `pnpm projen`) | root `package.json`, `pnpm-workspace.yaml`, `renovate.json5`, `prettier.config.js`, `license`, `CODEOWNERS`, `.editorconfig`, root `.gitignore` / `.gitattributes` / `.prettierignore`, `.projen/`, `.github/workflows/modules.yml`, `<module>/dagger.json` |
| Dagger (`dagger develop`)               | `<module>/package.json`, `<module>/tsconfig.json`, `<module>/yarn.lock`, `<module>/.gitignore`, `<module>/.gitattributes`, `<module>/sdk/`                                                                                                                  |
| You                                     | `<module>/src/**`, `<module>/LICENSE`, docs                                                                                                                                                                                                                 |

The modules are deliberately **not** pnpm workspace packages —
`pnpm-workspace.yaml` pins `packages: []`. Each one is independently installable
and the Dagger runtime builds it with Yarn inside its own container, so
enrolling them would mean a package-manager migration for no gain. The root
`node_modules/` exists only to run Projen and Prettier.

Because the Dagger SDK owns `*/package.json`, Renovate is configured to skip it
(its `typescript` pin comes from the SDK). It tracks `engineVersion` in
`.projenrc.ts` rather than in the six manifests — that is the one place the
repository names an engine — grouped into a single "Dagger engine" PR, and the
post-upgrade job runs `projen` to propagate it before the checks run. Both rules
come from the preset's `dagger` option, not from this repository.

## Root commands

```sh
pnpm projen           # synthesize root config; idempotent
pnpm dagger:develop   # regenerate sdk/ in every module
pnpm check:types      # tsc --noEmit per module, against its generated sdk/
pnpm format           # prettier --write .
```

`check:types` needs `sdk/` present, so run `dagger:develop` first on a fresh
clone. It is the only check that catches cross-module signature drift —
`dagger functions` loads a module without typechecking it, so a call that passes
the wrong arguments to another module's `@func()` still introspects cleanly.

Run `dagger develop` with a CLI matching the `engineVersion` in `dagger.json`,
or it will silently rewrite that field to the CLI's own version.

## Inter-module dependencies

`hermes-workspace` depends on `tigerfs` via:

```json
"dependencies": [
  { "name": "tigerfs", "source": "../tigerfs" }
]
```

This works while iterating locally. When publishing to consumers, the local-path
source is fine if they clone the whole repo; otherwise switch to the remote form
`github.com/langri-sha/dagger/tigerfs@main`.

When a dependency's API changes, run `dagger develop` in the dependent module so
its `sdk/client.gen.ts` regenerates and TypeScript sees the new signatures.

## Architectural posture (TigerFS + privileged FUSE)

Past iterations of `hermes-workspace` leaned on FUSE-in-the-consumer- container,
which forces `insecureRootCapabilities=true` and a root bootstrap phase to do
`mount --bind`. That works but it's expensive in trust and complexity, and it
tied agent persistence to a single container's lifecycle.

The preferred posture for new work is **host-level / snapshot /
network-service** patterns over privileged FUSE-in-Dagger. Concretely:

- **Snapshot** — `dag.tigerfs().snapshot(connection, ghostKey, app)` does the
  FUSE work in an ephemeral helper container and hands the consumer a plain
  `Directory`. Use for seeding, config bundles, and ephemeral builds where the
  consumer doesn't need writes.
- **Cache volume** — for per-agent runtime state that doesn't need durable
  cross-machine storage, prefer `withMountedCache(...)`. The tradeoff is data is
  local to the engine; the upside is no FUSE, no caps, no bootstrap dance.
- **Network service** — TigerFS over a Postgres connection string is another
  no-FUSE escape hatch (consumers connect over TCP and bypass the file layer
  entirely). Worth it when consumers are SQL-friendly workloads, not file-tools.
- **FUSE in consumer** — only when persistent, live writes from the consumer
  must round-trip to ghost.build. Today only `hermes-workspace` does this; new
  modules should not adopt the pattern without a clear reason.

## Conventions

- **Atomic commits.** One change per commit. The maintainer is strict about this
  — bundling unrelated edits will get rolled back.
- **No idempotent fluff.** `cmd || true`, swallowed errors, "tolerate
  pre-existing state" patterns are explicitly disliked. Prefer strict failure
  with a clear error over silent recovery.
- **Don't speculate, verify.** Before claiming "this won't work because X",
  actually try X. Tigerfs limitations were misdiagnosed twice this way; binary
  blobs DO round-trip through `plaintext` apps.
- **Comments explain _why_, not _what_.** The reader can see what the code does.
  They can't see why a mount-bind was chosen over a cache-volume, or why
  `tigerfs migrate` (not `create`) is the right call against ghost-provisioned
  DBs.
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
`letta/bin/run`) use the `dagger -m ../dagger/<module>` form so the working dir
stays at the consumer repo (so `--source=.` still resolves correctly).
