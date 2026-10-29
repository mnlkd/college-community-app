import {
  DELETED_USER_NAME,
  type AccountState,
  type AlumniStatus,
  type Programme,
  type Role,
} from '@hilcoe/shared'
import { Prisma } from '../generated/prisma/client.js'
import {
  ActorContext,
  NotFoundError,
  PermissionDeniedError,
  RestrictionError,
  type Clock,
  type RestrictionReader,
  type Tx,
} from '../kernel/index.js'

/** PostgreSQL row lock strengths, strongest first. */
export type MemberLockStrength = 'UPDATE' | 'NO KEY UPDATE' | 'SHARE' | 'KEY SHARE'

/** What other packages may know about a member account. */
export interface MemberSummary {
  id: string
  /** "Deleted User" for a deleted account. */
  displayName: string
  role: Role
  alumniStatus: AlumniStatus | null
  programme: Programme | null
  state: AccountState
}

interface MemberRow {
  id: string
  display_name: string | null
  role: Role
  alumni_status: AlumniStatus | null
  programme: Programme | null
  state: AccountState
}

/** Active Staff member or Verified Alumni (FR-5). Flagged, Disabled and Deleted accounts are not. */
export function isMentorEligible(member: Pick<MemberSummary, 'state' | 'role' | 'alumniStatus'>): boolean {
  return (
    member.state === 'ACTIVE' &&
    (member.role === 'STAFF' || (member.role === 'ALUMNI' && member.alumniStatus === 'VERIFIED'))
  )
}

function toSummary(row: MemberRow): MemberSummary {
  return {
    id: row.id,
    displayName: row.state === 'DELETED' ? DELETED_USER_NAME : (row.display_name ?? DELETED_USER_NAME),
    role: row.role,
    alumniStatus: row.alumni_status,
    programme: row.programme,
    state: row.state,
  }
}

/**
 * Account checks used inside other packages' transactions (ODD Table 8). State-dependent
 * rules are checked again on the locked account row, and the restriction is read again after
 * the lock, so a restriction applied meanwhile by a decision is honoured.
 */
export class AccessPolicy {
  constructor(
    private readonly clock: Clock,
    private readonly restrictions: RestrictionReader,
  ) {}

  async getMember(tx: Tx, memberId: string): Promise<MemberSummary> {
    return this.read(tx, memberId, null)
  }

  /**
   * Also locks the account row until the transaction ends. UPDATE (the default) excludes every
   * other lock; the weaker strengths let notices referencing the account be inserted meanwhile.
   */
  async lockMember(
    tx: Tx,
    memberId: string,
    strength: MemberLockStrength = 'UPDATE',
  ): Promise<MemberSummary> {
    return this.read(tx, memberId, strength)
  }

  async assertCanInteract(tx: Tx, actor: ActorContext): Promise<void> {
    if (!(await this.current(tx, actor)).canInteract()) {
      throw new PermissionDeniedError('Your account cannot do this.')
    }
  }

  async assertCanPublish(tx: Tx, actor: ActorContext): Promise<void> {
    const fresh = await this.current(tx, actor)
    if (!fresh.canInteract()) throw new PermissionDeniedError('Your account cannot do this.')
    const now = this.clock.now()
    if (fresh.isRestrictedAt(now) && fresh.restrictedUntil) throw new RestrictionError(fresh.restrictedUntil)
  }

  /**
   * Refuses a member under a restriction. Call it after locking the member's account row in the
   * same transaction.
   */
  async assertNotRestricted(tx: Tx, memberId: string): Promise<void> {
    const until = await this.restrictions.restrictedUntil(tx, memberId, this.clock.now())
    if (until) throw new RestrictionError(until)
  }

  async assertStudent(tx: Tx, memberId: string): Promise<void> {
    const member = await this.lockMember(tx, memberId)
    if (member.state !== 'ACTIVE' || member.role !== 'STUDENT') {
      throw new PermissionDeniedError('Only active Students can do this.')
    }
  }

  /** Active Staff member or Verified Alumni. */
  async assertMentorEligible(tx: Tx, memberId: string): Promise<void> {
    const member = await this.lockMember(tx, memberId)
    if (!isMentorEligible(member))
      throw new PermissionDeniedError('Only Staff members and Verified Alumni can mentor.')
  }

  /** Summaries of the given members, read without locks for lists and searches. */
  async getMembers(tx: Tx, memberIds: readonly string[]): Promise<Map<string, MemberSummary>> {
    const ids = [...new Set(memberIds)]
    if (ids.length === 0) return new Map()
    const rows = await tx.$queryRaw<MemberRow[]>`
      SELECT id, display_name, role, alumni_status, programme, state FROM member_account
      WHERE id = ANY(${ids}::uuid[])`
    return new Map(rows.map((row) => [row.id, toSummary(row)]))
  }

  private async current(tx: Tx, actor: ActorContext): Promise<ActorContext> {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    const member = await this.lockMember(tx, actor.accountId)
    return new ActorContext({
      accountId: actor.accountId,
      kind: 'MEMBER',
      role: member.role,
      alumniStatus: member.alumniStatus,
      accountState: member.state,
      restrictedUntil: await this.restrictions.restrictedUntil(tx, actor.accountId, this.clock.now()),
      mfaVerified: actor.mfaVerified,
      isFirstAdmin: false,
      sessionId: actor.sessionId,
    })
  }

  private async read(tx: Tx, memberId: string, lock: MemberLockStrength | null): Promise<MemberSummary> {
    const clause = lock ? Prisma.raw(`FOR ${lock}`) : Prisma.empty
    const rows = await tx.$queryRaw<MemberRow[]>`
      SELECT id, display_name, role, alumni_status, programme, state FROM member_account
      WHERE id = ${memberId}::uuid ${clause}`
    const row = rows[0]
    if (!row) throw new NotFoundError('The member was not found.')
    return toSummary(row)
  }
}
