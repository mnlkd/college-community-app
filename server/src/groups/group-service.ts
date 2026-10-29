import {
  groupBoardQuerySchema,
  groupEditInputSchema,
  groupInputSchema,
  groupTransferInputSchema,
  joinRequestsQuerySchema,
  myGroupsQuerySchema,
  type GroupApproveBlock,
  type GroupJoinBlock,
  type GroupMemberView,
  type GroupRelation,
  type GroupState,
  type GroupSummaryView,
  type GroupTransferView,
  type GroupView,
  type MembershipState,
  type MembershipView,
  type Page,
  type TransferState,
} from '@hilcoe/shared'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { deletedCard, type AccessPolicy, type AccountViews, type MemberSummary } from '../identity/index.js'
import {
  CapacityExceededError,
  ConflictError,
  DuplicateError,
  NotFoundError,
  PermissionDeniedError,
  isUniqueViolation,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type Clock,
  type TransactionRunner,
  type Tx,
} from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import { closeLockedGroup } from './group-closure.js'

/**
 * Save facts shown on a group without reading the boards tables. Implemented by boards (which
 * depends on groups) and given at start-up, avoiding a package cycle.
 */
export interface GroupSaveStats {
  groupSaves(
    memberId: string,
    groupIds: readonly string[],
  ): Promise<Map<string, { count: number; savedByMe: boolean }>>
}

export interface GroupServiceDeps {
  db: PrismaClient
  transactions: TransactionRunner
  clock: Clock
  access: AccessPolicy
  notifications: NotificationService
  views: AccountViews
  saves: GroupSaveStats
}

/** A group as the member may know it, for saved items. */
export interface GroupDescription {
  state: GroupState
  view: GroupSummaryView | null
}

interface GroupRecord {
  id: string
  ownerId: string
  title: string
  description: string
  maxOccupancy: number
  coordinationDetails: string | null
  state: GroupState
  version: number
  createdAt: Date
  updatedAt: Date
}

interface LockedGroup {
  id: string
  ownerId: string
  title: string
  state: GroupState
  maxOccupancy: number
  version: number
}

interface MembershipRecord {
  id: string
  groupId: string
  memberId: string
  state: MembershipState
  joinedAt: Date | null
  createdAt: Date
}

interface TransferRecord {
  id: string
  groupId: string
  fromOwnerId: string
  toMemberId: string
  state: TransferState
  createdAt: Date
  decidedAt: Date | null
}

const NOT_FOUND = 'The group was not found.'
const REQUEST_NOT_FOUND = 'The join request was not found.'
const TRANSFER_NOT_FOUND = 'The transfer was not found.'
const STUDENT_ONLY = 'Only Students can own and join groups.'
const OWNER_ONLY = 'Only the group owner can do this.'
const CHANGED = 'The group has changed. Reload and try again.'

function isActiveStudent(member: Pick<MemberSummary, 'state' | 'role'>): boolean {
  return member.state === 'ACTIVE' && member.role === 'STUDENT'
}

/**
 * Student groups and activities on the Activities Board (ODD Table 18, FR-7). Occupancy is the
 * number of ACCEPTED memberships and includes the owner.
 *
 * Every change takes its locks in one order, also used by GroupLifecycleHandler: member accounts
 * (KEY SHARE, which a graduation or deletion holding the account FOR UPDATE waits for), then the
 * group row, then membership and transfer rows. A group is locked through lockGroup, which locks
 * the owner's account first and checks that the owner did not change meanwhile.
 */
export class GroupService {
  constructor(private readonly deps: GroupServiceDeps) {}

  /** Create or Close Group: a Student without a restriction creates a group and is its first member. */
  async createGroup(actor: ActorContext, input: unknown): Promise<GroupView> {
    const ownerId = this.member(actor)
    const group = parseInput(groupInputSchema, input)
    const id = await this.deps.transactions.run(async (tx) => {
      await this.lockPublisher(tx, actor)
      const now = this.deps.clock.now()
      const created = await tx.group.create({
        data: {
          ownerId,
          title: group.title,
          description: group.description,
          maxOccupancy: group.maxOccupancy,
          coordinationDetails: group.coordinationDetails,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })
      await tx.groupMembership.create({
        data: {
          groupId: created.id,
          memberId: ownerId,
          state: 'ACCEPTED',
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      })
      return created.id
    })
    return this.getGroup(actor, id)
  }

  /** The owner edits an OPEN group; the maximum cannot fall below the current occupancy. */
  async editGroup(actor: ActorContext, groupId: string, input: unknown): Promise<GroupView> {
    const memberId = this.member(actor)
    const group = parseInput(groupEditInputSchema, input)
    await this.deps.transactions.run(async (tx) => {
      await this.lockPublisher(tx, actor)
      const { row } = await this.lockGroup(tx, groupId, 'UPDATE')
      if (row.ownerId !== memberId) throw new PermissionDeniedError(OWNER_ONLY)
      if (row.state !== 'OPEN') throw new ConflictError('A closed group cannot be edited.')
      if (row.version !== group.version) throw new ConflictError()
      const occupancy = await this.countAccepted(tx, groupId)
      if (group.maxOccupancy < occupancy) {
        throw new CapacityExceededError(
          `The maximum cannot be lower than the ${occupancy} current ${occupancy === 1 ? 'member' : 'members'}.`,
        )
      }
      await tx.group.update({
        where: { id: groupId },
        data: {
          title: group.title,
          description: group.description,
          maxOccupancy: group.maxOccupancy,
          coordinationDetails: group.coordinationDetails,
          version: { increment: 1 },
          updatedAt: this.deps.clock.now(),
        },
      })
    })
    return this.getGroup(actor, groupId)
  }

  /** The owner closes an OPEN group, also during a restriction. Closure is final. */
  async closeGroup(actor: ActorContext, groupId: string): Promise<void> {
    const memberId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      const { row } = await this.lockGroup(tx, groupId, 'UPDATE')
      if (row.ownerId !== memberId) throw new PermissionDeniedError(OWNER_ONLY)
      if (row.state !== 'OPEN') throw new ConflictError('This group is already closed.')
      await closeLockedGroup(tx, this.deps, row, memberId, this.deps.clock.now(), {
        clearCoordination: false,
      })
    })
  }

  /** The group; coordination details, members and a pending transfer only to those involved. */
  async getGroup(actor: ActorContext, groupId: string): Promise<GroupView> {
    this.member(actor)
    const row = await this.deps.db.group.findUnique({ where: { id: groupId } })
    if (!row) throw new NotFoundError(NOT_FOUND)
    const [summary] = await this.summaries(actor, [row])
    if (!summary) throw new NotFoundError(NOT_FOUND)
    return this.detail(actor, row, summary)
  }

  /** Manage Group Membership: a Student asks to join an OPEN group with a free place. */
  async requestJoin(actor: ActorContext, groupId: string): Promise<MembershipView> {
    const memberId = this.member(actor)
    if (actor.role !== 'STUDENT') throw new PermissionDeniedError(STUDENT_ONLY)
    let id: string
    try {
      id = await this.deps.transactions.run(async (tx) => {
        const { row, members } = await this.lockGroup(tx, groupId, 'SHARE', [memberId])
        const requester = members.get(memberId)
        if (!requester || !isActiveStudent(requester)) throw new PermissionDeniedError(STUDENT_ONLY)
        const open = await tx.groupMembership.findFirst({
          where: { groupId, memberId, state: { in: ['PENDING', 'ACCEPTED'] } },
          select: { state: true },
        })
        if (open) {
          throw new DuplicateError(
            open.state === 'ACCEPTED'
              ? 'You are already a member of this group.'
              : 'You already asked to join this group.',
          )
        }
        if (row.state !== 'OPEN') throw new ConflictError('This group is closed.')
        if ((await this.countAccepted(tx, groupId)) >= row.maxOccupancy) {
          throw new CapacityExceededError('This group is full.')
        }
        const now = this.deps.clock.now()
        const created = await tx.groupMembership.create({
          data: { groupId, memberId, state: 'PENDING', createdAt: now, updatedAt: now },
          select: { id: true },
        })
        await this.deps.notifications.notify(tx, {
          recipientId: row.ownerId,
          type: 'GROUP_REQUEST',
          eventKey: `group-membership:${created.id}:requested`,
          actorId: memberId,
          targetType: 'GROUP',
          targetId: groupId,
        })
        return created.id
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateError('You already asked to join this group.')
      throw error
    }
    return this.getMembership(actor, id)
  }

  /** The requester withdraws a pending request; the request is deleted. */
  async withdrawJoin(actor: ActorContext, groupId: string): Promise<void> {
    const memberId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      await this.deps.access.lockMember(tx, memberId, 'KEY SHARE')
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM group_membership
        WHERE group_id = ${groupId}::uuid AND member_id = ${memberId}::uuid AND state = 'PENDING'
        FOR UPDATE`
      const row = rows[0]
      if (!row) throw new NotFoundError(REQUEST_NOT_FOUND)
      await tx.groupMembership.delete({ where: { id: row.id } })
    })
  }

  /**
   * The owner approves a pending request. With the group locked, rechecks that the request is
   * pending, the group open with a free place and the requester an active Student.
   */
  async approveJoin(actor: ActorContext, membershipId: string): Promise<void> {
    await this.decide(actor, membershipId, 'ACCEPTED')
  }

  /** The owner declines a pending request; the requester is notified. */
  async declineJoin(actor: ActorContext, membershipId: string): Promise<void> {
    await this.decide(actor, membershipId, 'DECLINED')
  }

  /** An accepted member other than the owner leaves and releases the place. */
  async leaveGroup(actor: ActorContext, groupId: string): Promise<void> {
    const memberId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      const { row } = await this.lockGroup(tx, groupId, 'SHARE', [memberId])
      if (row.ownerId === memberId) {
        throw new PermissionDeniedError('The owner cannot leave. Transfer ownership or close the group.')
      }
      const memberships = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM group_membership
        WHERE group_id = ${groupId}::uuid AND member_id = ${memberId}::uuid AND state = 'ACCEPTED'
        FOR UPDATE`
      const membership = memberships[0]
      if (!membership) throw new ConflictError('You are not a member of this group.')
      const now = this.deps.clock.now()
      await tx.groupMembership.update({
        where: { id: membership.id },
        data: { state: 'LEFT', updatedAt: now },
      })
      await this.cancelTransfersTo(tx, groupId, memberId, now)
      await this.deps.notifications.notify(tx, {
        recipientId: row.ownerId,
        type: 'GROUP_OUTCOME',
        eventKey: `group-membership:${membership.id}:LEFT`,
        actorId: memberId,
        targetType: 'GROUP',
        targetId: groupId,
      })
    })
  }

  /** Transfer Group Ownership: the owner proposes an accepted Student member. */
  async proposeTransfer(actor: ActorContext, groupId: string, input: unknown): Promise<GroupTransferView> {
    const ownerId = this.member(actor)
    const { memberId: toMemberId } = parseInput(groupTransferInputSchema, input)
    let id: string
    try {
      id = await this.deps.transactions.run(async (tx) => {
        const { row, members } = await this.lockGroup(tx, groupId, 'UPDATE', [toMemberId])
        if (row.ownerId !== ownerId) throw new PermissionDeniedError(OWNER_ONLY)
        if (row.state !== 'OPEN') throw new ConflictError('A closed group cannot be transferred.')
        if (toMemberId === ownerId) throw new ConflictError('You already own this group.')
        const accepted = await tx.groupMembership.findFirst({
          where: { groupId, memberId: toMemberId, state: 'ACCEPTED' },
          select: { id: true },
        })
        const recipient = members.get(toMemberId)
        if (!accepted || !recipient) throw new ConflictError('Choose an accepted member of the group.')
        if (!isActiveStudent(recipient)) throw new ConflictError('This member can no longer own a group.')
        const pending = await tx.groupTransfer.findFirst({ where: { groupId, state: 'PENDING' } })
        if (pending) throw new DuplicateError('A transfer is already pending. Cancel it first.')
        const created = await tx.groupTransfer.create({
          data: { groupId, fromOwnerId: ownerId, toMemberId, createdAt: this.deps.clock.now() },
          select: { id: true },
        })
        await this.deps.notifications.notify(tx, {
          recipientId: toMemberId,
          type: 'GROUP_TRANSFER',
          eventKey: `group-transfer:${created.id}:proposed`,
          actorId: ownerId,
          targetType: 'GROUP',
          targetId: groupId,
        })
        return created.id
      })
    } catch (error) {
      if (isUniqueViolation(error))
        throw new DuplicateError('A transfer is already pending. Cancel it first.')
      throw error
    }
    return this.getTransfer(actor, id)
  }

  /** The recipient accepts: they become the owner; the former owner stays an accepted member. */
  async acceptTransfer(actor: ActorContext, transferId: string): Promise<void> {
    await this.decideTransfer(actor, transferId, 'ACCEPTED')
  }

  /** The recipient declines; the owner is notified. */
  async declineTransfer(actor: ActorContext, transferId: string): Promise<void> {
    await this.decideTransfer(actor, transferId, 'DECLINED')
  }

  /** The owner cancels a pending transfer; the recipient is notified. */
  async cancelTransfer(actor: ActorContext, transferId: string): Promise<void> {
    await this.decideTransfer(actor, transferId, 'CANCELLED')
  }

  /** A transfer, only to its two parties. */
  async getTransfer(actor: ActorContext, transferId: string): Promise<GroupTransferView> {
    const memberId = this.member(actor)
    const row = await this.deps.db.groupTransfer.findUnique({ where: { id: transferId } })
    if (!row || (row.fromOwnerId !== memberId && row.toMemberId !== memberId)) {
      throw new NotFoundError(TRANSFER_NOT_FOUND)
    }
    const [view] = await this.transferViews(memberId, [row])
    if (!view) throw new NotFoundError(TRANSFER_NOT_FOUND)
    return view
  }

  /** The pending requests of a group, oldest first, to its owner. */
  async listJoinRequests(actor: ActorContext, groupId: string, page: unknown): Promise<Page<MembershipView>> {
    const memberId = this.member(actor)
    const request = parseInput(joinRequestsQuerySchema, page)
    const db = this.deps.db
    const group = await db.group.findUnique({ where: { id: groupId } })
    if (!group) throw new NotFoundError(NOT_FOUND)
    if (group.ownerId !== memberId) throw new PermissionDeniedError(OWNER_ONLY)
    const where = { groupId, state: 'PENDING' as const }
    const [rows, total] = await Promise.all([
      db.groupMembership.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(request),
      }),
      db.groupMembership.count({ where }),
    ])
    return toPage(await this.membershipViews(memberId, rows), request, total)
  }

  /** The Activities Board and search: OPEN groups by text or #tag, by relevance then newest. */
  async searchGroups(actor: ActorContext, query: unknown): Promise<Page<GroupSummaryView>> {
    this.member(actor)
    const parsed = parseInput(groupBoardQuerySchema, query)
    const { text, tag } = parsed
    const { skip, take } = pageWindow(parsed)
    const where = Prisma.sql`
      WHERE g.state = 'OPEN'
        AND (${text}::text IS NULL OR g.search_vector @@ websearch_to_tsquery('simple', ${text}::text))
        AND (${tag}::text IS NULL OR g.search_vector @@ plainto_tsquery('simple', ${tag}::text))`
    const [ids, counts] = await Promise.all([
      this.deps.db.$queryRaw<{ id: string }[]>`
        SELECT g.id FROM "group" g ${where}
        ORDER BY
          CASE WHEN ${text}::text IS NULL THEN 0
               ELSE ts_rank(g.search_vector, websearch_to_tsquery('simple', ${text}::text)) END DESC,
          g.created_at DESC, g.id DESC
        LIMIT ${take} OFFSET ${skip}`,
      this.deps.db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM "group" g ${where}`,
    ])
    const rows = await this.byIds(ids.map((row) => row.id))
    return toPage(await this.summaries(actor, rows), parsed, counts[0]?.total ?? 0)
  }

  /** "My groups": groups the actor owns, has joined or asked to join; open first, latest change first. */
  async listMyGroups(actor: ActorContext, query: unknown): Promise<Page<GroupSummaryView>> {
    const memberId = this.member(actor)
    const parsed = parseInput(myGroupsQuerySchema, query)
    const relations: Record<GroupRelation, Prisma.GroupWhereInput> = {
      OWNER: { ownerId: memberId },
      MEMBER: { ownerId: { not: memberId }, memberships: { some: { memberId, state: 'ACCEPTED' } } },
      PENDING: { memberships: { some: { memberId, state: 'PENDING' } } },
    }
    const where: Prisma.GroupWhereInput = {
      ...(parsed.state ? { state: parsed.state } : {}),
      OR: parsed.relation ? [relations[parsed.relation]] : Object.values(relations),
    }
    const [rows, total] = await Promise.all([
      this.deps.db.group.findMany({
        where,
        orderBy: [{ state: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(parsed),
      }),
      this.deps.db.group.count({ where }),
    ])
    return toPage(await this.summaries(actor, rows), parsed, total)
  }

  /** Groups by id with their state, for saved items. */
  async describeGroups(
    actor: ActorContext,
    groupIds: readonly string[],
  ): Promise<Map<string, GroupDescription>> {
    this.member(actor)
    if (groupIds.length === 0) return new Map()
    const rows = await this.deps.db.group.findMany({ where: { id: { in: [...groupIds] } } })
    const views = new Map((await this.summaries(actor, rows)).map((view) => [view.id, view]))
    return new Map(rows.map((row) => [row.id, { state: row.state, view: views.get(row.id) ?? null }]))
  }

  /** Called by BoardsService.save: only an OPEN group may be saved. */
  async assertGroupSaveable(tx: Tx, actor: ActorContext, groupId: string): Promise<void> {
    await this.deps.access.assertCanInteract(tx, actor)
    const rows = await tx.$queryRaw<{ state: GroupState }[]>`
      SELECT state FROM "group" WHERE id = ${groupId}::uuid FOR SHARE`
    const row = rows[0]
    if (!row) throw new NotFoundError(NOT_FOUND)
    if (row.state !== 'OPEN') throw new ConflictError('This group is closed and cannot be saved.')
  }

  private member(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  /** Rechecks on the locked account that the actor is an active Student without a restriction. */
  private async lockPublisher(tx: Tx, actor: ActorContext): Promise<void> {
    const member = await this.deps.access.lockMember(tx, actor.accountId, 'KEY SHARE')
    if (!isActiveStudent(member)) throw new PermissionDeniedError(STUDENT_ONLY)
    await this.deps.access.assertNotRestricted(tx, actor.accountId)
  }

  /**
   * Key-share locks the owner's and the other given accounts (in id order), then the group row.
   * The owner is read first without a lock; a transfer completed meanwhile gives ConflictError.
   */
  private async lockGroup(
    tx: Tx,
    groupId: string,
    strength: 'UPDATE' | 'SHARE',
    accounts: string[] = [],
  ): Promise<{ row: LockedGroup; members: Map<string, MemberSummary> }> {
    const found = await tx.group.findUnique({ where: { id: groupId }, select: { ownerId: true } })
    if (!found) throw new NotFoundError(NOT_FOUND)
    const members = new Map<string, MemberSummary>()
    for (const id of [...new Set([found.ownerId, ...accounts])].sort()) {
      members.set(id, await this.deps.access.lockMember(tx, id, 'KEY SHARE'))
    }
    const rows = await tx.$queryRaw<
      {
        id: string
        owner_id: string
        title: string
        state: GroupState
        max_occupancy: number
        version: number
      }[]
    >`
      SELECT id, owner_id, title, state, max_occupancy, version FROM "group"
      WHERE id = ${groupId}::uuid ${Prisma.raw(`FOR ${strength}`)}`
    const row = rows[0]
    if (!row) throw new NotFoundError(NOT_FOUND)
    if (row.owner_id !== found.ownerId) throw new ConflictError(CHANGED)
    return {
      row: {
        id: row.id,
        ownerId: row.owner_id,
        title: row.title,
        state: row.state,
        maxOccupancy: row.max_occupancy,
        version: row.version,
      },
      members,
    }
  }

  private countAccepted(tx: Tx, groupId: string): Promise<number> {
    return tx.groupMembership.count({ where: { groupId, state: 'ACCEPTED' } })
  }

  private async decide(
    actor: ActorContext,
    membershipId: string,
    to: 'ACCEPTED' | 'DECLINED',
  ): Promise<void> {
    const ownerId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      const found = await tx.groupMembership.findUnique({
        where: { id: membershipId },
        select: { groupId: true, memberId: true },
      })
      if (!found) throw new NotFoundError(REQUEST_NOT_FOUND)
      const { row, members } = await this.lockGroup(tx, found.groupId, 'UPDATE', [found.memberId])
      if (row.ownerId !== ownerId) {
        if (found.memberId === ownerId) throw new PermissionDeniedError(OWNER_ONLY)
        throw new NotFoundError(REQUEST_NOT_FOUND)
      }
      const locked = await tx.$queryRaw<{ state: MembershipState }[]>`
        SELECT state FROM group_membership WHERE id = ${membershipId}::uuid FOR UPDATE`
      if (locked[0]?.state !== 'PENDING') throw new ConflictError('This request is no longer pending.')
      const now = this.deps.clock.now()
      if (to === 'ACCEPTED') {
        if (row.state !== 'OPEN') throw new ConflictError('This group is closed.')
        const requester = members.get(found.memberId)
        if (!requester || !isActiveStudent(requester)) {
          throw new ConflictError('This member can no longer join groups.')
        }
        if ((await this.countAccepted(tx, row.id)) >= row.maxOccupancy) {
          throw new CapacityExceededError('The group is full. Raise the maximum or decline the request.')
        }
      }
      await tx.groupMembership.update({
        where: { id: membershipId },
        data: { state: to, updatedAt: now, ...(to === 'ACCEPTED' ? { joinedAt: now } : {}) },
      })
      await this.deps.notifications.notify(tx, {
        recipientId: found.memberId,
        type: 'GROUP_OUTCOME',
        eventKey: `group-membership:${membershipId}:${to}`,
        actorId: ownerId,
        targetType: 'GROUP',
        targetId: row.id,
      })
    })
  }

  private async decideTransfer(
    actor: ActorContext,
    transferId: string,
    to: 'ACCEPTED' | 'DECLINED' | 'CANCELLED',
  ): Promise<void> {
    const memberId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      const found = await tx.groupTransfer.findUnique({ where: { id: transferId } })
      if (!found || (found.fromOwnerId !== memberId && found.toMemberId !== memberId)) {
        throw new NotFoundError(TRANSFER_NOT_FOUND)
      }
      const decider = to === 'CANCELLED' ? found.fromOwnerId : found.toMemberId
      if (decider !== memberId) {
        throw new PermissionDeniedError(
          to === 'CANCELLED'
            ? 'Only the owner can cancel this transfer.'
            : 'Only the proposed member can answer.',
        )
      }
      const { row, members } = await this.lockGroup(tx, found.groupId, 'UPDATE', [
        found.fromOwnerId,
        found.toMemberId,
      ])
      const locked = await tx.$queryRaw<{ state: TransferState }[]>`
        SELECT state FROM group_transfer WHERE id = ${transferId}::uuid FOR UPDATE`
      if (locked[0]?.state !== 'PENDING') throw new ConflictError('This transfer is no longer pending.')
      const now = this.deps.clock.now()
      if (to === 'ACCEPTED') {
        if (row.state !== 'OPEN' || row.ownerId !== found.fromOwnerId) throw new ConflictError(CHANGED)
        const recipient = members.get(found.toMemberId)
        const accepted = await tx.groupMembership.findFirst({
          where: { groupId: row.id, memberId: found.toMemberId, state: 'ACCEPTED' },
          select: { id: true },
        })
        if (!recipient || !isActiveStudent(recipient) || !accepted) {
          throw new ConflictError('You can no longer take over this group.')
        }
        await tx.group.update({
          where: { id: row.id },
          data: { ownerId: found.toMemberId, version: { increment: 1 }, updatedAt: now },
        })
      }
      await tx.groupTransfer.update({ where: { id: transferId }, data: { state: to, decidedAt: now } })
      await this.deps.notifications.notify(tx, {
        recipientId: to === 'CANCELLED' ? found.toMemberId : found.fromOwnerId,
        type: 'GROUP_TRANSFER',
        eventKey: `group-transfer:${transferId}:${to}`,
        actorId: memberId,
        targetType: 'GROUP',
        targetId: row.id,
      })
    })
  }

  /** A member who leaves can no longer take over: their pending transfer is cancelled. */
  private async cancelTransfersTo(tx: Tx, groupId: string, memberId: string, now: Date): Promise<void> {
    await tx.$queryRaw`
      SELECT id FROM group_transfer
      WHERE group_id = ${groupId}::uuid AND to_member_id = ${memberId}::uuid AND state = 'PENDING' FOR UPDATE`
    await tx.groupTransfer.updateMany({
      where: { groupId, toMemberId: memberId, state: 'PENDING' },
      data: { state: 'CANCELLED', decidedAt: now },
    })
  }

  private async getMembership(actor: ActorContext, membershipId: string): Promise<MembershipView> {
    const row = await this.deps.db.groupMembership.findUnique({ where: { id: membershipId } })
    if (!row) throw new NotFoundError(REQUEST_NOT_FOUND)
    const [view] = await this.membershipViews(actor.accountId, [row])
    if (!view) throw new NotFoundError(REQUEST_NOT_FOUND)
    return view
  }

  private async byIds(ids: string[]): Promise<GroupRecord[]> {
    if (ids.length === 0) return []
    const rows = await this.deps.db.group.findMany({ where: { id: { in: ids } } })
    const byId = new Map(rows.map((row) => [row.id, row]))
    return ids.flatMap((id) => {
      const row = byId.get(id)
      return row ? [row] : []
    })
  }

  private async occupancies(groupIds: string[]): Promise<Map<string, number>> {
    if (groupIds.length === 0) return new Map()
    const counts = await this.deps.db.groupMembership.groupBy({
      by: ['groupId'],
      where: { groupId: { in: groupIds }, state: 'ACCEPTED' },
      _count: { _all: true },
    })
    return new Map(counts.map((row) => [row.groupId, row._count._all]))
  }

  /** Board cards with the viewer's relation and why a join request is blocked now. */
  private async summaries(actor: ActorContext, rows: GroupRecord[]): Promise<GroupSummaryView[]> {
    if (rows.length === 0) return []
    const viewerId = actor.accountId
    const db = this.deps.db
    const ids = rows.map((row) => row.id)
    const owned = rows.filter((row) => row.ownerId === viewerId).map((row) => row.id)
    const [occupancy, mine, pending, cards, saves] = await Promise.all([
      this.occupancies(ids),
      db.groupMembership.findMany({
        where: { memberId: viewerId, groupId: { in: ids }, state: { in: ['PENDING', 'ACCEPTED'] } },
        select: { groupId: true, state: true },
      }),
      owned.length > 0
        ? db.groupMembership.groupBy({
            by: ['groupId'],
            where: { groupId: { in: owned }, state: 'PENDING' },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      this.deps.views.memberCards(rows.map((row) => row.ownerId)),
      this.deps.saves.groupSaves(viewerId, ids),
    ])
    const relation = new Map(mine.map((row) => [row.groupId, row.state]))
    const pendingCounts = new Map(pending.map((row) => [row.groupId, row._count._all]))
    const isStudent = actor.role === 'STUDENT'
    return rows.map((row) => {
      const count = occupancy.get(row.id) ?? 0
      const state = relation.get(row.id)
      const viewerRelation: GroupRelation | null =
        row.ownerId === viewerId
          ? 'OWNER'
          : state === 'ACCEPTED'
            ? 'MEMBER'
            : state === 'PENDING'
              ? 'PENDING'
              : null
      let joinBlock: GroupJoinBlock | null = null
      if (viewerRelation === null) {
        if (!isStudent) joinBlock = 'NOT_STUDENT'
        else if (actor.accountState !== 'ACTIVE') joinBlock = 'CANNOT_INTERACT'
        else if (row.state !== 'OPEN') joinBlock = 'CLOSED'
        else if (count >= row.maxOccupancy) joinBlock = 'FULL'
      }
      return {
        id: row.id,
        owner: cards.get(row.ownerId) ?? deletedCard(),
        title: row.title,
        description: row.description,
        maxOccupancy: row.maxOccupancy,
        occupancy: count,
        state: row.state,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        viewerRelation,
        joinBlock,
        pendingCount: row.ownerId === viewerId ? (pendingCounts.get(row.id) ?? 0) : null,
        savedByMe: saves.get(row.id)?.savedByMe ?? false,
      }
    })
  }

  private async detail(actor: ActorContext, row: GroupRecord, summary: GroupSummaryView): Promise<GroupView> {
    const viewerId = actor.accountId
    const isMember = summary.viewerRelation === 'OWNER' || summary.viewerRelation === 'MEMBER'
    const db = this.deps.db
    const [owners, memberships, transfer] = await Promise.all([
      this.deps.access.getMembers(db, [row.ownerId]),
      isMember
        ? db.groupMembership.findMany({
            where: { groupId: row.id, state: 'ACCEPTED' },
            orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([]),
      db.groupTransfer.findFirst({
        where: {
          groupId: row.id,
          state: 'PENDING',
          OR: [{ fromOwnerId: viewerId }, { toMemberId: viewerId }],
        },
      }),
    ])
    const owner = owners.get(row.ownerId)
    const withheld = owner === undefined || owner.state === 'DISABLED' || owner.state === 'DELETED'
    let members: GroupMemberView[] | null = null
    if (isMember) {
      const cards = await this.deps.views.memberCards(memberships.map((membership) => membership.memberId))
      members = memberships
        .map((membership) => ({
          membershipId: membership.id,
          member: cards.get(membership.memberId) ?? deletedCard(),
          isOwner: membership.memberId === row.ownerId,
          joinedAt: membership.joinedAt?.toISOString() ?? null,
        }))
        .sort((a, b) => Number(b.isOwner) - Number(a.isOwner))
    }
    const [pendingTransfer] = transfer ? await this.transferViews(viewerId, [transfer]) : []
    return {
      ...summary,
      coordinationDetails: isMember && !withheld ? row.coordinationDetails : null,
      coordinationWithheld: isMember && withheld && row.coordinationDetails !== null,
      members,
      pendingTransfer: pendingTransfer ?? null,
    }
  }

  private async membershipViews(viewerId: string, rows: MembershipRecord[]): Promise<MembershipView[]> {
    if (rows.length === 0) return []
    const groupIds = [...new Set(rows.map((row) => row.groupId))]
    const [groups, occupancy, cards, members] = await Promise.all([
      this.deps.db.group.findMany({ where: { id: { in: groupIds } } }),
      this.occupancies(groupIds),
      this.deps.views.memberCards(rows.map((row) => row.memberId)),
      this.deps.access.getMembers(
        this.deps.db,
        rows.map((row) => row.memberId),
      ),
    ])
    const byId = new Map(groups.map((group) => [group.id, group]))
    return rows.map((row) => {
      const group = byId.get(row.groupId)
      let approveBlock: GroupApproveBlock | null = null
      if (group && group.ownerId === viewerId && row.state === 'PENDING') {
        const member = members.get(row.memberId)
        if (group.state !== 'OPEN') approveBlock = 'CLOSED'
        else if (!member || !isActiveStudent(member)) approveBlock = 'REQUESTER_INELIGIBLE'
        else if ((occupancy.get(row.groupId) ?? 0) >= group.maxOccupancy) approveBlock = 'FULL'
      }
      return {
        id: row.id,
        groupId: row.groupId,
        member: cards.get(row.memberId) ?? deletedCard(),
        state: row.state,
        requestedAt: row.createdAt.toISOString(),
        joinedAt: row.joinedAt?.toISOString() ?? null,
        approveBlock,
      }
    })
  }

  private async transferViews(viewerId: string, rows: TransferRecord[]): Promise<GroupTransferView[]> {
    if (rows.length === 0) return []
    const groupIds = [...new Set(rows.map((row) => row.groupId))]
    const [groups, occupancy, cards] = await Promise.all([
      this.deps.db.group.findMany({ where: { id: { in: groupIds } } }),
      this.occupancies(groupIds),
      this.deps.views.memberCards(rows.flatMap((row) => [row.fromOwnerId, row.toMemberId])),
    ])
    const byId = new Map(groups.map((group) => [group.id, group]))
    return rows.flatMap((row): GroupTransferView[] => {
      const group = byId.get(row.groupId)
      if (!group) return []
      return [
        {
          id: row.id,
          group: {
            id: group.id,
            title: group.title,
            state: group.state,
            occupancy: occupancy.get(group.id) ?? 0,
            maxOccupancy: group.maxOccupancy,
          },
          fromOwner: cards.get(row.fromOwnerId) ?? deletedCard(),
          toMember: cards.get(row.toMemberId) ?? deletedCard(),
          state: row.state,
          createdAt: row.createdAt.toISOString(),
          decidedAt: row.decidedAt?.toISOString() ?? null,
          viewerSide: row.fromOwnerId === viewerId ? 'OWNER' : 'RECIPIENT',
        },
      ]
    })
  }
}
