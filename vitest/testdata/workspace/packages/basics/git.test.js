import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

test('initializes a git repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-'))
  execFileSync('git', ['init', '--quiet', dir])
  expect(
    execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'])
      .toString()
      .trim(),
  ).toBe('true')
})
