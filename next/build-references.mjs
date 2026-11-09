// Next's type check follows the app's tsconfig `references` and fails with
// TS6305 on projects that haven't been built.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('tsconfig.json')) {
  process.exit(0)
}

const tsc = (args, options) =>
  spawnSync('pnpm', ['exec', 'tsc', ...args], { encoding: 'utf8', ...options })

const fail = ({ error, status }) => {
  if (error) {
    console.error(`Could not run tsc: ${error.message}`)
  }
  process.exit(status ?? 1)
}

const config = tsc(['--project', '.', '--showConfig'], {
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (config.error || config.status !== 0) {
  // tsc reports tsconfig errors on stdout.
  process.stderr.write(config.stdout ?? '')
  fail(config)
}

const { references = [] } = JSON.parse(config.stdout)
if (references.length > 0) {
  const build = tsc(['--build', ...references.map(({ path }) => path)], {
    stdio: 'inherit',
  })
  if (build.error || build.status !== 0) {
    fail(build)
  }
}
