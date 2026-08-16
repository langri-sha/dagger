/**
 * Reusable Dagger building blocks for the Nous `hermes-agent` CLI.
 *
 * `hermes-agent` is a Python package distributed via an upstream installer
 * script. It ships the `hermes` binary, a gateway that exposes the agent
 * over HTTP on :8642, and a dashboard on :9119 that fronts the gateway
 * for the workspace UI's Sessions / Skills / Config panes.
 *
 * What this module gives you:
 *   - install()             — drop the `hermes` binary into a container by
 *                             running the upstream installer
 *   - withDashboardBundle() — pre-build the dashboard's `web/` bundle so
 *                             `hermes dashboard` doesn't try to npm-install
 *                             at first launch (which fails in hardened
 *                             containers)
 *   - check()               — smoke test: install into a fresh debian
 *                             container and dump versions
 *
 * The workspace UI (`dagger/hermes-workspace/`) layers on top of this with
 * the Vite dev server + tailscale + tigerfs mounts.
 */
import { dag, Container, object, func } from '@dagger.io/dagger'

const DEFAULT_HERMES_HOME = '/home/hermes/.hermes'
const DEFAULT_AGENT_PATH = '/usr/local/lib/hermes-agent'
// Pinned installer commit. Bump explicitly so changes are reviewable; the
// upstream `main` branch is a moving target.
const DEFAULT_AGENT_REF = '167b5648ea609aafa85f56c5714f7abda5091ed6'

@object()
export class Hermes {
  /**
   * Install the upstream NousResearch/hermes-agent package into `ctr`.
   *
   * The installer pins a hermes-agent commit (DEFAULT_AGENT_REF) and is
   * run with --skip-setup so no interactive prompts; HERMES_HOME points
   * at an isolated state directory the caller controls.
   *
   * Assumes the container has bash + curl on PATH. node:22-bookworm-slim
   * needs `apt-get install -y --no-install-recommends ca-certificates
   * curl python3 python3-pip python3-venv build-essential` first.
   */
  @func()
  install(
    ctr: Container,
    /**
     * HERMES_HOME inside the container. Defaults to /home/hermes/.hermes.
     */
    hermesHome?: string,
    /**
     * git ref of NousResearch/hermes-agent the installer should pull.
     * Defaults to the pinned commit DEFAULT_AGENT_REF.
     */
    agentRef?: string,
  ): Container {
    const home = hermesHome?.trim() || DEFAULT_HERMES_HOME
    const ref = agentRef?.trim() || DEFAULT_AGENT_REF
    const url = `https://raw.githubusercontent.com/NousResearch/hermes-agent/${ref}/scripts/install.sh`
    return ctr.withExec([
      'bash',
      '-lc',
      `curl -fsSL ${url} | bash -s -- --skip-setup --hermes-home ${home}`,
    ])
  }

  /**
   * Pre-build the hermes dashboard's `web/` bundle inside the image.
   *
   * `hermes dashboard` calls `_build_web_ui` (hermes_cli/main.py) on first
   * launch, which shells out to `npm install && npm run build` and exits
   * non-zero on failure. In a fresh hardened container that build hits
   * sandbox restrictions and the dashboard process exits 1, leaving
   * Skills / Sessions / Config disabled in the workspace UI. Building the
   * bundle once at image-build time lands `hermes_cli/web_dist/` in the
   * image so the runtime path skips the npm shell-out entirely.
   *
   * Requires `npm` on PATH (node:22-bookworm-slim has it).
   */
  @func()
  withDashboardBundle(
    ctr: Container,
    /**
     * Directory containing the unpacked hermes-agent source. Defaults to
     * /usr/local/lib/hermes-agent (where the installer drops it for root).
     */
    agentPath?: string,
  ): Container {
    const path = agentPath?.trim() || DEFAULT_AGENT_PATH
    return ctr.withExec([
      'bash',
      '-lc',
      `cd ${path}/web && npm install --no-audit --no-fund --prefer-offline && npm run build && test -e ${path}/hermes_cli/web_dist/index.html`,
    ])
  }

  /**
   * Smoke-test container: drop into debian:trixie-slim, install the
   * minimum apt deps the upstream installer needs, run install(), and
   * dump `hermes version` + `hermes gateway --help` first lines so a
   * caller can tell the install layer is intact end-to-end.
   */
  @func()
  check(
    /**
     * Override HERMES_HOME passed to the installer. Default
     * /home/hermes/.hermes.
     */
    hermesHome?: string,
    agentRef?: string,
  ): Container {
    const base = dag
      .container()
      .from('debian:trixie-slim')
      .withExec(['apt-get', 'update', '-qq'])
      .withExec([
        'apt-get',
        'install',
        '-y',
        '--no-install-recommends',
        'bash',
        'ca-certificates',
        'curl',
        'git',
        'python3',
        'python3-pip',
        'python3-venv',
        'build-essential',
      ])
      .withExec(['rm', '-rf', '/var/lib/apt/lists'])

    return this.install(base, hermesHome, agentRef).withExec([
      'sh',
      '-c',
      [
        "echo '== hermes version =='",
        'hermes version || hermes --version',
        'echo',
        "echo '== hermes gateway --help (first 5 lines) =='",
        "hermes gateway --help 2>&1 | sed -n '1,5p'",
        'echo',
        "echo '== hermes dashboard --help (first 5 lines) =='",
        "hermes dashboard --help 2>&1 | sed -n '1,5p'",
      ].join('\n'),
    ])
  }
}
