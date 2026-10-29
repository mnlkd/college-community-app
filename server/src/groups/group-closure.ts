import type { AccessPolicy } from '../identity/index.js'
import type { Tx } from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'

export interface GroupClosureDeps {
  access: AccessPolicy
  notifications: NotificationService
}

/**
 * Closes a group whose row (and owner account) the caller has locked: pending requests are
 * declined, the pending transfer is cancelled and accepted members are told, each with a notice.
 * Used by closeGroup and, on the owner's deletion, by GroupLifecycleHandler.
 *
 * The other members' accounts are key-share locked before their membership and transfer rows, the
 * order every group change uses, so a concurrent graduation or deletion of one of them finishes
 * first instead of deadlocking.
 */
export async function closeLockedGroup(
  tx: Tx,
  deps: GroupClosureDeps,
  group: { id: string; ownerId: string },
  actorId: string,
  now: Date,
  options: { clearCoordination: boolean },
): Promise<void> {
  const [memberships, transfers] = await Promise.all([
    tx.groupMembership.findMany({
      where: { groupId: group.id, state: { in: ['PENDING', 'ACCEPTED'] }, memberId: { not: group.ownerId } },
      select: { memberId: true },
    }),
    tx.groupTransfer.findMany({
      where: { groupId: group.id, state: 'PENDING' },
      select: { toMemberId: true },
    }),
  ])
  const others = [
    ...new Set([...memberships.map((row) => row.memberId), ...transfers.map((row) => row.toMemberId)]),
  ].sort()
  for (const memberId of others) await deps.access.lockMember(tx, memberId, 'KEY SHARE')

  const pending = await tx.$queryRaw<{ id: string; member_id: string }[]>`
    SELECT id, member_id FROM group_membership
    WHERE group_id = ${group.id}::uuid AND state = 'PENDING' ORDER BY id FOR UPDATE`
  const transfer = await tx.$queryRaw<{ id: string; to_member_id: string }[]>`
    SELECT id, to_member_id FROM group_transfer
    WHERE group_id = ${group.id}::uuid AND state = 'PENDING' FOR UPDATE`
  const accepted = await tx.groupMembership.findMany({
    where: { groupId: group.id, state: 'ACCEPTED', memberId: { not: group.ownerId } },
    select: { memberId: true },
  })

  await tx.groupMembership.updateMany({
    where: { id: { in: pending.map((row) => row.id) } },
    data: { state: 'DECLINED', updatedAt: now },
  })
  await tx.groupTransfer.updateMany({
    where: { id: { in: transfer.map((row) => row.id) } },
    data: { state: 'CANCELLED', decidedAt: now },
  })
  await tx.group.update({
    where: { id: group.id },
    data: {
      state: 'CLOSED',
      version: { increment: 1 },
      updatedAt: now,
      ...(options.clearCoordination ? { coordinationDetails: null } : {}),
    },
  })

  for (const row of pending) {
    await deps.notifications.notify(tx, {
      recipientId: row.member_id,
      type: 'GROUP_OUTCOME',
      eventKey: `group-membership:${row.id}:DECLINED`,
      actorId,
      targetType: 'GROUP',
      targetId: group.id,
    })
  }
  for (const row of transfer) {
    await deps.notifications.notify(tx, {
      recipientId: row.to_member_id,
      type: 'GROUP_TRANSFER',
      eventKey: `group-transfer:${row.id}:CANCELLED`,
      actorId,
      targetType: 'GROUP',
      targetId: group.id,
    })
  }
  for (const row of accepted) {
    await deps.notifications.notify(tx, {
      recipientId: row.memberId,
      type: 'GROUP_OUTCOME',
      eventKey: `group:${group.id}:CLOSED`,
      actorId,
      targetType: 'GROUP',
      targetId: group.id,
    })
  }
}
