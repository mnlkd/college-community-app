import {
  STUDENT_MENTOR_LIMIT,
  mentorProfileInputSchema,
  mentorSearchQuerySchema,
  mentorshipListQuerySchema,
  mentorshipRequestInputSchema,
  type MemberCardView,
  type MentorContactView,
  type MentorProfileView,
  type MentorRequestBlock,
  type MentorSummaryView,
  type MentorshipAcceptBlock,
  type MentorshipState,
  type MentorshipView,
  type OwnMentorSettingsView,
  type Page,
  type ParsedMentorSearchQuery,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  deletedCard,
  isMentorEligible,
  type AccessPolicy,
  type AccountViews,
  type MemberSummary,
} from '../identity/index.js'
import {
  CapacityExceededError,
  ConflictError,
  DuplicateError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
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
import { OPEN_MENTORSHIP_STATES } from './states.js'

export interface MentorshipServiceDeps {
  db: PrismaClient
  transactions: TransactionRunner
  clock: Clock
  access: AccessPolicy
  notifications: NotificationService
  views: AccountViews
}

/** Shown in the settings form before the first save. */
const DEFAULT_CAPACITY = 3

interface ProfileRecord {
  memberId: string
  available: boolean
  capacity: number
  introduction: string | null
  topics: string[]
}

interface MentorshipRecord {
  id: string
  studentId: string
  mentorId: string
  topic: string
  note: string
  state: MentorshipState
  requestedAt: Date
  decidedAt: Date | null
  updatedAt: Date
}

interface LockedProfileRow {
  member_id: string
  available: boolean
  capacity: number
  topics: string[]
}

interface LockedMentorshipRow {
  id: string
  student_id: string
  mentor_id: string
  state: MentorshipState
}

interface TransitionRule {
  /** Who besides a party is refused; both parties pass when absent. */
  only?: { side: 'STUDENT' | 'MENTOR'; message: string }
  from: MentorshipState
  to: MentorshipState
  conflictMessage: string
}

const MENTOR_ONLY = 'Only Staff members and Verified Alumni can mentor.'
const STUDENT_ONLY = 'Only Students can request mentorship.'
const NOT_FOUND = 'The mentorship was not found.'
const MENTOR_NOT_FOUND = 'The mentor was not found.'

function isActiveStudent(member: MemberSummary): boolean {
  return member.state === 'ACTIVE' && member.role === 'STUDENT'
}

/**
 * Mentor settings, requests and relationships (ODD Table 14, FR-5).
 *
 * Every change takes its locks in one order, also used by MentorshipLifecycleHandler: member
 * accounts (Student, then mentor), then the mentor profile, then the mentorship row. Accounts are
 * locked below FOR UPDATE, so notices referencing them can still be inserted, while a graduation
 * or deletion (which holds the account FOR UPDATE) still waits for the change, or the reverse.
 */
export class MentorshipService {
  constructor(private readonly deps: MentorshipServiceDeps) {}

  /** Manage Mentor Availability. Capacity cannot fall below the current active mentorships. */
  async updateMentorProfile(actor: ActorContext, input: unknown): Promise<OwnMentorSettingsView> {
    const memberId = this.member(actor)
    if (!this.mayMentor(actor)) throw new PermissionDeniedError(MENTOR_ONLY)
    const settings = parseInput(mentorProfileInputSchema, input)
    await this.deps.transactions.run(async (tx) => {
      await this.deps.access.assertMentorEligible(tx, memberId)
      const data = {
        available: settings.available,
        capacity: settings.capacity,
        introduction: settings.introduction,
        topics: settings.topics,
        updatedAt: this.deps.clock.now(),
      }
      // The account lock above serializes this mentor's own updates, so the create cannot race.
      const existing = await this.lockProfile(tx, memberId)
      if (existing) {
        const active = await this.countActive(tx, { mentorId: memberId })
        if (settings.capacity < active) {
          throw new CapacityExceededError(
            `Capacity cannot be lower than your ${active} active ${active === 1 ? 'mentee' : 'mentees'}.`,
          )
        }
        await tx.mentorProfile.update({ where: { memberId }, data })
        await tx.mentorContact.deleteMany({ where: { mentorId: memberId } })
      } else {
        await tx.mentorProfile.create({ data: { memberId, ...data } })
      }
      await tx.mentorContact.createMany({
        data: settings.contacts.map((contact) => ({
          mentorId: memberId,
          kind: contact.kind,
          value: contact.value,
          visibleAfterAcceptance: true,
        })),
      })
    })
    return this.getOwnMentorSettings(actor)
  }

  /** The actor's own settings with contacts; defaults before the first save. */
  async getOwnMentorSettings(actor: ActorContext): Promise<OwnMentorSettingsView> {
    const memberId = this.member(actor)
    if (!this.mayMentor(actor)) throw new PermissionDeniedError(MENTOR_ONLY)
    const db = this.deps.db
    const [profile, activeCount, pendingCount] = await Promise.all([
      db.mentorProfile.findUnique({
        where: { memberId },
        include: { contacts: { orderBy: { kind: 'asc' } } },
      }),
      db.mentorship.count({ where: { mentorId: memberId, state: 'ACTIVE' } }),
      db.mentorship.count({ where: { mentorId: memberId, state: 'PENDING' } }),
    ])
    if (!profile) {
      return {
        configured: false,
        available: false,
        capacity: Math.max(DEFAULT_CAPACITY, activeCount),
        introduction: null,
        topics: [],
        contacts: [],
        activeCount,
        pendingCount,
      }
    }
    return {
      configured: true,
      available: profile.available,
      capacity: profile.capacity,
      introduction: profile.introduction,
      topics: profile.topics,
      contacts: profile.contacts.map((contact) => ({ kind: contact.kind, value: contact.value })),
      activeCount,
      pendingCount,
    }
  }

  /** Public mentor profile without contacts; shown while the member may mentor, even if unavailable. */
  async getMentorProfile(actor: ActorContext, mentorId: string): Promise<MentorProfileView> {
    this.member(actor)
    const db = this.deps.db
    const [profile, members] = await Promise.all([
      db.mentorProfile.findUnique({ where: { memberId: mentorId } }),
      this.deps.access.getMembers(db, [mentorId]),
    ])
    const mentor = members.get(mentorId)
    if (!profile || !mentor || !isMentorEligible(mentor)) throw new NotFoundError(MENTOR_NOT_FOUND)
    const [summary] = await this.summaries(actor, [profile])
    if (!summary) throw new NotFoundError(MENTOR_NOT_FOUND)
    return {
      ...summary,
      viewerActiveMentors:
        actor.role === 'STUDENT' ? await this.countActive(db, { studentId: actor.accountId }) : null,
    }
  }

  /**
   * Available, eligible mentors matching the filters: a keyword over introduction and topics, a
   * tag or topic, and open places only. Ranked by relevance, then most recently updated.
   */
  async searchMentors(actor: ActorContext, query: unknown): Promise<Page<MentorSummaryView>> {
    this.member(actor)
    const parsed = parseInput(mentorSearchQuerySchema, query)
    const ids = await this.matchingMentorIds(parsed)
    const members = await this.deps.access.getMembers(this.deps.db, ids)
    const eligible = ids.filter((id) => {
      const member = members.get(id)
      return member !== undefined && isMentorEligible(member)
    })
    const { skip, take } = pageWindow(parsed)
    const pageIds = eligible.slice(skip, skip + take)
    const profiles = await this.deps.db.mentorProfile.findMany({ where: { memberId: { in: pageIds } } })
    const byId = new Map(profiles.map((profile) => [profile.memberId, profile]))
    const ordered = pageIds.flatMap((id) => {
      const profile = byId.get(id)
      return profile ? [profile] : []
    })
    const items = await this.summaries(actor, ordered)
    return toPage(items, { page: parsed.page, pageSize: parsed.pageSize }, eligible.length)
  }

  /** Request or Withdraw Mentorship: a Student asks an available, eligible mentor with places. */
  async requestMentorship(actor: ActorContext, mentorId: string, input: unknown): Promise<MentorshipView> {
    const studentId = this.member(actor)
    if (actor.role !== 'STUDENT') throw new PermissionDeniedError(STUDENT_ONLY)
    const request = parseInput(mentorshipRequestInputSchema, input)
    let id: string
    try {
      id = await this.deps.transactions.run(async (tx) => {
        const student = await this.deps.access.lockMember(tx, studentId, 'NO KEY UPDATE')
        if (!isActiveStudent(student)) throw new PermissionDeniedError(STUDENT_ONLY)
        const mentor = await this.lockMentorAccount(tx, mentorId)
        const profile = await this.lockProfile(tx, mentorId)
        if (!profile || !isMentorEligible(mentor)) throw new NotFoundError(MENTOR_NOT_FOUND)
        if (!profile.available) {
          throw new PermissionDeniedError('This mentor is not taking new requests right now.')
        }
        const topic = this.chooseTopic(profile.topics, request.topic)
        const open = await tx.mentorship.findFirst({
          where: { studentId, mentorId, state: { in: OPEN_MENTORSHIP_STATES } },
          select: { state: true },
        })
        if (open) {
          throw new DuplicateError(
            open.state === 'ACTIVE'
              ? 'This mentor is already mentoring you.'
              : 'You already have a pending request to this mentor.',
          )
        }
        if ((await this.countActive(tx, { mentorId })) >= profile.capacity) {
          throw new CapacityExceededError('This mentor has no open places.')
        }
        if ((await this.countActive(tx, { studentId })) >= STUDENT_MENTOR_LIMIT) {
          throw new CapacityExceededError(
            `You already have ${STUDENT_MENTOR_LIMIT} active mentors. End one before requesting another.`,
          )
        }
        const now = this.deps.clock.now()
        const created = await tx.mentorship.create({
          data: { studentId, mentorId, topic, note: request.note, requestedAt: now, updatedAt: now },
          select: { id: true },
        })
        await this.deps.notifications.notify(tx, {
          recipientId: mentorId,
          type: 'MENTORSHIP_REQUEST',
          eventKey: `mentorship:${created.id}:requested`,
          actorId: studentId,
          targetType: 'MENTORSHIP',
          targetId: created.id,
        })
        return created.id
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateError('You already have a pending request to this mentor.')
      }
      throw error
    }
    return this.getMentorship(actor, id)
  }

  /** The Student withdraws a pending request; the mentor is notified. */
  async withdrawRequest(actor: ActorContext, mentorshipId: string): Promise<void> {
    await this.transition(this.member(actor), mentorshipId, {
      only: { side: 'STUDENT', message: 'Only the Student can withdraw this request.' },
      from: 'PENDING',
      to: 'WITHDRAWN',
      conflictMessage: 'This request is no longer pending.',
    })
  }

  /**
   * Respond to Mentorship Request: rechecks eligibility, state and both limits with the rows
   * locked, then discloses the contacts and notifies the Student. Availability off still allows it.
   */
  async acceptRequest(actor: ActorContext, mentorshipId: string): Promise<MentorshipView> {
    const mentorId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      const parties = await this.parties(tx, mentorId, mentorshipId)
      if (parties.mentorId !== mentorId) {
        throw new PermissionDeniedError('Only the mentor can accept this request.')
      }
      const student = await this.deps.access.lockMember(tx, parties.studentId, 'NO KEY UPDATE')
      const mentor = await this.deps.access.lockMember(tx, mentorId, 'SHARE')
      const profile = await this.lockProfile(tx, mentorId)
      const row = await this.lockMentorship(tx, mentorshipId)
      if (row.state !== 'PENDING') throw new ConflictError('This request is no longer pending.')
      if (!profile || !isMentorEligible(mentor)) throw new PermissionDeniedError(MENTOR_ONLY)
      if (!isActiveStudent(student)) {
        throw new ConflictError('This member can no longer be mentored as a Student.')
      }
      if ((await this.countActive(tx, { mentorId })) >= profile.capacity) {
        throw new CapacityExceededError(
          'You have no open places. Raise your capacity or end a mentorship first.',
        )
      }
      if ((await this.countActive(tx, { studentId: parties.studentId })) >= STUDENT_MENTOR_LIMIT) {
        throw new CapacityExceededError(`This Student already has ${STUDENT_MENTOR_LIMIT} active mentors.`)
      }
      const now = this.deps.clock.now()
      await tx.mentorship.update({
        where: { id: mentorshipId },
        data: { state: 'ACTIVE', decidedAt: now, updatedAt: now },
      })
      await this.notifyOutcome(tx, mentorshipId, parties.studentId, mentorId, 'ACTIVE')
    })
    return this.getMentorship(actor, mentorshipId)
  }

  /** The mentor declines a pending request; the Student is notified. */
  async declineRequest(actor: ActorContext, mentorshipId: string): Promise<void> {
    await this.transition(this.member(actor), mentorshipId, {
      only: { side: 'MENTOR', message: 'Only the mentor can decline this request.' },
      from: 'PENDING',
      to: 'DECLINED',
      conflictMessage: 'This request is no longer pending.',
    })
  }

  /** End Mentorship: either party ends an active mentorship, releasing places and contact access. */
  async endMentorship(actor: ActorContext, mentorshipId: string): Promise<void> {
    await this.transition(this.member(actor), mentorshipId, {
      from: 'ACTIVE',
      to: 'ENDED',
      conflictMessage: 'This mentorship is not active.',
    })
  }

  /** The actor's requests and relationships, as Student, mentor or both; latest change first. */
  async listMyMentorships(actor: ActorContext, query: unknown): Promise<Page<MentorshipView>> {
    const memberId = this.member(actor)
    const parsed = parseInput(mentorshipListQuerySchema, query)
    const side =
      parsed.side === 'STUDENT'
        ? { studentId: memberId }
        : parsed.side === 'MENTOR'
          ? { mentorId: memberId }
          : { OR: [{ studentId: memberId }, { mentorId: memberId }] }
    const where = { ...side, ...(parsed.state.length > 0 ? { state: { in: parsed.state } } : {}) }
    const [rows, total] = await Promise.all([
      this.deps.db.mentorship.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(parsed),
      }),
      this.deps.db.mentorship.count({ where }),
    ])
    return toPage(await this.toViews(memberId, rows), parsed, total)
  }

  /** One mentorship of the actor; others' mentorships are reported as not found. */
  async getMentorship(actor: ActorContext, mentorshipId: string): Promise<MentorshipView> {
    const memberId = this.member(actor)
    const row = await this.deps.db.mentorship.findUnique({ where: { id: mentorshipId } })
    if (!row || (row.studentId !== memberId && row.mentorId !== memberId)) {
      throw new NotFoundError(NOT_FOUND)
    }
    const [view] = await this.toViews(memberId, [row])
    if (!view) throw new NotFoundError(NOT_FOUND)
    return view
  }

  /** Contacts, only to an active mentee and only while the mentor is not Flagged or Disabled. */
  async getMentorContacts(actor: ActorContext, mentorId: string): Promise<MentorContactView[]> {
    const studentId = this.member(actor)
    const db = this.deps.db
    const [profile, active, members] = await Promise.all([
      db.mentorProfile.findUnique({
        where: { memberId: mentorId },
        include: { contacts: { where: { visibleAfterAcceptance: true }, orderBy: { kind: 'asc' } } },
      }),
      db.mentorship.findFirst({ where: { studentId, mentorId, state: 'ACTIVE' }, select: { id: true } }),
      this.deps.access.getMembers(db, [mentorId]),
    ])
    const mentor = members.get(mentorId)
    if (!profile || !mentor || mentor.state === 'DELETED') throw new NotFoundError(MENTOR_NOT_FOUND)
    if (!active) throw new PermissionDeniedError('Contacts are shared with active mentees only.')
    if (!isMentorEligible(mentor)) {
      throw new PermissionDeniedError("This mentor's contacts are not available right now.")
    }
    return profile.contacts.map((contact) => ({ kind: contact.kind, value: contact.value }))
  }

  private member(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  /** Early check from the session; repeated on the locked account row before any change. */
  private mayMentor(actor: ActorContext): boolean {
    return (
      actor.role !== null &&
      isMentorEligible({ state: actor.accountState, role: actor.role, alumniStatus: actor.alumniStatus })
    )
  }

  /** The mentor's topic matching the requested one; any topic when the mentor lists none. */
  private chooseTopic(topics: string[], requested: string): string {
    if (topics.length === 0) return requested
    const match = topics.find((topic) => topic.toLowerCase() === requested.toLowerCase())
    if (!match) throw new ValidationError({ topic: "Choose one of the mentor's topics." })
    return match
  }

  private async lockMentorAccount(tx: Tx, mentorId: string): Promise<MemberSummary> {
    try {
      return await this.deps.access.lockMember(tx, mentorId, 'SHARE')
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError(MENTOR_NOT_FOUND)
      throw error
    }
  }

  private async lockProfile(tx: Tx, mentorId: string): Promise<LockedProfileRow | null> {
    const rows = await tx.$queryRaw<LockedProfileRow[]>`
      SELECT member_id, available, capacity, topics FROM mentor_profile
      WHERE member_id = ${mentorId}::uuid FOR UPDATE`
    return rows[0] ?? null
  }

  private async lockMentorship(tx: Tx, mentorshipId: string): Promise<LockedMentorshipRow> {
    const rows = await tx.$queryRaw<LockedMentorshipRow[]>`
      SELECT id, student_id, mentor_id, state FROM mentorship
      WHERE id = ${mentorshipId}::uuid FOR UPDATE`
    const row = rows[0]
    if (!row) throw new NotFoundError(NOT_FOUND)
    return row
  }

  /** The parties of a mentorship the member belongs to, read without a lock (they never change). */
  private async parties(
    tx: Tx,
    memberId: string,
    mentorshipId: string,
  ): Promise<{ studentId: string; mentorId: string }> {
    const row = await tx.mentorship.findUnique({
      where: { id: mentorshipId },
      select: { studentId: true, mentorId: true },
    })
    if (!row || (row.studentId !== memberId && row.mentorId !== memberId)) {
      throw new NotFoundError(NOT_FOUND)
    }
    return row
  }

  private countActive(tx: Tx, where: { mentorId: string } | { studentId: string }): Promise<number> {
    return tx.mentorship.count({ where: { ...where, state: 'ACTIVE' } })
  }

  /** Withdraw, decline or end: one state change, notified to the other party. */
  private async transition(memberId: string, mentorshipId: string, rule: TransitionRule): Promise<void> {
    await this.deps.transactions.run(async (tx) => {
      const parties = await this.parties(tx, memberId, mentorshipId)
      const side = parties.studentId === memberId ? 'STUDENT' : 'MENTOR'
      if (rule.only && rule.only.side !== side) throw new PermissionDeniedError(rule.only.message)
      // Key-share locks make a concurrent graduation or deletion of either party wait, or the reverse.
      await this.deps.access.lockMember(tx, parties.studentId, 'KEY SHARE')
      await this.deps.access.lockMember(tx, parties.mentorId, 'KEY SHARE')
      const row = await this.lockMentorship(tx, mentorshipId)
      if (row.state !== rule.from) throw new ConflictError(rule.conflictMessage)
      const now = this.deps.clock.now()
      await tx.mentorship.update({
        where: { id: mentorshipId },
        data: { state: rule.to, updatedAt: now, ...(rule.to === 'DECLINED' ? { decidedAt: now } : {}) },
      })
      const other = side === 'STUDENT' ? parties.mentorId : parties.studentId
      await this.notifyOutcome(tx, mentorshipId, other, memberId, rule.to)
    })
  }

  private notifyOutcome(
    tx: Tx,
    mentorshipId: string,
    recipientId: string,
    actorId: string,
    state: MentorshipState,
  ): Promise<void> {
    return this.deps.notifications.notify(tx, {
      recipientId,
      type: 'MENTORSHIP_OUTCOME',
      eventKey: `mentorship:${mentorshipId}:${state}`,
      actorId,
      targetType: 'MENTORSHIP',
      targetId: mentorshipId,
    })
  }

  /** Ordered ids of available mentor profiles matching the filters; eligibility is checked after. */
  private async matchingMentorIds(query: ParsedMentorSearchQuery): Promise<string[]> {
    const { text, tag, topic, openOnly } = query
    const rows = await this.deps.db.$queryRaw<{ member_id: string }[]>`
      SELECT mp.member_id FROM mentor_profile mp
      WHERE mp.available
        AND (${text}::text IS NULL OR
          to_tsvector('simple', coalesce(mp.introduction, '') || ' ' || array_to_string(mp.topics, ' '))
            @@ websearch_to_tsquery('simple', ${text}::text))
        AND (${tag}::text IS NULL OR EXISTS (
          SELECT 1 FROM unnest(mp.topics) AS t(topic)
          WHERE lower(regexp_replace(btrim(t.topic), '[[:space:]]+', '-', 'g')) = ${tag}::text))
        AND (${topic}::text IS NULL OR EXISTS (
          SELECT 1 FROM unnest(mp.topics) AS t(topic) WHERE lower(t.topic) = lower(${topic}::text)))
        AND (NOT ${openOnly}::boolean OR mp.capacity > (
          SELECT count(*) FROM mentorship m WHERE m.mentor_id = mp.member_id AND m.state = 'ACTIVE'))
      ORDER BY
        CASE WHEN ${text}::text IS NULL THEN 0
             ELSE ts_rank(
               to_tsvector('simple', coalesce(mp.introduction, '') || ' ' || array_to_string(mp.topics, ' ')),
               websearch_to_tsquery('simple', ${text}::text)) END DESC,
        mp.updated_at DESC, mp.member_id`
    return rows.map((row) => row.member_id)
  }

  /** Mentor cards with the viewer's open mentorship and why a request is blocked now. */
  private async summaries(actor: ActorContext, profiles: ProfileRecord[]): Promise<MentorSummaryView[]> {
    if (profiles.length === 0) return []
    const db = this.deps.db
    const ids = profiles.map((profile) => profile.memberId)
    const isStudent = actor.role === 'STUDENT'
    const [views, activeGroups, viewerOpen, viewerActive] = await Promise.all([
      this.deps.views.profiles(ids),
      db.mentorship.groupBy({
        by: ['mentorId'],
        where: { mentorId: { in: ids }, state: 'ACTIVE' },
        _count: { _all: true },
      }),
      isStudent
        ? db.mentorship.findMany({
            where: {
              studentId: actor.accountId,
              mentorId: { in: ids },
              state: { in: OPEN_MENTORSHIP_STATES },
            },
            select: { id: true, mentorId: true, state: true },
          })
        : Promise.resolve([]),
      isStudent ? this.countActive(db, { studentId: actor.accountId }) : Promise.resolve(0),
    ])
    const active = new Map(activeGroups.map((group) => [group.mentorId, group._count._all]))
    const open = new Map(viewerOpen.map((row) => [row.mentorId, row]))
    return profiles.flatMap((profile): MentorSummaryView[] => {
      const mentor = views.get(profile.memberId)
      if (!mentor) return []
      const activeCount = active.get(profile.memberId) ?? 0
      const mine = open.get(profile.memberId)
      const viewerMentorship = mine
        ? ({ id: mine.id, state: mine.state === 'ACTIVE' ? 'ACTIVE' : 'PENDING' } as const)
        : null
      let requestBlock: MentorRequestBlock | null = null
      if (!isStudent) requestBlock = 'NOT_STUDENT'
      else if (!actor.canInteract()) requestBlock = 'CANNOT_INTERACT'
      else if (viewerMentorship) requestBlock = 'OPEN_MENTORSHIP'
      else if (!profile.available) requestBlock = 'UNAVAILABLE'
      else if (activeCount >= profile.capacity) requestBlock = 'MENTOR_FULL'
      else if (viewerActive >= STUDENT_MENTOR_LIMIT) requestBlock = 'STUDENT_LIMIT'
      return [
        {
          mentor,
          available: profile.available,
          capacity: profile.capacity,
          activeCount,
          introduction: profile.introduction,
          topics: profile.topics,
          viewerMentorship,
          requestBlock,
        },
      ]
    })
  }

  private async toViews(memberId: string, rows: MentorshipRecord[]): Promise<MentorshipView[]> {
    if (rows.length === 0) return []
    const db = this.deps.db
    const studentIds = [...new Set(rows.map((row) => row.studentId))]
    const pendingAsMentor = rows.some((row) => row.mentorId === memberId && row.state === 'PENDING')
    const [cards, studentActive, members, profile, mentorActive] = await Promise.all([
      this.deps.views.memberCards([...studentIds, ...rows.map((row) => row.mentorId)]),
      db.mentorship.groupBy({
        by: ['studentId'],
        where: { studentId: { in: studentIds }, state: 'ACTIVE' },
        _count: { _all: true },
      }),
      pendingAsMentor
        ? this.deps.access.getMembers(db, [memberId, ...studentIds])
        : Promise.resolve(new Map<string, MemberSummary>()),
      pendingAsMentor
        ? db.mentorProfile.findUnique({ where: { memberId }, select: { capacity: true } })
        : Promise.resolve(null),
      pendingAsMentor ? this.countActive(db, { mentorId: memberId }) : Promise.resolve(0),
    ])
    const activeByStudent = new Map(studentActive.map((group) => [group.studentId, group._count._all]))
    const card = (id: string): MemberCardView => cards.get(id) ?? deletedCard()
    return rows.map((row): MentorshipView => {
      const viewerSide = row.studentId === memberId ? 'STUDENT' : 'MENTOR'
      const studentActiveMentors = activeByStudent.get(row.studentId) ?? 0
      let acceptBlock: MentorshipAcceptBlock | null = null
      if (viewerSide === 'MENTOR' && row.state === 'PENDING') {
        const self = members.get(memberId)
        const student = members.get(row.studentId)
        if (!profile || !self || !isMentorEligible(self)) acceptBlock = 'MENTOR_INELIGIBLE'
        else if (!student || !isActiveStudent(student)) acceptBlock = 'STUDENT_INELIGIBLE'
        else if (mentorActive >= profile.capacity) acceptBlock = 'MENTOR_FULL'
        else if (studentActiveMentors >= STUDENT_MENTOR_LIMIT) acceptBlock = 'STUDENT_LIMIT'
      }
      return {
        id: row.id,
        student: card(row.studentId),
        mentor: card(row.mentorId),
        topic: row.topic,
        note: row.note,
        state: row.state,
        requestedAt: row.requestedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        viewerSide,
        studentActiveMentors,
        acceptBlock,
      }
    })
  }
}
