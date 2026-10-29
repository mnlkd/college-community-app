import { z } from 'zod'
import type { AccountState, AlumniStatus, Role } from './enums.js'

// analytics Input/View types (ODD Section 3.10, Tables 23 and 24). Counts only: no names,
// emails or content (FR-11).

export const ANALYTICS_WINDOWS = [7, 30] as const
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number]
export const ANALYTICS_WINDOW_DEFAULT: AnalyticsWindow = 30

/** The dashboard window in days: 7 or 30 (default 30). */
export const analyticsQuerySchema = z.object({
  windowDays: z.coerce
    .number()
    .refine((value): value is AnalyticsWindow => (ANALYTICS_WINDOWS as readonly number[]).includes(value), {
      message: 'Choose a 7-day or 30-day window',
    })
    .default(ANALYTICS_WINDOW_DEFAULT),
})
export type AnalyticsQuery = z.input<typeof analyticsQuerySchema>

/** Accounts by role, Alumni status and state. Role and status counts exclude deleted accounts. */
export interface AccountCountsView {
  byRole: Record<Role, number>
  byAlumniStatus: Record<AlumniStatus, number>
  byState: Record<AccountState, number>
  /** Community accounts that are not deleted. */
  communityAccounts: number
  administrators: number
}

/** Posts and comments created on one UTC day. */
export interface DailyActivityView {
  /** UTC calendar date, YYYY-MM-DD. */
  date: string
  posts: number
  comments: number
}

/** DashboardSummary of Table 23. */
export interface DashboardSummaryView {
  windowDays: AnalyticsWindow
  generatedAt: string
  /** First and last UTC day of the window (the last is today). */
  from: string
  to: string
  accountCounts: AccountCountsView
  /** Members who posted, commented or liked in the window. */
  activeMembers: number
  /** One entry per UTC day of the window, oldest first. */
  dailyActivity: DailyActivityView[]
  totalPosts: number
  totalComments: number
  pendingReports: number
  pendingAlumniReviews: number
  pendingGraduationRequests: number
  openOpportunities: number
  activeGroups: number
  activeMentorships: number
}

/** Pending queues shown in the Administrator navigation (FR-12). */
export interface QueueCountsView {
  pendingReports: number
  pendingAlumniReviews: number
  pendingGraduationRequests: number
}

/** Queue counts are polled as often as notices. */
export const QUEUE_COUNTS_POLL_MS = 30_000
