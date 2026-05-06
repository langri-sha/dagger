/**
 * Hardened outsourc-e/hermes-workspace v2.1.3 (the Node web UI that wraps
 * NousResearch/hermes-agent) as a Dagger service.
 *
 * Persistent agent state ($HERMES_HOME, $HERMES_CLAUDE_HOME,
 * $HERMES_PI_HOME, $HERMES_FEYNMAN_HOME) is stored on per-agent
 * ghost.build-backed TigerFS mounts. The tigerfs module dependency
 * provides the CLI install + helper snippets. The bootstrap script runs
 * as root, mounts each FS at an internal path, seeds it from the
 * install-time content, then bind-mounts the seeded app dir over the
 * standard $HOME-style paths. Privilege is dropped to the hermes user
 * via setpriv before exec'ing the hermes-phase entrypoint (gateway +
 * dashboard + workspace UI).
 */
import {
  dag,
  object,
  func,
  Secret,
  Container,
  Directory,
  Service,
  CacheSharingMode,
} from "@dagger.io/dagger"

const HERMES_USER = "hermes"
const DEFAULT_HERMES_UID = 10001
const HERMES_HOME = "/home/hermes/.hermes"
const HERMES_CLAUDE_HOME = "/home/hermes/.claude"
const HERMES_CODEX_HOME = "/home/hermes/.codex"
const HERMES_PI_HOME = "/home/hermes/.pi"
const HERMES_FEYNMAN_HOME = "/home/hermes/.feynman"
const HERMES_HOME_ROOT = "/home/hermes"
const WORKSPACE_DIR = "/workspace"
const HERMES_WORKSPACE_DIR = "/opt/hermes-workspace"
const HERMES_WORKSPACE_REPO = "https://github.com/outsourc-e/hermes-workspace.git"
// outsourc-e/hermes-workspace v2.1.3 — annotated tag points to this commit.
const HERMES_WORKSPACE_REF = "58878ba7467a3efa07168c76353cacabcc1e17cd"
// NousResearch/hermes-agent installer SHA. Pinned for reproducibility;
// passed through to dag.hermes().install() so the upstream installer
// pulls a known commit instead of moving with `main`.
const HERMES_AGENT_REF = "167b5648ea609aafa85f56c5714f7abda5091ed6"
// Pinned npm package versions for the in-container CLIs. Bump with
// explicit commits so changes are reviewable and the image is reproducible.
const CLAUDE_CODE_VERSION = "2.1.126"
const CODEX_VERSION = "0.128.0"
const FEYNMAN_VERSION = "0.2.40"
const PI_VERSION = "0.72.1"
const DEFAULT_PORT = 3000
const HERMES_GATEWAY_PORT = 8642
const HERMES_DASHBOARD_PORT = 9119
const DEFAULT_APPROVALS = "manual"
const DEFAULT_TOOLSETS = "terminal,file"
const STATE_CACHE_SCOPE = "default"
// Tailscale runs in userspace networking mode so the container keeps its
// non-root, no-CAP_NET_ADMIN posture. Both proxies share one listener
// (tailscaled multiplexes SOCKS5 and HTTP on the same port).
const TS_PROXY_PORT = 1055
const TS_DEFAULT_HOSTNAME = "hermes-workspace"
const TS_STATE_SUBDIR = "tailscale"
const TS_BOOTSTRAP_PATH = "/usr/local/lib/hermes-workspace/proxy-bootstrap.cjs"
// TigerFS turns a ghost.build Postgres database into a transactional,
// versioned filesystem. Runs inside the workspace container as a FUSE
// daemon, mounted by the bootstrap's root phase and inherited by the
// hermes user after the privilege drop. The CLI install + fuse3 userspace
// runtime are provided by the tigerfs module dependency
// (dag.tigerfs().install(ctr)).

@object()
export class HermesWorkspace {
  /**
   * Build a hardened outsourc-e/hermes-workspace v2.1.3 container.
   *
   * The workspace is the Node web UI (chat / files / memory / skills /
   * terminal / dashboard / swarm) that wraps NousResearch/hermes-agent.
   *
   * Secure defaults: non-root user, isolated HERMES_HOME, manual approvals,
   * narrow toolsets, single exposed port. No --yolo, no privileged nesting,
   * no insecure root capabilities, no health-check skip. All provider
   * credentials flow through Dagger Secret arguments — never baked into
   * layers or generated config.
   */
  @func()
  hermesWorkspaceContainer(
    source: Directory,
    openrouterApiKey?: Secret,
    anthropicApiKey?: Secret,
    openaiApiKey?: Secret,
    workspacePassword?: Secret,
    tailscaleAuthKey?: Secret,
    tailscaleHostname?: string,
    apertureBaseUrl?: string,
    port?: number,
    approvalsMode?: string,
    toolsets?: string,
    hermesUid?: number,
    tailscaleServe?: boolean,
    ghostApiKey?: Secret,
    /**
     * Git committer identity for commits made inside the container. When
     * either is set, /etc/gitconfig is rendered with [user] block so all
     * users on the system inherit it without touching $HERMES_HOME.
     */
    gitUserName?: string,
    gitUserEmail?: string,
  ): Container {
    const resolvedPort = normalizePort(port)
    const resolvedUid = normalizeUid(hermesUid)
    const resolvedUidStr = String(resolvedUid)
    const resolvedServe = tailscaleServe === true
    const resolvedApprovals = sanitizeChoice(
      approvalsMode,
      ["manual", "smart"],
      DEFAULT_APPROVALS,
    )
    const resolvedToolsets = sanitizeCsv(toolsets) ?? DEFAULT_TOOLSETS
    const resolvedTsHostname = sanitizeHostname(tailscaleHostname) ?? `${TS_DEFAULT_HOSTNAME}-${STATE_CACHE_SCOPE}`
    const resolvedAperture = apertureBaseUrl?.trim() || undefined

    // Non-secret hermes-agent gateway env. The gateway only binds its HTTP
    // API when API_SERVER_ENABLED=true is read from the on-disk env file
    // (process env alone is not enough — see install.sh ensure_env_key).
    const hermesGatewayEnv = [
      "API_SERVER_ENABLED=true",
      `API_SERVER_HOST=127.0.0.1`,
      `API_SERVER_PORT=${HERMES_GATEWAY_PORT}`,
      "",
    ].join("\n")

    // Workspace .env. All provider keys are intentionally absent here —
    // they are injected via Dagger secrets at runtime as env vars and the
    // workspace reads them straight from process env.
    const workspaceEnv = [
      "# Generated by Dagger. Provider keys are injected at runtime via env.",
      `HERMES_API_URL=http://127.0.0.1:${HERMES_GATEWAY_PORT}`,
      `HERMES_DASHBOARD_URL=http://127.0.0.1:${HERMES_DASHBOARD_PORT}`,
      "HOST=0.0.0.0",
      `PORT=${resolvedPort}`,
      "NODE_ENV=production",
      "COOKIE_SECURE=0",
      "",
    ].join("\n")

    // Service entrypoint script. Starts the hermes-agent gateway, waits
    // for the gateway to be ready, then execs the workspace's Vite dev
    // server (the v2.1.3 README's documented runtime — its package.json
    // `start` script targets a Nitro `.output/` layout that this version's
    // build no longer produces, leaving `dist/server/server.js` as a
    // bare fetch handler with no embedded http listener). No --yolo, no
    // privileged nesting. CLAUDE_PASSWORD is sourced from the
    // workspacePassword secret if provided; otherwise the workspace's
    // fail-closed remote-bind guard is bypassed via
    // CLAUDE_ALLOW_INSECURE_REMOTE=1, since the only network path to
    // this service is the per-session Dagger tunnel.
    //
    // The hermes dashboard sidecar (port 9119) is intentionally not
    // started here: in v0.12.0 it builds its own `web/` UI on first
    // launch via `npm install && npm run build`, which fails inside the
    // hardened container. The Conductor pane in the workspace renders a
    // documented placeholder when the dashboard endpoint is absent.
    // Root-phase bootstrap. tini -> bootstrap (root) -> setpriv -> entrypoint
    // (hermes). Mounts tigerfs at /var/tigerfs/<alias>, provisions a plaintext
    // app, seeds it from the install-time content of the target dir on first
    // boot, then bind-mounts the app dir over the target so hermes-agent reads
    // and writes through tigerfs without changing $HERMES_HOME. CAP_SYS_ADMIN
    // (insecureRootCapabilities=true) is required for both FUSE mount(8) and
    // the bind-mount.
    const bootstrap = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "if [ \"$(id -u)\" != \"0\" ]; then",
      "  echo '[bootstrap] must start as root for tigerfs mount + bind-mount' >&2",
      "  exit 1",
      "fi",
      "",
      "if env | grep -qE '^TIGERFS_DB_'; then",
      "  if [ -z \"${GHOST_API_KEY:-}\" ]; then",
      "    echo '[bootstrap] TIGERFS_DB_* set but GHOST_API_KEY missing' >&2",
      "    exit 1",
      "  fi",
      "  for var in $(env | sed -nE 's/^(TIGERFS_DB_[A-Z0-9_]+)=.*/\\1/p'); do",
      "    val=\"${!var}\"",
      "    IFS='|' read -r ts_db ts_target <<<\"$val\"",
      "    alias_lower=\"$(echo \"${var#TIGERFS_DB_}\" | tr '[:upper:]' '[:lower:]')\"",
      "    ts_internal=\"/var/tigerfs/${alias_lower}\"",
      "    mkdir -p \"$ts_internal\" \"$ts_target\"",
      "",
      "    echo \"[bootstrap] tigerfs migrate ghost:$ts_db\"",
      "    tigerfs migrate \"ghost:$ts_db\" >\"/tmp/tigerfs-$ts_db-migrate.log\" 2>&1",
      "",
      "    echo \"[bootstrap] tigerfs mount ghost:$ts_db -> $ts_internal\"",
      "    tigerfs mount \"ghost:$ts_db\" \"$ts_internal\" >\"/tmp/tigerfs-$ts_db.log\" 2>&1 &",
      "    for i in $(seq 1 60); do",
      "      if mountpoint -q \"$ts_internal\"; then break; fi",
      "      sleep 0.5",
      "    done",
      "    if ! mountpoint -q \"$ts_internal\"; then",
      "      echo \"[bootstrap] tigerfs mount failed for ghost:$ts_db; see /tmp/tigerfs-$ts_db.log\" >&2",
      "      cat \"/tmp/tigerfs-$ts_db.log\" >&2",
      "      exit 1",
      "    fi",
      "",
      "    # Provision a plaintext app called 'home' the first time we mount this",
      "    # database. plaintext stores arbitrary bytes verbatim — works for",
      "    # binaries (bin/tirith), text files, sqlite DBs, etc.",
      "    if [ ! -d \"$ts_internal/home\" ]; then",
      "      echo plaintext > \"$ts_internal/.build/home\"",
      "      echo \"[bootstrap] provisioned plaintext app 'home' in $ts_internal\"",
      "    fi",
      "",
      "    # First-boot seed: copy the install-time directory contents into the",
      "    # tigerfs-backed app dir before bind-mounting. Subsequent boots find",
      "    # rows already in ghost.build and skip.",
      "    if [ -z \"$(ls -A \"$ts_internal/home\" 2>/dev/null)\" ] && \\",
      "       [ -d \"$ts_target\" ] && \\",
      "       [ -n \"$(ls -A \"$ts_target\" 2>/dev/null)\" ]; then",
      "      echo \"[bootstrap] seeding $ts_internal/home from $ts_target install seed\"",
      "      cp -a \"$ts_target/.\" \"$ts_internal/home/\"",
      "    fi",
      `    chown -R "${resolvedUidStr}:${resolvedUidStr}" "$ts_internal/home"`,
      "",
      "    echo \"[bootstrap] mount --bind $ts_internal/home -> $ts_target\"",
      "    mount --bind \"$ts_internal/home\" \"$ts_target\"",
      "  done",
      "fi",
      "",
      "# Drop privileges and exec the hermes-phase entrypoint.",
      `exec setpriv --reuid=${resolvedUidStr} --regid=${resolvedUidStr} --init-groups -- /usr/local/bin/hermes-workspace-entrypoint`,
      "",
    ].join("\n")

    const entrypoint = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "trap 'kill 0' EXIT INT TERM",
      "",
      "# This is the hermes-phase entrypoint, exec'd by the root-phase bootstrap",
      "# after tigerfs FUSE + bind mounts are in place. Runs as the hermes user.",
      "",
      "# Bootstrap a hermes config.yaml into HERMES_HOME if the freshly-seeded",
      "# tigerfs mount didn't carry one (e.g. when an empty install seed was",
      "# detected and skipped). The template at",
      "# /usr/local/share/hermes-templates/config.yaml is written at build time",
      "# via withHermesConfig.",
      "if [ ! -f \"$HERMES_HOME/config.yaml\" ] && \\",
      "   [ -f /usr/local/share/hermes-templates/config.yaml ]; then",
      "  cp /usr/local/share/hermes-templates/config.yaml \"$HERMES_HOME/config.yaml\"",
      "  echo \"[entrypoint] seeded $HERMES_HOME/config.yaml from build template\"",
      "fi",
      "",
      "# Gateway env baked at build time into HERMES_HOME/.env — but the",
      "# runtime cache mount may have its own copy. Process env wins for",
      "# hermes-agent's dotenv loader, so re-export here unconditionally.",
      "export API_SERVER_ENABLED=true",
      "export API_SERVER_HOST=127.0.0.1",
      `export API_SERVER_PORT=${HERMES_GATEWAY_PORT}`,
      "",
      `export HERMES_HOME="${HERMES_HOME}"`,
      `export WORKSPACE_DIR="${WORKSPACE_DIR}"`,
      `export HERMES_API_URL="http://127.0.0.1:${HERMES_GATEWAY_PORT}"`,
      `export CLAUDE_API_URL="http://127.0.0.1:${HERMES_GATEWAY_PORT}"`,
      `export CLAUDE_AGENT_PATH=/usr/local/lib/hermes-agent`,
      "export HOST=0.0.0.0",
      `export PORT="\${PORT:-${resolvedPort}}"`,
      "export COOKIE_SECURE=0",
      'export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"',
      "",
      "if [ -z \"${CLAUDE_PASSWORD:-}\" ]; then",
      "  export CLAUDE_ALLOW_INSECURE_REMOTE=1",
      "fi",
      "",
      "# Optional tailscale userspace daemon: only starts when an auth key is",
      "# present. Userspace mode means no /dev/net/tun, no CAP_NET_ADMIN — apps",
      "# reach the tailnet via the SOCKS5/HTTP proxy on localhost:" + TS_PROXY_PORT + ".",
      "# Started BEFORE the gateway fork so the gateway's outbound calls inherit",
      "# HTTP_PROXY too. Public-internet calls still pass through cleanly.",
      "if [ -n \"${TS_AUTHKEY:-}\" ]; then",
      `  TS_STATE_DIR="/var/tmp/${TS_STATE_SUBDIR}"`,
      '  TS_SOCKET="$TS_STATE_DIR/tailscaled.sock"',
      '  mkdir -p "$TS_STATE_DIR"',
      "  echo '[tailscale] starting tailscaled (userspace networking, proxy on " + String(TS_PROXY_PORT) + ")'",
      "  tailscaled \\",
      "    --tun=userspace-networking \\",
      `    --socks5-server=localhost:${TS_PROXY_PORT} \\`,
      `    --outbound-http-proxy-listen=localhost:${TS_PROXY_PORT} \\`,
      '    --statedir="$TS_STATE_DIR" \\',
      '    --socket="$TS_SOCKET" \\',
      "    >/tmp/tailscaled.log 2>&1 &",
      "  for i in $(seq 1 60); do",
      '    if [ -S "$TS_SOCKET" ]; then break; fi',
      "    sleep 0.5",
      "  done",
      `  if ! tailscale --socket="$TS_SOCKET" up --authkey="$TS_AUTHKEY" --hostname="${resolvedTsHostname}" --accept-dns --ssh=false --reset >/tmp/tailscale-up.log 2>&1; then`,
      "    echo '[tailscale] tailscale up failed; see /tmp/tailscale-up.log'",
      "    cat /tmp/tailscale-up.log >&2 || true",
      "  else",
      `    echo "[tailscale] joined tailnet as ${resolvedTsHostname}"`,
      "  fi",
      ...(resolvedServe ? [
        // tailscale serve advertises the workspace UI back into the tailnet
        // at https://<hostname>.<tailnet>.ts.net/. Inbound connections are
        // terminated by the userspace tailscaled and proxied to the local
        // vite port — no kernel mounts, no extra caps.
        `  if tailscale --socket="$TS_SOCKET" serve --bg "http://127.0.0.1:$PORT" >/tmp/tailscale-serve.log 2>&1; then`,
        `    echo "[tailscale] serving workspace UI to tailnet"`,
        "  else",
        `    echo "[tailscale] tailscale serve failed; see /tmp/tailscale-serve.log" >&2`,
        "    cat /tmp/tailscale-serve.log >&2 || true",
        "  fi",
      ] : []),
      // NODE_OPTIONS preloads a tiny CJS shim that installs undici's
      // EnvHttpProxyAgent — without it Node 22's native fetch() ignores
      // HTTP_PROXY and the workspace's tailnet calls would bypass the proxy.
      // The Python-based gateway picks up the proxy directly via env.
      `  export HTTP_PROXY="http://localhost:${TS_PROXY_PORT}"`,
      `  export HTTPS_PROXY="http://localhost:${TS_PROXY_PORT}"`,
      `  export http_proxy="http://localhost:${TS_PROXY_PORT}"`,
      `  export https_proxy="http://localhost:${TS_PROXY_PORT}"`,
      "  export NO_PROXY=\"127.0.0.1,localhost,::1\"",
      "  export no_proxy=\"127.0.0.1,localhost,::1\"",
      `  export NODE_OPTIONS="$NODE_OPTIONS --require=${TS_BOOTSTRAP_PATH}"`,
      "fi",
      "",
      "echo '[hermes-workspace] starting hermes-agent gateway on 127.0.0.1:" + HERMES_GATEWAY_PORT + "'",
      "hermes gateway run >/tmp/hermes-gateway.log 2>&1 &",
      "",
      // Dashboard exposes the extended APIs (sessions, skills, config, jobs)
      // that the workspace UI requires for the Skills / Sessions surfaces.
      // Without it the UI shows "Skills requires a Hermes gateway that
      // exposes the extended APIs" — see hermes-workspace
      // src/server/gateway-capabilities.ts.
      "echo '[hermes-workspace] starting hermes-agent dashboard on 127.0.0.1:" + HERMES_DASHBOARD_PORT + "'",
      `hermes dashboard --host 127.0.0.1 --port ${HERMES_DASHBOARD_PORT} --no-open >/tmp/hermes-dashboard.log 2>&1 &`,
      "",
      "echo '[hermes-workspace] waiting for gateway readiness…'",
      "for i in $(seq 1 60); do",
      `  if curl -sf "http://127.0.0.1:${HERMES_GATEWAY_PORT}/health" >/dev/null 2>&1; then`,
      "    echo '[hermes-workspace] gateway is ready'",
      "    break",
      "  fi",
      "  sleep 1",
      "done",
      "",
      "echo '[hermes-workspace] waiting for dashboard readiness…'",
      "for i in $(seq 1 60); do",
      `  if curl -sf "http://127.0.0.1:${HERMES_DASHBOARD_PORT}/" >/dev/null 2>&1; then`,
      "    echo '[hermes-workspace] dashboard is ready'",
      "    break",
      "  fi",
      "  sleep 1",
      "done",
      "",
      `cd "${HERMES_WORKSPACE_DIR}"`,
      `echo "[hermes-workspace] starting workspace UI on 0.0.0.0:$PORT"`,
      // Run vite under the bun runtime. node_modules is still populated by
      // pnpm install at image-build time — bun resolves vite from
      // node_modules/.bin and uses --bun to execute it on its own runtime.
      'exec bunx --bun vite dev --host 0.0.0.0 --port "$PORT"',
      "",
    ].join("\n")

    // CJS shim: installed via NODE_OPTIONS=--require so Node 22's native
    // fetch (undici) starts honouring HTTP_PROXY / HTTPS_PROXY / NO_PROXY.
    // Skipped at runtime if those env vars are absent, so the same image
    // also works when tailscale is disabled.
    const proxyBootstrap = [
      "'use strict'",
      "if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {",
      "  try {",
      "    const undici = require('undici')",
      "    if (undici.setGlobalDispatcher && undici.EnvHttpProxyAgent) {",
      "      undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent())",
      "    }",
      "  } catch (e) {",
      "    process.stderr.write(`[proxy-bootstrap] undici not available: ${e && e.message}\\n`)",
      "  }",
      "}",
      "",
    ].join("\n")

    let ctr = dag
      .container()
      .from("node:22-bookworm-slim")
      .withExec(["apt-get", "update"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "bash",
        "ca-certificates",
        "curl",
        "ffmpeg",
        "git",
        "python3",
        "python3-pip",
        "python3-venv",
        "ripgrep",
        "tini",
        "tmux",
        "build-essential",
      ])
      .withExec(["rm", "-rf", "/var/lib/apt/lists"])
      .withEnvVariable("HERMES_HOME", HERMES_HOME)
      // node:22-bookworm-slim ships with a `node` user at UID 1000 (a
      // common collision when --hermes-uid is set to a host UID). Drop
      // any existing user/group at the target UID before creating
      // hermes so the groupadd/useradd below succeed cleanly.
      .withExec([
        "bash",
        "-lc",
        `getent passwd ${resolvedUidStr} > /dev/null && ` +
          `userdel "$(getent passwd ${resolvedUidStr} | cut -d: -f1)" || true; ` +
          `getent group ${resolvedUidStr} > /dev/null && ` +
          `groupdel "$(getent group ${resolvedUidStr} | cut -d: -f1)" || true`,
      ])
      // Create the unprivileged hermes user up front so all subsequent file
      // ownership flows through the same UID/GID.
      .withExec([
        "groupadd",
        "--system",
        "--gid",
        resolvedUidStr,
        HERMES_USER,
      ])
      .withExec([
        "useradd",
        "--system",
        "--uid",
        resolvedUidStr,
        "--gid",
        resolvedUidStr,
        "--home-dir",
        HERMES_HOME_ROOT,
        "--create-home",
        "--shell",
        "/bin/bash",
        HERMES_USER,
      ])
      // hermes needs to be in the fuse group so it can open /dev/fuse
      // for the in-workspace tigerfs mounts (fusermount3 is SUID-root,
      // so unprivileged callers can mount FUSE if they have group access).
      // -f makes the command tolerant if the fuse group hasn't been
      // created yet — apt install fuse3 below adds it; we usermod twice
      // to ensure membership regardless of install order in cached layers.
      .withExec(["bash", "-lc", `getent group fuse >/dev/null && usermod -a -G fuse ${HERMES_USER} || true`])
      .withExec(["install", "-d", "-m", "0750", "-o", HERMES_USER, "-g", HERMES_USER, HERMES_HOME])
      .withExec(["install", "-d", "-m", "0750", "-o", HERMES_USER, "-g", HERMES_USER, HERMES_CLAUDE_HOME])
      .withExec(["install", "-d", "-m", "0750", "-o", HERMES_USER, "-g", HERMES_USER, HERMES_CODEX_HOME])
      .withExec(["install", "-d", "-m", "0750", "-o", HERMES_USER, "-g", HERMES_USER, HERMES_PI_HOME])
      .withExec(["install", "-d", "-m", "0750", "-o", HERMES_USER, "-g", HERMES_USER, HERMES_FEYNMAN_HOME])
      .withExec(["install", "-d", "-m", "0750", "-o", HERMES_USER, "-g", HERMES_USER, WORKSPACE_DIR])
      // Activate the pnpm version pinned by Node's bundled corepack.
      .withExec(["bash", "-lc", "corepack enable && corepack prepare pnpm@latest --activate"])
      // Bun (installed via npm to keep the dependency chain simple) is
      // the package manager for the in-container agent CLIs — meaningfully
      // faster to install than npm. BUN_INSTALL=/usr/local lands the
      // global binaries in /usr/local/bin so they're on PATH for every
      // user.
      .withExec(["bash", "-lc", "npm install -g bun"])
      .withExec([
        "bash",
        "-lc",
        `BUN_INSTALL=/usr/local bun install --global ` +
          `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} ` +
          `@openai/codex@${CODEX_VERSION} ` +
          `@companion-ai/feynman@${FEYNMAN_VERSION} ` +
          `@mariozechner/pi-coding-agent@${PI_VERSION}`,
      ])

    // Tailscale CLI + tailscaled, delegated to the tailscale module.
    // Userspace networking only — no /dev/net/tun, no CAP_NET_ADMIN at
    // runtime. The entrypoint runs tailscaled as a SOCKS5/HTTP proxy on
    // localhost so apps inside the container reach the tailnet without
    // kernel-level wiring.
    ctr = dag.tailscale().install(ctr)

    // Ghost + TigerFS CLIs and the fuse3 userspace runtime, delegated to
    // the tigerfs module. Provides `tigerfs migrate`, `tigerfs mount`,
    // `ghost`, and fusermount3 (SUID-root) — everything the bootstrap's
    // root phase needs for per-agent FUSE mounts.
    ctr = dag.tigerfs().install(ctr)

    // Hermes Agent (Nous installer) + the dashboard web bundle. Building
    // the bundle at image-build time keeps `hermes dashboard` from
    // shelling out to npm at first launch — that was the original
    // failure mode that left the workspace UI's Skills / Sessions panes
    // disabled.
    ctr = dag.hermes().install(ctr, HERMES_HOME, HERMES_AGENT_REF)
    ctr = dag.hermes().withDashboardBundle(ctr)

    ctr = ctr
      // Now that fuse3 has created /etc/group's `fuse` entry, add hermes
      // so the unprivileged user can open /dev/fuse and run tigerfs mount
      // through fusermount3 (SUID-root). Tolerant of failure (|| true)
      // because debian's fuse3 package may not always create a `fuse`
      // group on every layout — the runtime mount will tell us if
      // permissions are wrong, with a clearer error than usermod's.
      .withExec([
        "bash",
        "-lc",
        `if getent group fuse >/dev/null; then usermod -a -G fuse ${HERMES_USER} && echo '[fuse] hermes added to group fuse' || echo '[fuse] usermod failed; runtime mount may fall back to /dev/fuse perms'; else echo '[fuse] no fuse group; assuming /dev/fuse is world-rw'; fi`,
      ])
      // Clone the workspace at a pinned tag commit, then chown so the
      // unprivileged hermes user can run pnpm install against it.
      .withExec([
        "bash",
        "-lc",
        `git clone --filter=blob:none ${HERMES_WORKSPACE_REPO} ${HERMES_WORKSPACE_DIR} && git -C ${HERMES_WORKSPACE_DIR} -c advice.detachedHead=false checkout ${HERMES_WORKSPACE_REF}`,
      ])
      .withExec([
        "bash",
        "-lc",
        `test "$(git -C ${HERMES_WORKSPACE_DIR} rev-parse HEAD)" = "${HERMES_WORKSPACE_REF}"`,
      ])
      .withExec(["chown", "-R", `${resolvedUidStr}:${resolvedUidStr}`, HERMES_WORKSPACE_DIR])
      .withExec(["chown", "-R", `${resolvedUidStr}:${resolvedUidStr}`, HERMES_HOME_ROOT])
      // Persistent pnpm store cache so rebuilds don't re-download the
      // workspace's React/Vite/Tanstack stack from scratch.
      .withMountedCache(
        "/home/hermes/.local/share/pnpm/store",
        dag.cacheVolume(`hermes-workspace-pnpm-store-${STATE_CACHE_SCOPE}`),
        { owner: `${HERMES_USER}:${HERMES_USER}` },
      )
      .withUser(HERMES_USER)
      .withWorkdir(HERMES_WORKSPACE_DIR)
      // Skip browser downloads — workspace deps include playwright/puppeteer
      // for optional features we don't need at boot, and the downloads add
      // hundreds of MB plus a fragile network step.
      .withEnvVariable("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1")
      .withEnvVariable("PUPPETEER_SKIP_DOWNLOAD", "1")
      .withExec(["bash", "-lc", "pnpm install --frozen-lockfile"])
      .withUser("root")
      .withWorkdir("/")
      .withNewFile(`${HERMES_HOME}/.env`, hermesGatewayEnv, {
        permissions: 0o640,
        owner: `${HERMES_USER}:${HERMES_USER}`,
      })
      .withNewFile(`${HERMES_CLAUDE_HOME}/.env`, hermesGatewayEnv, {
        permissions: 0o640,
        owner: `${HERMES_USER}:${HERMES_USER}`,
      })
      .withNewFile(`${HERMES_WORKSPACE_DIR}/.env`, workspaceEnv, {
        permissions: 0o640,
        owner: `${HERMES_USER}:${HERMES_USER}`,
      })
      .withNewFile("/usr/local/bin/hermes-workspace-bootstrap", bootstrap, {
        permissions: 0o755,
      })
      .withNewFile("/usr/local/bin/hermes-workspace-entrypoint", entrypoint, {
        permissions: 0o755,
      })
      .withNewFile(TS_BOOTSTRAP_PATH, proxyBootstrap, {
        permissions: 0o644,
      })
      // Workspace source mounted with hermes ownership; trust domain is kept
      // separate from HERMES_HOME. Common local secret/config directories are
      // excluded from the secure workspace mount by default.
      .withDirectory(WORKSPACE_DIR, source, {
        owner: `${HERMES_USER}:${HERMES_USER}`,
        exclude: [
          ".env",
          ".env.*",
          ".netrc",
          ".npmrc",
          ".pypirc",
          ".git/**",
          ".hermes/**",
          ".claude/**",
          ".letta/**",
          ".ssh/**",
          ".aws/**",
          ".config/**",
          ".docker/**",
          ".gcloud/**",
          ".gnupg/**",
          ".kube/**",
          "*.key",
          "*.pem",
          "secrets.*",
          "node_modules/**",
        ],
      })
      .withEnvVariable("HERMES_HOME", HERMES_HOME)
      .withEnvVariable("WORKSPACE_DIR", WORKSPACE_DIR)
      .withEnvVariable("PORT", String(resolvedPort))
      .withEnvVariable("APPROVALS_MODE", resolvedApprovals)
      .withEnvVariable("TOOLSETS", resolvedToolsets)
      .withEnvVariable("HERMES_APPROVALS", resolvedApprovals)
      .withEnvVariable("HERMES_TOOLSETS", resolvedToolsets)

    if (openrouterApiKey) {
      ctr = ctr.withSecretVariable("OPENROUTER_API_KEY", openrouterApiKey)
    }
    if (anthropicApiKey) {
      ctr = ctr.withSecretVariable("ANTHROPIC_API_KEY", anthropicApiKey)
    }
    if (openaiApiKey) {
      ctr = ctr.withSecretVariable("OPENAI_API_KEY", openaiApiKey)
    }
    if (workspacePassword) {
      ctr = ctr.withSecretVariable("CLAUDE_PASSWORD", workspacePassword)
    }
    if (tailscaleAuthKey) {
      ctr = ctr.withSecretVariable("TS_AUTHKEY", tailscaleAuthKey)
    }
    if (ghostApiKey) {
      ctr = ctr.withSecretVariable("GHOST_API_KEY", ghostApiKey)
    }
    if (resolvedAperture) {
      ctr = this.withAperture(ctr, resolvedAperture)
    }

    const trimmedGitName = gitUserName?.trim()
    const trimmedGitEmail = gitUserEmail?.trim()
    if (trimmedGitName || trimmedGitEmail) {
      const lines = ["[user]"]
      if (trimmedGitName) lines.push(`\tname = ${trimmedGitName}`)
      if (trimmedGitEmail) lines.push(`\temail = ${trimmedGitEmail}`)
      lines.push("")
      ctr = ctr.withNewFile("/etc/gitconfig", lines.join("\n"), {
        permissions: 0o644,
      })
    }

    // Container starts as root so the entrypoint can do the tigerfs FUSE
    // mounts and bind-mounts; bootstrap drops privileges to hermes via
    // setpriv before exec'ing the hermes-phase entrypoint.
    return ctr
      .withUser("root")
      .withWorkdir(WORKSPACE_DIR)
      .withExposedPort(resolvedPort, {
        description: "hermes-workspace UI",
      })
  }

  /**
   * Route OpenAI / Anthropic / OpenRouter SDK calls through a Tailscale
   * Aperture gateway. Sets the canonical SDK base-URL env vars (and their
   * older `_API_BASE` aliases) at build time so the entrypoint stays out
   * of the auth-routing business. Aperture holds the upstream provider
   * keys; per-provider `--*-api-key` Secrets only need to be non-empty
   * placeholders so the SDKs initialise.
   *
   * Chainable: takes a Container, returns the same Container with the
   * env vars layered on. Composable with hermesWorkspaceContainer or any
   * other container in this module.
   */
  @func()
  withAperture(ctr: Container, baseUrl: string): Container {
    const trimmed = baseUrl.trim().replace(/\/+$/, "")
    return ctr
      .withEnvVariable("APERTURE_BASE_URL", trimmed)
      .withEnvVariable("OPENAI_BASE_URL", `${trimmed}/v1`)
      .withEnvVariable("OPENAI_API_BASE", `${trimmed}/v1`)
      .withEnvVariable("ANTHROPIC_BASE_URL", trimmed)
      .withEnvVariable("ANTHROPIC_API_BASE", trimmed)
      .withEnvVariable("OPENROUTER_BASE_URL", `${trimmed}/v1`)
      .withEnvVariable("OPENROUTER_API_BASE", `${trimmed}/v1`)
  }

  /**
   * Persist the in-container Claude CLI state in a Dagger cache volume,
   * seeded from the host's ~/.claude on first use. Subsequent restarts
   * reuse the cache, so an in-container `claude login` is a one-time
   * cost — fresh OAuth tokens stay around. Pair with --hermes-uid set
   * to the host UID (see .env.example) so file ownership matches.
   *
   * Also peels ANTHROPIC_BASE_URL / ANTHROPIC_API_BASE so Claude SDK
   * calls go to api.anthropic.com directly — the local CLI carries its
   * own credentials and shouldn't get rewritten through Aperture even
   * when this container has been put through withAperture.
   *
   * The cache is locked (one writer at a time) since credentials are
   * security-sensitive. Apply after hermesWorkspaceContainer (which
   * creates the hermes user) and after withAperture (so the unset wins).
   */
  @func()
  withLocalClaude(ctr: Container, source: Directory): Container {
    return ctr
      .withMountedCache(HERMES_CLAUDE_HOME, dag.cacheVolume("hermes-claude-state"), {
        source: source,
        sharing: CacheSharingMode.Locked,
        owner: `${HERMES_USER}:${HERMES_USER}`,
      })
      .withoutEnvVariable("ANTHROPIC_BASE_URL")
      .withoutEnvVariable("ANTHROPIC_API_BASE")
  }

  /**
   * Persist the in-container Codex CLI state in a Dagger cache volume,
   * seeded from the host's ~/.codex on first use. Subsequent restarts
   * reuse the cache, so an in-container `codex login` is a one-time
   * cost. Pair with --hermes-uid set to the host UID so file ownership
   * matches.
   *
   * Also peels OPENAI_BASE_URL / OPENAI_API_BASE so OpenAI SDK calls go
   * to api.openai.com directly — the local CLI carries its own
   * credentials and shouldn't get rewritten through Aperture even when
   * this container has been put through withAperture.
   *
   * The cache is locked (one writer at a time) since credentials are
   * security-sensitive. Apply after hermesWorkspaceContainer (which
   * creates the hermes user) and after withAperture (so the unset wins).
   */
  @func()
  withLocalCodex(ctr: Container, source: Directory): Container {
    return ctr
      .withMountedCache(HERMES_CODEX_HOME, dag.cacheVolume("hermes-codex-state"), {
        source: source,
        sharing: CacheSharingMode.Locked,
        owner: `${HERMES_USER}:${HERMES_USER}`,
      })
      .withoutEnvVariable("OPENAI_BASE_URL")
      .withoutEnvVariable("OPENAI_API_BASE")
  }

  /**
   * Bake a hermes-agent config.yaml into the image so the entrypoint
   * seeds it into HERMES_HOME on first boot (when the cache volume is
   * empty). Subsequent boots use whatever is in the cache, so users
   * can edit the live config and have it persist across restarts.
   *
   * The body is the full YAML — pass any valid hermes-agent config.
   * For the common qwen-on-tailnet setup, see withQwenOllama.
   */
  @func()
  withHermesConfig(ctr: Container, config: string): Container {
    return ctr.withNewFile(
      "/usr/local/share/hermes-templates/config.yaml",
      config,
      { permissions: 0o644 },
    )
  }

  /**
   * Convenience: bake a config.yaml that points hermes-agent at an
   * OpenAI-compatible Ollama proxy (e.g. ollama-proxy on tailnet) and
   * sets the given model as the default. Stacks on withHermesConfig.
   *
   * Defaults match the host setup: ollama-proxy.tail396699.ts.net with
   * qwen-122b at 262k context.
   */
  @func()
  withQwenOllama(
    ctr: Container,
    /**
     * OpenAI-compatible base URL of the Ollama proxy.
     */
    baseUrl?: string,
    /**
     * Model id to make the default.
     */
    model?: string,
    /**
     * Provider name as shown in the workspace UI.
     */
    providerName?: string,
    /**
     * Context length in tokens.
     */
    contextLength?: number,
  ): Container {
    const url = baseUrl?.trim() || "http://ollama-proxy.tail396699.ts.net/v1"
    const m = model?.trim() || "qwen-122b"
    const name = providerName?.trim() || "Ollama-proxy.tail396699.ts.net"
    const ctx = contextLength && contextLength > 0 ? contextLength : 262000
    const yaml = [
      "model:",
      `  default: ${m}`,
      `  provider: ${name}`,
      "providers: {}",
      "fallback_providers: []",
      "custom_providers:",
      `- name: ${name}`,
      `  base_url: ${url}`,
      `  model: ${m}`,
      "  models:",
      `    ${m}:`,
      `      context_length: ${ctx}`,
      "agent:",
      "  max_turns: 90",
      "  gateway_timeout: 1800",
      "  api_max_retries: 3",
      "",
    ].join("\n")
    return this.withHermesConfig(ctr, yaml)
  }

  /**
   * Configure a per-agent ghost.build-backed TigerFS FUSE mount inside
   * the workspace. Declares a TIGERFS_DB_<ALIAS> env var consumed by
   * the entrypoint's mount loop. The entrypoint runs as the hermes user
   * end to end — fusermount3 (SUID-root) handles the mount syscall, so
   * nothing in the workspace process tree runs as root, and the FUSE
   * mount is owned by the unprivileged user that called fusermount.
   *
   * Chainable: call once per agent state directory. The `alias` must
   * be unique across calls — it namespaces the env var so the
   * entrypoint can iterate every mount. Lowercase alphanumerics + hyphens.
   *
   * Caller must pass `--insecure-root-capabilities=true` to as-service
   * (or use hermesWorkspaceService with --ghost-api-key, which wires
   * it automatically) — FUSE mount(8) needs CAP_SYS_ADMIN at the
   * container level even though the calling user is unprivileged.
   *
   * Apply after hermesWorkspaceContainer (which installs tigerfs +
   * ghost CLIs, adds hermes to the fuse group, and creates the standard
   * agent state dirs).
   */
  @func()
  withTigerFs(
    ctr: Container,
    databaseName: string,
    mountPath: string,
    alias: string,
  ): Container {
    const safeAlias = alias.trim().toLowerCase().replace(/[^a-z0-9-]/g, "")
    if (!safeAlias) {
      throw new Error(`withTigerFs: alias must contain at least one alphanumeric character, got: ${alias}`)
    }
    const envName = `TIGERFS_DB_${safeAlias.toUpperCase().replace(/-/g, "_")}`
    const value = `${databaseName}|${mountPath}`
    return ctr.withEnvVariable(envName, value)
  }

  /**
   * Long-lived secure Hermes workspace service. Returns a Dagger Service so
   * Dagger manages lifecycle and health checks. The hardened default path
   * keeps experimentalPrivilegedNesting and insecureRootCapabilities off
   * — they're only set when --ghost-api-key is supplied (which spins up
   * per-agent TigerFS sidecars and NFS-mounts them, requiring
   * CAP_SYS_ADMIN inside the workspace). experimentalSkipHealthcheck is
   * never set.
   *
   * --ghost-api-key opts into per-agent ghost.build-backed TigerFS for
   * .hermes / .claude / .pi / .feynman. Each gets its own dedicated
   * database (hermes-state, claude-state, pi-state, feynman-state) and
   * NFS-exported sidecar — agent state is transactional, versioned, and
   * isolated by agent. localClaude / localCodex are mutually exclusive
   * with the ghost-backed mounts (the path collisions are detected at
   * runtime if both are supplied; tigerfs wins on path order).
   */
  @func()
  hermesWorkspaceService(
    source: Directory,
    openrouterApiKey?: Secret,
    anthropicApiKey?: Secret,
    openaiApiKey?: Secret,
    workspacePassword?: Secret,
    tailscaleAuthKey?: Secret,
    tailscaleHostname?: string,
    apertureBaseUrl?: string,
    port?: number,
    approvalsMode?: string,
    toolsets?: string,
    hermesUid?: number,
    ghostApiKey?: Secret,
    tailscaleServe?: boolean,
    localClaude?: Directory,
    localCodex?: Directory,
    /**
     * If true, bake the qwen-on-tailnet config into the image so the
     * entrypoint seeds it on first boot (cache-volume empty). Defaults
     * to true — pass --qwen-ollama=false to opt out.
     */
    qwenOllama?: boolean,
    /**
     * Override the default qwen base_url, model, provider name, or
     * context length when --qwen-ollama is enabled.
     */
    qwenOllamaBaseUrl?: string,
    qwenOllamaModel?: string,
    qwenOllamaProviderName?: string,
    qwenOllamaContextLength?: number,
    /** Git user.name written to /etc/gitconfig for in-container commits. */
    gitUserName?: string,
    /** Git user.email written to /etc/gitconfig for in-container commits. */
    gitUserEmail?: string,
  ): Service {
    let ctr = this.hermesWorkspaceContainer(
      source,
      openrouterApiKey,
      anthropicApiKey,
      openaiApiKey,
      workspacePassword,
      tailscaleAuthKey,
      tailscaleHostname,
      apertureBaseUrl,
      port,
      approvalsMode,
      toolsets,
      hermesUid,
      tailscaleServe,
      ghostApiKey,
      gitUserName,
      gitUserEmail,
    )
    if (qwenOllama !== false) {
      ctr = this.withQwenOllama(
        ctr,
        qwenOllamaBaseUrl,
        qwenOllamaModel,
        qwenOllamaProviderName,
        qwenOllamaContextLength,
      )
    }
    // Persist agent state across restarts via per-agent ghost.build-backed
    // TigerFS FUSE mounts. Each agent's home directory ($HERMES_HOME,
    // $HERMES_CLAUDE_HOME, $HERMES_PI_HOME, $HERMES_FEYNMAN_HOME) gets its
    // own dedicated database (hermes-state, claude-state, pi-state,
    // feynman-state). FUSE mount(8) requires CAP_SYS_ADMIN at the
    // container level — fusermount3 is SUID-root for the per-mount syscall,
    // but the kernel still gates the mount itself behind the capability.
    ctr = this.withTigerFs(ctr, "hermes-state", HERMES_HOME, "hermes")
    ctr = this.withTigerFs(ctr, "claude-state", HERMES_CLAUDE_HOME, "claude")
    ctr = this.withTigerFs(ctr, "pi-state", HERMES_PI_HOME, "pi")
    ctr = this.withTigerFs(ctr, "feynman-state", HERMES_FEYNMAN_HOME, "feynman")
    if (localClaude !== undefined) {
      ctr = this.withLocalClaude(ctr, localClaude)
    }
    if (localCodex !== undefined) {
      ctr = this.withLocalCodex(ctr, localCodex)
    }
    return ctr.asService({
      args: ["/usr/bin/tini", "--", "/usr/local/bin/hermes-workspace-bootstrap"],
      insecureRootCapabilities: ghostApiKey !== undefined,
    })
  }

  /**
   * Non-blocking validation that the secure container compiles and the
   * Hermes setup is in place. Reports rendered config and CLI presence
   * without starting the long-lived service.
   */
  @func()
  async hermesWorkspaceCheck(
    source: Directory,
    openrouterApiKey?: Secret,
    anthropicApiKey?: Secret,
    openaiApiKey?: Secret,
    workspacePassword?: Secret,
    tailscaleAuthKey?: Secret,
    tailscaleHostname?: string,
    apertureBaseUrl?: string,
    hermesUid?: number,
  ): Promise<string> {
    const ctr = this.hermesWorkspaceContainer(
      source,
      openrouterApiKey,
      anthropicApiKey,
      openaiApiKey,
      workspacePassword,
      tailscaleAuthKey,
      tailscaleHostname,
      apertureBaseUrl,
      undefined,
      undefined,
      undefined,
      hermesUid,
    )

    return ctr
      .withExec([
        "sh",
        "-c",
        [
          "echo '== whoami =='",
          "id",
          "echo",
          "echo '== hermes --version =='",
          "(command -v hermes && hermes --version) || echo 'hermes CLI not found on PATH'",
          "echo",
          "echo '== hermes gateway --help (first 5 lines) =='",
          "hermes gateway --help 2>&1 | sed -n '1,5p' || echo 'gateway subcommand unavailable'",
          "echo",
          "echo '== node --version =='",
          "node --version",
          "echo",
          "echo '== pnpm --version =='",
          "pnpm --version",
          "echo",
          "echo '== claude --version =='",
          "(command -v claude && claude --version) || echo 'claude CLI not found on PATH'",
          "echo",
          "echo '== codex --version =='",
          "(command -v codex && codex --version) || echo 'codex CLI not found on PATH'",
          "echo",
          "echo '== feynman --version =='",
          "(command -v feynman && feynman --version) || echo 'feynman CLI not found on PATH'",
          "echo",
          "echo '== pi --version =='",
          "(command -v pi && pi --version) || echo 'pi CLI not found on PATH'",
          "echo",
          `echo '== ${HERMES_WORKSPACE_DIR} HEAD =='`,
          `git -C ${HERMES_WORKSPACE_DIR} rev-parse HEAD`,
          `git -C ${HERMES_WORKSPACE_DIR} describe --tags --always`,
          "echo",
          `echo '== workspace install artifacts =='`,
          `ls ${HERMES_WORKSPACE_DIR}/node_modules/.bin/vite 2>&1`,
          `${HERMES_WORKSPACE_DIR}/node_modules/.bin/vite --version 2>&1`,
          "echo",
          "echo '== tailscale --version =='",
          "(command -v tailscale && tailscale --version) || echo 'tailscale CLI not found on PATH'",
          "(command -v tailscaled && tailscaled --version) || echo 'tailscaled not found on PATH'",
          "echo",
          `echo '== proxy bootstrap shim =='`,
          `head -n 6 ${TS_BOOTSTRAP_PATH} 2>&1 || echo 'bootstrap shim missing'`,
          "echo",
          "echo '== aperture wiring =='",
          'echo "APERTURE_BASE_URL=${APERTURE_BASE_URL:-<unset>}"',
          "echo",
          `echo '== gateway env file (non-secret) =='`,
          `cat ${HERMES_HOME}/.env`,
          "echo",
          `echo '== workspace .env (non-secret) =='`,
          `cat ${HERMES_WORKSPACE_DIR}/.env`,
          "echo",
          "echo '== workspace listing =='",
          `ls -la ${WORKSPACE_DIR} | head -n 20`,
        ].join("\n"),
      ])
      .stdout()
  }

}

function sanitizeHostname(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  // Tailscale device names: lowercase letters, digits, hyphens; <= 63 chars,
  // must start/end with alphanumeric. Anything else falls back to the
  // hostname-derived default.
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmed)) return undefined
  return trimmed
}

function sanitizeCsv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const cleaned = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9._:\/-]+$/.test(s))
  if (cleaned.length === 0) return undefined
  return cleaned.join(",")
}

function sanitizeChoice(
  value: string | undefined,
  allowed: string[],
  fallback: string,
): string {
  if (!value) return fallback
  return allowed.includes(value) ? value : fallback
}

function normalizePort(value: number | undefined): number {
  if (!Number.isInteger(value)) return DEFAULT_PORT
  const port = value as number
  if (port < 1024 || port > 65535) return DEFAULT_PORT
  return port
}

function normalizeUid(value: number | undefined): number {
  if (!Number.isInteger(value)) return DEFAULT_HERMES_UID
  const uid = value as number
  // Refuse 0/system UIDs — the hermes user must be unprivileged. Stay below
  // the typical NSS overflow UID (65534=nobody) so chowns don't collide.
  if (uid < 1000 || uid > 65533) return DEFAULT_HERMES_UID
  return uid
}
