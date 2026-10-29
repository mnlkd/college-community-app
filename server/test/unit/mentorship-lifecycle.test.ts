import { describe, expect, it, vi } from 'vitest'
import type { AccountLifecycleEvent } from '../../src/identity/index.js'
import { ConflictError, type Tx } from '../../src/kernel/index.js'
import { MentorshipLifecycleHandler } from '../../src/mentorship/index.js'
import type { NotificationService } from '../../src/notifications/index.js'

const memberId = '01900000-0000-7000-8000-000000000001'
const event = (kind: AccountLifecycleEvent['kind']): AccountLifecycleEvent => ({
  kind,
  memberId,
  newRole: kind === 'ACCOUNT_DELETED' ? null : 'ALUMNI',
  occurredAt: new Date('2026-10-01T09:00:00Z'),
})

function fakeTx(openCount: number) {
  const count = vi.fn(async () => openCount)
  return { tx: { mentorship: { count } } as unknown as Tx, count }
}

describe('MentorshipLifecycleHandler.beforeRoleChange', () => {
  const handler = new MentorshipLifecycleHandler({} as NotificationService)

  it('refuses a role correction while the member has pending or active mentorships', async () => {
    const { tx, count } = fakeTx(1)
    await expect(handler.beforeRoleChange(tx, event('ROLE_CORRECTED'))).rejects.toBeInstanceOf(ConflictError)
    expect(count).toHaveBeenCalledWith({
      where: {
        OR: [{ studentId: memberId }, { mentorId: memberId }],
        state: { in: ['PENDING', 'ACTIVE'] },
      },
    })
  })

  it('allows a role correction without open mentorships', async () => {
    const { tx } = fakeTx(0)
    await expect(handler.beforeRoleChange(tx, event('ROLE_CORRECTED'))).resolves.toBeUndefined()
  })

  it('never refuses graduation, which ends the mentee relationships instead', async () => {
    const { tx, count } = fakeTx(3)
    await expect(handler.beforeRoleChange(tx, event('GRADUATION_CONFIRMED'))).resolves.toBeUndefined()
    expect(count).not.toHaveBeenCalled()
  })
})
