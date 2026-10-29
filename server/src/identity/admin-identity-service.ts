import {
  administratorInputSchema,
  adminMemberQuerySchema,
  alumniDecisionInputSchema,
  emailSchema,
  expectedGraduationYearSchema,
  graduationDecisionInputSchema,
  isInstitutionalEmail,
  memberEmailUpdateInputSchema,
  pageRequestSchema,
  pastGraduationYearSchema,
  reasonInputSchema,
  roleCorrectionInputSchema,
  staffEmailInputSchema,
  staffEmailQuerySchema,
  type AccountState,
  type AdministratorView,
  type AdminMemberSummaryView,
  type AdminMemberView,
  type AlumniReviewView,
  type AlumniStatus,
  type Page,
  type PendingGraduationView,
  type RoleChangeBlockerView,
  type Programme,
  type Role,
  type StaffEmailView,
} from '@hilcoe/shared'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import {
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
  type AuditWriter,
  type Clock,
  type FileStorage,
  type TransactionRunner,
  type Tx,
  type WarningLogger,
} from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import { deleteMemberAccount, removeStoredFiles } from './account-deletion.js'
import type { AuthProvider } from './auth-provider.js'
import { hashEmail } from './email-hash.js'
import type { AccountLifecycleEvent, AccountLifecyclePublisher } from './lifecycle.js'

/** NFR-9: the platform always keeps at least this many Administrators. */
export const MIN_ADMINISTRATORS = 2

const EMAIL_IN_USE = 'This email is already in use.'
const MEMBER_NOT_FOUND = 'The account was not found.'
const ADMIN_NOT_FOUND = 'The Administrator was not found.'

interface LockedMember {
  id: string
  auth_user_id: string | null
  email: string
  display_name: string
  role: Role
  alumni_status: AlumniStatus | null
  programme: Programme | null
  state: Exclude<AccountState, 'DELETED'>
}

interface LockedAdmin {
  id: string
  auth_user_id: string
  email: string
  is_first_admin: boolean
}

const SUMMARY_SELECT = {
  id: true,
  displayName: true,
  email: true,
  role: true,
  alumniStatus: true,
  programme: true,
  state: true,
  createdAt: true,
} as const

type SummaryRow = Prisma.MemberAccountGetPayload<{ select: typeof SUMMARY_SELECT }>

const REVIEW_INCLUDE = {
  member: {
    select: {
      displayName: true,
      email: true,
      programme: true,
      profile: { select: { graduationYear: true } },
    },
  },
} as const

type ReviewRow = Prisma.AlumniReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>

const GRADUATION_INCLUDE = {
  member: { select: { displayName: true, email: true, programme: true } },
} as const

type GraduationRow = Prisma.GraduationRequestGetPayload<{ include: typeof GRADUATION_INCLUDE }>

function toSummary(row: SummaryRow): AdminMemberSummaryView {
  return {
    id: row.id,
    displayName: row.displayName ?? '',
    email: row.email ?? '',
    role: row.role,
    alumniStatus: row.alumniStatus,
    programme: row.programme,
    state: row.state === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    createdAt: row.createdAt.toISOString(),
  }
}

function toReviewView(row: ReviewRow): AlumniReviewView {
  return {
    id: row.id,
    memberId: row.memberId,
    displayName: row.member.displayName ?? '',
    email: row.member.email ?? '',
    registrationPath: row.registrationPath,
    claimedFullName: row.claimedFullName,
    identifyingContext: row.identifyingContext,
    programme: row.member.programme,
    graduationYear: row.member.profile?.graduationYear ?? null,
    decision: row.decision,
    createdAt: row.createdAt.toISOString(),
  }
}

function toGraduationView(row: GraduationRow, blockers: RoleChangeBlockerView[]): PendingGraduationView {
  return {
    blockers,
    id: row.id,
    memberId: row.memberId,
    displayName: row.member.displayName ?? '',
    email: row.member.email ?? '',
    currentProgramme: row.member.programme,
    programme: row.programme,
    graduationYear: row.graduationYear,
    decision: row.decision,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Pending Alumni reviews of accounts still waiting for one. */
const PENDING_REVIEW_WHERE = {
  decision: 'PENDING',
  member: { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED', state: { not: 'DELETED' } },
} as const satisfies Prisma.AlumniReviewWhereInput

const PENDING_GRADUATION_WHERE = {
  decision: 'PENDING',
  member: { role: 'STUDENT', state: { not: 'DELETED' } },
} as const satisfies Prisma.GraduationRequestWhereInput

/**
 * Administrator identity controls (ODD Table 8). Every change locks the rows it depends on,
 * re-checks their state and writes the audit record in the same transaction (NFR-7). External
 * Supabase Auth changes run last inside the transaction, so a failure rolls the change back.
 */
export class AdminIdentityService {
  constructor(
    private readonly deps: {
      db: PrismaClient
      transactions: TransactionRunner
      clock: Clock
      authProvider: AuthProvider
      storage: FileStorage
      notifications: NotificationService
      lifecycle: AccountLifecyclePublisher
      audit: AuditWriter
      logger: WarningLogger
      emailHashSecret: string
    },
  ) {}

  // Reads for the Administrator screens

  async listMembers(actor: ActorContext, rawQuery: unknown): Promise<Page<AdminMemberSummaryView>> {
    this.assertAdministrator(actor)
    const query = parseInput(adminMemberQuerySchema, rawQuery)
    const where: Prisma.MemberAccountWhereInput = {
      state: query.filter === 'DISABLED' ? 'DISABLED' : { not: 'DELETED' },
      ...(query.filter === 'FLAGGED' ? { role: 'ALUMNI', alumniStatus: 'FLAGGED' } : {}),
      ...(query.query
        ? {
            OR: [
              { displayName: { contains: query.query, mode: 'insensitive' } },
              { email: { contains: query.query.toLowerCase() } },
            ],
          }
        : {}),
    }
    const [rows, total] = await Promise.all([
      this.deps.db.memberAccount.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(query),
      }),
      this.deps.db.memberAccount.count({ where }),
    ])
    return toPage(rows.map(toSummary), query, total)
  }

  async getMember(actor: ActorContext, memberId: string): Promise<AdminMemberView> {
    this.assertAdministrator(actor)
    const row = await this.deps.db.memberAccount.findUnique({
      where: { id: memberId },
      select: {
        ...SUMMARY_SELECT,
        profile: { select: { studyOrExpertise: true, graduationYear: true, currentPosition: true } },
      },
    })
    if (!row || row.state === 'DELETED') throw new NotFoundError(MEMBER_NOT_FOUND)
    const [review, request] = await Promise.all([
      this.deps.db.alumniReview.findFirst({
        where: { memberId, ...PENDING_REVIEW_WHERE },
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.deps.db.graduationRequest.findFirst({
        where: { memberId, ...PENDING_GRADUATION_WHERE },
        include: GRADUATION_INCLUDE,
      }),
    ])
    return {
      ...toSummary(row),
      studyOrExpertise: row.profile?.studyOrExpertise ?? null,
      graduationYear: row.profile?.graduationYear ?? null,
      currentPosition: row.profile?.currentPosition ?? null,
      pendingAlumniReview: review ? toReviewView(review) : null,
      pendingGraduationRequest: request ? await this.graduationView(request) : null,
    }
  }

  /** Oldest first, so no review waits behind newer ones. */
  async listAlumniReviews(actor: ActorContext, rawPage: unknown): Promise<Page<AlumniReviewView>> {
    this.assertAdministrator(actor)
    const page = parseInput(pageRequestSchema, rawPage)
    const [rows, total] = await Promise.all([
      this.deps.db.alumniReview.findMany({
        where: PENDING_REVIEW_WHERE,
        include: REVIEW_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(page),
      }),
      this.deps.db.alumniReview.count({ where: PENDING_REVIEW_WHERE }),
    ])
    return toPage(rows.map(toReviewView), page, total)
  }

  async listGraduationRequests(actor: ActorContext, rawPage: unknown): Promise<Page<PendingGraduationView>> {
    this.assertAdministrator(actor)
    const page = parseInput(pageRequestSchema, rawPage)
    const [rows, total] = await Promise.all([
      this.deps.db.graduationRequest.findMany({
        where: PENDING_GRADUATION_WHERE,
        include: GRADUATION_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(page),
      }),
      this.deps.db.graduationRequest.count({ where: PENDING_GRADUATION_WHERE }),
    ])
    const views = await Promise.all(rows.map((row) => this.graduationView(row)))
    return toPage(views, page, total)
  }

  /** Lists what would refuse the role change now, so the reviewer sees it before deciding. */
  private async graduationView(row: GraduationRow): Promise<PendingGraduationView> {
    return toGraduationView(row, await this.deps.lifecycle.describeBlockers(this.deps.db, row.memberId))
  }

  async listStaffEmails(actor: ActorContext, rawQuery: unknown): Promise<Page<StaffEmailView>> {
    this.assertAdministrator(actor)
    const query = parseInput(staffEmailQuerySchema, rawQuery)
    const where: Prisma.StaffEmailEntryWhereInput = {
      active: true,
      ...(query.query ? { email: { contains: query.query.toLowerCase() } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.deps.db.staffEmailEntry.findMany({
        where,
        select: { email: true, updatedAt: true },
        orderBy: { email: 'asc' },
        ...pageWindow(query),
      }),
      this.deps.db.staffEmailEntry.count({ where }),
    ])
    return toPage(
      rows.map((row) => ({ email: row.email, updatedAt: row.updatedAt.toISOString() })),
      query,
      total,
    )
  }

  async listAdministrators(actor: ActorContext): Promise<AdministratorView[]> {
    this.assertAdministrator(actor)
    const rows = await this.deps.db.administratorAccount.findMany({
      select: { id: true, email: true, isFirstAdmin: true, createdAt: true },
      orderBy: [{ isFirstAdmin: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => this.toAdministratorView(actor, row))
  }

  // Review Alumni Affiliation and Confirm Graduation

  /** Sets VERIFIED or FLAGGED and notifies the member; the reason stays private. */
  async reviewAlumni(actor: ActorContext, reviewId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const input = parseInput(alumniDecisionInputSchema, rawInput)
    const found = await this.deps.db.alumniReview.findUnique({
      where: { id: reviewId },
      select: { memberId: true },
    })
    if (!found) throw new NotFoundError('The review was not found.')

    await this.deps.transactions.run(async (tx) => {
      const member = await this.lockMember(tx, found.memberId)
      const rows = await tx.$queryRaw<{ decision: string }[]>`
        SELECT decision FROM alumni_review WHERE id = ${reviewId}::uuid FOR UPDATE`
      if (rows[0]?.decision !== 'PENDING') throw new ConflictError('This review has already been decided.')
      if (member.role !== 'ALUMNI' || member.alumni_status !== 'SELF_REPORTED') {
        throw new ConflictError('This account is no longer waiting for an Alumni review.')
      }
      const now = this.deps.clock.now()
      await tx.alumniReview.update({
        where: { id: reviewId },
        data: {
          decision: input.decision,
          privateReason: input.reason,
          reviewedByAdminId: actor.accountId,
          decidedAt: now,
        },
      })
      await tx.memberAccount.update({ where: { id: member.id }, data: { alumniStatus: input.decision } })
      await this.deps.audit.record(tx, {
        actor,
        action: 'ALUMNI_REVIEWED',
        targetMemberId: member.id,
        reason: input.reason,
      })
      await this.deps.notifications.notify(tx, {
        recipientId: member.id,
        type: 'ALUMNI_DECISION',
        eventKey: `alumni-review:${reviewId}`,
        actorId: null,
        targetType: 'ALUMNI_REVIEW',
        targetId: reviewId,
      })
    })
  }

  /**
   * CONFIRMED runs beforeRoleChange, makes the Student a Verified Alumni with the requested
   * programme and year and publishes GRADUATION_CONFIRMED; DECLINED changes nothing else.
   */
  async decideGraduation(actor: ActorContext, requestId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const input = parseInput(graduationDecisionInputSchema, rawInput)
    const found = await this.deps.db.graduationRequest.findUnique({
      where: { id: requestId },
      select: { memberId: true },
    })
    if (!found) throw new NotFoundError('The graduation request was not found.')

    await this.deps.transactions.run(async (tx) => {
      const member = await this.lockMember(tx, found.memberId)
      const rows = await tx.$queryRaw<{ decision: string; programme: Programme; graduation_year: number }[]>`
        SELECT decision, programme, graduation_year FROM graduation_request
        WHERE id = ${requestId}::uuid FOR UPDATE`
      const request = rows[0]
      if (request?.decision !== 'PENDING') {
        throw new ConflictError('This graduation request has already been decided.')
      }
      if (member.role !== 'STUDENT') throw new ConflictError('This account is no longer a Student.')
      const now = this.deps.clock.now()

      if (input.decision === 'CONFIRMED') {
        if (member.state !== 'ACTIVE') {
          throw new ConflictError('Restore the account before confirming the graduation.')
        }
        const event: AccountLifecycleEvent = {
          kind: 'GRADUATION_CONFIRMED',
          memberId: member.id,
          newRole: 'ALUMNI',
          occurredAt: now,
        }
        await this.deps.lifecycle.beforeRoleChange(tx, event)
        await tx.memberAccount.update({
          where: { id: member.id },
          data: { role: 'ALUMNI', alumniStatus: 'VERIFIED', programme: request.programme },
        })
        await tx.profile.upsert({
          where: { memberId: member.id },
          create: { memberId: member.id, graduationYear: request.graduation_year },
          update: { graduationYear: request.graduation_year },
        })
        await this.deps.lifecycle.publish(tx, event)
      }

      await tx.graduationRequest.update({
        where: { id: requestId },
        data: {
          decision: input.decision,
          privateReason: input.reason,
          reviewedByAdminId: actor.accountId,
          decidedAt: now,
        },
      })
      await this.deps.audit.record(tx, {
        actor,
        action: 'GRADUATION_DECIDED',
        targetMemberId: member.id,
        reason: input.reason,
      })
      await this.deps.notifications.notify(tx, {
        recipientId: member.id,
        type: 'GRADUATION_DECISION',
        eventKey: `graduation-request:${requestId}`,
        actorId: null,
        targetType: 'GRADUATION_REQUEST',
        targetId: requestId,
      })
    })
  }

  // Maintain Staff Email List

  /** Adds or re-activates an entry. Existing accounts keep their role. */
  async addStaffEmail(actor: ActorContext, rawInput: unknown): Promise<StaffEmailView> {
    this.assertAdministrator(actor)
    const { email } = parseInput(staffEmailInputSchema, rawInput)
    try {
      const row = await this.deps.transactions.run(async (tx) => {
        const rows = await tx.$queryRaw<{ active: boolean }[]>`
          SELECT active FROM staff_email_entry WHERE email = ${email} FOR UPDATE`
        if (rows[0]?.active) throw new DuplicateError('This email is already on the Staff list.')
        const entry = await tx.staffEmailEntry.upsert({
          where: { email },
          create: { email, active: true, maintainedByAdminId: actor.accountId },
          update: { active: true, maintainedByAdminId: actor.accountId },
          select: { email: true, updatedAt: true },
        })
        await this.deps.audit.record(tx, { actor, action: 'STAFF_EMAIL_ADDED' })
        return entry
      })
      return { email: row.email, updatedAt: row.updatedAt.toISOString() }
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateError('This email is already on the Staff list.')
      throw error
    }
  }

  /** Deactivates the entry. Existing accounts keep their role; use correctRole for those. */
  async removeStaffEmail(actor: ActorContext, rawEmail: string): Promise<void> {
    this.assertAdministrator(actor)
    const parsed = emailSchema.safeParse(rawEmail)
    if (!parsed.success) throw new NotFoundError('This email is not on the Staff list.')
    const email = parsed.data
    await this.deps.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<{ active: boolean }[]>`
        SELECT active FROM staff_email_entry WHERE email = ${email} FOR UPDATE`
      if (!rows[0]?.active) throw new NotFoundError('This email is not on the Staff list.')
      await tx.staffEmailEntry.update({
        where: { email },
        data: { active: false, maintainedByAdminId: actor.accountId },
      })
      await this.deps.audit.record(tx, { actor, action: 'STAFF_EMAIL_REMOVED' })
    })
  }

  // Correct Community Role

  /**
   * Changes the role once beforeRoleChange passes and publishes ROLE_CORRECTED. Students and
   * Staff need an @hilcoeschool.com account email. The Alumni status itself can change here only
   * from FLAGGED; a SELF_REPORTED result opens a new Alumni review. Profile details the new role
   * cannot keep are cleared; the member fills the missing ones on their next profile edit.
   */
  async correctRole(actor: ActorContext, memberId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const input = parseInput(roleCorrectionInputSchema, rawInput)

    await this.deps.transactions.run(async (tx) => {
      const member = await this.lockMember(tx, memberId)
      const roleChanged = input.newRole !== member.role
      if (!roleChanged) {
        if (input.newRole !== 'ALUMNI') throw new ConflictError('The account already has this role.')
        if (member.alumni_status !== 'FLAGGED') {
          throw new ConflictError('Only a Flagged Alumni status can be changed by a role correction.')
        }
      }
      if ((input.newRole === 'STUDENT' || input.newRole === 'STAFF') && !isInstitutionalEmail(member.email)) {
        throw new ValidationError({
          newRole: 'Students and Staff need an @hilcoeschool.com account email. Update the email first.',
        })
      }
      const [pendingReview, pendingRequest] = await Promise.all([
        tx.alumniReview.findFirst({ where: { memberId, decision: 'PENDING' }, select: { id: true } }),
        tx.graduationRequest.findFirst({ where: { memberId, decision: 'PENDING' }, select: { id: true } }),
      ])
      if (pendingReview) throw new ConflictError('Decide the pending Alumni review first.')
      if (pendingRequest) throw new ConflictError('Decide the pending graduation request first.')

      const now = this.deps.clock.now()
      const event: AccountLifecycleEvent = {
        kind: 'ROLE_CORRECTED',
        memberId,
        newRole: input.newRole,
        occurredAt: now,
      }
      if (roleChanged) await this.deps.lifecycle.beforeRoleChange(tx, event)

      const profile = await tx.profile.findUnique({ where: { memberId }, select: { graduationYear: true } })
      let programme = member.programme
      let graduationYear = profile?.graduationYear ?? null
      if (input.newRole === 'STAFF') {
        programme = null
        graduationYear = null
      } else if (graduationYear !== null) {
        const year = now.getUTCFullYear()
        const schema =
          input.newRole === 'STUDENT' ? expectedGraduationYearSchema(year) : pastGraduationYearSchema(year)
        if (!schema.safeParse(graduationYear).success) graduationYear = null
      }
      await tx.memberAccount.update({
        where: { id: memberId },
        data: { role: input.newRole, alumniStatus: input.alumniStatus, programme },
      })
      await tx.profile.upsert({
        where: { memberId },
        create: { memberId, graduationYear },
        update: { graduationYear },
      })
      if (input.alumniStatus === 'SELF_REPORTED') {
        await tx.alumniReview.create({
          data: {
            memberId,
            registrationPath: isInstitutionalEmail(member.email) ? 'INSTITUTIONAL_EMAIL' : 'PERSONAL_EMAIL',
            claimedFullName: member.display_name,
          },
        })
      }
      if (roleChanged) await this.deps.lifecycle.publish(tx, event)
      await this.deps.audit.record(tx, {
        actor,
        action: 'ROLE_CORRECTED',
        targetMemberId: memberId,
        reason: input.reason,
      })
    })
  }

  // Update Member Email

  /** Replaces the email in the account and in Supabase Auth; the member then resets the password. */
  async updateMemberEmail(actor: ActorContext, memberId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const { newEmail, reason } = parseInput(memberEmailUpdateInputSchema, rawInput)
    try {
      await this.deps.transactions.run(async (tx) => {
        const member = await this.lockMember(tx, memberId)
        if (member.email === newEmail) {
          throw new ValidationError({ newEmail: 'This is already the account email.' })
        }
        const [admin, other, blocked] = await Promise.all([
          tx.administratorAccount.findUnique({ where: { email: newEmail }, select: { id: true } }),
          tx.memberAccount.findUnique({ where: { email: newEmail }, select: { id: true } }),
          tx.blockedEmailHash.findUnique({
            where: { emailHmac: hashEmail(newEmail, this.deps.emailHashSecret) },
            select: { emailHmac: true },
          }),
        ])
        if (admin || other) throw new DuplicateError(EMAIL_IN_USE)
        if (blocked) throw new ValidationError({ newEmail: 'This email belongs to a deleted fake account.' })
        await tx.memberAccount.update({ where: { id: memberId }, data: { email: newEmail } })
        await this.deps.audit.record(tx, {
          actor,
          action: 'MEMBER_EMAIL_UPDATED',
          targetMemberId: memberId,
          reason,
        })
        if (member.auth_user_id) await this.deps.authProvider.updateEmail(member.auth_user_id, newEmail)
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateError(EMAIL_IN_USE)
      throw error
    }
  }

  // Investigate Impersonation, Restore Account, Delete Confirmed Fake Account

  /** Sets DISABLED, bans the Supabase user and ends its sessions; data and relationships stay. */
  async disableAccount(actor: ActorContext, memberId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const { reason } = parseInput(reasonInputSchema, rawInput)
    await this.deps.transactions.run(async (tx) => {
      const member = await this.lockMember(tx, memberId)
      if (member.state !== 'ACTIVE') throw new ConflictError('The account is already disabled.')
      await tx.memberAccount.update({ where: { id: memberId }, data: { state: 'DISABLED' } })
      await this.deps.audit.record(tx, {
        actor,
        action: 'ACCOUNT_DISABLED',
        targetMemberId: memberId,
        reason,
      })
      if (member.auth_user_id) {
        await this.deps.authProvider.banUser(member.auth_user_id)
        await this.deps.authProvider.signOutAll(member.auth_user_id)
      }
    })
  }

  /** Reverses disableAccount; restrictions from moderation stay as they were. */
  async restoreAccount(actor: ActorContext, memberId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const { reason } = parseInput(reasonInputSchema, rawInput)
    await this.deps.transactions.run(async (tx) => {
      const member = await this.lockMember(tx, memberId)
      if (member.state !== 'DISABLED') throw new ConflictError('The account is not disabled.')
      await tx.memberAccount.update({ where: { id: memberId }, data: { state: 'ACTIVE' } })
      await this.deps.audit.record(tx, {
        actor,
        action: 'ACCOUNT_RESTORED',
        targetMemberId: memberId,
        reason,
      })
      if (member.auth_user_id) await this.deps.authProvider.unbanUser(member.auth_user_id)
    })
  }

  /** Deletes the account as deleteOwnAccount does and keeps only a keyed hash of its email (NFR-8). */
  async deleteFakeAccount(actor: ActorContext, memberId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const { reason } = parseInput(reasonInputSchema, rawInput)
    const keys = await this.deps.transactions.run(async (tx) => {
      const member = await this.lockMember(tx, memberId)
      await tx.blockedEmailHash.createMany({
        data: [
          {
            emailHmac: hashEmail(member.email, this.deps.emailHashSecret),
            blockedByAdminId: actor.accountId,
            createdAt: this.deps.clock.now(),
          },
        ],
        skipDuplicates: true,
      })
      await this.deps.audit.record(tx, {
        actor,
        action: 'FAKE_ACCOUNT_DELETED',
        targetMemberId: memberId,
        reason,
      })
      return deleteMemberAccount(tx, this.deps, { id: memberId, authUserId: member.auth_user_id })
    })
    await removeStoredFiles(this.deps.storage, this.deps.logger, keys)
  }

  // Create Administrator, Reset Administrator MFA, Remove Administrator

  /**
   * Invites the college email through Supabase Auth, then records the account. The new
   * Administrator sets a password and enrolls TOTP before any access (totpRequired).
   */
  async createAdministrator(actor: ActorContext, rawInput: unknown): Promise<AdministratorView> {
    this.assertAdministrator(actor)
    const { email } = parseInput(administratorInputSchema, rawInput)
    await this.assertEmailFree(this.deps.db, email)
    const authUserId = await this.deps.authProvider.inviteUser(email, 'ADMIN')
    try {
      const admin = await this.deps.transactions.run(async (tx) => {
        await this.assertEmailFree(tx, email)
        const created = await tx.administratorAccount.create({
          data: { authUserId, email, createdByAdminId: actor.accountId },
          select: { id: true, email: true, isFirstAdmin: true, createdAt: true },
        })
        await this.deps.audit.record(tx, {
          actor,
          action: 'ADMINISTRATOR_CREATED',
          targetAdminId: created.id,
        })
        return created
      })
      return this.toAdministratorView(actor, admin)
    } catch (error) {
      await this.deps.authProvider.deleteUser(authUserId).catch((cause: unknown) => {
        this.deps.logger.warn({ err: cause }, 'could not delete an invited user after a failed create')
      })
      if (isUniqueViolation(error)) throw new DuplicateError(EMAIL_IN_USE)
      throw error
    }
  }

  /** Removes another Administrator's second factors and ends their sessions. */
  async resetAdministratorMfa(actor: ActorContext, adminId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const { reason } = parseInput(reasonInputSchema, rawInput)
    if (adminId === actor.accountId) {
      throw new PermissionDeniedError('Another Administrator must reset your authenticator.')
    }
    await this.deps.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<LockedAdmin[]>`
        SELECT id, auth_user_id, email, is_first_admin FROM administrator_account
        WHERE id = ${adminId}::uuid FOR UPDATE`
      const target = rows[0]
      if (!target) throw new NotFoundError(ADMIN_NOT_FOUND)
      await tx.adminSession.deleteMany({ where: { adminId } })
      await this.deps.audit.record(tx, {
        actor,
        action: 'ADMINISTRATOR_MFA_RESET',
        targetAdminId: adminId,
        reason,
      })
      await this.deps.authProvider.removeMfaFactors(target.auth_user_id)
      await this.deps.authProvider.signOutAll(target.auth_user_id)
    })
  }

  /**
   * First Administrator only. Keeps at least two Administrators, never removes the first one,
   * anonymizes the removed account in the audit record and deletes its Supabase user.
   */
  async removeAdministrator(actor: ActorContext, adminId: string, rawInput: unknown): Promise<void> {
    this.assertAdministrator(actor)
    const { reason } = parseInput(reasonInputSchema, rawInput)
    if (!actor.isFirstAdmin) {
      throw new PermissionDeniedError('Only the first Administrator can remove Administrators.')
    }
    await this.deps.transactions.run(async (tx) => {
      // Every row is locked, so concurrent removals cannot both pass the two-Administrator check.
      const admins = await tx.$queryRaw<LockedAdmin[]>`
        SELECT id, auth_user_id, email, is_first_admin FROM administrator_account ORDER BY id FOR UPDATE`
      if (!admins.find((admin) => admin.id === actor.accountId)?.is_first_admin) {
        throw new PermissionDeniedError('Only the first Administrator can remove Administrators.')
      }
      const target = admins.find((admin) => admin.id === adminId)
      if (!target) throw new NotFoundError(ADMIN_NOT_FOUND)
      if (target.is_first_admin) throw new PermissionDeniedError('The first Administrator cannot be removed.')
      if (admins.length - 1 < MIN_ADMINISTRATORS) {
        throw new ConflictError(`At least ${MIN_ADMINISTRATORS} Administrators must remain.`)
      }
      await this.deps.audit.record(tx, {
        actor,
        action: 'ADMINISTRATOR_REMOVED',
        targetAdminId: adminId,
        reason,
      })
      await this.deps.audit.anonymize(tx, adminId)
      await tx.administratorAccount.delete({ where: { id: adminId } })
      await this.deps.authProvider.deleteUser(target.auth_user_id)
    })
  }

  /**
   * Copies the email Supabase Auth confirmed to the Administrator's own account. Administrators
   * keep an @hilcoeschool.com email.
   */
  async syncOwnEmail(actor: ActorContext): Promise<AdministratorView> {
    this.assertAdministrator(actor)
    try {
      const admin = await this.deps.transactions.run(async (tx) => {
        const rows = await tx.$queryRaw<LockedAdmin[]>`
          SELECT id, auth_user_id, email, is_first_admin FROM administrator_account
          WHERE id = ${actor.accountId}::uuid FOR UPDATE`
        const current = rows[0]
        if (!current) throw new NotFoundError(ADMIN_NOT_FOUND)
        const user = await this.deps.authProvider.getUser(current.auth_user_id)
        const email = user.email.toLowerCase()
        if (email !== current.email) {
          if (!isInstitutionalEmail(email)) {
            throw new ValidationError({ email: 'Administrators use an @hilcoeschool.com email.' })
          }
          const member = await tx.memberAccount.findUnique({ where: { email }, select: { id: true } })
          if (member) throw new DuplicateError(EMAIL_IN_USE)
          await tx.administratorAccount.update({ where: { id: current.id }, data: { email } })
          await this.deps.audit.record(tx, {
            actor,
            action: 'ADMINISTRATOR_EMAIL_CHANGED',
            targetAdminId: current.id,
          })
        }
        return tx.administratorAccount.findUniqueOrThrow({
          where: { id: current.id },
          select: { id: true, email: true, isFirstAdmin: true, createdAt: true },
        })
      })
      return this.toAdministratorView(actor, admin)
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateError(EMAIL_IN_USE)
      throw error
    }
  }

  private assertAdministrator(actor: ActorContext): void {
    if (!actor.isAdministrator) throw new PermissionDeniedError('This is for Administrators.')
  }

  /** Locks a member row; a deleted or unknown account is not found. */
  private async lockMember(tx: Tx, memberId: string): Promise<LockedMember> {
    const rows = await tx.$queryRaw<
      (Omit<LockedMember, 'state' | 'email' | 'display_name'> & {
        state: AccountState
        email: string | null
        display_name: string | null
      })[]
    >`
      SELECT id, auth_user_id, email, display_name, role, alumni_status, programme, state
      FROM member_account WHERE id = ${memberId}::uuid FOR UPDATE`
    const row = rows[0]
    if (!row || row.state === 'DELETED' || !row.email || !row.display_name) {
      throw new NotFoundError(MEMBER_NOT_FOUND)
    }
    return { ...row, state: row.state, email: row.email, display_name: row.display_name }
  }

  private async assertEmailFree(db: Tx | PrismaClient, email: string): Promise<void> {
    const [admin, member] = await Promise.all([
      db.administratorAccount.findUnique({ where: { email }, select: { id: true } }),
      db.memberAccount.findUnique({ where: { email }, select: { id: true } }),
    ])
    if (admin || member) throw new DuplicateError(EMAIL_IN_USE)
  }

  private toAdministratorView(
    actor: ActorContext,
    row: { id: string; email: string; isFirstAdmin: boolean; createdAt: Date },
  ): AdministratorView {
    return {
      id: row.id,
      email: row.email,
      isFirstAdmin: row.isFirstAdmin,
      isSelf: row.id === actor.accountId,
      createdAt: row.createdAt.toISOString(),
    }
  }
}
