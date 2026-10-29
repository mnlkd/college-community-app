import {
  TRENDING_DAYS,
  pageRequestSchema,
  saveTargetTypeSchema,
  searchQuerySchema,
  trendingQuerySchema,
  boardFromPath,
  type BoardItemView,
  type Page,
  type PostSummaryView,
  type SaveTargetType,
  type SavedItemView,
  type SearchResultView,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { GroupService } from '../groups/index.js'
import type { MentorshipService } from '../mentorship/index.js'
import {
  NotFoundError,
  PermissionDeniedError,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type Clock,
  type TransactionRunner,
  type Tx,
} from '../kernel/index.js'
import type { OpportunityService } from '../opportunities/index.js'
import type { PublishingService } from '../publishing/index.js'
import type { TrendingRanker } from './trending-ranker.js'

const DAY_MS = 24 * 60 * 60 * 1000

export interface BoardsServiceDeps {
  db: PrismaClient
  transactions: TransactionRunner
  clock: Clock
  publishing: PublishingService
  mentorship: MentorshipService
  opportunities: OpportunityService
  groups: GroupService
  ranker: TrendingRanker
}

/** Home feed, trending, global search and saved items (ODD Table 12). */
export class BoardsService {
  constructor(private readonly deps: BoardsServiceDeps) {}

  async listHomeFeed(actor: ActorContext, page: unknown): Promise<Page<PostSummaryView>> {
    return this.deps.publishing.listPosts(actor, page)
  }

  /** Visible posts of the last seven days ranked by TrendingRanker. */
  async listTrending(actor: ActorContext, query: unknown): Promise<PostSummaryView[]> {
    this.member(actor)
    const { limit } = parseInput(trendingQuerySchema, query)
    const now = this.deps.clock.now()
    const stats = await this.deps.publishing.listPostStats(new Date(now.getTime() - TRENDING_DAYS * DAY_MS))
    const ids = this.deps.ranker.rank(stats, now, limit)
    const described = await this.deps.publishing.describePosts(actor, ids)
    return ids.flatMap((id) => {
      const view = described.get(id)?.view
      return view && view.state === 'VISIBLE' ? [view] : []
    })
  }

  /** A Board through the search operation of its package; `board` is the path segment. */
  async listBoard(actor: ActorContext, board: string, query: unknown): Promise<Page<BoardItemView>> {
    this.member(actor)
    switch (boardFromPath(board)) {
      case 'OPPORTUNITIES':
        return this.deps.opportunities.searchOpportunities(actor, query)
      case 'ACTIVITIES':
        return this.deps.groups.searchGroups(actor, query)
      case 'MENTORSHIP':
        return this.deps.mentorship.searchMentors(actor, query)
      default:
        throw new NotFoundError('The board was not found.')
    }
  }

  /** Global search over posts, open listings, open groups and mentors (ACTIVITIES means groups). */
  async search(actor: ActorContext, query: unknown): Promise<SearchResultView> {
    this.member(actor)
    const parsed = parseInput(searchQuerySchema, query)
    const wants = (category: typeof parsed.category) =>
      parsed.category === null || parsed.category === category
    const filters = { text: parsed.text, tag: parsed.tag, page: parsed.page, pageSize: parsed.pageSize }
    const [posts, opportunities, groups, mentors] = await Promise.all([
      wants('POSTS') ? this.deps.publishing.searchPosts(actor, parsed) : null,
      wants('OPPORTUNITIES') ? this.deps.opportunities.searchOpportunities(actor, filters) : null,
      wants('ACTIVITIES') ? this.deps.groups.searchGroups(actor, filters) : null,
      wants('MENTORS') ? this.deps.mentorship.searchMentors(actor, filters) : null,
    ])
    return { posts, opportunities, groups, mentors }
  }

  /** Saves a VISIBLE post, an OPEN listing or an OPEN group; requires canInteract. Idempotent. */
  async save(actor: ActorContext, targetType: unknown, targetId: string): Promise<void> {
    this.member(actor)
    const type = parseInput(saveTargetTypeSchema, targetType)
    if (!actor.canInteract()) throw new PermissionDeniedError('Your account cannot save items.')
    await this.deps.transactions.run(async (tx) => {
      await this.assertSaveable(tx, actor, type, targetId)
      await tx.savedItem.createMany({
        data: [{ memberId: actor.accountId, targetType: type, targetId, createdAt: this.deps.clock.now() }],
        skipDuplicates: true,
      })
    })
  }

  /** Removes a save; allowed for every member. Idempotent. */
  async unsave(actor: ActorContext, targetType: unknown, targetId: string): Promise<void> {
    const memberId = this.member(actor)
    const type = parseInput(saveTargetTypeSchema, targetType)
    await this.deps.db.savedItem.deleteMany({ where: { memberId, targetType: type, targetId } })
  }

  /** The actor's saves newest first, each with its item's current state. */
  async listSaved(actor: ActorContext, page: unknown): Promise<Page<SavedItemView>> {
    const memberId = this.member(actor)
    const request = parseInput(pageRequestSchema, page)
    const where = { memberId }
    const [rows, total] = await Promise.all([
      this.deps.db.savedItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(request),
      }),
      this.deps.db.savedItem.count({ where }),
    ])
    const idsOf = (type: SaveTargetType) =>
      rows.filter((row) => row.targetType === type).map((row) => row.targetId)
    const [posts, opportunities, groups] = await Promise.all([
      this.deps.publishing.describePosts(actor, idsOf('POST')),
      this.deps.opportunities.describeOpportunities(actor, idsOf('OPPORTUNITY')),
      this.deps.groups.describeGroups(actor, idsOf('GROUP')),
    ])
    const items = rows.flatMap((row): SavedItemView[] => {
      const base = {
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        savedAt: row.createdAt.toISOString(),
        post: null,
        opportunity: null,
        group: null,
      }
      if (row.targetType === 'POST') {
        const described = posts.get(row.targetId)
        return described ? [{ ...base, state: described.state, post: described.view }] : []
      }
      if (row.targetType === 'OPPORTUNITY') {
        const described = opportunities.get(row.targetId)
        return described ? [{ ...base, state: described.state, opportunity: described.view }] : []
      }
      const described = groups.get(row.targetId)
      return described ? [{ ...base, state: described.state, group: described.view }] : []
    })
    return toPage(items, request, total)
  }

  private member(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  private assertSaveable(tx: Tx, actor: ActorContext, type: SaveTargetType, targetId: string): Promise<void> {
    switch (type) {
      case 'POST':
        return this.deps.publishing.assertPostSaveable(tx, actor, targetId)
      case 'OPPORTUNITY':
        return this.deps.opportunities.assertOpportunitySaveable(tx, actor, targetId)
      case 'GROUP':
        return this.deps.groups.assertGroupSaveable(tx, actor, targetId)
    }
  }
}
