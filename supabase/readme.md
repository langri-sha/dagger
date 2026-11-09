# supabase

Pushes a Supabase project's migrations and deploys its Edge Functions with the
Supabase CLI, which the module's `Dockerfile` pins and Renovate updates. The
project is the `project_id` in `supabase/config.toml`. Both are functions that
take the access token as a `Secret`, so it stays out of the logs and the cache,
and both fail when the CLI does:

```sh
dagger call migrate --token=env:SUPABASE_ACCESS_TOKEN
dagger call migrate --token=env:SUPABASE_ACCESS_TOKEN --db-password=env:SUPABASE_DB_PASSWORD
dagger call deploy --token=env:SUPABASE_ACCESS_TOKEN
```

`migrate` is `supabase db push`; the database password is optional. `deploy`
deploys every function in `supabase/functions`, bundled on Supabase's side as
the container has no Docker. Neither is a check or a generator, so
`dagger check` never runs them. Every call reaches Supabase; none is replayed
from a cache.

```toml
[modules.supabase]
source = "github.com/langri-sha/dagger/supabase@v1.6.0"

[modules.supabase.settings]
project = "apps/web" # default: .
```
