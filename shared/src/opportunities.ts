import { z } from 'zod'
import {
  opportunityTypeSchema,
  workArrangementSchema,
  type OpportunityState,
  type OpportunityType,
  type WorkArrangement,
} from './enums.js'
import type { MemberCardView } from './identity.js'
import { pageRequestSchema } from './pagination.js'
import { tagSchema } from './publishing.js'
import { calendarDateSchema, optionalText, queryFlag, requiredText } from './text.js'

// opportunities Input/View types (ODD Section 3.6, Tables 15 and 16).

export const OPPORTUNITY_TITLE_MAX = 160
export const OPPORTUNITY_ORGANIZATION_MAX = 160
export const OPPORTUNITY_LOCATION_MAX = 160
export const OPPORTUNITY_DESCRIPTION_MAX = 10000
export const OPPORTUNITY_APPLY_VIA_MAX = 500

/** An optional calendar date; a blank, missing or null value means "no deadline". */
const optionalDeadline = z
  .union([z.literal(''), calendarDateSchema])
  .nullish()
  .transform((value) => (value ? value : null))

/** OpportunityInput of Table 16 (create). */
export const opportunityInputSchema = z.object({
  title: requiredText(OPPORTUNITY_TITLE_MAX),
  organization: requiredText(OPPORTUNITY_ORGANIZATION_MAX),
  location: requiredText(OPPORTUNITY_LOCATION_MAX),
  type: opportunityTypeSchema,
  workArrangement: workArrangementSchema,
  description: requiredText(OPPORTUNITY_DESCRIPTION_MAX),
  applyVia: requiredText(OPPORTUNITY_APPLY_VIA_MAX),
  /** Shown on the listing; it never closes the listing. */
  deadline: optionalDeadline,
})
export type OpportunityInput = z.input<typeof opportunityInputSchema>
export type ParsedOpportunityInput = z.output<typeof opportunityInputSchema>

/** editOpportunity: the input with the version the author last read. */
export const opportunityEditInputSchema = opportunityInputSchema.extend({
  version: z.number().int().min(1),
})
export type OpportunityEditInput = z.input<typeof opportunityEditInputSchema>

/**
 * The Opportunities Board: open listings by keyword or #tag, type and arrangement. `mine` lists the
 * viewer's own listings in every state instead ("My listings").
 */
export const opportunityBoardQuerySchema = pageRequestSchema.extend({
  text: optionalText(200),
  tag: tagSchema.nullish().transform((value) => value ?? null),
  type: opportunityTypeSchema.nullish().transform((value) => value ?? null),
  workArrangement: workArrangementSchema.nullish().transform((value) => value ?? null),
  mine: queryFlag,
})
export type OpportunityBoardQuery = z.input<typeof opportunityBoardQuerySchema>
export type ParsedOpportunityBoardQuery = z.output<typeof opportunityBoardQuerySchema>

/** Everything of a listing beyond its title, type and status; withheld once it is closed. */
export interface OpportunityDetailsView {
  author: MemberCardView
  organization: string
  location: string
  workArrangement: WorkArrangement
  description: string
  applyVia: string
  /** Calendar date (YYYY-MM-DD) or null. */
  deadline: string | null
  version: number
  /** Aggregate only; never who saved. */
  saveCount: number
  createdAt: string
  updatedAt: string
}

/**
 * A listing. A CLOSED listing shows only its title, type and status to everyone, its author
 * included (`details` is null). A HIDDEN listing is shown only to its author.
 */
export interface OpportunityView {
  id: string
  title: string
  type: OpportunityType
  state: OpportunityState
  isOwn: boolean
  savedByMe: boolean
  details: OpportunityDetailsView | null
}

export type OpportunitySummaryView = OpportunityView
