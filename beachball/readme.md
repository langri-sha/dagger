# beachball

Checks that every changed package in a pnpm workspace has a Beachball change
file, and writes the missing ones with `message` and `type`. Beachball compares
HEAD to its merge base with the base branch. The module takes both from
`.merge-base`, which langri-sha/github's `merge-base` action writes from a
shallow checkout, and never reads the checkout's history. Without `.merge-base`,
the check and the generator fail.

A change to a pnpm catalog would demand change files from every package that
uses it: Beachball reads `pnpm-workspace.yaml` at the base, and `.merge-base`
doesn't carry it.

Change files carry `authorEmail`, which changelogs credit each change to.
Without it, they say `email not defined`, as the ones langri-sha/github's
post-upgrade job writes do, and changelogs leave the author out.

```toml
[modules.beachball]
source = "github.com/langri-sha/dagger/beachball@v1.0.0"

[modules.beachball.settings]
baseImageAddress = "node:24" # default
authorEmail = "renovate@example.com" # default: unset
```
