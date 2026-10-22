import { readFileSync, writeFileSync } from 'node:fs'

const message = readFileSync(
  new URL('src/message.txt', import.meta.url),
  'utf8',
)

writeFileSync(new URL('generated.txt', import.meta.url), message.toUpperCase())
