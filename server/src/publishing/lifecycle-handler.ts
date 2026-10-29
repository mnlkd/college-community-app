import type { AccountLifecycleEvent, AccountLifecycleHandler } from '../identity/index.js'
import type { Tx } from '../kernel/index.js'

/**
 * On ACCOUNT_DELETED removes the member's view marks. Posts, comments and likes are kept and show
 * Deleted User (SRS Manage Profile and Account; the ODD row also removes likes, see STATE.md).
 */
export class PublishingLifecycleHandler implements AccountLifecycleHandler {
  async beforeRoleChange(): Promise<void> {}

  async onAccountEvent(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.kind !== 'ACCOUNT_DELETED') return
    await tx.postViewDay.deleteMany({ where: { memberId: event.memberId } })
  }
}
