import type { ActorKind } from '@hilcoe/shared'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import type { AuthProvider, AuthUser } from '../identity/index.js'
import {
  AuthenticationError,
  DependencyError,
  DuplicateError,
  NotFoundError,
  RateLimitError,
} from '../kernel/index.js'

export interface VerifiedToken {
  authUserId: string
  /** Supabase session id; stable across token refreshes of one sign-in. */
  sessionId: string | null
  /** True when the session passed the authenticator-app factor (AAL2). */
  mfaVerified: boolean
  /** Earliest sign-in step of the session (amr claim), if present. */
  authenticatedAt: Date | null
}

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.string().min(1).optional(),
  aal: z.enum(['aal1', 'aal2', 'aal3']).optional(),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })).optional(),
})

/** The part of PrismaClient used to read and end sessions in the auth schema. */
export interface RawSqlExecutor {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SupabaseAuthAdapterOptions {
  sql: RawSqlExecutor
  supabaseUrl: string
  serviceRoleKey: string
  jwtSecret: string | null
}

/**
 * Wraps Supabase Auth (ODD Table 5). The service-role key stays on the server.
 * Access tokens are verified locally: HS256 tokens with the legacy JWT secret,
 * asymmetric tokens against the project's JWKS.
 */
export class SupabaseAuthAdapter implements AuthProvider {
  private readonly admin: SupabaseClient
  private readonly supabaseUrl: string
  private readonly serviceRoleKey: string
  private readonly issuer: string
  private readonly getKey: JWTVerifyGetKey
  private readonly sql: RawSqlExecutor

  constructor(options: SupabaseAuthAdapterOptions) {
    this.sql = options.sql
    this.supabaseUrl = options.supabaseUrl
    this.serviceRoleKey = options.serviceRoleKey
    this.issuer = `${options.supabaseUrl}/auth/v1`
    this.admin = createClient(options.supabaseUrl, options.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`))
    const secret = options.jwtSecret ? new TextEncoder().encode(options.jwtSecret) : null
    this.getKey = async (header, token) => {
      if (header.alg === 'HS256') {
        if (!secret) throw new AuthenticationError()
        return secret
      }
      return jwks(header, token)
    }
  }

  async verifyAccessToken(token: string): Promise<VerifiedToken> {
    let payload: unknown
    try {
      const result = await jwtVerify(token, this.getKey, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['HS256', 'ES256', 'RS256'],
      })
      payload = result.payload
    } catch (error) {
      if (error instanceof joseErrors.JWKSTimeout) throw new DependencyError(undefined, { cause: error })
      throw new AuthenticationError()
    }
    const claims = claimsSchema.safeParse(payload)
    if (!claims.success) throw new AuthenticationError()
    return {
      authUserId: claims.data.sub,
      sessionId: claims.data.session_id ?? null,
      mfaVerified: claims.data.aal === 'aal2' || claims.data.aal === 'aal3',
      authenticatedAt: earliestAuthentication(claims.data.amr),
    }
  }

  /**
   * Invites the user and records the account kind in app_metadata (writable only with the
   * service key). The sign-in pages read it as a hint; the server decides access from its tables.
   */
  async inviteUser(email: string, accountKind: ActorKind, redirectTo?: string): Promise<string> {
    const { data, error } = await this.admin.auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : {},
    )
    if (error?.code === 'email_exists' || error?.status === 422) {
      throw new DuplicateError('This email already has a sign-in account.')
    }
    if (error) throw this.dependency(error)
    const update = await this.admin.auth.admin.updateUserById(data.user.id, {
      app_metadata: { account_kind: accountKind },
    })
    if (update.error) throw this.dependency(update.error)
    return data.user.id
  }

  async getUser(authUserId: string): Promise<AuthUser> {
    const { data, error } = await this.admin.auth.admin.getUserById(authUserId)
    if (error?.status === 404) throw new NotFoundError('The sign-in account was not found.')
    if (error) throw this.dependency(error)
    if (!data.user.email) throw new NotFoundError('The sign-in account has no email.')
    return {
      id: data.user.id,
      email: data.user.email.toLowerCase(),
      emailConfirmed: Boolean(data.user.email_confirmed_at),
    }
  }

  /**
   * Signs in with a throw-away client and immediately ends the session it opened, so the
   * check leaves no usable session behind.
   */
  async verifyPassword(email: string, password: string): Promise<boolean> {
    const client = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.status === 429) throw new RateLimitError(60)
      if (error.status === 400 || error.status === 401 || error.status === 403) return false
      throw this.dependency(error)
    }
    if (data.session) {
      const result = await this.admin.auth.admin.signOut(data.session.access_token, 'local')
      if (result.error) throw this.dependency(result.error)
    }
    return true
  }

  async setAccountKind(authUserId: string, kind: ActorKind): Promise<void> {
    const { error } = await this.admin.auth.admin.updateUserById(authUserId, {
      app_metadata: { account_kind: kind },
    })
    if (error) throw this.dependency(error)
  }

  async updateEmail(authUserId: string, email: string): Promise<void> {
    const { error } = await this.admin.auth.admin.updateUserById(authUserId, { email, email_confirm: true })
    if (error?.code === 'email_exists' || error?.status === 422) {
      throw new DuplicateError('This email already has a sign-in account.')
    }
    if (error) throw this.dependency(error)
  }

  /** Bans for about 100 years; Supabase then refuses sign-in and token refresh. */
  async banUser(authUserId: string): Promise<void> {
    const { error } = await this.admin.auth.admin.updateUserById(authUserId, { ban_duration: '876000h' })
    if (error) throw this.dependency(error)
  }

  async unbanUser(authUserId: string): Promise<void> {
    const { error } = await this.admin.auth.admin.updateUserById(authUserId, { ban_duration: 'none' })
    if (error) throw this.dependency(error)
  }

  /**
   * Ends every session of the user. Supabase exposes no per-user admin sign-out, so the
   * user's rows in auth.sessions are deleted, as GoTrue's own logout does; their refresh
   * tokens cascade. Access tokens already issued stay valid until they expire, which is
   * why AuthMiddleware also checks the account state on every request.
   */
  async signOutAll(authUserId: string): Promise<void> {
    try {
      await this.sql.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${authUserId}::uuid`
    } catch (error) {
      throw this.dependency(error)
    }
  }

  /**
   * True while the Supabase session is still live. Lets AuthMiddleware refuse access tokens of
   * a session ended by signOutAll before they expire.
   */
  async sessionExists(authUserId: string, sessionId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(authUserId) || !UUID_PATTERN.test(sessionId)) return false
    try {
      const rows = await this.sql.$queryRaw<unknown[]>`
        SELECT 1 FROM auth.sessions WHERE id = ${sessionId}::uuid AND user_id = ${authUserId}::uuid`
      return rows.length > 0
    } catch (error) {
      throw this.dependency(error)
    }
  }

  async removeMfaFactors(authUserId: string): Promise<void> {
    const { data, error } = await this.admin.auth.admin.mfa.listFactors({ userId: authUserId })
    if (error) throw this.dependency(error)
    for (const factor of data.factors) {
      const result = await this.admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: authUserId })
      if (result.error) throw this.dependency(result.error)
    }
  }

  async deleteUser(authUserId: string): Promise<void> {
    const { error } = await this.admin.auth.admin.deleteUser(authUserId)
    if (error && error.status !== 404) throw this.dependency(error)
  }

  private dependency(cause: unknown): DependencyError {
    return new DependencyError('The sign-in service is unavailable. Try again shortly.', { cause })
  }
}

function earliestAuthentication(amr: { timestamp: number }[] | undefined): Date | null {
  if (!amr || amr.length === 0) return null
  return new Date(Math.min(...amr.map((entry) => entry.timestamp)) * 1000)
}
