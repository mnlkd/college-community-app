import {
  opportunityBoardQuerySchema,
  opportunityEditInputSchema,
  opportunityInputSchema,
  type OpportunityState,
  type OpportunitySummaryView,
  type OpportunityType,
  type OpportunityView,
  type Page,
  type ParsedOpportunityBoardQuery,
  type WorkArrangement,
} from '@hilcoe/shared'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { deletedCard, isMentorEligible, type AccessPolicy, type AccountViews } from '../identity/index.js'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type Clock,
  type ContentSnapshot,
  type TransactionRunner,
  type Tx,
} from '../kernel/index.js'

/**
 * Save facts shown on a listing without reading the boards tables. Implemented by boards (which
 * depends on opportunities) and given at start-up, avoiding a package cycle.
 */
export interface OpportunitySaveStats {
  opportunitySaves(
    memberId: string,
    opportunityIds: readonly string[],
  ): Promise<Map<string, { count: number; savedByMe: boolean }>>
}

export interface OpportunityServiceDeps {
  db: PrismaClient
  transactions: TransactionRunner
  clock: Clock
  access: AccessPolicy
  views: AccountViews
  saves: OpportunitySaveStats
}

/** A listing as the member may know it: its state, and its view unless it is hidden from them. */
export interface OpportunityDescription {
  state: OpportunityState
  view: OpportunityView | null
}

interface OpportunityRecord {
  id: string
  authorId: string
  title: string
  organization: string
  location: string
  type: OpportunityType
  workArrangement: WorkArrangement
  description: string
  applyVia: string
  deadline: Date | null
  state: OpportunityState
  version: number
  createdAt: Date
  updatedAt: Date
}

interface LockedRow {
  id: string
  author_id: string
  state: OpportunityState
  version: number
}

const NOT_FOUND = 'The opportunity was not found.'
const AUTHOR_ONLY = 'Only Staff members and Verified Alumni can post opportunities.'

function toDate(deadline: string | null): Date | null {
  return deadline === null ? null : new Date(`${deadline}T00:00:00.000Z`)
}

/**
 * Opportunity listings (ODD Table 16, FR-6). Applications happen outside the platform.
 *
 * Locks: the author's account (NO KEY UPDATE for create and edit, KEY SHARE for close), then the
 * listing row. OpportunityLifecycleHandler holds the account FOR UPDATE, so it and a change never
 * overlap.
 */
export class OpportunityService {
  constructor(private readonly deps: OpportunityServiceDeps) {}

  /** Manage Opportunity Listing: an active Staff member or Verified Alumni without a restriction. */
  async createOpportunity(actor: ActorContext, input: unknown): Promise<OpportunityView> {
    const authorId = this.member(actor)
    const listing = parseInput(opportunityInputSchema, input)
    const id = await this.deps.transactions.run(async (tx) => {
      await this.lockAuthor(tx, actor)
      const now = this.deps.clock.now()
      const created = await tx.opportunity.create({
        data: {
          authorId,
          title: listing.title,
          organization: listing.organization,
          location: listing.location,
          type: listing.type,
          workArrangement: listing.workArrangement,
          description: listing.description,
          applyVia: listing.applyVia,
          deadline: toDate(listing.deadline),
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })
      return created.id
    })
    return this.getOpportunity(actor, id)
  }

  /** The author edits an OPEN listing, giving the version last read. */
  async editOpportunity(
    actor: ActorContext,
    opportunityId: string,
    input: unknown,
  ): Promise<OpportunityView> {
    const authorId = this.member(actor)
    const listing = parseInput(opportunityEditInputSchema, input)
    await this.deps.transactions.run(async (tx) => {
      await this.lockAuthor(tx, actor)
      const row = await this.lockOwn(tx, authorId, opportunityId)
      if (row.state !== 'OPEN') throw new ConflictError('Only an open listing can be edited.')
      if (row.version !== listing.version) throw new ConflictError()
      await tx.opportunity.update({
        where: { id: opportunityId },
        data: {
          title: listing.title,
          organization: listing.organization,
          location: listing.location,
          type: listing.type,
          workArrangement: listing.workArrangement,
          description: listing.description,
          applyVia: listing.applyVia,
          deadline: toDate(listing.deadline),
          version: { increment: 1 },
          updatedAt: this.deps.clock.now(),
        },
      })
    })
    return this.getOpportunity(actor, opportunityId)
  }

  /** The author closes an OPEN listing, also during a restriction. Closure is final. */
  async closeOpportunity(actor: ActorContext, opportunityId: string): Promise<void> {
    const authorId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      await this.deps.access.lockMember(tx, authorId, 'KEY SHARE')
      const row = await this.lockOwn(tx, authorId, opportunityId)
      if (row.state !== 'OPEN') throw new ConflictError('This listing is not open.')
      await tx.opportunity.update({
        where: { id: opportunityId },
        data: { state: 'CLOSED', version: { increment: 1 }, updatedAt: this.deps.clock.now() },
      })
    })
  }

  /** The listing; a CLOSED one shows only title, type and status; a HIDDEN one only to its author. */
  async getOpportunity(actor: ActorContext, opportunityId: string): Promise<OpportunityView> {
    const memberId = this.member(actor)
    const row = await this.deps.db.opportunity.findUnique({ where: { id: opportunityId } })
    if (!row || (row.state === 'HIDDEN' && row.authorId !== memberId)) throw new NotFoundError(NOT_FOUND)
    const [view] = await this.toViews(memberId, [row])
    if (!view) throw new NotFoundError(NOT_FOUND)
    return view
  }

  /**
   * The Opportunities Board and search: OPEN listings matching text, #tag, type and arrangement,
   * by relevance then newest. With `mine`, the actor's own listings in every state, open first.
   */
  async searchOpportunities(actor: ActorContext, query: unknown): Promise<Page<OpportunitySummaryView>> {
    const memberId = this.member(actor)
    const parsed = parseInput(opportunityBoardQuerySchema, query)
    const { ids, total } = await this.matching(memberId, parsed)
    const rows = await this.deps.db.opportunity.findMany({ where: { id: { in: ids } } })
    const byId = new Map(rows.map((row) => [row.id, row]))
    const ordered = ids.flatMap((id) => {
      const row = byId.get(id)
      return row ? [row] : []
    })
    return toPage(await this.toViews(memberId, ordered), parsed, total)
  }

  /** Listings by id with their state, for saved items; a hidden listing has no view for others. */
  async describeOpportunities(
    actor: ActorContext,
    opportunityIds: readonly string[],
  ): Promise<Map<string, OpportunityDescription>> {
    const memberId = this.member(actor)
    if (opportunityIds.length === 0) return new Map()
    const rows = await this.deps.db.opportunity.findMany({ where: { id: { in: [...opportunityIds] } } })
    const visible = rows.filter((row) => row.state !== 'HIDDEN' || row.authorId === memberId)
    const views = new Map((await this.toViews(memberId, visible)).map((view) => [view.id, view]))
    return new Map(rows.map((row) => [row.id, { state: row.state, view: views.get(row.id) ?? null }]))
  }

  /** Called by BoardsService.save: only an OPEN listing the member can see may be saved. */
  async assertOpportunitySaveable(tx: Tx, actor: ActorContext, opportunityId: string): Promise<void> {
    await this.deps.access.assertCanInteract(tx, actor)
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT id, author_id, state, version FROM opportunity WHERE id = ${opportunityId}::uuid FOR SHARE`
    const row = rows[0]
    if (!row || (row.state === 'HIDDEN' && row.author_id !== actor.accountId)) {
      throw new NotFoundError(NOT_FOUND)
    }
    if (row.state !== 'OPEN') throw new ConflictError('This listing is closed and cannot be saved.')
  }

  /** Called by ModerationService: the author of each listing, read without locks. */
  async listingAuthors(tx: Tx, opportunityIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(opportunityIds)]
    if (ids.length === 0) return new Map()
    const rows = await tx.opportunity.findMany({
      where: { id: { in: ids } },
      select: { id: true, authorId: true },
    })
    return new Map(rows.map((row) => [row.id, row.authorId]))
  }

  /**
   * Called by ModerationService when a member reports a listing: copies it as evidence. An open
   * or closed listing may be reported; one hidden from the member is not found.
   */
  async captureSnapshot(tx: Tx, opportunityId: string, viewerId: string): Promise<ContentSnapshot> {
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT id, author_id, state, version FROM opportunity WHERE id = ${opportunityId}::uuid FOR SHARE`
    const locked = rows[0]
    if (!locked || (locked.state === 'HIDDEN' && locked.author_id !== viewerId)) {
      throw new NotFoundError(NOT_FOUND)
    }
    const row = await tx.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })
    const text = [
      row.title,
      `${row.organization} · ${row.location}`,
      `${row.type} · ${row.workArrangement}`,
      row.deadline ? `Deadline: ${row.deadline.toISOString().slice(0, 10)}` : null,
      `Apply via: ${row.applyVia}`,
      '',
      row.description,
    ]
      .filter((line) => line !== null)
      .join('\n')
    return { authorId: locked.author_id, version: locked.version, text, imageIds: [], postId: null }
  }

  /** Called by ModerationService when a report is upheld: an open or closed listing becomes HIDDEN. */
  async hideContent(tx: Tx, opportunityId: string): Promise<void> {
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT id, author_id, state, version FROM opportunity WHERE id = ${opportunityId}::uuid FOR UPDATE`
    const row = rows[0]
    if (!row) throw new NotFoundError(NOT_FOUND)
    if (row.state === 'HIDDEN') return
    await tx.opportunity.update({
      where: { id: opportunityId },
      data: { state: 'HIDDEN', version: { increment: 1 }, updatedAt: this.deps.clock.now() },
    })
  }

  private member(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  /** Rechecks on the locked account that the actor may publish listings now. */
  private async lockAuthor(tx: Tx, actor: ActorContext): Promise<void> {
    const author = await this.deps.access.lockMember(tx, actor.accountId, 'NO KEY UPDATE')
    if (!isMentorEligible(author)) throw new PermissionDeniedError(AUTHOR_ONLY)
    await this.deps.access.assertNotRestricted(tx, actor.accountId)
  }

  /** The actor's own listing, locked; anyone else's is refused, or not found when hidden from them. */
  private async lockOwn(tx: Tx, authorId: string, opportunityId: string): Promise<LockedRow> {
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT id, author_id, state, version FROM opportunity WHERE id = ${opportunityId}::uuid FOR UPDATE`
    const row = rows[0]
    if (!row || (row.state === 'HIDDEN' && row.author_id !== authorId)) throw new NotFoundError(NOT_FOUND)
    if (row.author_id !== authorId)
      throw new PermissionDeniedError('Only the author can change this listing.')
    return row
  }

  /** A #tag is searched as a word of the listing; listings have no tag table. */
  private async matching(
    memberId: string,
    query: ParsedOpportunityBoardQuery,
  ): Promise<{ ids: string[]; total: number }> {
    const { text, tag, type, workArrangement, mine } = query
    const { skip, take } = pageWindow(query)
    const where = Prisma.sql`
      WHERE (CASE WHEN ${mine}::boolean THEN o.author_id = ${memberId}::uuid ELSE o.state = 'OPEN' END)
        AND (${type}::text IS NULL OR o.type::text = ${type}::text)
        AND (${workArrangement}::text IS NULL OR o.work_arrangement::text = ${workArrangement}::text)
        AND (${text}::text IS NULL OR o.search_vector @@ websearch_to_tsquery('simple', ${text}::text))
        AND (${tag}::text IS NULL OR o.search_vector @@ plainto_tsquery('simple', ${tag}::text))`
    const [rows, counts] = await Promise.all([
      this.deps.db.$queryRaw<{ id: string }[]>`
        SELECT o.id FROM opportunity o ${where}
        ORDER BY
          CASE WHEN ${mine}::boolean THEN (o.state = 'OPEN')::int ELSE 0 END DESC,
          CASE WHEN ${text}::text IS NULL THEN 0
               ELSE ts_rank(o.search_vector, websearch_to_tsquery('simple', ${text}::text)) END DESC,
          o.created_at DESC, o.id DESC
        LIMIT ${take} OFFSET ${skip}`,
      this.deps.db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM opportunity o ${where}`,
    ])
    return { ids: rows.map((row) => row.id), total: counts[0]?.total ?? 0 }
  }

  private async toViews(memberId: string, rows: OpportunityRecord[]): Promise<OpportunityView[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const [cards, saves] = await Promise.all([
      this.deps.views.memberCards(rows.filter((row) => row.state !== 'CLOSED').map((row) => row.authorId)),
      this.deps.saves.opportunitySaves(memberId, ids),
    ])
    return rows.map((row) => {
      const save = saves.get(row.id)
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        state: row.state,
        isOwn: row.authorId === memberId,
        savedByMe: save?.savedByMe ?? false,
        details:
          row.state === 'CLOSED'
            ? null
            : {
                author: cards.get(row.authorId) ?? deletedCard(),
                organization: row.organization,
                location: row.location,
                workArrangement: row.workArrangement,
                description: row.description,
                applyVia: row.applyVia,
                deadline: row.deadline ? row.deadline.toISOString().slice(0, 10) : null,
                version: row.version,
                saveCount: save?.count ?? 0,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
              },
      }
    })
  }
}
