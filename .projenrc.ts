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
    engineVersion: 'v1.0.0-beta.18',
    modules: {
      actionlint: {},
      beachball: {},
      cargo: {},
      ci: {},
      next: {
        dependencies: ['../typescript'],
      },
      nginx: {},
      projen: {
        dependencies: ['../typescript'],
      },
      supabase: {},
      terraform: {},
      typescript: {},
      vitest: {
        dependencies: ['../typescript'],
      },
    },
  },
  editorConfig: {},
  lintSynthesized: {},
  pnpmWorkspace: {
    minimumReleaseAgeExclude: ['@langri-sha/*', ...Project.presetPackages],
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
    extends: ['github>langri-sha/renovate-config'],
  },
  worktrunk: {},
})

project.package?.addField('private', true)
project.package?.addField('packageManager', 'pnpm@12.14.0')
project.package?.addEngine('pnpm', '>= 11.0.0')

project.package?.setScript('format', 'prettier --write .')
project.package?.setScript('format:check', 'prettier --check .')

project.gitattributes.addAttributes(
  'readme',
  'text=auto',
  'linguist-language=Markdown',
)

project.synth()
