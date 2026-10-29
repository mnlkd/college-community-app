import type { AuditAction, AuditOutcome } from '@hilcoe/shared'
import type { ActorContext } from './actor-context.js'
import type { Tx } from './transaction.js'

export interface AuditEntryInput {
  actor: ActorContext
  action: AuditAction
  targetMemberId?: string | null
  targetAdminId?: string | null
  reason?: string | null
  /** For REPORT_DECIDED. */
  outcome?: AuditOutcome | null
  reportId?: string | null
}

/** Implemented by AuditService (moderation) and given to identity at start-up. */
export interface AuditWriter {
  /** Returns the id of the new record. */
  record(tx: Tx, entry: AuditEntryInput): Promise<string>
  anonymize(tx: Tx, accountId: string): Promise<void>
}
