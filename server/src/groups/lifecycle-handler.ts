import type { RoleChangeBlockerView } from '@hilcoe/shared'
import type { AccessPolicy, AccountLifecycleEvent, AccountLifecycleHandler } from '../identity/index.js'
import { ConflictError, type Tx } from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import { closeLockedGroup } from './group-closure.js'

interface MembershipRow {
  id: string
  group_id: string
  owner_id: string
  state: 'PENDING' | 'ACCEPTED'
  group_state: 'OPEN' | 'CLOSED'
}

interface TransferRow {
  id: string
  group_id: string
  from_owner_id: string
  to_member_id: string
}

/**
 * GroupLifecycleHandler (ODD Table 7). Refuses a graduation or role correction while the member
 * owns an open group. When the member stops being a Student their memberships end: accepted ones
 * are left, pending requests are deleted and transfers involving them are cancelled. On deletion
 * their owned groups also close and lose their coordination details.
 *
 * The publisher holds the member's account FOR UPDATE, which every GroupService change waits for
 * (it key-share locks the accounts involved first). Only the member's own groups are locked here;
 * other groups are reached through their membership and transfer rows.
 */
export class GroupLifecycleHandler implements AccountLifecycleHandler {
  constructor(
    private readonly access: AccessPolicy,
    private readonly notifications: NotificationService,
  ) {}

  async beforeRoleChange(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.newRole === 'STUDENT') return
    const owned = await tx.group.count({ where: { ownerId: event.memberId, state: 'OPEN' } })
    if (owned > 0) {
      throw new ConflictError(
        'The member owns an open group. It must be transferred or closed before the role changes.',
      )
    }
  }

  async describeBlockers(tx: Tx, memberId: string): Promise<RoleChangeBlockerView[]> {
    const groups = await tx.group.findMany({
      where: { ownerId: memberId, state: 'OPEN' },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
    })
    return groups.map((group) => ({ kind: 'OWNED_GROUP', id: group.id, label: group.title }))
  }

  async onAccountEvent(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.kind !== 'ACCOUNT_DELETED' && event.newRole === 'STUDENT') return
    const memberId = event.memberId
    const now = event.occurredAt
    if (event.kind === 'ACCOUNT_DELETED') await this.closeOwnedGroups(tx, memberId, now)

    const transfers = await tx.$queryRaw<TransferRow[]>`
      SELECT id, group_id, from_owner_id, to_member_id FROM group_transfer
      WHERE (from_owner_id = ${memberId}::uuid OR to_member_id = ${memberId}::uuid) AND state = 'PENDING'
      ORDER BY id FOR UPDATE`
    const memberships = await tx.$queryRaw<MembershipRow[]>`
      SELECT m.id, m.group_id, g.owner_id, m.state, g.state AS group_state
      FROM group_membership m JOIN "group" g ON g.id = m.group_id
      WHERE m.member_id = ${memberId}::uuid AND m.state IN ('PENDING', 'ACCEPTED')
        AND g.owner_id <> ${memberId}::uuid
      ORDER BY m.id FOR UPDATE OF m`

    for (const transfer of transfers) {
      await tx.groupTransfer.update({
        where: { id: transfer.id },
        data: { state: 'CANCELLED', decidedAt: now },
      })
      await this.notifications.notify(tx, {
        recipientId: transfer.from_owner_id === memberId ? transfer.to_member_id : transfer.from_owner_id,
        type: 'GROUP_TRANSFER',
        eventKey: `group-transfer:${transfer.id}:CANCELLED`,
        actorId: memberId,
        targetType: 'GROUP',
        targetId: transfer.group_id,
      })
    }
    for (const membership of memberships) {
      if (membership.state === 'PENDING') {
        await tx.groupMembership.delete({ where: { id: membership.id } })
        continue
      }
      await tx.groupMembership.update({
        where: { id: membership.id },
        data: { state: 'LEFT', updatedAt: now },
      })
      if (membership.group_state !== 'OPEN') continue
      await this.notifications.notify(tx, {
        recipientId: membership.owner_id,
        type: 'GROUP_OUTCOME',
        eventKey: `group-membership:${membership.id}:LEFT`,
        actorId: memberId,
        targetType: 'GROUP',
        targetId: membership.group_id,
      })
    }
  }

  /** Closes the deleted owner's open groups and clears the coordination details of all of them. */
  private async closeOwnedGroups(tx: Tx, ownerId: string, now: Date): Promise<void> {
    const owned = await tx.$queryRaw<{ id: string; state: 'OPEN' | 'CLOSED' }[]>`
      SELECT id, state FROM "group" WHERE owner_id = ${ownerId}::uuid ORDER BY id FOR UPDATE`
    for (const group of owned) {
      if (group.state === 'OPEN') {
        await closeLockedGroup(
          tx,
          { access: this.access, notifications: this.notifications },
          { id: group.id, ownerId },
          ownerId,
          now,
          { clearCoordination: true },
        )
      }
    }
    await tx.group.updateMany({
      where: { ownerId, coordinationDetails: { not: null } },
      data: { coordinationDetails: null },
    })
  }
}
