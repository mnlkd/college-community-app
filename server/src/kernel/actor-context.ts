import type { AccountState, ActorContextView, ActorKind, AlumniStatus, Role } from '@hilcoe/shared'

export interface ActorContextData {
  accountId: string
  kind: ActorKind
  role: Role | null
  alumniStatus: AlumniStatus | null
  accountState: AccountState
  restrictedUntil: Date | null
  mfaVerified: boolean
  isFirstAdmin: boolean
  /** Supabase session id (JWT session_id claim); used for Administrator session limits. */
  sessionId: string | null
}

/** The authenticated caller of one request (ODD Table 5). Read-only. */
export class ActorContext {
  readonly accountId: string
  readonly kind: ActorKind
  readonly role: Role | null
  readonly alumniStatus: AlumniStatus | null
  readonly accountState: AccountState
  readonly restrictedUntil: Date | null
  readonly mfaVerified: boolean
  readonly isFirstAdmin: boolean
  readonly sessionId: string | null

  constructor(data: ActorContextData) {
    this.accountId = data.accountId
    this.kind = data.kind
    this.role = data.role
    this.alumniStatus = data.alumniStatus
    this.accountState = data.accountState
    this.restrictedUntil = data.restrictedUntil
    this.mfaVerified = data.mfaVerified
    this.isFirstAdmin = data.isFirstAdmin
    this.sessionId = data.sessionId
    Object.freeze(this)
  }

  get isMember(): boolean {
    return this.kind === 'MEMBER'
  }

  get isAdministrator(): boolean {
    return this.kind === 'ADMIN'
  }

  /** ACTIVE Student, Staff member or Verified Alumni; used for liking, saving and reporting. */
  canInteract(): boolean {
    if (this.kind !== 'MEMBER' || this.accountState !== 'ACTIVE') return false
    if (this.role === 'STUDENT' || this.role === 'STAFF') return true
    return this.role === 'ALUMNI' && this.alumniStatus === 'VERIFIED'
  }

  /** canInteract() and no restriction after now. */
  canPublish(now: Date): boolean {
    return this.canInteract() && !this.isRestrictedAt(now)
  }

  isRestrictedAt(now: Date): boolean {
    return this.restrictedUntil !== null && this.restrictedUntil.getTime() > now.getTime()
  }

  toView(): ActorContextView {
    return {
      accountId: this.accountId,
      kind: this.kind,
      role: this.role,
      alumniStatus: this.alumniStatus,
      accountState: this.accountState,
      restrictedUntil: this.restrictedUntil?.toISOString() ?? null,
      mfaVerified: this.mfaVerified,
      isFirstAdmin: this.isFirstAdmin,
    }
  }
}
