import { describe, expect, it } from 'vitest'
import { AccountLifecyclePublisher, hashEmail, type AccountLifecycleEvent } from '../../src/identity/index.js'
import { ConflictError, type Tx } from '../../src/kernel/index.js'

const tx = {} as Tx
const event: AccountLifecycleEvent = {
  kind: 'GRADUATION_CONFIRMED',
  memberId: '01900000-0000-7000-8000-000000000001',
  newRole: 'ALUMNI',
  occurredAt: new Date(),
}

describe('AccountLifecyclePublisher', () => {
  it('calls beforeRoleChange and onAccountEvent on every registered handler in order', async () => {
    const seen: string[] = []
    const publisher = new AccountLifecyclePublisher()
    for (const name of ['groups', 'mentorship']) {
      publisher.register({
        beforeRoleChange: async () => void seen.push(`${name}:before`),
        onAccountEvent: async () => void seen.push(`${name}:event`),
      })
    }
    await publisher.beforeRoleChange(tx, event)
    await publisher.publish(tx, event)
    expect(seen).toEqual(['groups:before', 'mentorship:before', 'groups:event', 'mentorship:event'])
  })

  it('stops at the first handler that refuses a role change', async () => {
    const publisher = new AccountLifecyclePublisher()
    let reached = false
    publisher.register({
      beforeRoleChange: async () => {
        throw new ConflictError('owns an open group')
      },
      onAccountEvent: async () => {},
    })
    publisher.register({
      beforeRoleChange: async () => void (reached = true),
      onAccountEvent: async () => {},
    })
    await expect(publisher.beforeRoleChange(tx, event)).rejects.toBeInstanceOf(ConflictError)
    expect(reached).toBe(false)
  })
})

describe('hashEmail', () => {
  it('is an HMAC of the lower-case email, so letter case does not matter', () => {
    const secret = 's'.repeat(32)
    expect(hashEmail(' Fake@Gmail.com', secret)).toBe(hashEmail('fake@gmail.com', secret))
    expect(hashEmail('fake@gmail.com', secret)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashEmail('fake@gmail.com', secret)).not.toBe(hashEmail('fake@gmail.com', 't'.repeat(32)))
  })
})
