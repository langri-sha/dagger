const { TextFile } = require('projen')

module.exports = (project) =>
  new TextFile(project, 'stamp.txt', { lines: ['1'] })
