import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())

describe('Express app', () => {
  it('answers the health check', async () => {
    const response = await request(t.app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(response.headers['x-powered-by']).toBeUndefined()
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('answers unknown endpoints with 404 NOT_FOUND', async () => {
    const response = await request(t.app).get('/api/unknown-things')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })

  it('answers malformed JSON with 422', async () => {
    const response = await request(t.app)
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{"oops"')
    expect(response.status).toBe(422)
    expect(response.body.error).toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
