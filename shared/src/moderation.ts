import { z } from 'zod'
import {
  auditActionSchema,
  guidelineCategorySchema,
  reportTargetTypeSchema,
  type AuditAction,
  type AuditOutcome,
  type ConsequenceKind,
  type GuidelineCategory,
  type ReportState,
  type ReportTargetType,
} from './enums.js'
import type { MemberCardView } from './identity.js'
import { privateReasonSchema } from './identity-admin.js'
import { pageRequestSchema } from './pagination.js'
import { calendarDateSchema, optionalText, uuidSchema } from './text.js'

// moderation Input/View types (ODD Section 3.9, Tables 21 and 22).

export const REPORT_DETAILS_MAX = 1000
/** Evidence is kept for seven days after the decision (NFR-8). */
export const EVIDENCE_RETENTION_DAYS = 7
/** A restriction lasts 14 days from the decision (FR-14). */
export const RESTRICTION_DAYS = 14

/** ReportInput of Table 22. */
export const reportInputSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetId: uuidSchema,
  reason: guidelineCategorySchema,
  details: optionalText(REPORT_DETAILS_MAX),
})
export type ReportInput = z.input<typeof reportInputSchema>

export const REPORT_DECISIONS = ['UPHELD', 'DISMISSED'] as const
export const reportDecisionSchema = z.enum(REPORT_DECISIONS)
export type ReportDecision = z.infer<typeof reportDecisionSchema>

/** decideReport(decision, reason): the private reason is required (NFR-7). */
export const reportDecisionInputSchema = z.object({
  decision: reportDecisionSchema,
  reason: privateReasonSchema,
})
export type ReportDecisionInput = z.input<typeof reportDecisionInputSchema>

/** Queue tabs of the Administrator moderation screen. */
export const ADMIN_REPORT_STATES = ['PENDING', 'UPHELD', 'DISMISSED', 'ALL'] as const
export const adminReportStateSchema = z.enum(ADMIN_REPORT_STATES)
export type AdminReportState = z.infer<typeof adminReportStateSchema>

/** Pending reports are listed oldest first; decided ones newest first. */
export const adminReportQuerySchema = pageRequestSchema.extend({
  state: adminReportStateSchema.default('PENDING'),
})
export type AdminReportQuery = z.input<typeof adminReportQuerySchema>

/** A blank, missing or null query value means "no filter". */
function optionalFilter<T extends z.ZodType<string>>(schema: T) {
  return z
    .union([z.literal(''), schema])
    .nullish()
    .transform((value) => (value ? (value as z.output<T>) : null))
}

/** listAuditRecords filters; from and to are inclusive UTC calendar days. */
export const auditRecordQuerySchema = pageRequestSchema
  .extend({
    action: optionalFilter(auditActionSchema),
    adminId: optionalFilter(uuidSchema),
    memberId: optionalFilter(uuidSchema),
    from: optionalFilter(calendarDateSchema),
    to: optionalFilter(calendarDateSchema),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The end date must not be before the start date',
  })
export type AuditRecordQuery = z.input<typeof auditRecordQuerySchema>

/** A member's own report (private report history). The reported content is not repeated. */
export interface ReportView {
  id: string
  targetType: ReportTargetType
  targetId: string
  reason: GuidelineCategory
  details: string | null
  state: ReportState
  createdAt: string
  decidedAt: string | null
}

/** One row of the Administrator queue. */
export interface ReportSummaryView extends ReportView {
  /** Start of the evidence text; null once the evidence has expired. */
  excerpt: string | null
  author: MemberCardView
  /** Deleted User card after the reporter's account is deleted. */
  reporter: MemberCardView
  /** Earlier upheld violations of the author, excluding this item. */
  authorPriorViolations: number
}

export interface EvidenceImageView {
  /** Signed link valid for 60 seconds. */
  url: string
  altText: string | null
}

export interface EvidenceView {
  snapshotText: string | null
  images: EvidenceImageView[]
}

export type ConsequencePreview = ConsequenceKind | 'NONE'

export interface ReportDecisionView {
  outcome: AuditOutcome
  reason: string | null
  decidedAt: string
}

export interface ReportDetailView extends ReportSummaryView {
  /** The snapshot taken at submission; null once expired (NFR-8). */
  evidence: EvidenceView | null
  evidenceExpired: boolean
  /** What upholding would apply now; null once decided. NONE for a deleted author. */
  consequencePreview: ConsequencePreview | null
  /** Other pending reports on the same item, resolved together on upholding. */
  otherPendingReports: number
  /** For the post of a reported comment, so the Administrator can open the context. */
  postId: string | null
  decision: ReportDecisionView | null
}

export interface DecisionResultView {
  reportId: string
  state: ReportState
  outcome: AuditOutcome
  /** Every report resolved by this decision (several on upholding). */
  resolvedReports: number
  consequence: { kind: ConsequenceKind; restrictUntil: string | null } | null
  auditRecordId: string
}

/** A consequence as its member sees it; the deciding Administrator and reporters are not shown. */
export interface ConsequenceView {
  id: string
  kind: ConsequenceKind
  targetType: ReportTargetType
  targetId: string
  decidedAt: string
  restrictUntil: string | null
}

export interface AuditRecordView {
  id: string
  occurredAt: string
  action: AuditAction
  outcome: AuditOutcome | null
  /** Null once the acting Administrator's reference is removed. */
  actor: { adminId: string; email: string } | null
  targetMember: { memberId: string; displayName: string } | null
  targetAdmin: { adminId: string; email: string } | null
  reason: string | null
  reportId: string | null
  /** True when a referenced account was deleted and its reference removed. */
  anonymized: boolean
}
