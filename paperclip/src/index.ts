/*
 * Dagger module for Paperclip (paperclipai/paperclip), the TypeScript
 * control plane for coordinating CLI agents.
 *
 * Runtime state lives under /paperclip: embedded PGlite, local storage,
 * secrets/master.key, agent workspaces, logs, and config. service() mounts
 * that path as a locked Dagger cache volume because embedded PG/PGlite is a
 * single-writer runtime. Package-manager caches are shared build caches only.
 *
 * Tailscale is optional and secret-gated. Pass tailscaleAuthKey as a Dagger
 * Secret; the module never creates, prints, or stores auth keys in source.
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

const PAPERCLIP_REPO = "https://github.com/paperclipai/paperclip.git"
const PAPERCLIP_REF = "master"
const PAPERCLIP_HOME = "/paperclip"
const PAPERCLIP_WORKDIR = "/app"
const DEFAULT_PORT = 3100
const DEFAULT_DATA_CACHE = "paperclip-data"
const DEFAULT_DEPLOYMENT_MODE = "authenticated"
const DEFAULT_DEPLOYMENT_EXPOSURE = "private"
const DEFAULT_TAILSCALE_HOSTNAME = "paperclip"
const TS_PROXY_PORT = 1055
const TS_STATE_DIR = `${PAPERCLIP_HOME}/tailscale`

@object()
export class Paperclip {
  /**
   * Build a Paperclip runtime container from source.
   *
   * If source is omitted, this clones paperclipai/paperclip@master. The build
   * mirrors the upstream Dockerfile, but uses Dagger cache volumes for pnpm and
   * npm downloads so repeated toolchain builds do not redownload dependencies.
   */
  @func()
  async container(
    source?: Directory,
    anthropicApiKey?: Secret,
    openaiApiKey?: Secret,
    betterAuthSecret?: Secret,
    databaseUrl?: Secret,
    tailscaleAuthKey?: Secret,
    tailscaleHostname?: string,
    tailscaleServe?: boolean,
    port?: number,
    paperclipPublicUrl?: string,
    deploymentMode?: string,
    deploymentExposure?: string,
  ): Promise<Container> {
    const resolvedSource = source ?? dag.git(PAPERCLIP_REPO).branch(PAPERCLIP_REF).tree({ discardGitDir: true })
    const resolvedPort = normalizePort(port)
    const resolvedDeploymentMode = sanitizeChoice(
      deploymentMode,
      ["local_trusted", "authenticated"],
      DEFAULT_DEPLOYMENT_MODE,
    )
    const resolvedDeploymentExposure = sanitizeChoice(
      deploymentExposure,
      ["private", "public"],
      DEFAULT_DEPLOYMENT_EXPOSURE,
    )
    const resolvedPublicUrl = paperclipPublicUrl?.trim() || `http://localhost:${resolvedPort}`
    const resolvedTsHostname = sanitizeHostname(tailscaleHostname) ?? DEFAULT_TAILSCALE_HOSTNAME
    const resolvedTsServe = tailscaleServe === true

    const tsDaemon = await dag
      .tailscale()
      .daemonSnippet(resolvedTsHostname, {
        authKeyEnv: "TS_AUTHKEY",
        proxyPort: TS_PROXY_PORT,
        stateDir: TS_STATE_DIR,
      })
    const tsServe = resolvedTsServe
      ? await dag.tailscale().serveSnippet("http://127.0.0.1:$PORT")
      : ""
    const tsProxyEnv = await dag.tailscale().proxyEnvSnippet({ proxyPort: TS_PROXY_PORT })

    const entrypoint = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "# Optional userspace Tailscale. TS_AUTHKEY is injected only via Dagger Secret.",
      "if [ -n \"${TS_AUTHKEY:-}\" ]; then",
      indent(tsDaemon, 2),
      ...(resolvedTsServe ? [indent(tsServe, 2)] : []),
      indent(tsProxyEnv, 2),
      "fi",
      "",
      "exec docker-entrypoint.sh \"$@\"",
      "",
    ].join("\n")

    let ctr = dag
      .container()
      .from("node:lts-trixie-slim")
      .withExec(["apt-get", "update", "-qq"])
      .withExec([
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "bash",
        "ca-certificates",
        "curl",
        "gh",
        "git",
        "gosu",
        "jq",
        "openssh-client",
        "python3",
        "ripgrep",
        "wget",
      ])
      .withExec(["rm", "-rf", "/var/lib/apt/lists"])
      .withEnvVariable("PNPM_HOME", "/usr/local/share/pnpm")
      .withEnvVariable("PATH", "$PNPM_HOME:$PATH", { expand: true })
      .withExec(["bash", "-lc", "corepack enable && corepack prepare pnpm@9.15.0 --activate"])
      .withMountedCache(
        "/root/.local/share/pnpm/store",
        dag.cacheVolume("paperclip-pnpm-store"),
        { sharing: CacheSharingMode.Shared },
      )
      .withMountedCache(
        "/root/.npm",
        dag.cacheVolume("paperclip-npm-cache"),
        { sharing: CacheSharingMode.Shared },
      )
      .withWorkdir(PAPERCLIP_WORKDIR)
      .withDirectory(PAPERCLIP_WORKDIR, resolvedSource, {
        exclude: [
          ".git/**",
          "node_modules/**",
          "**/node_modules/**",
          "data/**",
          ".env",
          ".env.*",
        ],
      })
      .withExec(["pnpm", "config", "set", "store-dir", "/root/.local/share/pnpm/store"])
      .withExec(["pnpm", "install", "--frozen-lockfile"])
      .withExec(["pnpm", "--filter", "@paperclipai/ui", "build"])
      .withExec(["pnpm", "--filter", "@paperclipai/plugin-sdk", "build"])
      .withExec(["pnpm", "--filter", "@paperclipai/server", "build"])
      .withExec(["test", "-f", "server/dist/index.js"])
      .withExec([
        "npm",
        "install",
        "--global",
        "--omit=dev",
        "@anthropic-ai/claude-code@latest",
        "@openai/codex@latest",
        "opencode-ai",
      ])
      .withExec(["install", "-d", "-m", "0750", "-o", "node", "-g", "node", PAPERCLIP_HOME])
      .withExec(["chown", "-R", "node:node", PAPERCLIP_WORKDIR])
      .withEnvVariable("NODE_ENV", "production")
      .withEnvVariable("HOME", PAPERCLIP_HOME)
      .withEnvVariable("HOST", "0.0.0.0")
      .withEnvVariable("PORT", String(resolvedPort))
      .withEnvVariable("SERVE_UI", "true")
      .withEnvVariable("PAPERCLIP_HOME", PAPERCLIP_HOME)
      .withEnvVariable("PAPERCLIP_INSTANCE_ID", "default")
      .withEnvVariable("PAPERCLIP_CONFIG", `${PAPERCLIP_HOME}/instances/default/config.json`)
      .withEnvVariable("PAPERCLIP_DEPLOYMENT_MODE", resolvedDeploymentMode)
      .withEnvVariable("PAPERCLIP_DEPLOYMENT_EXPOSURE", resolvedDeploymentExposure)
      .withEnvVariable("PAPERCLIP_PUBLIC_URL", resolvedPublicUrl)
      .withEnvVariable("OPENCODE_ALLOW_ALL_MODELS", "true")
      .withNewFile("/usr/local/bin/paperclip-dagger-entrypoint", entrypoint, {
        permissions: 0o755,
      })
      .withEntrypoint(["/usr/local/bin/paperclip-dagger-entrypoint"])
      .withDefaultArgs([
        "node",
        "--import",
        "./server/node_modules/tsx/dist/loader.mjs",
        "server/dist/index.js",
      ])
      .withExposedPort(resolvedPort, { description: "Paperclip API and UI" })

    if (tailscaleAuthKey) {
      ctr = dag.tailscale().install(ctr, { release: "trixie" })
      ctr = ctr.withSecretVariable("TS_AUTHKEY", tailscaleAuthKey)
    }
    if (anthropicApiKey) {
      ctr = ctr.withSecretVariable("ANTHROPIC_API_KEY", anthropicApiKey)
    }
    if (openaiApiKey) {
      ctr = ctr.withSecretVariable("OPENAI_API_KEY", openaiApiKey)
    }
    if (betterAuthSecret) {
      ctr = ctr.withSecretVariable("BETTER_AUTH_SECRET", betterAuthSecret)
    }
    if (databaseUrl) {
      ctr = ctr.withSecretVariable("DATABASE_URL", databaseUrl)
    }

    return ctr
  }

  /**
   * Run Paperclip as a long-lived Dagger service.
   *
   * /paperclip is a locked cache volume because embedded PGlite and the local
   * secrets/master.key must not be concurrently written by multiple services.
   * For persistent production on Hetzner, prefer host-level Tailscale plus an
   * external Postgres/database backup plan over container-level tailnet state.
   */
  @func()
  async service(
    source?: Directory,
    anthropicApiKey?: Secret,
    openaiApiKey?: Secret,
    betterAuthSecret?: Secret,
    databaseUrl?: Secret,
    tailscaleAuthKey?: Secret,
    tailscaleHostname?: string,
    tailscaleServe?: boolean,
    port?: number,
    paperclipPublicUrl?: string,
    deploymentMode?: string,
    deploymentExposure?: string,
    dataCacheName?: string,
  ): Promise<Service> {
    const cacheName = dataCacheName?.trim() || DEFAULT_DATA_CACHE
    const ctr = await this.container(
      source,
      anthropicApiKey,
      openaiApiKey,
      betterAuthSecret,
      databaseUrl,
      tailscaleAuthKey,
      tailscaleHostname,
      tailscaleServe,
      port,
      paperclipPublicUrl,
      deploymentMode,
      deploymentExposure,
    )

    return ctr
      .withMountedCache(PAPERCLIP_HOME, dag.cacheVolume(cacheName), {
        sharing: CacheSharingMode.Locked,
        owner: "node:node",
      })
      .asService()
  }

  /**
   * Non-blocking validation that the Paperclip image builds and expected tools
   * are present. It does not start the long-lived server or join a tailnet.
   */
  @func()
  async check(source?: Directory): Promise<string> {
    const ctr = await this.container(source)
    return ctr
      .withExec([
        "sh",
        "-c",
        [
          "echo '== node =='",
          "node --version",
          "echo",
          "echo '== pnpm =='",
          "pnpm --version",
          "echo",
          "echo '== paperclip build artifacts =='",
          "test -f server/dist/index.js && ls -l server/dist/index.js",
          "test -d ui/dist && ls -ld ui/dist",
          "echo",
          "echo '== agent CLIs =='",
          "(command -v claude && claude --version) || echo 'claude CLI not found'",
          "(command -v codex && codex --version) || echo 'codex CLI not found'",
          "(command -v opencode && opencode --version) || echo 'opencode CLI not found'",
          "echo",
          "echo '== runtime env (non-secret) =='",
          "printf 'PAPERCLIP_HOME=%s\\nPORT=%s\\nPAPERCLIP_DEPLOYMENT_MODE=%s\\nPAPERCLIP_DEPLOYMENT_EXPOSURE=%s\\n' \"$PAPERCLIP_HOME\" \"$PORT\" \"$PAPERCLIP_DEPLOYMENT_MODE\" \"$PAPERCLIP_DEPLOYMENT_EXPOSURE\"",
        ].join("\n"),
      ])
      .stdout()
  }
}

function sanitizeHostname(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmed)) return undefined
  return trimmed
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

function indent(text: string, n: number): string {
  const pad = " ".repeat(n)
  return text
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n")
}
