import type { AccountLifecycleEvent, AccountLifecycleHandler } from '../identity/index.js'
import { ConflictError, type Tx } from '../kernel/index.js'

/**
 * OpportunityLifecycleHandler (ODD Table 7). Refuses ROLE_CORRECTED while the member has open
 * listings; on ACCOUNT_DELETED closes them. The publisher holds the member's account FOR UPDATE,
 * which OpportunityService also locks before a listing, so no edit or close overlaps.
 */
export class OpportunityLifecycleHandler implements AccountLifecycleHandler {
  async beforeRoleChange(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.kind !== 'ROLE_CORRECTED') return
    const open = await tx.opportunity.count({ where: { authorId: event.memberId, state: 'OPEN' } })
    if (open > 0) {
      throw new ConflictError(
        'The member has open opportunity listings. They must be closed before the role changes.',
      )
    }
  }

  async onAccountEvent(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.kind !== 'ACCOUNT_DELETED') return
    await tx.opportunity.updateMany({
      where: { authorId: event.memberId, state: 'OPEN' },
      data: { state: 'CLOSED', version: { increment: 1 }, updatedAt: event.occurredAt },
    })
  }
}
