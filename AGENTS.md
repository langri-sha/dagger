# AGENTS.md

Context for AI coding agents working in this repo.

## What this is

A repository of reusable Dagger modules for the maintainer's personal
infrastructure. It is being redone on current Dagger, starting from the modules
that live in langri-sha/langri-sha.com (`ci` and `terraform`); no modules are
here yet. The previous TypeScript modules (`hermes`, `hermes-workspace`,
`letta-code`, `paperclip`, `tailscale`, `tigerfs`) are on the `legacy` branch.

## Who owns which file

Projen manages the repository root: `package.json`, `pnpm-workspace.yaml`,
`renovate.json5`, `prettier.config.js`, `license`, `CODEOWNERS`,
`.editorconfig`, `.gitignore`, `.gitattributes`, `.prettierignore` and
`.projen/`. Edit `.projenrc.ts` and run `pnpm projen` rather than editing them
by hand.

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
