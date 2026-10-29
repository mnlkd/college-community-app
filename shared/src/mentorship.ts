import { z } from 'zod'
import { contactKindSchema, mentorshipStateSchema, type ContactKind, type MentorshipState } from './enums.js'
import type { MemberCardView, ProfileView } from './identity.js'
import { pageRequestSchema } from './pagination.js'
import { tagSchema } from './publishing.js'
import { emailSchema, optionalText, queryFlag, requiredText } from './text.js'

// mentorship Input/View types (ODD Section 3.5, Tables 13 and 14).

/** A Student has at most three ACTIVE mentors (FR-5). */
export const STUDENT_MENTOR_LIMIT = 3
/** Capacity is a positive whole number; the upper bound is an implementation choice. */
export const MENTOR_CAPACITY_MAX = 10
export const MENTOR_INTRODUCTION_MAX = 500
export const MENTOR_TOPICS_MAX = 5
export const MENTOR_TOPIC_MAX = 160
export const MENTOR_CONTACT_VALUE_MAX = 500
export const MENTORSHIP_TOPIC_MAX = 160
export const MENTORSHIP_NOTE_MAX = 1000

const PHONE_PATTERN = /^\+?[\d\s().-]{6,40}$/

export const mentorContactInputSchema = z
  .object({ kind: contactKindSchema, value: requiredText(MENTOR_CONTACT_VALUE_MAX) })
  .superRefine((contact, context) => {
    if (contact.kind === 'EMAIL' && !emailSchema.safeParse(contact.value).success) {
      context.addIssue({ code: 'custom', message: 'Enter a valid email address', path: ['value'] })
    }
    if (contact.kind === 'PHONE' && !PHONE_PATTERN.test(contact.value)) {
      context.addIssue({ code: 'custom', message: 'Enter a valid phone number', path: ['value'] })
    }
  })
  .transform((contact) =>
    contact.kind === 'EMAIL' ? { ...contact, value: contact.value.toLowerCase() } : contact,
  )
export type MentorContactInput = z.input<typeof mentorContactInputSchema>

/** Manage Mentor Availability: settings and the contacts shared with active mentees only. */
export const mentorProfileInputSchema = z.object({
  available: z.boolean(),
  capacity: z
    .number({ error: 'Enter a whole number' })
    .int('Enter a whole number')
    .min(1, 'At least 1')
    .max(MENTOR_CAPACITY_MAX, `At most ${MENTOR_CAPACITY_MAX}`),
  introduction: optionalText(MENTOR_INTRODUCTION_MAX),
  topics: z
    .array(requiredText(MENTOR_TOPIC_MAX))
    .max(MENTOR_TOPICS_MAX, `At most ${MENTOR_TOPICS_MAX} topics`)
    .default([])
    .refine(
      (topics) => new Set(topics.map((topic) => topic.toLowerCase())).size === topics.length,
      'Each topic may appear once',
    ),
  contacts: z
    .array(mentorContactInputSchema)
    .min(1, 'Choose at least one contact method')
    .refine(
      (contacts) => new Set(contacts.map((contact) => contact.kind)).size === contacts.length,
      'One contact per method',
    ),
})
export type MentorProfileInput = z.input<typeof mentorProfileInputSchema>
export type ParsedMentorProfileInput = z.output<typeof mentorProfileInputSchema>

export const mentorshipRequestInputSchema = z.object({
  topic: requiredText(MENTORSHIP_TOPIC_MAX),
  note: requiredText(MENTORSHIP_NOTE_MAX),
})
export type MentorshipRequestInput = z.input<typeof mentorshipRequestInputSchema>

export const MENTORSHIP_SIDES = ['STUDENT', 'MENTOR'] as const
export const mentorshipSideSchema = z.enum(MENTORSHIP_SIDES)
export type MentorshipSide = z.infer<typeof mentorshipSideSchema>

/** States that end a request or relationship; the "History" tab. */
export const CLOSED_MENTORSHIP_STATES = ['DECLINED', 'WITHDRAWN', 'ENDED'] as const

/** listMyMentorships: `state` is one state or a comma-separated list. */
export const mentorshipListQuerySchema = pageRequestSchema.extend({
  side: mentorshipSideSchema.nullish().transform((value) => value ?? null),
  state: z
    .string()
    .nullish()
    .transform((value) => (value ? value.split(',').map((part) => part.trim()) : []))
    .pipe(z.array(mentorshipStateSchema)),
})
export type MentorshipListQuery = z.input<typeof mentorshipListQuerySchema>

/** searchMentors: available mentors by keyword (introduction and topics), #tag or topic, and open places. */
export const mentorSearchQuerySchema = pageRequestSchema.extend({
  text: optionalText(200),
  /** A normalized tag; matches a topic written as a tag (lower case, spaces as hyphens). */
  tag: tagSchema.nullish().transform((value) => value ?? null),
  topic: optionalText(MENTOR_TOPIC_MAX),
  openOnly: queryFlag,
})
export type MentorSearchQuery = z.input<typeof mentorSearchQuerySchema>
export type ParsedMentorSearchQuery = z.output<typeof mentorSearchQuerySchema>

/** Topic.asTag: the form of a topic that a #tag search matches. */
export function topicAsTag(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, '-')
}

/** Why the viewer cannot request this mentor now; checked again by the server. */
export const MENTOR_REQUEST_BLOCKS = [
  'NOT_STUDENT',
  'CANNOT_INTERACT',
  'UNAVAILABLE',
  'MENTOR_FULL',
  'STUDENT_LIMIT',
  'OPEN_MENTORSHIP',
] as const
export type MentorRequestBlock = (typeof MENTOR_REQUEST_BLOCKS)[number]

/** Why the mentor cannot accept this pending request now; checked again on acceptance. */
export const MENTORSHIP_ACCEPT_BLOCKS = [
  'MENTOR_INELIGIBLE',
  'STUDENT_INELIGIBLE',
  'MENTOR_FULL',
  'STUDENT_LIMIT',
] as const
export type MentorshipAcceptBlock = (typeof MENTORSHIP_ACCEPT_BLOCKS)[number]

/** A mentor on the Mentorship Board or in search; never with contacts. */
export interface MentorSummaryView {
  mentor: ProfileView
  available: boolean
  capacity: number
  /** ACTIVE mentorships; pending requests reserve no place. */
  activeCount: number
  introduction: string | null
  topics: string[]
  /** The viewer's PENDING or ACTIVE mentorship with this mentor. */
  viewerMentorship: { id: string; state: 'PENDING' | 'ACTIVE' } | null
  /** Null when the viewer may request this mentor now. */
  requestBlock: MentorRequestBlock | null
}

export interface MentorProfileView extends MentorSummaryView {
  /** The viewer's ACTIVE mentor count when the viewer is a Student, otherwise null. */
  viewerActiveMentors: number | null
}

export interface MentorContactView {
  kind: ContactKind
  value: string
}

/** The mentor's own settings, with contacts. `configured` is false before the first save. */
export interface OwnMentorSettingsView {
  configured: boolean
  available: boolean
  capacity: number
  introduction: string | null
  topics: string[]
  contacts: MentorContactView[]
  activeCount: number
  pendingCount: number
}

export interface MentorshipView {
  id: string
  student: MemberCardView
  mentor: MemberCardView
  topic: string
  note: string
  state: MentorshipState
  requestedAt: string
  /** When the mentor accepted or declined. */
  decidedAt: string | null
  /** Last change, such as a withdrawal or ending. */
  updatedAt: string
  /** The viewer's side of this mentorship. */
  viewerSide: MentorshipSide
  /** The Student's ACTIVE mentor count, for the mentor's decision. */
  studentActiveMentors: number
  /** Set for the mentor on a PENDING request that cannot be accepted now. */
  acceptBlock: MentorshipAcceptBlock | null
}
