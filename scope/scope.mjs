import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import picomatch from 'picomatch'

const checkName =
  /^[a-zA-Z0-9_][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9_][a-zA-Z0-9._-]*)*$/
function checkNames(links, main) {
  return links.map((link) => {
    const name = new URL(link).searchParams.get('check')
    if (!name || !checkName.test(name)) {
      throw new Error('Invalid Dagger check name')
    }
    // Loading the resolver with -m qualifies the workspace's main checks.
    return main && name.startsWith(`${main}/`)
      ? name.slice(main.length + 1)
      : name
  })
}

function expand(selector, names) {
  const checks = names.filter(
    (name) =>
      name === selector ||
      (!selector.includes('/') && name.startsWith(`${selector}/`)),
  )
  if (!checks.length) {
    throw new Error(`No Dagger check matches ${selector}`)
  }
  return checks
}

function select(rules, paths, names, always) {
  if (!Array.isArray(rules) || rules.at(-1)?.glob !== '**') {
    throw new Error('Expected a rule list ending in a ** catch-all')
  }
  const matchers = rules.map((rule) => {
    const { glob, affects: { checks } = {} } = rule
    if (typeof glob !== 'string' || !glob || !Array.isArray(checks)) {
      throw new Error('Invalid scope rule')
    }
    const selectors = checks.flatMap((id) => {
      if (id === '*') return [id]
      if (typeof id !== 'string' || !checkName.test(id)) {
        throw new Error('Invalid Dagger check selector')
      }
      return expand(id, names)
    })
    return { glob, matches: picomatch(glob, { dot: true }), selectors }
  })
  if (!matchers.at(-1).selectors.includes('*')) {
    throw new Error('The catch-all must select every check')
  }

  if (!paths.length) return { reason: 'The changed path list is empty' }
  const selected = new Set(always.flatMap((id) => expand(id, names)))
  const matched = new Set()
  for (const path of paths) {
    if (path === 'ci/scope.json') {
      return { reason: 'The scope manifest changed' }
    }
    const rule = matchers.find(({ matches }) => matches(path))
    if (!rule || rule.selectors.includes('*')) {
      return { reason: 'A changed path requires the full check suite' }
    }
    rule.selectors.forEach((id) => selected.add(id))
    matched.add(rule.glob)
  }

  return selected.size
    ? { selected: [...selected].sort(), matched: [...matched] }
    : { reason: 'The changed paths selected no checks' }
}

const git = (...args) =>
  execFileSync('git', ['--git-dir=/git', '--no-replace-objects', ...args], {
    encoding: 'utf8',
  })

const readInput = (name) =>
  JSON.parse(readFileSync(`/inputs/${name}.json`, 'utf8'))

let result
try {
  const [mergeSha, headSha] = readInput('merge')
  const [merge, base, head, extraParent] = git(
    'rev-list',
    '-1',
    '--parents',
    'HEAD',
  )
    .trim()
    .split(' ')
  if (merge !== mergeSha || !base || !head || head !== headSha || extraParent) {
    throw new Error(
      'The workspace does not match the expected pull request merge commit',
    )
  }

  const rules = JSON.parse(git('show', `${base}:ci/scope.json`))
  const paths = git(
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    base,
    merge,
    '--',
  )
    .split('\0')
    .filter(Boolean)
  result = select(
    rules,
    paths,
    checkNames(readInput('checks'), readInput('main')),
    readInput('always'),
  )
} catch (error) {
  result = { reason: error.message }
}

const label = (value) => '`' + value.replace(/[`<>\x00-\x1f\x7f]/g, '?') + '`'
const summary = result.reason
  ? `All Dagger checks run. ${label(result.reason.slice(0, 200))}`
  : [
      `Checks: ${result.selected.map(label).join(', ')}`,
      `Matched rules: ${result.matched.map(label).join(', ')}`,
    ].join('\n\n')

console.log(
  JSON.stringify({
    args: result.selected?.flatMap((name) => ['--check', name]) ?? [],
    summary: `### Dagger check scope\n\n${summary}\n`,
  }),
)
