import { writeFileSync } from 'node:fs'

writeFileSync(
  new URL('greeting.js', import.meta.url),
  "export default 'Hello from prepare'\n",
)
