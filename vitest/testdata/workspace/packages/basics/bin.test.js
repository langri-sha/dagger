import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('runs a tool from node_modules/.bin', () => {
  expect(execFileSync('vitest', ['--version']).toString()).toContain('5.0.4')
})
