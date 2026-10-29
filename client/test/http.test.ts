import { describe, expect, it, vi } from 'vitest'
import { ApiError, createHttpClient } from '../src/api/http'
import { shouldRetry } from '../src/api/query-client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('createHttpClient', () => {
  it('attaches the bearer token and returns the JSON body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }))
    const http = createHttpClient({ getAccessToken: async () => 'token-1', fetchImpl })
    await expect(http('/accounts/me', { query: { page: 2, empty: null } })).resolves.toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/api/accounts/me')
    expect(url.search).toBe('?page=2')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
  })

  it('sends no Authorization header when signed out and serializes JSON bodies', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const http = createHttpClient({ getAccessToken: async () => null, fetchImpl })
    await expect(http('/things', { method: 'POST', body: { a: 1 } })).resolves.toBeUndefined()
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"a":1}')
  })

  it('turns an ErrorBody into a typed ApiError', async () => {
    const body = {
      error: { code: 'VALIDATION_FAILED', message: 'Check the form', fields: { title: 'Required' } },
    }
    const http = createHttpClient({
      getAccessToken: async () => 't',
      fetchImpl: async () => jsonResponse(422, body),
    })
    const error = await http('/x').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Check the form',
      fields: { title: 'Required' },
    })
  })

  it('keeps restrictedUntil and retryAfter', async () => {
    const restricted = {
      error: { code: 'RESTRICTED', message: 'r', fields: null, restrictedUntil: '2026-01-01T00:00:00.000Z' },
    }
    const limited = { error: { code: 'RATE_LIMITED', message: 'l', fields: null, retryAfter: 30 } }
    const responses = [jsonResponse(403, restricted), jsonResponse(429, limited)]
    const http = createHttpClient({
      getAccessToken: async () => 't',
      fetchImpl: async () => responses.shift()!,
    })
    await expect(http('/a')).rejects.toMatchObject({ restrictedUntil: '2026-01-01T00:00:00.000Z' })
    await expect(http('/b')).rejects.toMatchObject({ retryAfter: 30 })
  })

  it('reports a 401 to onUnauthenticated', async () => {
    const onUnauthenticated = vi.fn()
    const body = {
      error: { code: 'UNAUTHENTICATED', message: 'Your Administrator session has ended.', fields: null },
    }
    const http = createHttpClient({
      getAccessToken: async () => 't',
      onUnauthenticated,
      fetchImpl: async () => jsonResponse(401, body),
    })
    await expect(http('/admin/accounts/me')).rejects.toMatchObject({ status: 401 })
    expect(onUnauthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Your Administrator session has ended.' }),
    )
  })

  it('maps network failures and non-JSON errors to safe messages', async () => {
    const network = createHttpClient({
      getAccessToken: async () => null,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(network('/x')).rejects.toMatchObject({ status: 0, code: 'DEPENDENCY_UNAVAILABLE' })

    const html = createHttpClient({
      getAccessToken: async () => null,
      fetchImpl: async () => new Response('<html>bad gateway</html>', { status: 502 }),
    })
    await expect(html('/x')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' })
  })
})

describe('shouldRetry', () => {
  it('retries transient failures at most twice and never 4xx answers', () => {
    expect(shouldRetry(0, new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'x'))).toBe(true)
    expect(shouldRetry(2, new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(403, 'FORBIDDEN', 'x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(401, 'UNAUTHENTICATED', 'x'))).toBe(false)
    expect(shouldRetry(0, new Error('boom'))).toBe(true)
  })
})
