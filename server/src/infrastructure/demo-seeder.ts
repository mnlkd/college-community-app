import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ActorKind } from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { Clock } from '../kernel/index.js'
import {
  ADMINS,
  COMMENTS,
  GROUPS,
  MEMBERS,
  MENTORS,
  MENTORSHIPS,
  OPPORTUNITIES,
  POSTS,
  seedId,
} from './demo-data.js'
import { STORAGE_BUCKETS } from './storage-adapter.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The Supabase Auth admin operations the seeder needs. */
export interface DemoAuthAdmin {
  /** Every auth user, keyed by lower-case email. */
  listUsers(): Promise<Map<string, string>>
  /**
   * Creates the confirmed user, or resets the password, account kind and ban of an existing one.
   * MFA factors are left as they are.
   */
  ensureUser(existingId: string | null, email: string, password: string, kind: ActorKind): Promise<string>
  deleteUser(authUserId: string): Promise<void>
}

/** The Supabase Storage admin operations the seeder needs. */
export interface DemoStorageAdmin {
  /** Creates or updates the private image buckets. */
  ensureBuckets(): Promise<void>
  /** Removes every object of the image buckets; returns how many were removed. */
  removeAll(): Promise<number>
}

export interface DemoSeederDeps {
  db: PrismaClient
  clock: Clock
  auth: DemoAuthAdmin
  storage: DemoStorageAdmin
  /** The password of the ten demonstration accounts (SEED_PASSWORD). */
  password: string
  /** reseed() runs only where DEMO_ENVIRONMENT=true. */
  demoEnvironment: boolean
}

export interface SeedSummary {
  administrators: number
  members: number
  posts: number
  mentors: number
  opportunities: number
  groups: number
}

export interface ReseedSummary extends SeedSummary {
  tablesEmptied: number
  filesRemoved: number
  authUsersRemoved: number
}

/** All demonstration sign-in emails. */
export const DEMO_EMAILS: readonly string[] = [
  ...ADMINS.map((admin) => admin.email),
  ...MEMBERS.map((m) => m.email),
]

export class DemoEnvironmentError extends Error {
  constructor() {
    super('reseed runs only in the demonstration environment (DEMO_ENVIRONMENT=true).')
  }
}

/**
 * Demonstration reset of NFR-9 (ODD Table 5). seed() creates or restores the ten synthetic
 * identities and the sample content and may run anywhere; reseed() first erases every platform
 * row, stored image and other auth user, and runs only in the demonstration environment. It is
 * not a backup.
 */
export class DemoSeeder {
  constructor(private readonly deps: DemoSeederDeps) {}

  async reseed(): Promise<ReseedSummary> {
    if (!this.deps.demoEnvironment) throw new DemoEnvironmentError()
    const tablesEmptied = await this.emptyTables()
    const filesRemoved = await this.deps.storage.removeAll()
    const keep = new Set(DEMO_EMAILS)
    let authUsersRemoved = 0
    for (const [email, id] of await this.deps.auth.listUsers()) {
      if (keep.has(email)) continue
      await this.deps.auth.deleteUser(id)
      authUsersRemoved += 1
    }
    return { tablesEmptied, filesRemoved, authUsersRemoved, ...(await this.seed()) }
  }

  /** Idempotent: running it again restores the initial accounts, passwords and sample content. */
  async seed(): Promise<SeedSummary> {
    const { db, auth, password } = this.deps
    await this.deps.storage.ensureBuckets()
    const users = await auth.listUsers()

    const adminIds: string[] = []
    for (const admin of ADMINS) {
      const authUserId = await auth.ensureUser(users.get(admin.email) ?? null, admin.email, password, 'ADMIN')
      const row = await db.administratorAccount.upsert({
        where: { email: admin.email },
        create: {
          authUserId,
          email: admin.email,
          isFirstAdmin: admin.isFirstAdmin,
          createdByAdminId: adminIds[0] ?? null,
        },
        update: { authUserId, state: 'ACTIVE', isFirstAdmin: admin.isFirstAdmin, totpRequired: true },
      })
      adminIds.push(row.id)
    }
    const firstAdminId = adminIds[0] ?? null

    for (const member of MEMBERS) {
      const authUserId = await auth.ensureUser(
        users.get(member.email) ?? null,
        member.email,
        password,
        'MEMBER',
      )
      const account = {
        authUserId,
        displayName: member.displayName,
        role: member.role,
        alumniStatus: member.alumniStatus,
        programme: member.programme,
        state: 'ACTIVE' as const,
      }
      const row = await db.memberAccount.upsert({
        where: { email: member.email },
        create: { email: member.email, ...account },
        update: account,
      })
      const profile = {
        bio: member.profile.bio,
        studyOrExpertise: member.profile.studyOrExpertise,
        graduationYear: member.profile.graduationYear ?? null,
        currentPosition: member.profile.currentPosition ?? null,
      }
      await db.profile.upsert({
        where: { memberId: row.id },
        create: { memberId: row.id, ...profile },
        update: profile,
      })

      if (member.role === 'STAFF') {
        await db.staffEmailEntry.upsert({
          where: { email: member.email },
          create: { email: member.email, maintainedByAdminId: firstAdminId },
          update: { active: true },
        })
      }
      if (member.role === 'ALUMNI') {
        await db.alumniReview.deleteMany({ where: { memberId: row.id } })
        const verified = member.alumniStatus === 'VERIFIED'
        await db.alumniReview.create({
          data: {
            memberId: row.id,
            registrationPath: 'PERSONAL_EMAIL',
            claimedFullName: member.displayName,
            identifyingContext: `${member.programme === 'COMPUTER_SCIENCE' ? 'Computer Science' : 'Software Engineering'}, class of ${member.profile.graduationYear}`,
            decision: verified ? 'VERIFIED' : 'PENDING',
            reviewedByAdminId: verified ? firstAdminId : null,
            decidedAt: verified ? this.deps.clock.now() : null,
          },
        })
      }
    }

    const memberIds = new Map<string, string>()
    for (const row of await db.memberAccount.findMany({ select: { id: true, email: true } })) {
      if (row.email) memberIds.set(row.email, row.id)
    }
    const member = (email: string) => {
      const id = memberIds.get(email)
      if (!id) throw new Error(`Seed member missing: ${email}`)
      return id
    }
    const now = this.deps.clock.now().getTime()
    await this.seedPosts(member, now)
    await this.seedMentorship(member, now)
    await this.seedOpportunities(member, now)
    await this.seedGroups(member, now)
    await this.seedNotifications(memberIds, now)
    await this.seedReports(memberIds, now)
    return {
      administrators: ADMINS.length,
      members: MEMBERS.length,
      posts: POSTS.length,
      mentors: MENTORS.length,
      opportunities: OPPORTUNITIES.length,
      groups: GROUPS.length,
    }
  }

  /** TRUNCATE empties every platform table at once and does not fire the audit row trigger. */
  private async emptyTables(): Promise<number> {
    const tables = await this.deps.db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
    if (tables.length === 0) return 0
    const list = tables.map((table) => `"${table.tablename.replaceAll('"', '""')}"`).join(', ')
    await this.deps.db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`)
    return tables.length
  }

  private async seedPosts(member: (email: string) => string, now: number): Promise<void> {
    const db = this.deps.db
    for (const [index, post] of POSTS.entries()) {
      const id = seedId('a', index)
      const createdAt = new Date(now - post.ageHours * HOUR)
      const data = { body: post.body, state: 'VISIBLE' as const, version: 1, createdAt, updatedAt: createdAt }
      await db.post.upsert({
        where: { id },
        create: { id, authorId: member(post.author), ...data },
        update: data,
      })
      await db.postTag.deleteMany({ where: { postId: id } })
      await db.tag.createMany({
        data: post.tags.map((normalizedLabel) => ({ normalizedLabel })),
        skipDuplicates: true,
      })
      const tags = await db.tag.findMany({ where: { normalizedLabel: { in: post.tags } } })
      await db.postTag.createMany({ data: tags.map((tag) => ({ postId: id, tagId: tag.id })) })
      for (const email of post.likedBy) {
        const memberId = member(email)
        await db.like.upsert({
          where: { memberId_postId: { memberId, postId: id } },
          create: { memberId, postId: id, createdAt, updatedAt: createdAt },
          update: { active: true },
        })
      }
    }

    for (const [index, comment] of COMMENTS.entries()) {
      const id = seedId('b', index)
      const createdAt = new Date(now - comment.ageHours * HOUR)
      const data = {
        body: comment.body,
        state: 'VISIBLE' as const,
        version: 1,
        createdAt,
        updatedAt: createdAt,
      }
      await db.comment.upsert({
        where: { id },
        create: {
          id,
          postId: seedId('a', comment.post),
          authorId: member(comment.author),
          parentCommentId: comment.reply === undefined ? null : seedId('b', comment.reply),
          ...data,
        },
        update: data,
      })
    }
  }

  private async seedMentorship(member: (email: string) => string, now: number): Promise<void> {
    const db = this.deps.db
    for (const mentor of MENTORS) {
      const memberId = member(mentor.email)
      const data = {
        available: mentor.available,
        capacity: mentor.capacity,
        introduction: mentor.introduction,
        topics: mentor.topics,
      }
      await db.mentorProfile.upsert({ where: { memberId }, create: { memberId, ...data }, update: data })
      await db.mentorContact.deleteMany({ where: { mentorId: memberId } })
      await db.mentorContact.createMany({
        data: mentor.contacts.map((contact) => ({ mentorId: memberId, ...contact })),
      })
    }
    for (const [index, mentorship] of MENTORSHIPS.entries()) {
      const id = seedId('m', index)
      const studentId = member(mentorship.student)
      const mentorId = member(mentorship.mentor)
      // Clear any other open request for the pair so the one-open-per-pair rule holds on re-runs.
      await db.mentorship.deleteMany({
        where: { studentId, mentorId, id: { not: id }, state: { in: ['PENDING', 'ACTIVE'] } },
      })
      const requestedAt = new Date(now - mentorship.ageHours * HOUR)
      const decidedAt =
        mentorship.decidedHours === null ? null : new Date(now - mentorship.decidedHours * HOUR)
      const data = {
        topic: mentorship.topic,
        note: mentorship.note,
        state: mentorship.state,
        requestedAt,
        decidedAt,
        updatedAt: decidedAt ?? requestedAt,
      }
      await db.mentorship.upsert({
        where: { id },
        create: { id, studentId, mentorId, ...data },
        update: data,
      })
    }
  }

  private async seedOpportunities(member: (email: string) => string, now: number): Promise<void> {
    const today = new Date(new Date(now).toISOString().slice(0, 10))
    for (const [index, listing] of OPPORTUNITIES.entries()) {
      const id = seedId('o', index)
      const authorId = member(listing.author)
      const createdAt = new Date(now - listing.ageHours * HOUR)
      const data = {
        title: listing.title,
        organization: listing.organization,
        location: listing.location,
        type: listing.type,
        workArrangement: listing.workArrangement,
        description: listing.description,
        applyVia: listing.applyVia,
        deadline:
          listing.deadlineDays === null ? null : new Date(today.getTime() + listing.deadlineDays * DAY),
        state: listing.state,
        createdAt,
        updatedAt: createdAt,
      }
      await this.deps.db.opportunity.upsert({
        where: { id },
        create: { id, authorId, ...data },
        update: data,
      })
    }
  }

  private async seedGroups(member: (email: string) => string, now: number): Promise<void> {
    const db = this.deps.db
    let membershipIndex = 0
    for (const [index, group] of GROUPS.entries()) {
      const id = seedId('g', index)
      const ownerId = member(group.owner)
      const createdAt = new Date(now - group.ageHours * HOUR)
      const data = {
        ownerId,
        title: group.title,
        description: group.description,
        maxOccupancy: group.maxOccupancy,
        coordinationDetails: group.coordinationDetails,
        state: group.state,
        createdAt,
        updatedAt: createdAt,
      }
      await db.group.upsert({ where: { id }, create: { id, ...data }, update: data })
      // Re-runs reset the group's memberships and transfers to the seeded ones.
      await db.groupTransfer.deleteMany({ where: { groupId: id } })
      await db.groupMembership.deleteMany({ where: { groupId: id } })
      const rows = [
        { email: group.owner, state: 'ACCEPTED' as const, ageHours: group.ageHours },
        ...group.members,
      ]
      for (const row of rows) {
        const requestedAt = new Date(now - row.ageHours * HOUR)
        await db.groupMembership.create({
          data: {
            id: seedId('s', membershipIndex++),
            groupId: id,
            memberId: member(row.email),
            state: row.state,
            joinedAt: row.state === 'ACCEPTED' ? requestedAt : null,
            createdAt: requestedAt,
            updatedAt: requestedAt,
          },
        })
      }
    }
  }

  /** Sample notices that point at the seeded posts, comments, mentorships and groups. */
  private async seedNotifications(memberIds: Map<string, string>, now: number): Promise<void> {
    const selamawit = 'selamawit.girma@hilcoeschool.com'
    const notices = [
      {
        recipient: selamawit,
        type: 'COMMENT',
        actor: 'abel.tadesse@hilcoeschool.com',
        ageHours: 2,
        target: ['COMMENT', seedId('b', 0)],
      },
      {
        recipient: selamawit,
        type: 'LIKE',
        actor: 'mahlet.tesfaye@hilcoeschool.com',
        ageHours: 5,
        target: ['POST', seedId('a', 0)],
      },
      {
        recipient: selamawit,
        type: 'REPLY',
        actor: 'dawit.mekonnen@example.com',
        ageHours: 1.5,
        target: ['COMMENT', seedId('b', 2)],
      },
      {
        recipient: selamawit,
        type: 'MENTORSHIP_OUTCOME',
        actor: 'yonas.bekele@example.com',
        ageHours: 48,
        target: ['MENTORSHIP', seedId('m', 0)],
      },
      {
        recipient: 'meseret.alemayehu@hilcoeschool.com',
        type: 'MENTORSHIP_REQUEST',
        actor: selamawit,
        ageHours: 4,
        target: ['MENTORSHIP', seedId('m', 1)],
      },
      {
        recipient: 'abel.tadesse@hilcoeschool.com',
        type: 'GROUP_REQUEST',
        actor: 'nahom.getachew@hilcoeschool.com',
        ageHours: 3,
        target: ['GROUP', seedId('g', 0)],
      },
    ] as const
    for (const [index, notice] of notices.entries()) {
      const recipientId = memberIds.get(notice.recipient)
      if (!recipientId) continue
      const createdAt = new Date(now - notice.ageHours * HOUR)
      const eventKey = `seed:${notice.type.toLowerCase()}:${index}`
      const data = {
        type: notice.type,
        actorId: memberIds.get(notice.actor) ?? null,
        targetType: notice.target[0],
        targetId: notice.target[1],
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 90 * DAY),
      }
      await this.deps.db.notification.upsert({
        where: { recipientId_eventKey: { recipientId, eventKey } },
        create: { recipientId, eventKey, ...data },
        update: data,
      })
    }
  }

  /**
   * Two pending reports for the Administrator queue. A report that was already decided is left
   * as it is, so re-running the seed never reopens a decision.
   */
  private async seedReports(memberIds: Map<string, string>, now: number): Promise<void> {
    const db = this.deps.db
    const reports = [
      {
        reporter: 'abel.tadesse@hilcoeschool.com',
        targetType: 'POST',
        targetId: seedId('a', 3),
        snapshot: POSTS[3]?.body ?? null,
        reason: 'SPAM',
        details: 'Sample report: recruiting outside the opportunities board.',
        ageHours: 5,
      },
      {
        reporter: 'mahlet.tesfaye@hilcoeschool.com',
        targetType: 'COMMENT',
        targetId: seedId('b', 3),
        snapshot: COMMENTS[3]?.body ?? null,
        reason: 'HARASSMENT',
        details: null,
        ageHours: 2,
      },
    ] as const
    for (const [index, report] of reports.entries()) {
      const reporterId = memberIds.get(report.reporter)
      if (!reporterId) continue
      const id = seedId('r', index)
      if (await db.report.findUnique({ where: { id }, select: { id: true } })) continue
      const pending = await db.report.findFirst({
        where: { reporterId, targetType: report.targetType, targetId: report.targetId, state: 'PENDING' },
        select: { id: true },
      })
      if (pending) continue
      const createdAt = new Date(now - report.ageHours * HOUR)
      await db.report.create({
        data: {
          id,
          reporterId,
          targetType: report.targetType,
          targetId: report.targetId,
          targetVersion: 1,
          reason: report.reason,
          details: report.details,
          createdAt,
          evidence: { create: { snapshotText: report.snapshot, createdAt } },
        },
      })
    }
  }
}

/** Raw SQL access used to list stored objects (the Prisma client connects as the database owner). */
interface SqlClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>
}

/** DemoAuthAdmin and DemoStorageAdmin over the Supabase admin APIs (service-role key). */
export class SupabaseDemoAdmin implements DemoAuthAdmin, DemoStorageAdmin {
  private readonly client: SupabaseClient

  constructor(
    options: { supabaseUrl: string; serviceRoleKey: string },
    private readonly sql: SqlClient,
  ) {
    this.client = createClient(options.supabaseUrl, options.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  }

  async listUsers(): Promise<Map<string, string>> {
    const byEmail = new Map<string, string>()
    for (let page = 1; ; page += 1) {
      const { data, error } = await this.client.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      for (const user of data.users) if (user.email) byEmail.set(user.email.toLowerCase(), user.id)
      if (data.users.length < 1000) return byEmail
    }
  }

  /**
   * app_metadata (writable only with the service key) tells the sign-in pages which account type
   * to expect; the server still decides access from its own tables.
   */
  async ensureUser(
    existingId: string | null,
    email: string,
    password: string,
    kind: ActorKind,
  ): Promise<string> {
    const app_metadata = { account_kind: kind }
    if (existingId) {
      const { error } = await this.client.auth.admin.updateUserById(existingId, {
        password,
        app_metadata,
        ban_duration: 'none',
      })
      if (error) throw error
      return existingId
    }
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password,
      app_metadata,
      email_confirm: true,
    })
    if (error) throw error
    return data.user.id
  }

  async deleteUser(authUserId: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(authUserId)
    if (error) throw error
  }

  async ensureBuckets(): Promise<void> {
    const { data, error } = await this.client.storage.listBuckets()
    if (error) throw error
    const options = {
      public: false,
      fileSizeLimit: '5MB',
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    }
    for (const bucket of STORAGE_BUCKETS) {
      const result = data.some((existing) => existing.name === bucket)
        ? await this.client.storage.updateBucket(bucket, options)
        : await this.client.storage.createBucket(bucket, options)
      if (result.error) throw result.error
    }
  }

  async removeAll(): Promise<number> {
    let removed = 0
    for (const bucket of STORAGE_BUCKETS) {
      const rows = await this.sql.$queryRaw<{ name: string }[]>`
        SELECT name FROM storage.objects WHERE bucket_id = ${bucket}`
      const names = rows.map((row) => row.name)
      for (let start = 0; start < names.length; start += 100) {
        const { error } = await this.client.storage.from(bucket).remove(names.slice(start, start + 100))
        if (error) throw error
      }
      removed += names.length
    }
    return removed
  }
}
