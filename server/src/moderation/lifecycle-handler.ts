import type { AccountLifecycleEvent, AccountLifecycleHandler } from '../identity/index.js'
import type { Tx } from '../kernel/index.js'

/**
 * ModerationLifecycleHandler (ODD Table 7). On ACCOUNT_DELETED clears reporterId from the member's
 * reports; pending reports and their evidence stay until an Administrator decides them.
 */
export class ModerationLifecycleHandler implements AccountLifecycleHandler {
  async beforeRoleChange(): Promise<void> {}

  async onAccountEvent(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    if (event.kind !== 'ACCOUNT_DELETED') return
    await tx.report.updateMany({ where: { reporterId: event.memberId }, data: { reporterId: null } })
  }
}
