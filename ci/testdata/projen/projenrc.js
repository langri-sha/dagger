const { Project, javascript } = require('projen')
const stamp = require('stamp')

const project = new Project({ name: 'fixture', projenrcJson: false })

new javascript.NodePackage(project, {
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion: '12.11.2',
  devDeps: ['constructs@10.8.1', 'projen@0.104.8', 'stamp@file:stamp-1'],
})

project.defaultTask.exec('node projenrc.js')

stamp(project)

project.synth()
