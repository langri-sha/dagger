import { Project } from '@langri-sha/projen-project'

const project = new Project({
  name: 'dagger',
  package: {
    authorEmail: 'filip.dupanovic@gmail.com',
    authorName: 'Filip Dupanović',
    authorOrganization: false,
    authorUrl: 'https://langri-sha.com',
    bugsUrl: 'https://github.com/langri-sha/dagger/issues',
    copyrightYear: '2026',
    description: 'Reusable Dagger modules',
    homepage: 'https://langri-sha.com',
    license: 'MIT',
    licensed: true,
    minNodeVersion: '24.16.0',
    repository: 'langri-sha/dagger',
    type: 'module',

    devDeps: ['@langri-sha/prettier@^0.4.6'],
  },
  codeowners: {
    '*': '@langri-sha',
  },
  dagger: {
    engineVersion: 'v1.0.0-beta.15',
    modules: {
      cargo: {},
      ci: {},
      terraform: {},
    },
  },
  editorConfig: {},
  lintSynthesized: {},
  pnpmWorkspace: {
    minimumReleaseAgeExclude: [
      '@langri-sha/*',
      'projen-babel-config',
      'projen-beachball',
      'projen-cargo',
      'projen-codeowners',
      'projen-dagger',
      'projen-editorconfig',
      'projen-eslint',
      'projen-husky',
      'projen-jest-config',
      'projen-license',
      'projen-lint-staged',
      'projen-lint-synthesized',
      'projen-pnpm-workspace',
      'projen-prettier',
      'projen-readme',
      'projen-renovate',
      'projen-ruff',
      'projen-skills',
      'projen-swcrc',
      'projen-ty',
      'projen-typescript-config',
      'projen-uv',
      'projen-worktrunk',
    ],
    allowBuilds: {
      '@swc/core': false,
      esbuild: false,
      'unrs-resolver': false,
    },
  },
  prettier: {},
  readme: {
    filename: 'readme.md',
  },
  renovate: {
    packageRules: [
      {
        description: 'Update our own packages together',
        groupName: 'langri-sha projen toolchain',
        groupSlug: 'langri-sha-projen',
        matchPackageNames: ['@langri-sha/**'],
      },
      {
        description: 'Install our own packages without waiting them out',
        matchPackageNames: ['@langri-sha/**'],
        minimumReleaseAge: null,
      },
      {
        description:
          'Install our own GitHub Actions and Terraform modules without waiting them out',
        matchPackageNames: ['langri-sha/**'],
        minimumReleaseAge: null,
      },
    ],
  },
  worktrunk: {},
})

project.package?.addField('private', true)
project.package?.addField('packageManager', 'pnpm@12.10.1')
project.package?.addEngine('pnpm', '>= 11.0.0')

project.package?.setScript('format', 'prettier --write .')
project.package?.setScript('format:check', 'prettier --check .')

project.gitattributes.addAttributes(
  'readme',
  'text=auto',
  'linguist-language=Markdown',
)

project.synth()
