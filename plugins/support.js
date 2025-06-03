'use strict'

import fp from 'fastify-plugin'
// the use of fastify-plugin is required to be able
// to export the decorators to the outer scope

import { fastifyCors } from '@fastify/cors'
import { fastifyHelmet } from '@fastify/helmet'
import { fastifyRateLimit } from '@fastify/rate-limit'

export default fp(async function (fastify, opts) {
  fastify.register(fastifyCors, opts)
  fastify.register(fastifyHelmet, opts)
  fastify.register(fastifyRateLimit, opts)
})