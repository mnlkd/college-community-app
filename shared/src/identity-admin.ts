import { z } from 'zod'
import {
  roleSchema,
  type AccountState,
  type AlumniStatus,
  type GraduationDecision,
  type Programme,
  type RegistrationPath,
  type ReviewDecision,
  type Role,
} from './enums.js'
import { pageRequestSchema } from './pagination.js'
import { institutionalEmailSchema, emailSchema, optionalText, requiredText } from './text.js'

// AdminIdentityService Input/View types (ODD Section 3.2, Table 8; SRS Table 6 use cases of Batch 1b).

/** Private reasons are never shown to the member (Table 7). */
export const PRIVATE_REASON_MAX = 1000
export const MEMBER_SEARCH_MAX = 100

export const privateReasonSchema = requiredText(PRIVATE_REASON_MAX)

/** Body of the operations that only need a reason: disable, restore, delete, MFA reset, removal. */
export const reasonInputSchema = z.object({ reason: privateReasonSchema })
export type ReasonInput = z.input<typeof reasonInputSchema>

/** Review Alumni Affiliation; uncertain cases stay pending, so there is no PENDING choice. */
export const alumniDecisionInputSchema = z.object({
  decision: z.enum(['VERIFIED', 'FLAGGED']),
  reason: privateReasonSchema,
})
export type AlumniDecisionInput = z.input<typeof alumniDecisionInputSchema>

/** Confirm Graduation. */
export const graduationDecisionInputSchema = z.object({
  decision: z.enum(['CONFIRMED', 'DECLINED']),
  reason: privateReasonSchema,
})
export type GraduationDecisionInput = z.input<typeof graduationDecisionInputSchema>

/** Maintain Staff Email List. */
export const staffEmailInputSchema = z.object({ email: institutionalEmailSchema })
export type StaffEmailInput = z.input<typeof staffEmailInputSchema>

/** Alumni statuses an Administrator may give through Correct Community Role. */
export const ROLE_CORRECTION_ALUMNI_STATUSES = ['VERIFIED', 'SELF_REPORTED'] as const

/**
 * Correct Community Role. An Alumni result needs a status: VERIFIED, or SELF_REPORTED, which
 * opens a new Alumni review. Other roles take no status.
 */
export const roleCorrectionInputSchema = z
  .object({
    newRole: roleSchema,
    alumniStatus: z
      .enum(ROLE_CORRECTION_ALUMNI_STATUSES)
      .nullish()
      .transform((value) => value ?? null),
    reason: privateReasonSchema,
  })
  .superRefine((input, context) => {
    if (input.newRole === 'ALUMNI' && input.alumniStatus === null) {
      context.addIssue({ code: 'custom', path: ['alumniStatus'], message: 'Choose the Alumni status' })
    }
    if (input.newRole !== 'ALUMNI' && input.alumniStatus !== null) {
      context.addIssue({ code: 'custom', path: ['alumniStatus'], message: 'Only Alumni have a status' })
    }
  })
export type RoleCorrectionInput = z.input<typeof roleCorrectionInputSchema>

/** Update Member Email. */
export const memberEmailUpdateInputSchema = z.object({
  newEmail: emailSchema,
  reason: privateReasonSchema,
})
export type MemberEmailUpdateInput = z.input<typeof memberEmailUpdateInputSchema>

/** Create Administrator: a college email only (FR-1). */
export const administratorInputSchema = z.object({ email: institutionalEmailSchema })
export type AdministratorInput = z.input<typeof administratorInputSchema>

export const ADMIN_MEMBER_FILTERS = ['ALL', 'FLAGGED', 'DISABLED'] as const
export const adminMemberFilterSchema = z.enum(ADMIN_MEMBER_FILTERS)
export type AdminMemberFilter = z.infer<typeof adminMemberFilterSchema>

/** Users list: deleted accounts are never listed. */
export const adminMemberQuerySchema = pageRequestSchema.extend({
  filter: adminMemberFilterSchema.default('ALL'),
  query: optionalText(MEMBER_SEARCH_MAX),
})
export type AdminMemberQuery = z.input<typeof adminMemberQuerySchema>

/** Staff email list search. */
export const staffEmailQuerySchema = pageRequestSchema.extend({
  query: optionalText(MEMBER_SEARCH_MAX),
})
export type StaffEmailQuery = z.input<typeof staffEmailQuerySchema>

/** One row of the Administrator users list. Includes the email, unlike ProfileView. */
export interface AdminMemberSummaryView {
  id: string
  displayName: string
  email: string
  role: Role
  alumniStatus: AlumniStatus | null
  programme: Programme | null
  state: Exclude<AccountState, 'DELETED'>
  createdAt: string
}

/** A Self-Reported Alumni account waiting for Review Alumni Affiliation. */
export interface AlumniReviewView {
  id: string
  memberId: string
  displayName: string
  email: string
  registrationPath: RegistrationPath
  claimedFullName: string
  identifyingContext: string | null
  programme: Programme | null
  graduationYear: number | null
  decision: ReviewDecision
  createdAt: string
}

/** Kinds of responsibility that block a role change until the member hands it over. */
export const ROLE_CHANGE_BLOCKER_KINDS = ['OWNED_GROUP'] as const
export type RoleChangeBlockerKind = (typeof ROLE_CHANGE_BLOCKER_KINDS)[number]

/** Something the member must transfer or close before the role can change, e.g. an open group they own. */
export interface RoleChangeBlockerView {
  kind: RoleChangeBlockerKind
  id: string
  label: string
}

/** A Student's graduation request waiting for Confirm Graduation. */
export interface PendingGraduationView {
  id: string
  memberId: string
  displayName: string
  email: string
  /** The programme on the account, to compare with the claimed one. */
  currentProgramme: Programme | null
  programme: Programme
  graduationYear: number
  decision: GraduationDecision
  createdAt: string
  /** While any remain, confirming is refused (CONFLICT). */
  blockers: RoleChangeBlockerView[]
}

/** The Manage User screen. */
export interface AdminMemberView extends AdminMemberSummaryView {
  studyOrExpertise: string | null
  graduationYear: number | null
  currentPosition: string | null
  pendingAlumniReview: AlumniReviewView | null
  pendingGraduationRequest: PendingGraduationView | null
}

export interface StaffEmailView {
  email: string
  updatedAt: string
}

export interface AdministratorView {
  id: string
  email: string
  isFirstAdmin: boolean
  /** True for the signed-in Administrator. */
  isSelf: boolean
  createdAt: string
}
