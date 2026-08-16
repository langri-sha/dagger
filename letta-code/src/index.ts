/**
 * Run Letta Code (the @letta-ai/letta-code CLI) inside a Dagger container.
 *
 * Three-step layering:
 *   1. container() — base Node + bun + the CLI, no project context
 *   2. code()      — adds a workspace Directory and optional agent id
 *   3. run() / terminal() — execute the CLI with a prompt or interactively
 *
 * Auth: pass --api-key as a Dagger Secret.
 */
import {
  dag,
  object,
  func,
  Secret,
  Container,
  Directory,
} from '@dagger.io/dagger'

const WORKSPACE_DIR = '/workspace'
const LETTA_BASE_URL = 'https://api.letta.com'

@object()
export class LettaCode {
  /**
   * Base container with Node, bun, gh, build deps, and the Letta Code CLI
   * preinstalled. LETTA_API_KEY is wired in as a secret env var; the
   * upstream LETTA_BASE_URL default is set so SDK calls hit api.letta.com.
   */
  @func()
  container(apiKey: Secret): Container {
    return dag
      .container()
      .from('node:current-slim')
      .withExec(['apt-get', 'update'])
      .withExec([
        'apt-get',
        'install',
        '-y',
        'gh',
        'python3',
        'make',
        'g++',
        'git',
      ])
      .withExec(['npm', 'install', '-g', 'bun'])
      .withEnvVariable('PATH', '/root/.bun/bin:$PATH', { expand: true })
      .withExec(['bun', 'install', '-g', '@letta-ai/letta-code'])
      .withSecretVariable('LETTA_API_KEY', apiKey)
      .withEnvVariable('LETTA_BASE_URL', LETTA_BASE_URL)
  }

  /**
   * Layer the caller's source directory on top of the base container,
   * mounted at /workspace, optionally pinning an agent id via env.
   */
  @func()
  code(apiKey: Secret, source: Directory, agentId?: string): Container {
    let ctr = this.container(apiKey)
      .withWorkdir(WORKSPACE_DIR)
      .withDirectory(WORKSPACE_DIR, source)

    if (agentId) {
      ctr = ctr.withEnvVariable('LETTA_AGENT_ID', agentId)
    }

    return ctr
  }

  /**
   * Run a one-shot prompt and return the agent's text output.
   */
  @func()
  async run(
    apiKey: Secret,
    source: Directory,
    prompt: string,
    agentId?: string,
  ): Promise<string> {
    return this.code(apiKey, source, agentId)
      .withExec(['letta', '-p', prompt, '--output-format', 'text'])
      .stdout()
  }

  /**
   * Drop into an interactive Letta Code session inside the container.
   * Pass --yolo to skip per-tool approvals.
   */
  @func()
  terminal(
    apiKey: Secret,
    source: Directory,
    agentId?: string,
    yolo?: boolean,
  ): Container {
    const cmd = ['letta']
    if (yolo) cmd.push('--yolo')

    return this.code(apiKey, source, agentId).terminal({ cmd })
  }
}
