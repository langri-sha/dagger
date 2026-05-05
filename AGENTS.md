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
| `tigerfs/` | install, migrate, mount [TigerFS](https://tigerfs.io); `.build/` app provisioning helpers |
| `letta-code/` | run the `@letta-ai/letta-code` CLI in a hardened container |
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
