import { createServer } from 'vite'

const server = await createServer({
  configFile: new URL('./vite.config.ts', import.meta.url).pathname,
})
await server.listen()
const address = server.httpServer?.address()
if (!address || typeof address === 'string') throw new Error('No TCP listener')
console.log(`EXTENSION_2_HARNESS http://terminal:${address.port}/`)
