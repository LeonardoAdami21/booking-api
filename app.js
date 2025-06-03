
import * as path from 'path'
import Autoload from '@fastify/autoload'

// Pass --options via CLI arguments in command to enable these options.
const options = {}

const app = (fastify, opts) => {
  const __dirname = path.dirname(new URL(import.meta.url).pathname)
  fastify.register(Autoload, {
    dir: path.join(__dirname, 'plugins'),
    options: opts
  })
  fastify.register(Autoload, {
    dir: path.join(__dirname, './booking'),
    options: opts
  })
}

export default app