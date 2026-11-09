# terraform

Checks a Terraform root module — formatting, validation and tests — without
needing cloud credentials, and keeps the provider lock file current. It runs the
Terraform version the root module pins.

Each instance mounts only its root module's directory (`<rootModule>/**`) and
the paths `include` adds, so a change elsewhere leaves its checks cached. The
default root, `terraform`, mounts all of `terraform/`. A root that calls shared
modules, or reads files outside its directory, lists their globs in `include`,
relative to the workspace root; absolute paths and `..` segments are rejected,
here and in `rootModule`. A root that reads the whole tree sets
`include = ["terraform/**"]`; `fmt` checks only the files an instance mounts, so
that one root covers every file.

```toml
[modules.terraform]
source = "github.com/langri-sha/dagger/terraform@v1.0.0"

[modules.terraform.settings]
rootModule = "terraform/app" # default: terraform
include = ["terraform/modules/network/**"] # default: []
cacheKey = "app" # default: the root module
```

Each root module downloads providers into a cache volume of its own, locked to
one check at a time, since Terraform's plugin cache isn't safe for concurrent
writers. Root modules that share a `cacheKey` share that volume and wait on each
other's checks.
