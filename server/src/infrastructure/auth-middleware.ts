import type { AccountState, AlumniStatus, Role } from '@hilcoe/shared'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  ActorContext,
  AuthenticationError,
  PermissionDeniedError,
  type Clock,
  type TransactionRunner,
} from '../kernel/index.js'
import type { VerifiedToken } from './supabase-auth-adapter.js'

export const ADMIN_IDLE_LIMIT_MS = 30 * 60 * 1000
export const ADMIN_SESSION_LIMIT_MS = 8 * 60 * 60 * 1000

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<VerifiedToken>
}

/** Tells whether a Supabase session is still live (implemented by SupabaseAuthAdapter). */
export interface SessionDirectory {
  sessionExists(authUserId: string, sessionId: string): Promise<boolean>
}

const SESSION_ENDED = 'Your Administrator session has ended. Sign in again.'

/** Locals set on a protected request. */
export interface AuthLocals {
  actor: ActorContext
  /** Set by the token-only guard used before a platform account exists. */
  authUser: { authUserId: string }
}

export function actorOf(res: Response): ActorContext {
  const actor = (res.locals as Partial<AuthLocals>).actor
  if (!actor) throw new Error('Route is missing an authentication guard')
  return actor
}

export function authUserOf(res: Response): { authUserId: string } {
  const authUser = (res.locals as Partial<AuthLocals>).authUser
  if (!authUser) throw new Error('Route is missing the authUser guard')
  return authUser
}

interface AdminSessionRow {
  first_seen_at: Date
  last_activity_at: Date
  expires_at: Date
}

/**
 * First step of every protected request (ODD Table 5). Besides SupabaseAuthAdapter it reads
 * the account tables and the current restriction (the documented exception to table ownership)
 * and writes admin_session.
 */
export class AuthMiddleware {
  /** The token each ActorContext was built from. */
  private readonly tokens = new WeakMap<ActorContext, VerifiedToken>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly verifier: AccessTokenVerifier,
    private readonly sessions: SessionDirectory,
    private readonly transactions: TransactionRunner,
    private readonly clock: Clock,
  ) {}

  private async verify(request: Request): Promise<VerifiedToken> {
    const header = request.get('authorization')
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null
    if (!match?.[1]) throw new AuthenticationError()
    return this.verifier.verifyAccessToken(match[1])
  }

  /** Verifies the bearer token and builds the ActorContext of its platform account. */
  async authenticate(request: Request): Promise<ActorContext> {
    const token = await this.verify(request)

    const now = this.clock.now()
    // One round trip each: the latest active restriction is joined into the member lookup.
    const [member, admin] = await Promise.all([
      this.prisma.memberAccount.findUnique({
        where: { authUserId: token.authUserId },
        select: {
          id: true,
          role: true,
          alumniStatus: true,
          state: true,
          consequences: {
            where: { kind: 'RESTRICTION', restrictUntil: { gt: now } },
            orderBy: { restrictUntil: 'desc' },
            take: 1,
            select: { restrictUntil: true },
          },
        },
      }),
      this.prisma.administratorAccount.findUnique({
        where: { authUserId: token.authUserId },
        select: { id: true, state: true, isFirstAdmin: true },
      }),
    ])

    const actor = member ? this.memberActor(member, token) : admin ? this.adminActor(admin, token) : null
    if (!actor) throw new AuthenticationError()
    this.tokens.set(actor, token)
    return actor
  }

  private memberActor(
    member: {
      id: string
      role: Role
      alumniStatus: AlumniStatus | null
      state: AccountState
      consequences: { restrictUntil: Date | null }[]
    },
    token: VerifiedToken,
  ): ActorContext {
    if (member.state !== 'ACTIVE') throw new PermissionDeniedError('This account is not active.')
    return new ActorContext({
      accountId: member.id,
      kind: 'MEMBER',
      role: member.role,
      alumniStatus: member.alumniStatus,
      accountState: member.state,
      restrictedUntil: member.consequences[0]?.restrictUntil ?? null,
      mfaVerified: token.mfaVerified,
      isFirstAdmin: false,
      sessionId: token.sessionId,
    })
  }

  private adminActor(
    admin: { id: string; state: 'ACTIVE' | 'DISABLED'; isFirstAdmin: boolean },
    token: VerifiedToken,
  ): ActorContext {
    if (admin.state !== 'ACTIVE') throw new PermissionDeniedError('This account is not active.')
    return new ActorContext({
      accountId: admin.id,
      kind: 'ADMIN',
      role: null,
      alumniStatus: null,
      accountState: 'ACTIVE',
      restrictedUntil: null,
      mfaVerified: token.mfaVerified,
      isFirstAdmin: admin.isFirstAdmin,
      sessionId: token.sessionId,
    })
  }

  /**
   * Requires the second factor and a live AdminSession; ends the session after 30 minutes
   * idle or 8 hours in total (NFR-1). The session row is locked so concurrent requests agree.
   * A session seen for the first time must still exist in Supabase Auth, so access tokens of a
   * session ended by an MFA reset are refused before they expire.
   */
  async requireAdministrator(actor: ActorContext): Promise<void> {
    if (!actor.isAdministrator) throw new PermissionDeniedError('This page is for Administrators.')
    if (!actor.mfaVerified) {
      throw new PermissionDeniedError('Verify your authenticator code to continue.')
    }
    const sessionId = actor.sessionId
    const token = this.tokens.get(actor)
    if (!sessionId || !token) throw new AuthenticationError()

    const live = await this.transactions.run(async (tx) => {
      const now = this.clock.now()
      const authenticatedAt = token.authenticatedAt
      const start = authenticatedAt && authenticatedAt < now ? authenticatedAt : now
      const inserted = await tx.$executeRaw`
        INSERT INTO admin_session (id, admin_id, supabase_session_id, first_seen_at, last_activity_at, expires_at)
        VALUES (gen_random_uuid(), ${actor.accountId}::uuid, ${sessionId}, ${start}, ${now},
                ${new Date(start.getTime() + ADMIN_SESSION_LIMIT_MS)})
        ON CONFLICT (supabase_session_id) DO NOTHING`
      // Throwing rolls the new row back, so a later request checks Supabase again.
      if (inserted > 0 && !(await this.sessions.sessionExists(token.authUserId, sessionId))) {
        throw new AuthenticationError(SESSION_ENDED)
      }
      const rows = await tx.$queryRaw<AdminSessionRow[]>`
        SELECT first_seen_at, last_activity_at, expires_at FROM admin_session
        WHERE supabase_session_id = ${sessionId} AND admin_id = ${actor.accountId}::uuid
        FOR UPDATE`
      const session = rows[0]
      if (!session) return false
      const idleFor = now.getTime() - session.last_activity_at.getTime()
      if (idleFor > ADMIN_IDLE_LIMIT_MS || now.getTime() >= session.expires_at.getTime()) return false
      await tx.$executeRaw`
        UPDATE admin_session SET last_activity_at = ${now} WHERE supabase_session_id = ${sessionId}`
      return true
    })
    if (!live) throw new AuthenticationError(SESSION_ENDED)
  }

  /** Express guard for community endpoints. */
  member(): RequestHandler {
    return this.guard(async (request) => {
      const actor = await this.authenticate(request)
      if (!actor.isMember) throw new PermissionDeniedError('This page is for community members.')
      return actor
    })
  }

  /**
   * Express guard for registration: a verified Supabase token whose user may not have a
   * platform account yet. RegistrationService checks everything else.
   */
  authUser(): RequestHandler {
    return (request: Request, response: Response, next: NextFunction) => {
      this.verify(request).then((token) => {
        ;(response.locals as AuthLocals).authUser = { authUserId: token.authUserId }
        next()
      }, next)
    }
  }

  /** Express guard for endpoints open to members and Administrators. */
  memberOrAdministrator(): RequestHandler {
    return this.guard(async (request) => {
      const actor = await this.authenticate(request)
      if (actor.isAdministrator) await this.requireAdministrator(actor)
      return actor
    })
  }

  /** Express guard for Administrator endpoints. */
  administrator(): RequestHandler {
    return this.guard(async (request) => {
      const actor = await this.authenticate(request)
      await this.requireAdministrator(actor)
      return actor
    })
  }

  private guard(resolve: (request: Request) => Promise<ActorContext>): RequestHandler {
    return (request: Request, response: Response, next: NextFunction) => {
      resolve(request).then((actor) => {
        ;(response.locals as AuthLocals).actor = actor
        next()
      }, next)
    }
  }
}
