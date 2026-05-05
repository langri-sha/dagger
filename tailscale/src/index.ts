/**
 * Reusable Dagger building blocks for running tailscale inside a
 * container in **userspace networking** mode — no /dev/net/tun, no
 * CAP_NET_ADMIN, no privileged nesting required at runtime.
 *
 * The tailscaled daemon multiplexes a SOCKS5 + HTTP proxy on one port
 * (`proxyPort`, default 1055). Apps reach the tailnet by exporting
 * `HTTP_PROXY` / `HTTPS_PROXY` to that proxy. Inbound connections from
 * the tailnet are handled by `tailscale serve` (see `serveSnippet`).
 *
 * Workflow encoded by these helpers:
 *   1. install()         — apt-get install tailscale + tailscaled into a
 *                          debian/ubuntu container
 *   2. daemonSnippet()   — bash that starts tailscaled (userspace mode)
 *                          and runs `tailscale up` against an auth key
 *   3. serveSnippet()    — bash that runs `tailscale serve --bg <url>`
 *                          to publish a local port back into the tailnet
 *   4. proxyEnvSnippet() — bash that exports HTTP_PROXY / HTTPS_PROXY /
 *                          NO_PROXY at the SOCKS5 listener
 *
 * Auth key is read from a runtime env var (`TS_AUTHKEY` by default), not
 * baked into the image, so the same image can be re-deployed against
 * different tailnets / accounts. Hostname is a snippet argument; pass a
 * `"${TS_HOSTNAME}"`-style string if you want runtime expansion.
 */
import {
  dag,
  Container,
  object,
  func,
} from "@dagger.io/dagger"

const DEFAULT_PROXY_PORT = 1055
const DEFAULT_STATE_DIR = "/var/tmp/tailscale"
const DEFAULT_AUTH_KEY_ENV = "TS_AUTHKEY"
const DEFAULT_NO_PROXY = "127.0.0.1,localhost,::1"

@object()
export class Tailscale {
  /**
   * Install the official tailscale APT repo + the tailscale CLI and
   * tailscaled binary into `ctr`. Targets debian bookworm by default;
   * pass a different `release` for ubuntu (e.g. "noble") or another
   * debian release.
   *
   * Pulls ca-certificates + curl so this works against minimal base
   * images (debian:trixie-slim, node:22-bookworm-slim).
   */
  @func()
  install(
    ctr: Container,
    /**
     * APT distribution release name. Default "bookworm". Use "noble"
     * for ubuntu 24.04, "trixie" for debian 13, etc.
     */
    release?: string,
  ): Container {
    const rel = release?.trim() || "bookworm"
    return ctr.withExec([
      "bash",
      "-lc",
      [
        "set -e",
        "apt-get update -qq",
        "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl",
        "install -d -m 0755 /usr/share/keyrings /etc/apt/sources.list.d",
        `curl -fsSL https://pkgs.tailscale.com/stable/debian/${rel}.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg`,
        `curl -fsSL https://pkgs.tailscale.com/stable/debian/${rel}.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list`,
        "apt-get update -qq",
        "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tailscale",
        "apt-get clean && rm -rf /var/lib/apt/lists/*",
      ].join(" && "),
    ])
  }

  /**
   * Return a Bash snippet that starts `tailscaled` in userspace mode and
   * runs `tailscale up` to join the tailnet.
   *
   * Expects:
   *   - `tailscale` and `tailscaled` on PATH (use `install()`)
   *   - The auth-key env var (default `TS_AUTHKEY`) set in the container
   *   - The state dir (default `/var/tmp/tailscale`) writable
   *
   * Exposes for the rest of the script:
   *   - `TS_SOCKET` — path to the tailscaled control socket; pass to
   *     subsequent `tailscale --socket=...` invocations
   *
   * The snippet is **strict** — if `tailscaled` doesn't open its socket
   * within 30s, or `tailscale up` fails, the snippet returns non-zero.
   * The previous incarnation in hermes-workspace tolerated `up` failures
   * with `|| true`; that's been dropped.
   *
   * Doesn't gate on the auth-key env var — that's the caller's call.
   * Wrap the snippet output in `if [ -n "${TS_AUTHKEY:-}" ]; then ... fi`
   * if tailscale should be optional in the entrypoint.
   */
  @func()
  daemonSnippet(
    /**
     * Hostname to register on the tailnet. Pass a literal string for a
     * compile-time hostname, or `"${TS_HOSTNAME}"` to read from a
     * runtime env var.
     */
    hostname: string,
    /**
     * Env var that holds the tailnet pre-auth key. Default `TS_AUTHKEY`.
     */
    authKeyEnv?: string,
    /**
     * Local port for the SOCKS5 + outbound HTTP proxy. Default 1055.
     */
    proxyPort?: number,
    /**
     * tailscaled state dir. Default `/var/tmp/tailscale`.
     */
    stateDir?: string,
  ): string {
    const env = authKeyEnv?.trim() || DEFAULT_AUTH_KEY_ENV
    const port = Number.isInteger(proxyPort) && (proxyPort as number) > 0
      ? proxyPort
      : DEFAULT_PROXY_PORT
    const dir = stateDir?.trim() || DEFAULT_STATE_DIR
    return [
      `# tailscale userspace daemon (proxy on localhost:${port})`,
      `TS_STATE_DIR="${dir}"`,
      `TS_SOCKET="$TS_STATE_DIR/tailscaled.sock"`,
      `mkdir -p "$TS_STATE_DIR"`,
      `echo "[tailscale] starting tailscaled (userspace networking, proxy on localhost:${port})"`,
      `tailscaled \\`,
      `  --tun=userspace-networking \\`,
      `  --socks5-server=localhost:${port} \\`,
      `  --outbound-http-proxy-listen=localhost:${port} \\`,
      `  --statedir="$TS_STATE_DIR" \\`,
      `  --socket="$TS_SOCKET" \\`,
      `  >/tmp/tailscaled.log 2>&1 &`,
      `for _ in $(seq 1 60); do`,
      `  if [ -S "$TS_SOCKET" ]; then break; fi`,
      `  sleep 0.5`,
      `done`,
      `if [ ! -S "$TS_SOCKET" ]; then`,
      `  echo "[tailscale] tailscaled did not open $TS_SOCKET" >&2`,
      `  cat /tmp/tailscaled.log >&2`,
      `  exit 1`,
      `fi`,
      `if ! tailscale --socket="$TS_SOCKET" up --authkey="\${${env}}" --hostname="${hostname}" --accept-dns --ssh=false --reset >/tmp/tailscale-up.log 2>&1; then`,
      `  echo "[tailscale] tailscale up failed" >&2`,
      `  cat /tmp/tailscale-up.log >&2`,
      `  exit 1`,
      `fi`,
      `echo "[tailscale] joined tailnet as ${hostname}"`,
    ].join("\n")
  }

  /**
   * Return a Bash snippet that publishes a local URL back into the
   * tailnet via `tailscale serve --bg`. The advertised URL is
   * `https://<hostname>.<tailnet>.ts.net/`.
   *
   * Run after `daemonSnippet`. Requires `TS_SOCKET` to be set in the
   * shell (the daemon snippet exports it).
   *
   * The snippet is best-effort — if `tailscale serve` fails, the snippet
   * logs the error and continues. (`serve` is non-essential; the
   * tailnet device is still joined and the user can reach it by
   * tailnet IP if `serve` is broken.)
   */
  @func()
  serveSnippet(
    /**
     * The local URL to serve. Typically `http://127.0.0.1:$PORT` so the
     * port is read from a runtime env var.
     */
    upstream: string,
  ): string {
    return [
      `# tailscale serve: ${upstream} -> https://<hostname>.<tailnet>.ts.net/`,
      `if tailscale --socket="$TS_SOCKET" serve --bg "${upstream}" >/tmp/tailscale-serve.log 2>&1; then`,
      `  echo "[tailscale] serving ${upstream} to tailnet"`,
      `else`,
      `  echo "[tailscale] tailscale serve failed; see /tmp/tailscale-serve.log" >&2`,
      `  cat /tmp/tailscale-serve.log >&2 || true`,
      `fi`,
    ].join("\n")
  }

  /**
   * Return a Bash snippet that exports the standard `HTTP_PROXY`,
   * `HTTPS_PROXY`, and `NO_PROXY` env vars (and their lowercase
   * variants) pointing at the tailscaled SOCKS5 listener so apps reach
   * tailnet hosts via the userspace network.
   *
   * Run after `daemonSnippet`. Sets `export` so the values propagate to
   * every child process (including a subsequent `exec` of the
   * application).
   *
   * Note: Node 22's native `fetch()` (undici) ignores `HTTP_PROXY` /
   * `HTTPS_PROXY` unless you load a `--require` shim that calls
   * `setGlobalDispatcher(new EnvHttpProxyAgent())`. That shim isn't part
   * of this module — wire it up at the consumer end if you're running
   * Node and want native fetch to honour the proxy env.
   */
  @func()
  proxyEnvSnippet(
    proxyPort?: number,
    /**
     * Comma-separated `NO_PROXY` list. Default
     * `"127.0.0.1,localhost,::1"`.
     */
    noProxy?: string,
  ): string {
    const port = Number.isInteger(proxyPort) && (proxyPort as number) > 0
      ? proxyPort
      : DEFAULT_PROXY_PORT
    const skip = noProxy?.trim() || DEFAULT_NO_PROXY
    return [
      `# tailscale proxy env (apps -> userspace tailscaled on :${port})`,
      `export HTTP_PROXY="http://localhost:${port}"`,
      `export HTTPS_PROXY="http://localhost:${port}"`,
      `export http_proxy="http://localhost:${port}"`,
      `export https_proxy="http://localhost:${port}"`,
      `export NO_PROXY="${skip}"`,
      `export no_proxy="${skip}"`,
    ].join("\n")
  }

  /**
   * Smoke-test container: install tailscale into debian:trixie-slim,
   * then dump versions. Verifies the install layer compiles and the
   * binaries land on PATH; doesn't try to bring up the tailnet (no
   * auth key supplied).
   */
  @func()
  check(release?: string): Container {
    return this.install(
      dag.container().from("debian:trixie-slim"),
      release,
    ).withExec([
      "sh",
      "-c",
      [
        "echo '== tailscale --version =='",
        "tailscale --version",
        "echo",
        "echo '== tailscaled --version =='",
        "tailscaled --version",
      ].join("\n"),
    ])
  }
}
