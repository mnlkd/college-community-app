import type { MentorshipState } from '@hilcoe/shared'
import type { AccountLifecycleEvent, AccountLifecycleHandler } from '../identity/index.js'
import { ConflictError, type Tx } from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import { OPEN_MENTORSHIP_STATES } from './states.js'

interface OpenRow {
  id: string
  student_id: string
  mentor_id: string
  state: MentorshipState
}

/**
 * MentorshipLifecycleHandler (ODD Table 7). Refuses ROLE_CORRECTED while the member has pending
 * or active mentorships. On GRADUATION_CONFIRMED ends the member's mentee relationships and
 * withdraws their pending requests; on ACCOUNT_DELETED does the same on the mentor side too and
 * removes the mentor profile and contacts. The other party is notified each time.
 *
 * The publisher runs with the member's account locked FOR UPDATE; the profile and then the
 * mentorship rows are locked next, the order MentorshipService uses.
 */
export class MentorshipLifecycleHandler implements AccountLifecycleHandler {
  constructor(private readonly notifications: NotificationService) {}

  async beforeRoleChange(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.kind !== 'ROLE_CORRECTED') return
    const open = await tx.mentorship.count({
      where: {
        OR: [{ studentId: event.memberId }, { mentorId: event.memberId }],
        state: { in: OPEN_MENTORSHIP_STATES },
      },
    })
    if (open > 0) {
      throw new ConflictError(
        'The member has pending or active mentorships. They must be ended or answered before the role changes.',
      )
    }
  }

  async onAccountEvent(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.kind === 'ROLE_CORRECTED') return
    const memberId = event.memberId
    const deleting = event.kind === 'ACCOUNT_DELETED'
    await tx.$queryRaw`SELECT member_id FROM mentor_profile WHERE member_id = ${memberId}::uuid FOR UPDATE`
    const rows = await tx.$queryRaw<OpenRow[]>`
      SELECT id, student_id, mentor_id, state FROM mentorship
      WHERE (student_id = ${memberId}::uuid OR (${deleting}::boolean AND mentor_id = ${memberId}::uuid))
        AND state IN ('PENDING', 'ACTIVE')
      ORDER BY id
      FOR UPDATE`
    for (const row of rows) {
      const next: MentorshipState = row.state === 'ACTIVE' ? 'ENDED' : 'WITHDRAWN'
      await tx.mentorship.update({
        where: { id: row.id },
        data: { state: next, updatedAt: event.occurredAt },
      })
      await this.notifications.notify(tx, {
        recipientId: row.student_id === memberId ? row.mentor_id : row.student_id,
        type: 'MENTORSHIP_OUTCOME',
        eventKey: `mentorship:${row.id}:${next}`,
        actorId: memberId,
        targetType: 'MENTORSHIP',
        targetId: row.id,
      })
    }
    if (deleting) await tx.mentorProfile.deleteMany({ where: { memberId } })
  }
}
