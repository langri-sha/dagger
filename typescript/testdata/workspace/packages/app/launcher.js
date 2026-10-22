import { readFileSync } from 'node:fs'

const launcher = readFileSync(
  new URL('node_modules/esbuild/bin/esbuild', import.meta.url),
)

process.stdout.write(launcher.subarray(1, 4).toString())
