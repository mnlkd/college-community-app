import { describe, expect, it } from 'vitest'
import { RateLimiter } from '../../src/infrastructure/rate-limiter.js'
import { RateLimitError } from '../../src/kernel/index.js'
import { FakeClock } from '../helpers/fake-clock.js'

describe('RateLimiter', () => {
  it('allows the limit, then refuses with retryAfter until the window ends', () => {
    const clock = new FakeClock(new Date('2026-10-01T00:00:00Z'))
    const limiter = new RateLimiter({ POST_CREATE: { limit: 2, windowSeconds: 60 } }, clock)
    limiter.check('POST_CREATE', 'a')
    limiter.check('POST_CREATE', 'a')
    clock.advance(15_000)
    let error: unknown
    try {
      limiter.check('POST_CREATE', 'a')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(RateLimitError)
    expect((error as RateLimitError).retryAfter).toBe(45)
    limiter.check('POST_CREATE', 'b')
    clock.advance(45_000)
    expect(() => limiter.check('POST_CREATE', 'a')).not.toThrow()
  })

  it('fails loudly for an action without a rule', () => {
    const limiter = new RateLimiter({}, new FakeClock())
    expect(() => limiter.check('UNKNOWN', 'a')).toThrow(/No rate limit rule/)
  })
})
