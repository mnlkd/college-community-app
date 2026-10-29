import type { LifecycleKind, Role, RoleChangeBlockerView } from '@hilcoe/shared'
import type { Tx } from '../kernel/index.js'

/** Value object passed to the lifecycle handlers; not stored (ODD Table 7). */
export interface AccountLifecycleEvent {
  kind: LifecycleKind
  memberId: string
  /** Set for GRADUATION_CONFIRMED and ROLE_CORRECTED. */
  newRole: Role | null
  occurredAt: Date
}

/** Implemented by the lifecycle handlers of later packages and registered at start-up. */
export interface AccountLifecycleHandler {
  /** Raises ConflictError when the member holds a responsibility the new role cannot keep. */
  beforeRoleChange(tx: Tx, event: AccountLifecycleEvent): Promise<void>
  /** Ends or closes the member's relationships in the same transaction as the change. */
  onAccountEvent(tx: Tx, event: AccountLifecycleEvent): Promise<void>
  /**
   * What the member must hand over before a graduation can be confirmed, for the Administrator's
   * review; beforeRoleChange still decides. Optional for handlers that never block graduation.
   */
  describeBlockers?(tx: Tx, memberId: string): Promise<RoleChangeBlockerView[]>
}

/** Handler registry: handlers from later batches plug in without changes here. */
export class AccountLifecyclePublisher {
  private readonly handlers: AccountLifecycleHandler[] = []

  register(handler: AccountLifecycleHandler): void {
    this.handlers.push(handler)
  }

  async beforeRoleChange(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    for (const handler of this.handlers) await handler.beforeRoleChange(tx, event)
  }

  async describeBlockers(tx: Tx, memberId: string): Promise<RoleChangeBlockerView[]> {
    const blockers: RoleChangeBlockerView[] = []
    for (const handler of this.handlers) {
      if (handler.describeBlockers) blockers.push(...(await handler.describeBlockers(tx, memberId)))
    }
    return blockers
  }

  async publish(tx: Tx, event: AccountLifecycleEvent): Promise<void> {
    for (const handler of this.handlers) await handler.onAccountEvent(tx, event)
  }
}
