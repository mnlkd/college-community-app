import { randomUUID } from 'node:crypto'
import {
  deleteAccountInputSchema,
  graduationInputSchema,
  pastGraduationYearSchema,
  profileInputSchema,
  roleDetailsIssues,
  type GraduationRequestView,
  type OwnAccountView,
  type ProfileView,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  DuplicateError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  isUniqueViolation,
  parseInput,
  type ActorContext,
  type AuditWriter,
  type Clock,
  type FileStorage,
  type ImageProcessing,
  type TransactionRunner,
  type Tx,
  type WarningLogger,
} from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import { toGraduationRequestView, type AccountViews } from './account-views.js'
import type { AuthProvider } from './auth-provider.js'
import { deleteMemberAccount, removeStoredFiles } from './account-deletion.js'
import type { AccountLifecyclePublisher } from './lifecycle.js'

export const PROFILE_PICTURE_FIELD = 'picture'
const PROFILE_BUCKET = 'profile-images'
const PENDING_GRADUATION = 'You already have a graduation request waiting for a decision.'

interface LockedAccount {
  id: string
  auth_user_id: string | null
  email: string | null
  role: 'STUDENT' | 'STAFF' | 'ALUMNI'
  state: 'ACTIVE' | 'DISABLED' | 'DELETED'
}

/** A member's own profile and account (ODD Table 8). */
export class AccountService {
  constructor(
    private readonly deps: {
      db: PrismaClient
      transactions: TransactionRunner
      clock: Clock
      authProvider: AuthProvider
      storage: FileStorage
      images: ImageProcessing
      notifications: NotificationService
      lifecycle: AccountLifecyclePublisher
      audit: AuditWriter
      views: AccountViews
      logger: WarningLogger
    },
  ) {}

  async getOwnAccount(actor: ActorContext): Promise<OwnAccountView> {
    return this.deps.views.ownAccount(this.memberId(actor))
  }

  /**
   * Public profile fields only. Restricted members have no access to other profiles; an
   * Administrator may view any. A deleted account has no profile.
   */
  async getProfile(actor: ActorContext, memberId: string): Promise<ProfileView> {
    if (actor.isMember && actor.accountId !== memberId && actor.isRestrictedAt(this.deps.clock.now())) {
      throw new PermissionDeniedError('Profiles are not available while your account is restricted.')
    }
    return this.deps.views.profile(memberId)
  }

  /** Also allowed during a restriction. Cannot change the role or Alumni status. */
  async updateProfile(actor: ActorContext, rawInput: unknown): Promise<ProfileView> {
    const memberId = this.memberId(actor)
    const input = parseInput(profileInputSchema, rawInput)
    await this.deps.transactions.run(async (tx) => {
      const account = await this.lockLive(tx, memberId)
      const issues = roleDetailsIssues(account.role, input, this.deps.clock.now().getUTCFullYear())
      if (Object.keys(issues).length > 0) throw new ValidationError(issues)
      const details = {
        bio: input.bio,
        studyOrExpertise: input.studyOrExpertise,
        graduationYear: input.graduationYear,
        currentPosition: input.currentPosition,
      }
      await tx.memberAccount.update({
        where: { id: memberId },
        data: { displayName: input.displayName, programme: input.programme },
      })
      await tx.profile.upsert({ where: { memberId }, create: { memberId, ...details }, update: details })
    })
    return this.deps.views.profile(memberId)
  }

  /** Stores the processed picture, then removes the old file. */
  async setProfilePicture(actor: ActorContext, file: Uint8Array): Promise<ProfileView> {
    const memberId = this.memberId(actor)
    const image = await this.deps.images.process(file, 'PROFILE', PROFILE_PICTURE_FIELD)
    const key = `${PROFILE_BUCKET}/${memberId}/${randomUUID()}.${image.extension}`
    await this.deps.storage.upload(key, image.bytes, image.contentType)

    let oldKey: string | null
    try {
      oldKey = await this.deps.transactions.run(async (tx) => {
        await this.lockLive(tx, memberId)
        const created = await tx.profileImage.create({
          data: { memberId, storageKey: key },
          select: { id: true },
        })
        return this.replacePicture(tx, memberId, created.id)
      })
    } catch (error) {
      await this.removeFiles([key])
      throw error
    }
    await this.removeFiles(oldKey ? [oldKey] : [])
    return this.deps.views.profile(memberId)
  }

  async removeProfilePicture(actor: ActorContext): Promise<ProfileView> {
    const memberId = this.memberId(actor)
    const oldKey = await this.deps.transactions.run(async (tx) => {
      await this.lockLive(tx, memberId)
      return this.replacePicture(tx, memberId, null)
    })
    await this.removeFiles(oldKey ? [oldKey] : [])
    return this.deps.views.profile(memberId)
  }

  /** Copies the email Supabase Auth confirmed (Change Account Email). */
  async syncEmail(actor: ActorContext): Promise<OwnAccountView> {
    const memberId = this.memberId(actor)
    try {
      await this.deps.transactions.run(async (tx) => {
        const account = await this.lockLive(tx, memberId)
        if (!account.auth_user_id) throw new NotFoundError('The account was not found.')
        const user = await this.deps.authProvider.getUser(account.auth_user_id)
        const email = user.email.toLowerCase()
        if (email === account.email) return
        const admin = await tx.administratorAccount.findUnique({ where: { email }, select: { id: true } })
        if (admin) throw new DuplicateError('This email is already in use.')
        await tx.memberAccount.update({ where: { id: memberId }, data: { email } })
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateError('This email is already in use.')
      throw error
    }
    return this.deps.views.ownAccount(memberId)
  }

  async listGraduationRequests(actor: ActorContext): Promise<GraduationRequestView[]> {
    const rows = await this.deps.db.graduationRequest.findMany({
      where: { memberId: this.memberId(actor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return rows.map(toGraduationRequestView)
  }

  /** A Student claims to have completed a programme; at most one request waits at a time. */
  async requestGraduation(actor: ActorContext, rawInput: unknown): Promise<GraduationRequestView> {
    const memberId = this.memberId(actor)
    const input = parseInput(graduationInputSchema, rawInput)
    const year = pastGraduationYearSchema(this.deps.clock.now().getUTCFullYear()).safeParse(
      input.graduationYear,
    )
    if (!year.success) {
      throw new ValidationError({ graduationYear: year.error.issues[0]?.message ?? 'Not valid' })
    }
    try {
      const request = await this.deps.transactions.run(async (tx) => {
        const account = await this.lockLive(tx, memberId)
        if (account.role !== 'STUDENT') {
          throw new PermissionDeniedError('Only Students can request Alumni status.')
        }
        const pending = await tx.graduationRequest.findFirst({
          where: { memberId, decision: 'PENDING' },
          select: { id: true },
        })
        if (pending) throw new DuplicateError(PENDING_GRADUATION)
        return tx.graduationRequest.create({
          data: { memberId, programme: input.programme, graduationYear: input.graduationYear },
        })
      })
      return toGraduationRequestView(request)
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateError(PENDING_GRADUATION)
      throw error
    }
  }

  /** After password confirmation, deletes the account (see deleteMemberAccount). */
  async deleteOwnAccount(actor: ActorContext, rawInput: unknown): Promise<void> {
    const memberId = this.memberId(actor)
    const { currentPassword } = parseInput(deleteAccountInputSchema, rawInput)
    const current = await this.deps.db.memberAccount.findUnique({
      where: { id: memberId },
      select: { email: true },
    })
    if (!current?.email) throw new NotFoundError('The account was not found.')
    if (!(await this.deps.authProvider.verifyPassword(current.email, currentPassword))) {
      throw new ValidationError({ currentPassword: 'The password is not correct.' })
    }

    const keys = await this.deps.transactions.run(async (tx) => {
      const account = await this.lockLive(tx, memberId)
      return deleteMemberAccount(tx, this.deps, { id: memberId, authUserId: account.auth_user_id })
    })
    await this.removeFiles(keys)
  }

  private memberId(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  /** Locks the account row; only an ACTIVE account may change itself. */
  private async lockLive(tx: Tx, memberId: string): Promise<LockedAccount> {
    const rows = await tx.$queryRaw<LockedAccount[]>`
      SELECT id, auth_user_id, email, role, state FROM member_account WHERE id = ${memberId}::uuid FOR UPDATE`
    const account = rows[0]
    if (!account) throw new NotFoundError('The account was not found.')
    if (account.state !== 'ACTIVE') throw new PermissionDeniedError('This account is not active.')
    return account
  }

  /** Points the profile at the new image (or none) and deletes the old image row; returns its key. */
  private async replacePicture(tx: Tx, memberId: string, imageId: string | null): Promise<string | null> {
    const profile = await tx.profile.findUnique({
      where: { memberId },
      select: { profileImage: { select: { id: true, storageKey: true } } },
    })
    await tx.profile.upsert({
      where: { memberId },
      create: { memberId, profileImageId: imageId },
      update: { profileImageId: imageId },
    })
    const old = profile?.profileImage
    if (!old) return null
    await tx.profileImage.delete({ where: { id: old.id } })
    return old.storageKey
  }

  private async removeFiles(keys: string[]): Promise<void> {
    await removeStoredFiles(this.deps.storage, this.deps.logger, keys)
  }
}
