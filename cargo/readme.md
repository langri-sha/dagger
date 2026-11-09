# cargo

Checks a [Cargo] workspace — formatting, [Clippy] with warnings as errors, and
tests — and keeps `Cargo.lock` in step with the manifests.

```toml
[modules.cargo]
source = "github.com/langri-sha/dagger/cargo@v1.0.0"

[modules.cargo.settings]
baseImageAddress = "rust:1-slim" # default
```

[cargo]: https://doc.rust-lang.org/cargo/
[clippy]: https://doc.rust-lang.org/clippy/
