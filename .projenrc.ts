import { Project } from '@langri-sha/projen-project'

// Projen owns the repository root, and each module's `dagger.json` through the
// `dagger` option below. Everything else inside a module directory is written
// by the Dagger TypeScript SDK — `dagger develop` regenerates `package.json`,
// `tsconfig.json`, `yarn.lock`, `.gitignore`, `.gitattributes` and `sdk/` from
// its own templates, so anything Projen synthesized there would be reverted on
// the next run and re-synthesized on the one after. The manifest is the
// exception: it is written in the field order the CLI marshals, so
// `dagger develop` reads it back and leaves it alone.
//
// The modules stay out of the pnpm workspace for the same reason: each one is
// an independently installable Dagger module that the runtime builds with
// Yarn inside its own container. `packages: []` below is that decision, not
// an oversight.
const project = new Project({
  name: 'dagger',
  package: {
    authorEmail: 'filip.dupanovic@gmail.com',
    authorName: 'Filip Dupanović',
    authorOrganization: false,
    authorUrl: 'https://langri-sha.com',
    bugsUrl: 'https://github.com/langri-sha/dagger/issues',
    copyrightYear: '2026',
    description:
      'Reusable Dagger TypeScript modules for personal infrastructure',
    homepage: 'https://langri-sha.com',
    license: 'MIT',
    licensed: true,
    minNodeVersion: '24.16.0',
    repository: 'langri-sha/dagger',
    type: 'module',

    devDeps: [
      '@langri-sha/prettier@^0.4.6',
      '@langri-sha/projen-project@*',
      '@types/node@24.19.0',
      'prettier@3.9.9',
      'prettier-plugin-ini@1.3.0',
      'tsx@4.23.15',
      // Matches the version the Dagger TypeScript SDK installs into every
      // module, so `check:types` typechecks against the same compiler the
      // runtime uses. Held at ^5 by a rule the `dagger` option contributes.
      'typescript@5.9.3',
    ],
  },
  codeowners: {
    '*': '@langri-sha',
  },
  // Every module directory holds a `dagger.json` synthesized from here, so a
  // new module is declared here first. The engine version is declared once and
  // written into all of them; Renovate moves it in this file rather than in
  // the manifests.
  dagger: {
    engineVersion: 'v0.21.9',
    modules: {
      hermes: {},
      // `dagger install` appends, so the order is the order they were added.
      'hermes-workspace': {
        dependencies: ['../tigerfs', '../hermes', '../tailscale'],
      },
      'letta-code': {},
      paperclip: {
        dependencies: ['../tailscale'],
      },
      tailscale: {},
      tigerfs: {},
    },
  },
  editorConfig: {},
  lintSynthesized: {},
  pnpmWorkspace: {
    minimumReleaseAgeExclude: ['@langri-sha/*'],
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
        description: 'Packages published from the langri-sha/projen monorepo',
        groupName: 'langri-sha projen toolchain',
        groupSlug: 'langri-sha-projen',
        matchSourceUrls: ['https://github.com/langri-sha/projen'],
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
})

project.package?.addField('private', true)
project.package?.addField('packageManager', 'pnpm@12.6.0')
project.package?.addEngine('pnpm', '>= 11.0.0')

project.package?.setScript('format', 'prettier --write .')
project.package?.setScript('format:check', 'prettier --check .')

project.gitattributes.addAttributes(
  'readme',
  'text=auto',
  'linguist-language=Markdown',
)

project.synth()
