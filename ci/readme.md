# ci

Generators and fixes for pnpm workspaces that Dagger's official modules don't
cover: the generators re-run projen and tidy the `package.json` files, `fix`
applies ESLint and Prettier fixes, and `snapshots` updates Vitest snapshots.
Type-checking is in [typescript].

`projen` runs the steps of the [projen] module's `synth` on `ci`'s install of
the workspace, for workspaces that don't install that module.
langri-sha/github's `check.yml` runs the module's generator when the workspace
installs it, and `ci/projen` otherwise. A workspace that installs the projen
module skips `ci/projen`, which drops it from `dagger check` too, so the two
don't write the same files:

```toml
[modules.ci.generate]
skip = ["projen"]
```

`fix` runs `eslint --fix .` and then `prettier --write .`, each when the
workspace installs it, at the version its lock file pins. Problems ESLint can't
fix are left to the [eslint] module's check. It's a function rather than a
generator, since a generator's stale check would repeat that check and
[prettier]'s. Apply its changes from the workspace root:

```sh
dagger call -y ci fix
```

`snapshots` runs `vitest run --update --passWithNoTests` when the workspace
installs Vitest, so it accepts every snapshot that changed. It runs the whole
suite in the `baseImageAddress` container, without the [vitest] module's build
step, extra files or Dagger session. The default `node:24` ships git for suites
that run it; a slim image doesn't. Like `fix`, it's a function, applied from the
workspace root:

```sh
dagger call -y ci snapshots
```

Every generator reads the same tree. A single `dagger generate` applies nothing
when two of them change one file, as `projen` and `packages` can both rewrite a
`package.json`. The post-upgrade job in langri-sha/github's `check.yml` runs its
fixes in order, each on the previous one's output. To do the same, call the
fixes and then run one generator at a time, after the merge-base action that
[beachball] needs:

```sh
dagger call -y ci fix
dagger call -y ci snapshots
dagger generate -y projen # ci/projen without the projen module
dagger generate -y ci/packages
dagger generate -y uv
dagger generate -y beachball/change
```

Checking for changes, uploading the patch and pushing it with the App token stay
in GitHub Actions.

```toml
[modules.ci]
source = "github.com/langri-sha/dagger/ci@v1.0.0"

[modules.ci.settings]
baseImageAddress = "node:24" # default
```

[typescript]: ../typescript/readme.md
[projen]: ../projen/readme.md
[eslint]: https://github.com/dagger/eslint
[prettier]: https://github.com/dagger/prettier
[vitest]: https://github.com/dagger/vitest
[beachball]: ../beachball/readme.md
