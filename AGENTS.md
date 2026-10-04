# AGENTS.md

Context for AI coding agents working in this repo.

## What this is

A repository of reusable Dagger modules: Dang modules for Dagger 1.0, one per
top-level directory (`terraform/`), each tagged as `<module>/v<version>`. They
are ported from langri-sha/langri-sha.com, without the defaults that only fit
it. The previous TypeScript modules (`hermes`, `hermes-workspace`, `letta-code`,
`paperclip`, `tailscale`, `tigerfs`) are on the `legacy` branch.

## Who owns which file

Projen manages the repository root: `package.json`, `pnpm-workspace.yaml`,
`renovate.json5`, `prettier.config.js`, `license`, `CODEOWNERS`,
`.editorconfig`, `.gitignore`, `.gitattributes`, `.prettierignore` and
`.projen/`, and each module's `dagger-module.toml`, written from the `dagger`
option with the one engine version they all declare. Edit `.projenrc.ts` and run
`pnpm projen` rather than editing them by hand.

## Root commands

```sh
pnpm projen   # synthesize root config; idempotent
pnpm format   # prettier --write .
```

## Conventions

- **Atomic commits.** One change per commit. The maintainer is strict about this
  — bundling unrelated edits will get rolled back.
- **No idempotent fluff.** `cmd || true`, swallowed errors, "tolerate
  pre-existing state" patterns are explicitly disliked. Prefer strict failure
  with a clear error over silent recovery.
- **Don't speculate, verify.** Before claiming "this won't work because X",
  actually try X.
- **Comments explain _why_, not _what_.** The reader can see what the code does.
- **No emojis** unless explicitly requested.
