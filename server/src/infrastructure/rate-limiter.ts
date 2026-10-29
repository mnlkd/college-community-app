import { RateLimitError, type Clock } from '../kernel/index.js'

export interface RateLimitRule {
  /** Number of actions allowed in one window. */
  limit: number
  windowSeconds: number
}

/**
 * Limits changes per account and action with fixed windows held in memory (NFR-5).
 * Supabase Auth limits sign-in and email codes itself. One server instance is assumed
 * (Render free tier); a shared store would be needed to scale out.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>()

  constructor(
    private readonly rules: Readonly<Record<string, RateLimitRule>>,
    private readonly clock: Clock,
  ) {}

  check(action: string, key: string): void {
    const rule = this.rules[action]
    if (!rule) throw new Error(`No rate limit rule for action ${action}`)
    const now = this.clock.now().getTime()
    const windowMs = rule.windowSeconds * 1000
    const id = `${action}:${key}`
    const current = this.windows.get(id)
    if (!current || now - current.startedAt >= windowMs) {
      this.windows.set(id, { startedAt: now, count: 1 })
      this.prune(now)
      return
    }
    if (current.count >= rule.limit) {
      throw new RateLimitError(Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000)))
    }
    current.count += 1
  }

  private prune(now: number): void {
    if (this.windows.size < 10_000) return
    for (const [id, window] of this.windows) {
      const rule = this.rules[id.slice(0, id.indexOf(':'))]
      if (!rule || now - window.startedAt >= rule.windowSeconds * 1000) this.windows.delete(id)
    }
  }
}
