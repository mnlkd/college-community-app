import { describe, expect, it, vi } from 'vitest'
import { GroupLifecycleHandler } from '../../src/groups/index.js'
import type { AccessPolicy, AccountLifecycleEvent } from '../../src/identity/index.js'
import { ConflictError, type Tx } from '../../src/kernel/index.js'
import type { NotificationService } from '../../src/notifications/index.js'
import { OpportunityLifecycleHandler } from '../../src/opportunities/index.js'

const memberId = '01900000-0000-7000-8000-000000000001'
const event = (
  kind: AccountLifecycleEvent['kind'],
  newRole: AccountLifecycleEvent['newRole'] = 'ALUMNI',
): AccountLifecycleEvent => ({
  kind,
  memberId,
  newRole: kind === 'ACCOUNT_DELETED' ? null : newRole,
  occurredAt: new Date('2026-10-01T09:00:00Z'),
})

describe('OpportunityLifecycleHandler', () => {
  const handler = new OpportunityLifecycleHandler()
  const fakeTx = (open: number) => {
    const count = vi.fn(async () => open)
    const updateMany = vi.fn(async () => ({ count: open }))
    return { tx: { opportunity: { count, updateMany } } as unknown as Tx, count, updateMany }
  }

  it('refuses a role correction while the member has open listings', async () => {
    const { tx, count } = fakeTx(1)
    await expect(handler.beforeRoleChange(tx, event('ROLE_CORRECTED'))).rejects.toBeInstanceOf(ConflictError)
    expect(count).toHaveBeenCalledWith({ where: { authorId: memberId, state: 'OPEN' } })
    await expect(handler.beforeRoleChange(fakeTx(0).tx, event('ROLE_CORRECTED'))).resolves.toBeUndefined()
  })

  it('closes open listings on deletion only', async () => {
    const graduation = fakeTx(2)
    await handler.onAccountEvent(graduation.tx, event('GRADUATION_CONFIRMED'))
    expect(graduation.updateMany).not.toHaveBeenCalled()
    const deletion = fakeTx(2)
    await handler.onAccountEvent(deletion.tx, event('ACCOUNT_DELETED'))
    expect(deletion.updateMany).toHaveBeenCalledWith({
      where: { authorId: memberId, state: 'OPEN' },
      data: { state: 'CLOSED', version: { increment: 1 }, updatedAt: event('ACCOUNT_DELETED').occurredAt },
    })
  })
})

describe('GroupLifecycleHandler', () => {
  const handler = new GroupLifecycleHandler({} as AccessPolicy, {} as NotificationService)
  const fakeTx = (owned: { id: string; title: string }[]) => {
    const count = vi.fn(async () => owned.length)
    const findMany = vi.fn(async () => owned)
    const queryRaw = vi.fn()
    return { tx: { group: { count, findMany }, $queryRaw: queryRaw } as unknown as Tx, count, queryRaw }
  }

  it('refuses graduation or a correction away from Student while the member owns an open group', async () => {
    const owner = fakeTx([{ id: 'g1', title: 'Study circle' }])
    for (const kind of ['GRADUATION_CONFIRMED', 'ROLE_CORRECTED'] as const) {
      await expect(handler.beforeRoleChange(owner.tx, event(kind))).rejects.toBeInstanceOf(ConflictError)
    }
    expect(owner.count).toHaveBeenCalledWith({ where: { ownerId: memberId, state: 'OPEN' } })
    await expect(
      handler.beforeRoleChange(fakeTx([]).tx, event('GRADUATION_CONFIRMED')),
    ).resolves.toBeUndefined()
  })

  it('allows a correction to Student and leaves memberships alone', async () => {
    const owner = fakeTx([{ id: 'g1', title: 'Study circle' }])
    await expect(
      handler.beforeRoleChange(owner.tx, event('ROLE_CORRECTED', 'STUDENT')),
    ).resolves.toBeUndefined()
    await handler.onAccountEvent(owner.tx, event('ROLE_CORRECTED', 'STUDENT'))
    expect(owner.count).not.toHaveBeenCalled()
    expect(owner.queryRaw).not.toHaveBeenCalled()
  })

  it('describes owned open groups as blockers', async () => {
    const { tx } = fakeTx([{ id: 'g1', title: 'Study circle' }])
    expect(await handler.describeBlockers(tx, memberId)).toEqual([
      { kind: 'OWNED_GROUP', id: 'g1', label: 'Study circle' },
    ])
  })
})
