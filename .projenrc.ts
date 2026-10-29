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
    minNodeVersion: '24.22.1',
    repository: 'langri-sha/dagger',
    type: 'module',

    devDeps: ['@langri-sha/prettier@^0.4.6'],
  },
  claude: {
    settings: {
      attribution: { commit: '', pr: '', sessionUrl: false },
    },
  },
  codeowners: {
    '*': '@langri-sha',
  },
  dagger: {
    engineVersion: 'v1.0.0-beta.21',
    modules: {
      actionlint: {},
      beachball: {},
      cargo: {},
      changesets: {},
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
  githubTemplates: {},
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
    extends: [
      'github>langri-sha/renovate-config',
      'customManagers:dockerfileVersions',
    ],
    customManagers: [
      {
        customType: 'regex',
        managerFilePatterns: ['/\\.dang$/'],
        matchStrings: [
          '# renovate: datasource=(?<datasource>[\\w.-]+) depName=(?<depName>\\S+)\\s+let \\w+: String! = "(?<currentValue>[^"]+)"',
        ],
      },
    ],
  },
  worktrunk: {},
  skills: {
    ignore: false,
    skills: [
      {
        source: 'langri-sha/skills',
        ref: 'v1.0.0',
        skills: ['create-commit', 'create-pr'],
      },
    ],
  },
})

project.package?.addField('private', true)
project.package?.addField('packageManager', 'pnpm@12.15.0')
project.package?.addEngine('pnpm', '>= 11.0.0')

project.package?.setScript('format', 'prettier --write .')
project.package?.setScript('format:check', 'prettier --check .')

project.gitattributes.addAttributes(
  'readme',
  'text=auto',
  'linguist-language=Markdown',
)

project.synth()
