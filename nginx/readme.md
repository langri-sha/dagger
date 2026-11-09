# nginx

Builds an [nginx] image from a [Docker] context and checks it as a JSON spec
declares. `config` runs `nginx -t` through the image's entrypoint, so its
templates are rendered. `responses` runs each scenario: the image as a service,
the requests sent to it, and its stdout and stderr, as `docker logs` shows them.

A scenario can add echo upstreams: nginx answering every request with fixed
headers and a body, under the hostnames it names, over HTTPS with a self-signed
certificate that the image's CA bundle can trust. `resolver` names the variable
the image's `resolver` directive reads, and points it at a DNS server that
answers those hostnames, as Docker's embedded DNS does. `content` adds built
files to the context, such as a static export from [next] through a `dag://`
link, and `${NAME}` in the spec takes its value from `variables`.

```toml
[modules.web-image]
source = "github.com/langri-sha/dagger/nginx@v1.3.0"

[modules.web-image.settings]
context = "apps/web"
spec = "apps/web/nginx.json"
content = "dag://web/build" # default: none
contentPath = "dist" # default: .
dockerfile = "Dockerfile" # default
buildArgs = [] # default
variables = ["BASE_PATH=/pull/7"] # default: []
```

```json
{
  "port": 8080,
  "environment": ["PORT=8080"],
  "scenarios": [
    {
      "name": "proxy",
      "environment": ["UPSTREAM_HOST=upstream"],
      "resolver": "RESOLVER",
      "upstreams": [
        {
          "hostnames": ["upstream"],
          "tls": true,
          "trusted": true,
          "headers": ["set-cookie: a=1"],
          "body": "$request_method $request_uri host=$host"
        }
      ],
      "requests": [
        {
          "method": "GET",
          "path": "/proxy/hello",
          "headers": ["cookie: session=secret"],
          "status": 200,
          "body": "GET /hello host=upstream",
          "bodyContains": ["host=upstream"],
          "responseHeaders": ["x-content-type-options: nosniff"],
          "absentHeaders": ["set-cookie"]
        }
      ],
      "logContains": ["GET /proxy/hello"],
      "logExcludes": ["session=secret"]
    }
  ]
}
```

`port` can be left out when the image exposes a single port. Paths are sent as
they are, `..` included, and response headers match ignoring case.

A check run through `dagger call` exits 0 even when it fails. To pass settings
per run, or to run checks the workspace skips, call `verify-config` and
`verify-responses`, which fail the command:

```sh
dagger call web-image --content apps/web/dist --variables BASE_PATH=/pull/7 verify-responses
```

[next]: ../next/readme.md
[nginx]: https://nginx.org/en/docs/
[docker]: https://docs.docker.com/
