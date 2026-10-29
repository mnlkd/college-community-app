import { z } from 'zod'
import {
  type accountStateSchema,
  type alumniStatusSchema,
  type graduationDecisionSchema,
  programmeSchema,
  type Role,
} from './enums.js'
import type { FieldErrors } from './errors.js'
import { INSTITUTIONAL_EMAIL_DOMAIN, optionalText, requiredText } from './text.js'

// identity Input/View types (ODD Section 3.2, Tables 7 and 8).

export const DISPLAY_NAME_MAX = 100
export const BIO_MAX = 500
export const PROFILE_DETAIL_MAX = 160
export const IDENTIFYING_CONTEXT_MAX = 1000
/** First graduation year accepted for Alumni and graduation requests. */
export const GRADUATION_YEAR_MIN = 1997
/** Students give an expected graduation year from the current year to this many years ahead. */
export const EXPECTED_GRADUATION_YEARS_AHEAD = 7

export function isInstitutionalEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${INSTITUTIONAL_EMAIL_DOMAIN}`)
}

const yearSchema = z.number({ error: 'Enter a year' }).int('Enter a year')

/** A year an Alumni graduated or a Student completed the programme: 1997 to the current year. */
export function pastGraduationYearSchema(currentYear: number) {
  return yearSchema
    .min(GRADUATION_YEAR_MIN, `From ${GRADUATION_YEAR_MIN}`)
    .max(currentYear, 'Cannot be in the future')
}

/** A Student's expected graduation year: the current year to seven years ahead. */
export function expectedGraduationYearSchema(currentYear: number) {
  const last = currentYear + EXPECTED_GRADUATION_YEARS_AHEAD
  return yearSchema.min(currentYear, `From ${currentYear}`).max(last, `At most ${last}`)
}

/** Role-specific profile details collected at registration and kept by Profile. */
export const roleDetailsSchema = z.object({
  programme: programmeSchema.nullish().transform((value) => value ?? null),
  graduationYear: yearSchema.nullish().transform((value) => value ?? null),
  studyOrExpertise: optionalText(PROFILE_DETAIL_MAX),
  currentPosition: optionalText(PROFILE_DETAIL_MAX),
})
export type RoleDetails = z.output<typeof roleDetailsSchema>

/**
 * Role rules shared by registration and profile editing: Students give a programme and an
 * expected graduation year, Alumni a programme and a past graduation year, Staff their
 * department or expertise and position (SRS Table 6, Register Account). Staff have no
 * programme or graduation year. Returns the failing fields; empty when the details fit.
 */
export function roleDetailsIssues(role: Role, details: RoleDetails, currentYear: number): FieldErrors {
  const fields: FieldErrors = {}
  const checkYear = (schema: z.ZodType) => {
    if (details.graduationYear === null) fields.graduationYear = 'Required'
    else {
      const result = schema.safeParse(details.graduationYear)
      if (!result.success) fields.graduationYear = result.error.issues[0]?.message ?? 'Not valid'
    }
  }
  if (role === 'STAFF') {
    if (details.studyOrExpertise === null) fields.studyOrExpertise = 'Required'
    if (details.currentPosition === null) fields.currentPosition = 'Required'
    if (details.programme !== null) fields.programme = 'Staff profiles have no programme'
    if (details.graduationYear !== null) fields.graduationYear = 'Staff profiles have no graduation year'
    return fields
  }
  if (details.programme === null) fields.programme = 'Required'
  checkYear(
    role === 'STUDENT' ? expectedGraduationYearSchema(currentYear) : pastGraduationYearSchema(currentYear),
  )
  return fields
}

// Registration (Register Account, Self-report Alumni Details)

export const REGISTRATION_KINDS = ['STUDENT_OR_STAFF', 'ALUMNI'] as const
export const registrationKindSchema = z.enum(REGISTRATION_KINDS)
export type RegistrationKind = z.infer<typeof registrationKindSchema>

const studentOrStaffRegistrationSchema = roleDetailsSchema.extend({
  kind: z.literal('STUDENT_OR_STAFF'),
  displayName: requiredText(DISPLAY_NAME_MAX),
})

const alumniRegistrationSchema = roleDetailsSchema.extend({
  kind: z.literal('ALUMNI'),
  /** For the personal-email path this is the full name the Administrator corroborates. */
  displayName: requiredText(DISPLAY_NAME_MAX),
  identifyingContext: optionalText(IDENTIFYING_CONTEXT_MAX),
})

/** Sent once Supabase Auth has accepted the email code (RegistrationService.completeRegistration). */
export const registrationInputSchema = z.discriminatedUnion('kind', [
  studentOrStaffRegistrationSchema,
  alumniRegistrationSchema,
])
export type RegistrationInput = z.input<typeof registrationInputSchema>
export type ParsedRegistrationInput = z.output<typeof registrationInputSchema>

/** Whether the signed-in Supabase user already has a platform account, and the role it would get. */
export interface RegistrationStatusView {
  registered: boolean
  email: string
  institutional: boolean
  /** True when the email is on the active Staff email list. */
  staffListed: boolean
}

// Profiles (View Member Profile, Manage Profile and Account)

/** Public profile fields. Never the email, review, moderation or saved data. */
export interface ProfileView {
  memberId: string
  displayName: string
  role: Role
  alumniStatus: z.infer<typeof alumniStatusSchema> | null
  programme: z.infer<typeof programmeSchema> | null
  bio: string | null
  studyOrExpertise: string | null
  graduationYear: number | null
  currentPosition: string | null
  /** Signed link valid for 60 seconds; null when there is no picture (initials are shown). */
  pictureUrl: string | null
}

export const profileInputSchema = roleDetailsSchema.extend({
  displayName: requiredText(DISPLAY_NAME_MAX),
  bio: optionalText(BIO_MAX),
})
export type ProfileInput = z.input<typeof profileInputSchema>
export type ParsedProfileInput = z.output<typeof profileInputSchema>

// Graduation requests (Request Alumni Status)

export const graduationInputSchema = z.object({
  programme: programmeSchema,
  graduationYear: yearSchema,
})
export type GraduationInput = z.input<typeof graduationInputSchema>

export interface GraduationRequestView {
  id: string
  programme: z.infer<typeof programmeSchema>
  graduationYear: number
  decision: z.infer<typeof graduationDecisionSchema>
  createdAt: string
  decidedAt: string | null
}

/** The signed-in member's own account, shown in Settings. */
export interface OwnAccountView {
  id: string
  email: string
  displayName: string
  role: Role
  alumniStatus: z.infer<typeof alumniStatusSchema> | null
  state: z.infer<typeof accountStateSchema>
  profile: ProfileView
  /** The latest graduation request, if any. */
  graduationRequest: GraduationRequestView | null
}

export const deleteAccountInputSchema = z.object({
  currentPassword: z.string().min(1, 'Required').max(200, 'At most 200 characters'),
})
export type DeleteAccountInput = z.input<typeof deleteAccountInputSchema>

/** Shown wherever a deleted account's content appears (FR-2). */
export const DELETED_USER_NAME = 'Deleted User'

/**
 * How a member appears beside their content (posts, comments, likers). A deleted account shows
 * Deleted User with no profile link, role or picture (FR-2).
 */
export interface MemberCardView {
  /** Null for a deleted account, so no profile link is offered. */
  memberId: string | null
  displayName: string
  role: Role | null
  alumniStatus: z.infer<typeof alumniStatusSchema> | null
  /** Signed link valid for 60 seconds; null without a picture. */
  pictureUrl: string | null
  deleted: boolean
}
