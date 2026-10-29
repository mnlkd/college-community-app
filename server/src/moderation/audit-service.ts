import { auditRecordQuerySchema, type AuditRecordView, type Page } from '@hilcoe/shared'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import type { AccountViews } from '../identity/index.js'
import {
  PermissionDeniedError,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type AuditEntryInput,
  type AuditWriter,
  type Clock,
  type Tx,
} from '../kernel/index.js'

/** Audit records are kept one year after a referenced account is deleted (NFR-8). */
export const AUDIT_RETENTION_AFTER_DELETION_MS = 365 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export interface AuditServiceDeps {
  db: PrismaClient
  clock: Clock
  views: AccountViews
}

/**
 * Append-only Administrator action record (NFR-7, ODD Table 22). A database trigger refuses any
 * change other than removing a deleted account's reference, and any deletion before purgeAfter.
 */
export class AuditService implements AuditWriter {
  constructor(private readonly deps: AuditServiceDeps) {}

  /**
   * CleanupJob: removes records whose purgeAfter has passed. The trigger compares with the
   * database clock, so the earlier of the two clocks is used. Returns the number removed.
   */
  async purgeExpired(now: Date): Promise<number> {
    return this.deps.db.$executeRaw`
      DELETE FROM audit_record WHERE purge_after <= LEAST(${now}::timestamptz, now())`
  }

  /** Written in the same transaction as the audited action. */
  async record(tx: Tx, entry: AuditEntryInput): Promise<string> {
    if (!entry.actor.isAdministrator) throw new Error('Only Administrator actions are audited')
    const created = await tx.auditRecord.create({
      data: {
        actorAdminId: entry.actor.accountId,
        targetMemberId: entry.targetMemberId ?? null,
        targetAdminId: entry.targetAdminId ?? null,
        actionCode: entry.action,
        outcome: entry.outcome ?? null,
        reportId: entry.reportId ?? null,
        reason: entry.reason ?? null,
        occurredAt: this.deps.clock.now(),
      },
      select: { id: true },
    })
    return created.id
  }

  /**
   * Removes the references to a deleted account and sets purgeAfter one year ahead. A record
   * already due earlier keeps its earlier date.
   */
  async anonymize(tx: Tx, accountId: string): Promise<void> {
    const purgeAfter = new Date(this.deps.clock.now().getTime() + AUDIT_RETENTION_AFTER_DELETION_MS)
    await tx.$executeRaw`
      UPDATE audit_record SET
        actor_admin_id   = CASE WHEN actor_admin_id   = ${accountId}::uuid THEN NULL ELSE actor_admin_id END,
        target_member_id = CASE WHEN target_member_id = ${accountId}::uuid THEN NULL ELSE target_member_id END,
        target_admin_id  = CASE WHEN target_admin_id  = ${accountId}::uuid THEN NULL ELSE target_admin_id END,
        purge_after      = LEAST(COALESCE(purge_after, ${purgeAfter}), ${purgeAfter})
      WHERE actor_admin_id = ${accountId}::uuid
         OR target_member_id = ${accountId}::uuid
         OR target_admin_id = ${accountId}::uuid`
  }

  /** Audit records newest first, filtered by action, Administrator, member and UTC day range. */
  async listAuditRecords(actor: ActorContext, query: unknown): Promise<Page<AuditRecordView>> {
    if (!actor.isAdministrator) throw new PermissionDeniedError('This is for Administrators.')
    const { action, adminId, memberId, from, to, ...request } = parseInput(auditRecordQuerySchema, query)
    const occurredAt: Prisma.DateTimeFilter = {}
    if (from) occurredAt.gte = new Date(`${from}T00:00:00.000Z`)
    if (to) occurredAt.lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS)
    const where: Prisma.AuditRecordWhereInput = {
      ...(action ? { actionCode: action } : {}),
      ...(adminId ? { OR: [{ actorAdminId: adminId }, { targetAdminId: adminId }] } : {}),
      ...(memberId ? { targetMemberId: memberId } : {}),
      ...(from || to ? { occurredAt } : {}),
    }
    const [rows, total] = await Promise.all([
      this.deps.db.auditRecord.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(request),
      }),
      this.deps.db.auditRecord.count({ where }),
    ])
    const [emails, cards] = await Promise.all([
      this.deps.views.adminEmails(
        rows.flatMap((row) => [row.actorAdminId, row.targetAdminId]).filter((id) => id !== null),
      ),
      this.deps.views.memberCards(rows.flatMap((row) => (row.targetMemberId ? [row.targetMemberId] : []))),
    ])
    const admin = (id: string | null) => {
      const email = id ? emails.get(id) : undefined
      return id && email ? { adminId: id, email } : null
    }
    const items = rows.map((row): AuditRecordView => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      action: row.actionCode,
      outcome: row.outcome,
      actor: admin(row.actorAdminId),
      targetMember: row.targetMemberId
        ? {
            memberId: row.targetMemberId,
            displayName: cards.get(row.targetMemberId)?.displayName ?? '',
          }
        : null,
      targetAdmin: admin(row.targetAdminId),
      reason: row.reason,
      reportId: row.reportId,
      anonymized: row.purgeAfter !== null,
    }))
    return toPage(items, request, total)
  }
}
