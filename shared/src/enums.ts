import { z } from 'zod'

// Enumerations of ODD Sections 3.1 to 3.10. The arrays are the single source for
// the Zod schemas here and are mirrored by the PostgreSQL enums in the Prisma schema.

export const ACTOR_KINDS = ['MEMBER', 'ADMIN'] as const
export const actorKindSchema = z.enum(ACTOR_KINDS)
export type ActorKind = z.infer<typeof actorKindSchema>

// identity (Table 7)
export const ROLES = ['STUDENT', 'STAFF', 'ALUMNI'] as const
export const roleSchema = z.enum(ROLES)
export type Role = z.infer<typeof roleSchema>

export const ALUMNI_STATUSES = ['SELF_REPORTED', 'VERIFIED', 'FLAGGED'] as const
export const alumniStatusSchema = z.enum(ALUMNI_STATUSES)
export type AlumniStatus = z.infer<typeof alumniStatusSchema>

export const ACCOUNT_STATES = ['ACTIVE', 'DISABLED', 'DELETED'] as const
export const accountStateSchema = z.enum(ACCOUNT_STATES)
export type AccountState = z.infer<typeof accountStateSchema>

export const ADMIN_STATES = ['ACTIVE', 'DISABLED'] as const
export const adminStateSchema = z.enum(ADMIN_STATES)
export type AdminState = z.infer<typeof adminStateSchema>

export const PROGRAMMES = ['COMPUTER_SCIENCE', 'SOFTWARE_ENGINEERING'] as const
export const programmeSchema = z.enum(PROGRAMMES)
export type Programme = z.infer<typeof programmeSchema>

export const REGISTRATION_PATHS = ['INSTITUTIONAL_EMAIL', 'PERSONAL_EMAIL'] as const
export const registrationPathSchema = z.enum(REGISTRATION_PATHS)
export type RegistrationPath = z.infer<typeof registrationPathSchema>

export const REVIEW_DECISIONS = ['PENDING', 'VERIFIED', 'FLAGGED'] as const
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS)
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>

export const GRADUATION_DECISIONS = ['PENDING', 'CONFIRMED', 'DECLINED'] as const
export const graduationDecisionSchema = z.enum(GRADUATION_DECISIONS)
export type GraduationDecision = z.infer<typeof graduationDecisionSchema>

export const LIFECYCLE_KINDS = ['GRADUATION_CONFIRMED', 'ROLE_CORRECTED', 'ACCOUNT_DELETED'] as const
export const lifecycleKindSchema = z.enum(LIFECYCLE_KINDS)
export type LifecycleKind = z.infer<typeof lifecycleKindSchema>

// infrastructure (Table 5, ImageProcessor)
export const IMAGE_PURPOSES = ['POST', 'PROFILE'] as const
export const imagePurposeSchema = z.enum(IMAGE_PURPOSES)
export type ImagePurpose = z.infer<typeof imagePurposeSchema>

// publishing (Table 9)
export const POST_STATES = ['VISIBLE', 'ARCHIVED', 'HIDDEN'] as const
export const postStateSchema = z.enum(POST_STATES)
export type PostState = z.infer<typeof postStateSchema>

export const COMMENT_STATES = ['VISIBLE', 'DELETED', 'HIDDEN'] as const
export const commentStateSchema = z.enum(COMMENT_STATES)
export type CommentState = z.infer<typeof commentStateSchema>

// boards (Table 11)
export const SAVE_TARGET_TYPES = ['POST', 'OPPORTUNITY', 'GROUP'] as const
export const saveTargetTypeSchema = z.enum(SAVE_TARGET_TYPES)
export type SaveTargetType = z.infer<typeof saveTargetTypeSchema>

export const SEARCH_CATEGORIES = ['POSTS', 'OPPORTUNITIES', 'ACTIVITIES', 'MENTORS'] as const
export const searchCategorySchema = z.enum(SEARCH_CATEGORIES)
export type SearchCategory = z.infer<typeof searchCategorySchema>

// mentorship (Table 13)
export const MENTORSHIP_STATES = ['PENDING', 'ACTIVE', 'DECLINED', 'WITHDRAWN', 'ENDED'] as const
export const mentorshipStateSchema = z.enum(MENTORSHIP_STATES)
export type MentorshipState = z.infer<typeof mentorshipStateSchema>

export const CONTACT_KINDS = ['EMAIL', 'TELEGRAM', 'PHONE', 'OTHER'] as const
export const contactKindSchema = z.enum(CONTACT_KINDS)
export type ContactKind = z.infer<typeof contactKindSchema>

// opportunities (Table 15)
export const OPPORTUNITY_TYPES = ['INTERNSHIP', 'PART_TIME', 'FULL_TIME'] as const
export const opportunityTypeSchema = z.enum(OPPORTUNITY_TYPES)
export type OpportunityType = z.infer<typeof opportunityTypeSchema>

export const WORK_ARRANGEMENTS = ['ON_SITE', 'REMOTE', 'HYBRID'] as const
export const workArrangementSchema = z.enum(WORK_ARRANGEMENTS)
export type WorkArrangement = z.infer<typeof workArrangementSchema>

export const OPPORTUNITY_STATES = ['OPEN', 'CLOSED', 'HIDDEN'] as const
export const opportunityStateSchema = z.enum(OPPORTUNITY_STATES)
export type OpportunityState = z.infer<typeof opportunityStateSchema>

// groups (Table 17)
export const GROUP_STATES = ['OPEN', 'CLOSED'] as const
export const groupStateSchema = z.enum(GROUP_STATES)
export type GroupState = z.infer<typeof groupStateSchema>

export const MEMBERSHIP_STATES = ['PENDING', 'ACCEPTED', 'DECLINED', 'LEFT'] as const
export const membershipStateSchema = z.enum(MEMBERSHIP_STATES)
export type MembershipState = z.infer<typeof membershipStateSchema>

export const TRANSFER_STATES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const
export const transferStateSchema = z.enum(TRANSFER_STATES)
export type TransferState = z.infer<typeof transferStateSchema>

// notifications (Table 19)
export const NOTIFICATION_TYPES = [
  'COMMENT',
  'REPLY',
  'LIKE',
  'MENTORSHIP_REQUEST',
  'MENTORSHIP_OUTCOME',
  'GROUP_REQUEST',
  'GROUP_OUTCOME',
  'GROUP_TRANSFER',
  'ALUMNI_DECISION',
  'GRADUATION_DECISION',
  'MODERATION_OUTCOME',
  'REPORT_OUTCOME',
] as const
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES)
export type NotificationType = z.infer<typeof notificationTypeSchema>

// moderation (Table 21)
export const REPORT_TARGET_TYPES = ['POST', 'COMMENT', 'OPPORTUNITY'] as const
export const reportTargetTypeSchema = z.enum(REPORT_TARGET_TYPES)
export type ReportTargetType = z.infer<typeof reportTargetTypeSchema>

export const GUIDELINE_CATEGORIES = [
  'HARASSMENT',
  'SPAM',
  'IMPERSONATION',
  'PRIVATE_INFORMATION',
  'FALSE_INFORMATION',
] as const
export const guidelineCategorySchema = z.enum(GUIDELINE_CATEGORIES)
export type GuidelineCategory = z.infer<typeof guidelineCategorySchema>

export const REPORT_STATES = ['PENDING', 'UPHELD', 'DISMISSED'] as const
export const reportStateSchema = z.enum(REPORT_STATES)
export type ReportState = z.infer<typeof reportStateSchema>

export const CONSEQUENCE_KINDS = ['WARNING', 'RESTRICTION'] as const
export const consequenceKindSchema = z.enum(CONSEQUENCE_KINDS)
export type ConsequenceKind = z.infer<typeof consequenceKindSchema>

// One value per audited operation of AdminIdentityService, an Administrator's own
// email change and decideReport (Table 21, NFR-7).
export const AUDIT_ACTIONS = [
  'ALUMNI_REVIEWED',
  'GRADUATION_DECIDED',
  'STAFF_EMAIL_ADDED',
  'STAFF_EMAIL_REMOVED',
  'ROLE_CORRECTED',
  'MEMBER_EMAIL_UPDATED',
  'ACCOUNT_DISABLED',
  'ACCOUNT_RESTORED',
  'FAKE_ACCOUNT_DELETED',
  'ADMINISTRATOR_CREATED',
  'ADMINISTRATOR_MFA_RESET',
  'ADMINISTRATOR_REMOVED',
  'ADMINISTRATOR_EMAIL_CHANGED',
  'REPORT_DECIDED',
] as const
export const auditActionSchema = z.enum(AUDIT_ACTIONS)
export type AuditAction = z.infer<typeof auditActionSchema>

/**
 * The outcome of a REPORT_DECIDED record (NFR-7). UPHELD_NO_CONSEQUENCE: the item was upheld but
 * its author's account had been deleted, so no consequence applies.
 */
export const AUDIT_OUTCOMES = [
  'DISMISSED',
  'UPHELD_WARNING',
  'UPHELD_RESTRICTION',
  'UPHELD_NO_CONSEQUENCE',
] as const
export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES)
export type AuditOutcome = z.infer<typeof auditOutcomeSchema>
