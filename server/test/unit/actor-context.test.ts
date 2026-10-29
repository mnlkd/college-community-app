import { describe, expect, it } from 'vitest'
import { ActorContext, type ActorContextData } from '../../src/kernel/index.js'

const now = new Date('2026-10-01T12:00:00Z')

function member(overrides: Partial<ActorContextData> = {}): ActorContext {
  return new ActorContext({
    accountId: '01900000-0000-7000-8000-000000000001',
    kind: 'MEMBER',
    role: 'STUDENT',
    alumniStatus: null,
    accountState: 'ACTIVE',
    restrictedUntil: null,
    mfaVerified: false,
    isFirstAdmin: false,
    sessionId: 's1',
    ...overrides,
  })
}

describe('ActorContext', () => {
  it.each([
    ['active Student', {}, true],
    ['active Staff', { role: 'STAFF' as const }, true],
    ['Verified Alumni', { role: 'ALUMNI' as const, alumniStatus: 'VERIFIED' as const }, true],
    ['Self-Reported Alumni', { role: 'ALUMNI' as const, alumniStatus: 'SELF_REPORTED' as const }, false],
    ['Flagged Alumni', { role: 'ALUMNI' as const, alumniStatus: 'FLAGGED' as const }, false],
    ['disabled Student', { accountState: 'DISABLED' as const }, false],
    ['Administrator', { kind: 'ADMIN' as const, role: null }, false],
  ])('canInteract and canPublish for %s', (_label, overrides, expected) => {
    const actor = member(overrides)
    expect(actor.canInteract()).toBe(expected)
    expect(actor.canPublish(now)).toBe(expected)
  })

  it('a current restriction blocks publishing but not interacting', () => {
    const actor = member({ restrictedUntil: new Date(now.getTime() + 1000) })
    expect(actor.canInteract()).toBe(true)
    expect(actor.canPublish(now)).toBe(false)
  })

  it('an ended restriction no longer blocks publishing', () => {
    const actor = member({ restrictedUntil: now })
    expect(actor.canPublish(now)).toBe(true)
  })

  it('is read-only and its view hides the session id', () => {
    const actor = member({ restrictedUntil: now })
    expect(Object.isFrozen(actor)).toBe(true)
    expect(actor.toView()).toEqual({
      accountId: actor.accountId,
      kind: 'MEMBER',
      role: 'STUDENT',
      alumniStatus: null,
      accountState: 'ACTIVE',
      restrictedUntil: now.toISOString(),
      mfaVerified: false,
      isFirstAdmin: false,
    })
  })
})
