<p align="center">
  <img src="docs/assets/dagger.svg" width="220" alt="Interlocking modules feeding a dagger-shaped automation pipeline">
</p>

<h1 align="center">dagger</h1>

<p align="center">
  Reusable Dagger modules.
</p>

## Modules

Each module is a [Dang] module for Dagger 1.0, released together under one
`v<version>` tag.

| Module       | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| [actionlint] | Lint GitHub Actions workflows and their shell scripts         |
| [beachball]  | Check and generate Beachball change files                     |
| [cargo]      | Format, lint and test Cargo workspaces; update lock files     |
| [changesets] | Check and generate Changesets change files                    |
| [ci]         | Generate workspace metadata, apply fixes and update snapshots |
| [next]       | Build Next.js apps and standalone runtime images              |
| [nginx]      | Build nginx images and check configuration and responses      |
| [projen]     | Synthesize projen projects and refresh lock files             |
| [supabase]   | Push migrations and deploy Edge Functions                     |
| [terraform]  | Check Terraform roots and update provider lock files          |
| [typescript] | Type-check pnpm workspaces and validate release builds        |
| [vitest]     | Run workspace Vitest suites                                   |
| [zig]        | Build and test Zig projects                                   |

## Python

Python tooling comes from upstream rather than from here:
[`github.com/dagger/python/ruff`][ruff] for linting and formatting, and
[`github.com/dagger/python/ty`][ty] for type-checking. Their tags are
`v<version>` at the repository root.

[`github.com/dagger/python/uv`][uv] keeps `uv.lock` current: its `lock`
generator runs `uv lock`, and its stale check fails on a lock file that
`uv lock --check` would reject. It locks only projects that already have a
`uv.lock`, with the uv its image ships rather than the project's. It also audits
the locked dependencies as a check. Generators all read the same tree, so when
projen changes `pyproject.toml`, `uv.lock` follows on the next
`dagger generate`.

## Legacy

The previous TypeScript modules — `hermes`, `hermes-workspace`, `letta-code`,
`paperclip`, `tailscale` and `tigerfs` — are on the [`legacy`][legacy] branch.

## Development

```sh
pnpm install
pnpm projen   # re-synthesize root config after editing .projenrc.ts
pnpm format   # prettier --write .
```

See [AGENTS.md] for orientation, module checks and the release flow.

## Contributing

See [CONTRIBUTING.md] in `langri-sha/github`.

## License

MIT — see [license].

[contributing.md]:
  https://github.com/langri-sha/github/blob/main/CONTRIBUTING.md
[dang]: https://docs.dagger.io/reference/sdks/dang
[actionlint]: ./actionlint/readme.md
[beachball]: ./beachball/readme.md
[cargo]: ./cargo/readme.md
[changesets]: ./changesets/readme.md
[ci]: ./ci/readme.md
[next]: ./next/readme.md
[nginx]: ./nginx/readme.md
[projen]: ./projen/readme.md
[supabase]: ./supabase/readme.md
[terraform]: ./terraform/readme.md
[typescript]: ./typescript/readme.md
[vitest]: ./vitest/readme.md
[zig]: ./zig/readme.md
[ruff]: https://github.com/dagger/python/tree/main/ruff
[ty]: https://github.com/dagger/python/tree/main/ty
[uv]: https://github.com/dagger/python/tree/main/uv
[legacy]: https://github.com/langri-sha/dagger/tree/legacy
[agents.md]: ./AGENTS.md
[license]: ./license
