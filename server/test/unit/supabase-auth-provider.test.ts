import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SupabaseAuthAdapter } from '../../src/infrastructure/supabase-auth-adapter.js'
import { DependencyError, NotFoundError, RateLimitError } from '../../src/kernel/index.js'

const USER_ID = '01900000-0000-7000-8000-0000000000bb'
let server: Server
let adapter: SupabaseAuthAdapter
let calls: string[] = []
let passwordStatus = 200
let liveSessions: unknown[] = []
const queries: unknown[][] = []

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of request) text += String(chunk)
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

function reply(response: ServerResponse, status: number, value: object) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

/** A minimal stand-in for the GoTrue endpoints the adapter uses. */
beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://x')
      calls.push(`${request.method} ${url.pathname}${url.search}`)
      const payload = await body(request)
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        if (passwordStatus !== 200) {
          return reply(response, passwordStatus, {
            code: passwordStatus,
            error_code: 'invalid_credentials',
            msg: 'no',
          })
        }
        if (payload.password !== 'right password') {
          return reply(response, 400, {
            code: 400,
            error_code: 'invalid_credentials',
            msg: 'Invalid login credentials',
          })
        }
        return reply(response, 200, {
          access_token: 'fresh-token',
          refresh_token: 'r',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: USER_ID, aud: 'authenticated', email: 'a@hilcoeschool.com' },
        })
      }
      if (url.pathname === '/auth/v1/logout') return reply(response, 204, {})
      if (url.pathname === `/auth/v1/admin/users/${USER_ID}` && request.method === 'GET') {
        return reply(response, 200, {
          id: USER_ID,
          aud: 'authenticated',
          email: 'Mixed.Case@HiLCoESchool.com',
          email_confirmed_at: '2026-01-01T00:00:00Z',
        })
      }
      if (url.pathname.startsWith('/auth/v1/admin/users/') && request.method === 'GET') {
        return reply(response, 404, { code: 404, error_code: 'user_not_found', msg: 'User not found' })
      }
      if (url.pathname === `/auth/v1/admin/users/${USER_ID}` && request.method === 'PUT') {
        calls.push(JSON.stringify(payload))
        return reply(response, 200, { id: USER_ID, aud: 'authenticated' })
      }
      reply(response, 500, { msg: 'unexpected' })
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  adapter = new SupabaseAuthAdapter({
    sql: {
      $executeRaw: () => Promise.resolve(0),
      $queryRaw: <T>(_query: TemplateStringsArray, ...values: unknown[]) => {
        queries.push(values)
        return Promise.resolve(liveSessions as T)
      },
    },
    supabaseUrl: url,
    serviceRoleKey: 'k',
    jwtSecret: null,
  })
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
beforeEach(() => {
  calls = []
  passwordStatus = 200
  liveSessions = []
  queries.length = 0
})

describe('SupabaseAuthAdapter as AuthProvider', () => {
  it('verifies a password and ends the session it opened', async () => {
    await expect(adapter.verifyPassword('a@hilcoeschool.com', 'right password')).resolves.toBe(true)
    expect(calls).toContain('POST /auth/v1/logout?scope=local')
  })

  it('returns false for a wrong password without opening a session', async () => {
    await expect(adapter.verifyPassword('a@hilcoeschool.com', 'wrong')).resolves.toBe(false)
    expect(calls.some((call) => call.includes('logout'))).toBe(false)
  })

  it('maps Supabase rate limiting and outages', async () => {
    passwordStatus = 429
    await expect(adapter.verifyPassword('a@hilcoeschool.com', 'x')).rejects.toBeInstanceOf(RateLimitError)
    passwordStatus = 503
    await expect(adapter.verifyPassword('a@hilcoeschool.com', 'x')).rejects.toBeInstanceOf(DependencyError)
  })

  it('reads the user with a lower-case email', async () => {
    await expect(adapter.getUser(USER_ID)).resolves.toEqual({
      id: USER_ID,
      email: 'mixed.case@hilcoeschool.com',
      emailConfirmed: true,
    })
    await expect(adapter.getUser('01900000-0000-7000-8000-0000000000cc')).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('records the account kind in app_metadata', async () => {
    await adapter.setAccountKind(USER_ID, 'MEMBER')
    expect(calls).toContain(JSON.stringify({ app_metadata: { account_kind: 'MEMBER' } }))
  })

  it('reports whether a Supabase session is still live', async () => {
    const sessionId = '01900000-0000-7000-8000-0000000000dd'
    await expect(adapter.sessionExists(USER_ID, sessionId)).resolves.toBe(false)
    liveSessions = [{ '?column?': 1 }]
    await expect(adapter.sessionExists(USER_ID, sessionId)).resolves.toBe(true)
    expect(queries.at(-1)).toEqual([sessionId, USER_ID])
    await expect(adapter.sessionExists(USER_ID, 'not-a-uuid')).resolves.toBe(false)
    expect(queries).toHaveLength(2)
  })
})
