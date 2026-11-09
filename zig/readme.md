# zig

Checks a [Zig] project: `zig build test` as the `test` check, and `zig build`
with the `steps` and `args` settings as the `build` check. Zig comes from the
official release tarball, which the module verifies against the minisign key
that ziglang.org publishes, and runs on `baseImageAddress`. `version` picks the
release, as `major.minor.patch` from 0.14.1 on; it defaults to the one the
module pins. Zig's global and local caches live in cache volumes; the local one
is keyed by `cacheKey`, which defaults to the workspace's address, so projects
don't share one that keeps growing.

The `build` check runs the default step unless `steps` names others. `args`
reach both checks, as in `-Doptimize=ReleaseSafe`.

```toml
[modules.zig]
source = "github.com/langri-sha/dagger/zig@v1.0.0"

[modules.zig.settings]
# version: default is the release the module pins
baseImageAddress = "alpine:3" # default
steps = ["docs"] # default: []
args = ["-Doptimize=ReleaseSafe"] # default: []
cacheKey = "app" # default: the workspace's address
```

`environment` returns the project on the toolchain, for anything else Zig does:

```sh
dagger call zig environment with-exec --args=zig,env stdout
```

[zig]: https://ziglang.org/learn/
