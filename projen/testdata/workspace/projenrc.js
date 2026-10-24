const { Project, TextFile, javascript } = require('projen')
const stamp = require('stamp')

const project = new Project({ name: 'fixture', projenrcJson: false })

const pkg = new javascript.NodePackage(project, {
  packageManager: javascript.NodePackageManager.PNPM,
  addPackageManagerToDevEngines: false,
  devDeps: ['constructs@10.8.1', 'projen@0.104.10', 'stamp@file:stamp-1'],
})

pkg.addField('packageManager', 'pnpm@12.14.0')

project.defaultTask.exec('node projenrc.js')

stamp(project)

new TextFile(project, 'synthesized.txt', {
  committed: false,
  lines: ['Synthesized'],
})

project.synth()
