import { z } from 'zod'
import {
  searchCategorySchema,
  type GroupState,
  type OpportunityState,
  type PostState,
  type SaveTargetType,
} from './enums.js'
import type { GroupSummaryView } from './groups.js'
import { pageRequestSchema, type Page } from './pagination.js'
import type { MentorSummaryView } from './mentorship.js'
import type { OpportunitySummaryView } from './opportunities.js'
import { tagSchema, type PostSummaryView } from './publishing.js'
import { optionalText } from './text.js'

// boards Input/View types (ODD Section 3.4, Tables 11 and 12).

export const SEARCH_TEXT_MAX = 200
export const TRENDING_DAYS = 7
export const TRENDING_LIMIT_DEFAULT = 5
export const TRENDING_LIMIT_MAX = 20

/** SearchQuery of Table 11. Board filters arrive with the Boards in later batches. */
export const searchQuerySchema = pageRequestSchema
  .extend({
    text: optionalText(SEARCH_TEXT_MAX),
    tag: tagSchema.nullish().transform((value) => value ?? null),
    category: searchCategorySchema.nullish().transform((value) => value ?? null),
  })
  .refine((query) => query.text !== null || query.tag !== null, {
    message: 'Enter a search term or choose a tag',
    path: ['text'],
  })
export type SearchQuery = z.input<typeof searchQuerySchema>
export type ParsedSearchQuery = z.output<typeof searchQuerySchema>

export const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(TRENDING_LIMIT_MAX).default(TRENDING_LIMIT_DEFAULT),
})

/** Global search results by category; a category is null when it was not searched. */
export interface SearchResultView {
  posts: Page<PostSummaryView> | null
  /** Open listings only. */
  opportunities: Page<OpportunitySummaryView> | null
  /** Open groups only (the ACTIVITIES category). */
  groups: Page<GroupSummaryView> | null
  mentors: Page<MentorSummaryView> | null
}

/** Boards served by listBoard. */
export const BOARDS = ['OPPORTUNITIES', 'ACTIVITIES', 'MENTORSHIP'] as const
export type Board = (typeof BOARDS)[number]

/** Lower-case path segment of each Board (/api/boards/:board). */
export const BOARD_PATHS: Record<Board, string> = {
  OPPORTUNITIES: 'opportunities',
  ACTIVITIES: 'activities',
  MENTORSHIP: 'mentorship',
}

export function boardFromPath(segment: string): Board | null {
  const entry = Object.entries(BOARD_PATHS).find(([, path]) => path === segment)
  return entry ? (entry[0] as Board) : null
}

/** An item of a Board. */
export type BoardItemView = OpportunitySummaryView | GroupSummaryView | MentorSummaryView

/** Lower-case plural path segment of each save target type (/api/saved-items/:type/:id). */
export const SAVE_TARGET_PATHS: Record<SaveTargetType, string> = {
  POST: 'posts',
  OPPORTUNITY: 'opportunities',
  GROUP: 'groups',
}

export function saveTargetFromPath(segment: string): SaveTargetType | null {
  const entry = Object.entries(SAVE_TARGET_PATHS).find(([, path]) => path === segment)
  return entry ? (entry[0] as SaveTargetType) : null
}

/**
 * A private save with its item's current state. Exactly the field of its target type is set, and it
 * is null when the item can no longer be shown, such as a post or listing hidden by moderation.
 */
export interface SavedItemView {
  id: string
  targetType: SaveTargetType
  targetId: string
  savedAt: string
  state: PostState | OpportunityState | GroupState
  post: PostSummaryView | null
  /** A closed listing shows only its title, type and status. */
  opportunity: OpportunitySummaryView | null
  group: GroupSummaryView | null
}
