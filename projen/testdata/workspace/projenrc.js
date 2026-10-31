const { execFileSync } = require('node:child_process')
const { accessSync } = require('node:fs')
const { Project, TextFile, javascript } = require('projen')
const stamp = require('stamp')

const project = new Project({ name: 'fixture', projenrcJson: false })

const pkg = new javascript.NodePackage(project, {
  packageManager: javascript.NodePackageManager.PNPM,
  addPackageManagerToDevEngines: false,
  devDeps: ['constructs@10.8.1', 'projen@0.104.19', 'stamp@file:stamp-1'],
})

pkg.addField('packageManager', 'pnpm@12.16.1')

project.defaultTask.exec('node projenrc.js')

stamp(project)

new TextFile(project, 'synthesized.txt', {
  committed: false,
  lines: ['Synthesized'],
})

execFileSync('git', ['--version'])
accessSync('/etc/ssl/certs/ca-certificates.crt')

project.synth()
