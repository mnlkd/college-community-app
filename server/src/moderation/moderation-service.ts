import {
  EVIDENCE_RETENTION_DAYS,
  RESTRICTION_DAYS,
  adminReportQuerySchema,
  pageRequestSchema,
  reportDecisionInputSchema,
  reportInputSchema,
  type AuditOutcome,
  type ConsequenceKind,
  type ConsequencePreview,
  type ConsequenceView,
  type DecisionResultView,
  type EvidenceImageView,
  type MemberCardView,
  type Page,
  type ReportDetailView,
  type ReportSummaryView,
  type ReportTargetType,
  type ReportView,
} from '@hilcoe/shared'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { deletedCard, type AccessPolicy, type AccountViews } from '../identity/index.js'
import {
  ConflictError,
  DuplicateError,
  NotFoundError,
  PermissionDeniedError,
  isUniqueViolation,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type Clock,
  type ContentSnapshot,
  type TransactionRunner,
  type Tx,
} from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import type { OpportunityService } from '../opportunities/index.js'
import type { PublishingService } from '../publishing/index.js'
import type { AuditService } from './audit-service.js'

const DAY_MS = 24 * 60 * 60 * 1000
const EXCERPT_LENGTH = 200
const NOT_FOUND = 'The report was not found.'

export interface ModerationServiceDeps {
  db: PrismaClient
  transactions: TransactionRunner
  clock: Clock
  access: AccessPolicy
  views: AccountViews
  publishing: PublishingService
  opportunities: OpportunityService
  notifications: NotificationService
  audit: AuditService
}

type ReportRow = Prisma.ReportGetPayload<{
  include: { evidence: { select: { snapshotText: true; imageRef: true; purgeAfter: true } } }
}>

interface Target {
  targetType: ReportTargetType
  targetId: string
}

interface ContentFacts {
  authorId: string
  /** The post of a post or comment; null for a listing. */
  postId: string | null
}

function targetKey(target: Target): string {
  return `${target.targetType}:${target.targetId}`
}

function toReportView(row: {
  id: string
  targetType: ReportTargetType
  targetId: string
  reason: ReportView['reason']
  details: string | null
  state: ReportView['state']
  createdAt: Date
  decidedAt: Date | null
}): ReportView {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    details: row.details,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  }
}

/**
 * Reporting, decisions and consequences (FR-10, FR-13, FR-14, ODD Table 22).
 *
 * Locks, in order: the reporter's account then the content (submitReport); the content author's
 * account, the content, then the pending reports on it (upholding). Publishing and opportunity
 * changes lock the author's account before the content too, so a restriction applied by a
 * decision is seen by any change that follows it.
 */
export class ModerationService {
  constructor(private readonly deps: ModerationServiceDeps) {}

  /** Report Content: copies the evidence in the same transaction. Requires canInteract. */
  async submitReport(actor: ActorContext, input: unknown): Promise<ReportView> {
    const reporterId = this.member(actor)
    const report = parseInput(reportInputSchema, input)
    try {
      return await this.deps.transactions.run(async (tx) => {
        await this.deps.access.assertCanInteract(tx, actor)
        const snapshot = await this.captureSnapshot(tx, report, reporterId)
        if (snapshot.authorId === reporterId) {
          throw new PermissionDeniedError('You cannot report your own content.')
        }
        const pending = await tx.report.findFirst({
          where: { reporterId, targetType: report.targetType, targetId: report.targetId, state: 'PENDING' },
          select: { id: true },
        })
        if (pending) throw new DuplicateError('You have already reported this item. It is awaiting review.')
        const now = this.deps.clock.now()
        const created = await tx.report.create({
          data: {
            reporterId,
            targetType: report.targetType,
            targetId: report.targetId,
            targetVersion: snapshot.version,
            reason: report.reason,
            details: report.details,
            createdAt: now,
          },
        })
        await tx.moderationEvidence.createMany({
          data: [
            { reportId: created.id, snapshotText: snapshot.text, createdAt: now },
            ...snapshot.imageIds.map((imageRef) => ({ reportId: created.id, imageRef, createdAt: now })),
          ],
        })
        return toReportView(created)
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('You have already reported this item. It is awaiting review.')
      }
      throw error
    }
  }

  /** The actor's private report history, newest first. */
  async listMyReports(actor: ActorContext, page: unknown): Promise<Page<ReportView>> {
    const reporterId = this.member(actor)
    const request = parseInput(pageRequestSchema, page)
    const where = { reporterId }
    const [rows, total] = await Promise.all([
      this.deps.db.report.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(request),
      }),
      this.deps.db.report.count({ where }),
    ])
    return toPage(rows.map(toReportView), request, total)
  }

  /** The actor's consequences, newest first; the deciding Administrator and reporters are not shown. */
  async listMyConsequences(actor: ActorContext): Promise<ConsequenceView[]> {
    const memberId = this.member(actor)
    const rows = await this.deps.db.consequence.findMany({
      where: { memberId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { violation: { select: { targetType: true, targetId: true, decisionAt: true } } },
    })
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      targetType: row.violation.targetType,
      targetId: row.violation.targetId,
      decidedAt: row.violation.decisionAt.toISOString(),
      restrictUntil: row.restrictUntil?.toISOString() ?? null,
    }))
  }

  /**
   * The Administrator queue. Pending reports are listed oldest first (listPendingReports of the
   * ODD); the decided tabs newest first.
   */
  async listReports(actor: ActorContext, query: unknown): Promise<Page<ReportSummaryView>> {
    this.administrator(actor)
    const { state, ...request } = parseInput(adminReportQuerySchema, query)
    const where: Prisma.ReportWhereInput = state === 'ALL' ? {} : { state }
    const orderBy: Prisma.ReportOrderByWithRelationInput[] =
      state === 'PENDING' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }]
    const [rows, total] = await Promise.all([
      this.deps.db.report.findMany({
        where,
        orderBy,
        include: { evidence: { select: { snapshotText: true, imageRef: true, purgeAfter: true } } },
        ...pageWindow(request),
      }),
      this.deps.db.report.count({ where }),
    ])
    const { summaries } = await this.summarize(rows)
    return toPage(summaries, request, total)
  }

  /** One report with its evidence, refused once expired even if cleanup has not yet run (NFR-8). */
  async getReport(actor: ActorContext, reportId: string): Promise<ReportDetailView> {
    this.administrator(actor)
    const row = await this.deps.db.report.findUnique({
      where: { id: reportId },
      include: {
        evidence: {
          select: { snapshotText: true, imageRef: true, purgeAfter: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!row) throw new NotFoundError(NOT_FOUND)
    const { summaries, facts } = await this.summarize([row])
    const summary = summaries[0]
    if (!summary) throw new NotFoundError(NOT_FOUND)
    const content = facts.get(targetKey(row))
    const expired = this.isExpired(row)

    let evidence: ReportDetailView['evidence'] = null
    if (!expired) {
      const imageIds = row.evidence.flatMap((item) => (item.imageRef ? [item.imageRef] : []))
      const images = await this.deps.publishing.evidenceImages(imageIds)
      evidence = {
        snapshotText: row.evidence.find((item) => item.imageRef === null)?.snapshotText ?? null,
        images: imageIds.flatMap((id): EvidenceImageView[] => {
          const image = images.get(id)
          return image ? [image] : []
        }),
      }
    }

    const pending = row.state === 'PENDING'
    const [preview, otherPendingReports, decision] = await Promise.all([
      pending && content ? this.previewConsequence(row, content.authorId) : Promise.resolve(null),
      pending
        ? this.deps.db.report.count({
            where: {
              targetType: row.targetType,
              targetId: row.targetId,
              state: 'PENDING',
              id: { not: row.id },
            },
          })
        : Promise.resolve(0),
      this.deps.db.auditRecord.findFirst({
        where: { reportId: row.id, actionCode: 'REPORT_DECIDED' },
        orderBy: { occurredAt: 'desc' },
        select: { outcome: true, reason: true, occurredAt: true },
      }),
    ])
    return {
      ...summary,
      evidence,
      evidenceExpired: expired,
      consequencePreview: pending ? (preview ?? 'NONE') : null,
      otherPendingReports,
      postId: content?.postId ?? null,
      decision:
        decision?.outcome && !pending
          ? {
              outcome: decision.outcome,
              reason: decision.reason,
              decidedAt: decision.occurredAt.toISOString(),
            }
          : null,
    }
  }

  /**
   * Review Report and Apply Consequence. Upholding hides the content, resolves every pending
   * report on it, records one violation for the item and its consequence (a warning for the
   * author's first violation, otherwise a 14-day restriction). Both outcomes notify, start the
   * seven-day evidence retention and write the audit record.
   */
  async decideReport(actor: ActorContext, reportId: string, input: unknown): Promise<DecisionResultView> {
    this.administrator(actor)
    const { decision, reason } = parseInput(reportDecisionInputSchema, input)
    return this.deps.transactions.run(async (tx) => {
      const found = await tx.report.findUnique({
        where: { id: reportId },
        select: { targetType: true, targetId: true },
      })
      if (!found) throw new NotFoundError(NOT_FOUND)
      const content = (await this.contentFacts(tx, [found])).get(targetKey(found))
      if (!content) throw new NotFoundError('The reported item was not found.')
      const now = this.deps.clock.now()
      const purgeAfter = new Date(now.getTime() + EVIDENCE_RETENTION_DAYS * DAY_MS)

      if (decision === 'DISMISSED') {
        const locked = await tx.$queryRaw<{ id: string; state: string; reporter_id: string | null }[]>`
          SELECT id, state, reporter_id FROM report WHERE id = ${reportId}::uuid FOR UPDATE`
        const report = locked[0]
        if (!report || report.state !== 'PENDING')
          throw new ConflictError('This report has already been decided.')
        await tx.report.update({ where: { id: reportId }, data: { state: 'DISMISSED', decidedAt: now } })
        await tx.moderationEvidence.updateMany({ where: { reportId }, data: { purgeAfter } })
        if (report.reporter_id) await this.notifyReporter(tx, report.reporter_id, reportId)
        const author = await this.deps.access.getMember(tx, content.authorId)
        const auditRecordId = await this.deps.audit.record(tx, {
          actor,
          action: 'REPORT_DECIDED',
          outcome: 'DISMISSED',
          reportId,
          reason,
          targetMemberId: author.state === 'DELETED' ? null : author.id,
        })
        return {
          reportId,
          state: 'DISMISSED',
          outcome: 'DISMISSED',
          resolvedReports: 1,
          consequence: null,
          auditRecordId,
        }
      }

      const author = await this.deps.access.lockMember(tx, content.authorId)
      if (found.targetType === 'OPPORTUNITY') {
        await this.deps.opportunities.hideContent(tx, found.targetId)
      } else {
        await this.deps.publishing.hideContent(tx, found.targetType, found.targetId)
      }
      // Locked after the content, so no report can be added on the item meanwhile.
      const reports = await tx.$queryRaw<{ id: string; reporter_id: string | null }[]>`
        SELECT id, reporter_id FROM report
        WHERE target_type = ${found.targetType}::report_target_type AND target_id = ${found.targetId}::uuid
          AND state = 'PENDING'
        ORDER BY id
        FOR UPDATE`
      if (!reports.some((report) => report.id === reportId)) {
        throw new ConflictError('This report has already been decided.')
      }
      const reportIds = reports.map((report) => report.id)
      await tx.report.updateMany({
        where: { id: { in: reportIds } },
        data: { state: 'UPHELD', decidedAt: now },
      })
      await tx.moderationEvidence.updateMany({ where: { reportId: { in: reportIds } }, data: { purgeAfter } })

      let consequence: { kind: ConsequenceKind; restrictUntil: Date | null } | null = null
      const existing = await tx.violation.findUnique({
        where: { targetType_targetId: { targetType: found.targetType, targetId: found.targetId } },
        select: { id: true },
      })
      if (!existing) {
        const earlier = await tx.violation.count({ where: { memberId: author.id } })
        const violation = await tx.violation.create({
          data: {
            memberId: author.id,
            targetType: found.targetType,
            targetId: found.targetId,
            decidedByAdminId: actor.accountId,
            decisionAt: now,
          },
          select: { id: true },
        })
        if (author.state !== 'DELETED') {
          consequence =
            earlier === 0
              ? { kind: 'WARNING', restrictUntil: null }
              : { kind: 'RESTRICTION', restrictUntil: new Date(now.getTime() + RESTRICTION_DAYS * DAY_MS) }
          await tx.consequence.create({
            data: { memberId: author.id, violationId: violation.id, ...consequence, createdAt: now },
          })
          await this.deps.notifications.notify(tx, {
            recipientId: author.id,
            type: 'MODERATION_OUTCOME',
            eventKey: `moderation:${violation.id}`,
            actorId: null,
            targetType: 'REPORT',
            targetId: reportId,
          })
        }
      }
      for (const report of reports) {
        if (report.reporter_id) await this.notifyReporter(tx, report.reporter_id, report.id)
      }
      const outcome: AuditOutcome = !consequence
        ? 'UPHELD_NO_CONSEQUENCE'
        : consequence.kind === 'WARNING'
          ? 'UPHELD_WARNING'
          : 'UPHELD_RESTRICTION'
      const auditRecordId = await this.deps.audit.record(tx, {
        actor,
        action: 'REPORT_DECIDED',
        outcome,
        reportId,
        reason,
        targetMemberId: author.state === 'DELETED' ? null : author.id,
      })
      return {
        reportId,
        state: 'UPHELD',
        outcome,
        resolvedReports: reports.length,
        consequence: consequence && {
          kind: consequence.kind,
          restrictUntil: consequence.restrictUntil?.toISOString() ?? null,
        },
        auditRecordId,
      }
    })
  }

  /**
   * CleanupJob: removes evidence seven days after its decision (NFR-8) and releases the post
   * images no evidence refers to any more. Returns the storage keys of released images that are
   * no longer on a post, to remove after the commit.
   */
  async purgeExpiredEvidence(now: Date): Promise<{ evidence: number; removedImageKeys: string[] }> {
    return this.deps.transactions.run(async (tx) => {
      const deleted = await tx.$queryRaw<{ image_ref: string | null }[]>`
        DELETE FROM moderation_evidence WHERE purge_after <= ${now}::timestamptz RETURNING image_ref`
      const imageIds = [...new Set(deleted.flatMap((row) => (row.image_ref ? [row.image_ref] : [])))]
      if (imageIds.length === 0) return { evidence: deleted.length, removedImageKeys: [] }
      await this.deps.publishing.lockEvidenceImages(tx, imageIds)
      const held = await tx.moderationEvidence.findMany({
        where: { imageRef: { in: imageIds } },
        select: { imageRef: true },
        distinct: ['imageRef'],
      })
      const stillHeld = new Set(held.map((row) => row.imageRef))
      const released = imageIds.filter((id) => !stillHeld.has(id))
      const removedImageKeys = await this.deps.publishing.releaseEvidenceImages(tx, released)
      return { evidence: deleted.length, removedImageKeys }
    })
  }

  private async captureSnapshot(tx: Tx, target: Target, reporterId: string): Promise<ContentSnapshot> {
    if (target.targetType === 'OPPORTUNITY') {
      return this.deps.opportunities.captureSnapshot(tx, target.targetId, reporterId)
    }
    return this.deps.publishing.captureSnapshot(tx, target.targetType, target.targetId, reporterId)
  }

  /** Reporters learn only that their report was reviewed; no Administrator is named. */
  private async notifyReporter(tx: Tx, reporterId: string, reportId: string): Promise<void> {
    await this.deps.notifications.notify(tx, {
      recipientId: reporterId,
      type: 'REPORT_OUTCOME',
      eventKey: `report-outcome:${reportId}`,
      actorId: null,
      targetType: 'REPORT',
      targetId: reportId,
    })
  }

  private isExpired(row: { evidence: { purgeAfter: Date | null }[] }): boolean {
    const now = this.deps.clock.now().getTime()
    return row.evidence.some((item) => item.purgeAfter !== null && item.purgeAfter.getTime() <= now)
  }

  /** What upholding would apply now. */
  private async previewConsequence(target: Target, authorId: string): Promise<ConsequencePreview> {
    const author = await this.deps.access.getMember(this.deps.db, authorId)
    if (author.state === 'DELETED') return 'NONE'
    const existing = await this.deps.db.violation.findUnique({
      where: { targetType_targetId: { targetType: target.targetType, targetId: target.targetId } },
      select: { id: true },
    })
    if (existing) return 'NONE'
    const earlier = await this.deps.db.violation.count({ where: { memberId: authorId } })
    return earlier === 0 ? 'WARNING' : 'RESTRICTION'
  }

  /** The author and post of each reported item, read through the owning packages. */
  private async contentFacts(tx: Tx, targets: readonly Target[]): Promise<Map<string, ContentFacts>> {
    const ids = (type: ReportTargetType) =>
      targets.filter((target) => target.targetType === type).map((target) => target.targetId)
    const [posts, comments, listings] = await Promise.all([
      this.deps.publishing.contentAuthors(tx, 'POST', ids('POST')),
      this.deps.publishing.contentAuthors(tx, 'COMMENT', ids('COMMENT')),
      this.deps.opportunities.listingAuthors(tx, ids('OPPORTUNITY')),
    ])
    const facts = new Map<string, ContentFacts>()
    for (const [id, fact] of posts) facts.set(`POST:${id}`, fact)
    for (const [id, fact] of comments) facts.set(`COMMENT:${id}`, fact)
    for (const [id, authorId] of listings) facts.set(`OPPORTUNITY:${id}`, { authorId, postId: null })
    return facts
  }

  private async summarize(
    rows: readonly ReportRow[],
  ): Promise<{ summaries: ReportSummaryView[]; facts: Map<string, ContentFacts> }> {
    const facts = await this.contentFacts(this.deps.db, rows)
    const authorIds = [...new Set([...facts.values()].map((fact) => fact.authorId))]
    const [cards, violations] = await Promise.all([
      this.deps.views.memberCards([
        ...authorIds,
        ...rows.flatMap((row) => (row.reporterId ? [row.reporterId] : [])),
      ]),
      authorIds.length > 0
        ? this.deps.db.violation.findMany({
            where: { memberId: { in: authorIds } },
            select: { memberId: true, targetType: true, targetId: true },
          })
        : Promise.resolve([]),
    ])
    const card = (id: string | null | undefined): MemberCardView =>
      (id ? cards.get(id) : undefined) ?? deletedCard()
    const summaries = rows.map((row): ReportSummaryView => {
      const authorId = facts.get(targetKey(row))?.authorId
      const text = this.isExpired(row)
        ? null
        : (row.evidence.find((item) => item.imageRef === null)?.snapshotText ?? null)
      return {
        ...toReportView(row),
        excerpt:
          text === null ? null : text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text,
        author: card(authorId),
        reporter: card(row.reporterId),
        authorPriorViolations: violations.filter(
          (violation) => violation.memberId === authorId && targetKey(violation) !== targetKey(row),
        ).length,
      }
    })
    return { summaries, facts }
  }

  private member(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  private administrator(actor: ActorContext): void {
    if (!actor.isAdministrator) throw new PermissionDeniedError('This is for Administrators.')
  }
}
