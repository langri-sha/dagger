import { expect, test } from 'vitest'
import greeting from './greeting.js'

test('imports the file prepare generates', () => {
  expect(greeting).toBe('Hello from prepare')
})
