import { expect, test } from 'vitest'

import { greet } from './greeting.js'

test('greets by name', () => {
  expect(greet('world')).toMatchSnapshot()
})
