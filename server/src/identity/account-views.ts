import {
  DELETED_USER_NAME,
  type GraduationRequestView,
  type MemberCardView,
  type OwnAccountView,
  type ProfileView,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import { NotFoundError, type FileStorage } from '../kernel/index.js'

const PROFILE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  alumniStatus: true,
  programme: true,
  state: true,
  profile: {
    select: {
      bio: true,
      studyOrExpertise: true,
      graduationYear: true,
      currentPosition: true,
      profileImage: { select: { storageKey: true } },
    },
  },
} as const

export function toGraduationRequestView(row: {
  id: string
  programme: GraduationRequestView['programme']
  graduationYear: number
  decision: GraduationRequestView['decision']
  createdAt: Date
  decidedAt: Date | null
}): GraduationRequestView {
  return {
    id: row.id,
    programme: row.programme,
    graduationYear: row.graduationYear,
    decision: row.decision,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  }
}

/** Builds the account and profile views; the only place that decides which fields are public. */
export class AccountViews {
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: FileStorage,
  ) {}

  /** The given storage keys that a profile picture still refers to (orphan file sweep). */
  async findStoredKeys(keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set()
    const rows = await this.db.profileImage.findMany({
      where: { storageKey: { in: [...keys] } },
      select: { storageKey: true },
    })
    return new Set(rows.map((row) => row.storageKey))
  }

  /** The given Supabase Auth users that a member or Administrator account refers to. */
  async linkedAuthUserIds(authUserIds: readonly string[]): Promise<Set<string>> {
    if (authUserIds.length === 0) return new Set()
    const ids = [...authUserIds]
    const [members, admins] = await Promise.all([
      this.db.memberAccount.findMany({ where: { authUserId: { in: ids } }, select: { authUserId: true } }),
      this.db.administratorAccount.findMany({
        where: { authUserId: { in: ids } },
        select: { authUserId: true },
      }),
    ])
    return new Set([...members, ...admins].flatMap((row) => (row.authUserId ? [row.authUserId] : [])))
  }

  /** Public fields only. A deleted account has no profile. */
  async profile(memberId: string): Promise<ProfileView> {
    const profile = (await this.profiles([memberId])).get(memberId)
    if (!profile) throw new NotFoundError('The profile was not found.')
    return profile
  }

  /** Public profiles of the given members; deleted and unknown accounts are left out. */
  async profiles(memberIds: readonly string[]): Promise<Map<string, ProfileView>> {
    const ids = [...new Set(memberIds)]
    if (ids.length === 0) return new Map()
    const rows = await this.db.memberAccount.findMany({
      where: { id: { in: ids }, state: { not: 'DELETED' }, displayName: { not: null } },
      select: PROFILE_SELECT,
    })
    const keys = rows.flatMap((row) => {
      const key = row.profile?.profileImage?.storageKey
      return key ? [key] : []
    })
    const urls = keys.length > 0 ? await this.storage.createSignedUrls(keys) : new Map<string, string>()
    const views = new Map<string, ProfileView>()
    for (const account of rows) {
      const profile = account.profile
      const key = profile?.profileImage?.storageKey
      views.set(account.id, {
        memberId: account.id,
        displayName: account.displayName ?? DELETED_USER_NAME,
        role: account.role,
        alumniStatus: account.alumniStatus,
        programme: account.programme,
        bio: profile?.bio ?? null,
        studyOrExpertise: profile?.studyOrExpertise ?? null,
        graduationYear: profile?.graduationYear ?? null,
        currentPosition: profile?.currentPosition ?? null,
        pictureUrl: key ? (urls.get(key) ?? null) : null,
      })
    }
    return views
  }

  /**
   * How members appear beside their content, for publishing and later packages. A deleted or
   * unknown account appears as Deleted User without a link, role or picture.
   */
  async memberCards(memberIds: readonly string[]): Promise<Map<string, MemberCardView>> {
    const ids = [...new Set(memberIds)]
    if (ids.length === 0) return new Map()
    const rows = await this.db.memberAccount.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        displayName: true,
        role: true,
        alumniStatus: true,
        state: true,
        profile: { select: { profileImage: { select: { storageKey: true } } } },
      },
    })
    const live = rows.filter((row) => row.state !== 'DELETED' && row.displayName)
    const keys = live.flatMap((row) => {
      const key = row.profile?.profileImage?.storageKey
      return key ? [key] : []
    })
    const urls = keys.length > 0 ? await this.storage.createSignedUrls(keys) : new Map<string, string>()
    const cards = new Map<string, MemberCardView>()
    for (const id of ids) cards.set(id, deletedCard())
    for (const row of live) {
      const key = row.profile?.profileImage?.storageKey
      cards.set(row.id, {
        memberId: row.id,
        displayName: row.displayName ?? DELETED_USER_NAME,
        role: row.role,
        alumniStatus: row.alumniStatus,
        pictureUrl: key ? (urls.get(key) ?? null) : null,
        deleted: false,
      })
    }
    return cards
  }

  /** Emails of Administrator accounts, for audit records; removed accounts are absent. */
  async adminEmails(adminIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(adminIds)]
    if (ids.length === 0) return new Map()
    const rows = await this.db.administratorAccount.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    })
    return new Map(rows.map((row) => [row.id, row.email]))
  }

  async ownAccount(memberId: string): Promise<OwnAccountView> {
    const [account, profile, request] = await Promise.all([
      this.db.memberAccount.findUnique({
        where: { id: memberId },
        select: { id: true, email: true, displayName: true, role: true, alumniStatus: true, state: true },
      }),
      this.profile(memberId),
      this.db.graduationRequest.findFirst({
        where: { memberId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ])
    if (!account?.email || !account.displayName) throw new NotFoundError('The account was not found.')
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      alumniStatus: account.alumniStatus,
      state: account.state,
      profile,
      graduationRequest: request ? toGraduationRequestView(request) : null,
    }
  }
}

export function deletedCard(): MemberCardView {
  return {
    memberId: null,
    displayName: DELETED_USER_NAME,
    role: null,
    alumniStatus: null,
    pictureUrl: null,
    deleted: true,
  }
}
