import type { Greeting } from 'shared'

const greeting: Greeting = { text: process.env.GREETING ?? '' }

export default function Page() {
  return <p>{greeting.text}</p>
}
