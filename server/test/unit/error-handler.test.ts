import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ErrorHandler } from '../../src/infrastructure/error-handler.js'
import { RateLimitError, RestrictionError, ValidationError } from '../../src/kernel/index.js'

function appThrowing(error: unknown) {
  const lines: string[] = []
  const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) })
  const handler = new ErrorHandler(logger)
  const app = express()
  app.use(express.json())
  app.post('/boom', () => {
    throw error
  })
  app.use(handler.middleware())
  return { app, lines }
}

describe('ErrorHandler', () => {
  it('turns a ValidationError into 422 with fields', async () => {
    const { app } = appThrowing(new ValidationError({ title: 'Required' }))
    const response = await request(app).post('/boom').send({})
    expect(response.status).toBe(422)
    expect(response.body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are not valid.',
        fields: { title: 'Required' },
      },
    })
  })

  it('turns an unknown error into a generic 500 without stack or message', async () => {
    const { app, lines } = appThrowing(new TypeError('db password=hunter2 leaked in message'))
    const response = await request(app).post('/boom').send({ body: 'private user content' })
    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again later.', fields: null },
    })
    expect(response.text).not.toMatch(/hunter2|stack|TypeError|at /)
    expect(lines.join('\n')).not.toContain('private user content')
  })

  it('adds restrictedUntil to RESTRICTED and Retry-After to RATE_LIMITED', async () => {
    const until = new Date('2026-10-15T00:00:00Z')
    const restricted = await request(appThrowing(new RestrictionError(until)).app).post('/boom')
    expect(restricted.status).toBe(403)
    expect(restricted.body.error).toMatchObject({ code: 'RESTRICTED', restrictedUntil: until.toISOString() })

    const limited = await request(appThrowing(new RateLimitError(42)).app).post('/boom')
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toBe('42')
    expect(limited.body.error).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 42 })
  })

  it('turns malformed JSON into 422', async () => {
    const { app } = appThrowing(new Error('unreached'))
    const response = await request(app).post('/boom').set('content-type', 'application/json').send('{bad')
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('VALIDATION_FAILED')
  })
})
