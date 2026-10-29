import {
  ACCOUNT_STATES,
  ALUMNI_STATUSES,
  ROLES,
  analyticsQuerySchema,
  type AccountCountsView,
  type AnalyticsWindow,
  type DailyActivityView,
  type DashboardSummaryView,
  type QueueCountsView,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import { PermissionDeniedError, parseInput, type ActorContext, type Clock } from '../kernel/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

export interface AnalyticsServiceDeps {
  db: PrismaClient
  clock: Clock
}

/** An aggregate CSV file (exportCsv of Table 24). */
export interface CsvFile {
  fileName: string
  content: string
}

type CountRow = { count: bigint }
type GroupRow = { key: string | null; count: bigint }
type DayRow = { day: Date; count: bigint }

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>
}

function tally<K extends string>(keys: readonly K[], rows: GroupRow[]): Record<K, number> {
  const counts = zeroCounts(keys)
  for (const row of rows) {
    if (row.key !== null && (keys as readonly string[]).includes(row.key))
      counts[row.key as K] = Number(row.count)
  }
  return counts
}

/**
 * Analytics and Reporting (FR-11) and the Administrator queue counts (FR-12). Reads the tables
 * of the other packages with aggregate queries only, so results hold counts and never names,
 * emails or content (ODD Section 3.10).
 */
export class AnalyticsService {
  constructor(private readonly deps: AnalyticsServiceDeps) {}

  /** The dashboard for the last 7 or 30 UTC days, today included. */
  async getDashboard(actor: ActorContext, query: unknown): Promise<DashboardSummaryView> {
    this.requireAdministrator(actor)
    const { windowDays } = parseInput(analyticsQuerySchema, query)
    return this.summarize(windowDays)
  }

  /** The same counts as getDashboard, as an aggregate-only CSV file. */
  async exportCsv(actor: ActorContext, query: unknown): Promise<CsvFile> {
    this.requireAdministrator(actor)
    const { windowDays } = parseInput(analyticsQuerySchema, query)
    const summary = await this.summarize(windowDays)
    return {
      fileName: `hilcoe-commons-aggregates-${windowDays}d-${summary.to}.csv`,
      content: toCsv(summary),
    }
  }

  /** Pending reports, Alumni reviews and graduation requests for the Administrator navigation. */
  async getQueueCounts(actor: ActorContext): Promise<QueueCountsView> {
    this.requireAdministrator(actor)
    return this.queueCounts()
  }

  private async summarize(windowDays: AnalyticsWindow): Promise<DashboardSummaryView> {
    const db = this.deps.db
    const now = this.deps.clock.now()
    const today = new Date(`${utcDay(now)}T00:00:00.000Z`)
    const since = new Date(today.getTime() - (windowDays - 1) * DAY_MS)

    const [accountCounts, activeRows, postRows, commentRows, queues, boardRows] = await Promise.all([
      this.accountCounts(),
      db.$queryRaw<CountRow[]>`
        SELECT count(DISTINCT member_id) AS count FROM (
          SELECT author_id AS member_id FROM post WHERE created_at >= ${since}
          UNION SELECT author_id FROM comment WHERE created_at >= ${since}
          UNION SELECT member_id FROM "like" WHERE active AND updated_at >= ${since}
        ) AS actions`,
      db.$queryRaw<DayRow[]>`
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS count
        FROM post WHERE created_at >= ${since} GROUP BY 1`,
      db.$queryRaw<DayRow[]>`
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS count
        FROM comment WHERE created_at >= ${since} GROUP BY 1`,
      this.queueCounts(),
      db.$queryRaw<{ opportunities: bigint; groups: bigint; mentorships: bigint }[]>`
        SELECT
          (SELECT count(*) FROM opportunity WHERE state = 'OPEN') AS opportunities,
          (SELECT count(*) FROM "group" WHERE state = 'OPEN') AS groups,
          (SELECT count(*) FROM mentorship WHERE state = 'ACTIVE') AS mentorships`,
    ])

    const posts = new Map(postRows.map((row) => [utcDay(row.day), Number(row.count)]))
    const comments = new Map(commentRows.map((row) => [utcDay(row.day), Number(row.count)]))
    const dailyActivity: DailyActivityView[] = []
    for (let offset = 0; offset < windowDays; offset += 1) {
      const date = utcDay(new Date(since.getTime() + offset * DAY_MS))
      dailyActivity.push({ date, posts: posts.get(date) ?? 0, comments: comments.get(date) ?? 0 })
    }
    const boards = boardRows[0]
    return {
      windowDays,
      generatedAt: now.toISOString(),
      from: utcDay(since),
      to: utcDay(today),
      accountCounts,
      activeMembers: Number(activeRows[0]?.count ?? 0),
      dailyActivity,
      totalPosts: dailyActivity.reduce((sum, day) => sum + day.posts, 0),
      totalComments: dailyActivity.reduce((sum, day) => sum + day.comments, 0),
      ...queues,
      openOpportunities: Number(boards?.opportunities ?? 0),
      activeGroups: Number(boards?.groups ?? 0),
      activeMentorships: Number(boards?.mentorships ?? 0),
    }
  }

  private async queueCounts(): Promise<QueueCountsView> {
    const [row] = await this.deps.db.$queryRaw<{ reports: bigint; reviews: bigint; graduations: bigint }[]>`
      SELECT
        (SELECT count(*) FROM report WHERE state = 'PENDING') AS reports,
        (SELECT count(*) FROM alumni_review WHERE decision = 'PENDING') AS reviews,
        (SELECT count(*) FROM graduation_request WHERE decision = 'PENDING') AS graduations`
    return {
      pendingReports: Number(row?.reports ?? 0),
      pendingAlumniReviews: Number(row?.reviews ?? 0),
      pendingGraduationRequests: Number(row?.graduations ?? 0),
    }
  }

  private async accountCounts(): Promise<AccountCountsView> {
    const db = this.deps.db
    const [roles, statuses, states, admins] = await Promise.all([
      db.$queryRaw<GroupRow[]>`
        SELECT role::text AS key, count(*) AS count FROM member_account
        WHERE state <> 'DELETED' GROUP BY role`,
      db.$queryRaw<GroupRow[]>`
        SELECT alumni_status::text AS key, count(*) AS count FROM member_account
        WHERE state <> 'DELETED' AND alumni_status IS NOT NULL GROUP BY alumni_status`,
      db.$queryRaw<
        GroupRow[]
      >`SELECT state::text AS key, count(*) AS count FROM member_account GROUP BY state`,
      db.$queryRaw<CountRow[]>`SELECT count(*) AS count FROM administrator_account`,
    ])
    const byState = tally(ACCOUNT_STATES, states)
    return {
      byRole: tally(ROLES, roles),
      byAlumniStatus: tally(ALUMNI_STATUSES, statuses),
      byState,
      communityAccounts: byState.ACTIVE + byState.DISABLED,
      administrators: Number(admins[0]?.count ?? 0),
    }
  }

  private requireAdministrator(actor: ActorContext): void {
    if (!actor.isAdministrator) throw new PermissionDeniedError('This is for Administrators.')
  }
}

/**
 * One row per metric: `metric,window_days,utc_date,count`. Daily rows carry their UTC date;
 * window totals and current counts leave it blank. Metric names are fixed identifiers, so no
 * value needs quoting, and no row holds a name, email or content.
 */
export function toCsv(summary: DashboardSummaryView): string {
  const rows: string[] = []
  const add = (metric: string, count: number, date = '') =>
    rows.push(`${metric},${summary.windowDays},${date},${count}`)
  const accounts = summary.accountCounts
  add('community_accounts', accounts.communityAccounts)
  add('administrators', accounts.administrators)
  for (const role of ROLES) add(`accounts_role_${role.toLowerCase()}`, accounts.byRole[role])
  for (const status of ALUMNI_STATUSES) {
    add(`accounts_alumni_${status.toLowerCase()}`, accounts.byAlumniStatus[status])
  }
  for (const state of ACCOUNT_STATES) add(`accounts_state_${state.toLowerCase()}`, accounts.byState[state])
  add('active_members', summary.activeMembers)
  add('posts', summary.totalPosts)
  add('comments', summary.totalComments)
  add('pending_reports', summary.pendingReports)
  add('pending_alumni_reviews', summary.pendingAlumniReviews)
  add('pending_graduation_requests', summary.pendingGraduationRequests)
  add('open_opportunities', summary.openOpportunities)
  add('active_groups', summary.activeGroups)
  add('active_mentorships', summary.activeMentorships)
  for (const day of summary.dailyActivity) {
    add('daily_posts', day.posts, day.date)
    add('daily_comments', day.comments, day.date)
  }
  return ['metric,window_days,utc_date,count', ...rows].join('\r\n') + '\r\n'
}
