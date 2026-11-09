# changesets

Checks that the changes come with a [Changesets] change file, running
`changeset status` against the merge base. An empty change file, which releases
nothing, counts. Like the beachball module, it takes the merge base from
`.merge-base`, which langri-sha/github's `merge-base` action writes from a
shallow checkout, and never reads the checkout's history. Without `.merge-base`,
the check and the generator fail.

The generator writes an empty change file when the check would fail, for pull
requests that don't deserve a release, such as Renovate's dev-tooling bumps.
Changesets names the file at random, and the check only sees it once it's
committed and the merge-base action has run again.

Changesets counts any changed file, `.changeset/` included, toward a package
that releases. A private package does so only with `privatePackages.version` set
in `.changeset/config.json`; with `version` and `tag` both off, the check has
nothing to ask for.

```toml
[modules.changesets]
source = "github.com/langri-sha/dagger/changesets@v1.10.0"

[modules.changesets.settings]
baseImageAddress = "node:24" # default
```

[changesets]: https://github.com/changesets/changesets
