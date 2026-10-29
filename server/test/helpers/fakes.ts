import { randomUUID } from 'node:crypto'
import type { ActorKind } from '@hilcoe/shared'
import type { AuthProvider, AuthUser } from '../../src/identity/index.js'
import type { SessionDirectory } from '../../src/infrastructure/auth-middleware.js'
import type { InventoryPage, SupabaseInventory } from '../../src/infrastructure/supabase-inventory.js'
import type { FileStorage } from '../../src/kernel/index.js'

interface FakeUser extends AuthUser {
  password: string
  accountKind: ActorKind | null
  banned: boolean
  mfaFactors: number
  invited: boolean
}

/**
 * In-memory stand-in for Supabase Auth's admin operations. Sessions are live unless the user
 * was signed out everywhere; a later sign-in is simulated with signIn().
 */
export class FakeAuthProvider implements AuthProvider, SessionDirectory {
  readonly users = new Map<string, FakeUser>()
  /** Users whose sessions were ended by signOutAll. */
  readonly signedOut = new Set<string>()
  failNextDelete = false
  /** Makes the next external change fail, as an unreachable Supabase Auth would. */
  failNext: 'inviteUser' | 'updateEmail' | 'banUser' | 'unbanUser' | 'removeMfaFactors' | null = null

  addUser(
    email: string,
    options: { password?: string; emailConfirmed?: boolean; id?: string } = {},
  ): FakeUser {
    const user: FakeUser = {
      id: options.id ?? randomUUID(),
      email: email.toLowerCase(),
      emailConfirmed: options.emailConfirmed ?? true,
      password: options.password ?? 'correct horse battery staple',
      accountKind: null,
      banned: false,
      mfaFactors: 0,
      invited: false,
    }
    this.users.set(user.id, user)
    return user
  }

  async getUser(authUserId: string): Promise<AuthUser> {
    const user = this.users.get(authUserId)
    if (!user) throw new Error('unknown user')
    return { id: user.id, email: user.email, emailConfirmed: user.emailConfirmed }
  }

  async verifyPassword(email: string, password: string): Promise<boolean> {
    return [...this.users.values()].some((user) => user.email === email && user.password === password)
  }

  async setAccountKind(authUserId: string, kind: ActorKind): Promise<void> {
    const user = this.users.get(authUserId)
    if (user) user.accountKind = kind
  }

  async inviteUser(email: string, kind: ActorKind): Promise<string> {
    this.failIf('inviteUser')
    if ([...this.users.values()].some((user) => user.email === email.toLowerCase())) {
      throw new Error('A user with this email address has already been registered')
    }
    const user = this.addUser(email, { emailConfirmed: false })
    user.accountKind = kind
    user.invited = true
    return user.id
  }

  async updateEmail(authUserId: string, email: string): Promise<void> {
    this.failIf('updateEmail')
    const user = this.mustGet(authUserId)
    user.email = email.toLowerCase()
    user.emailConfirmed = true
  }

  async banUser(authUserId: string): Promise<void> {
    this.failIf('banUser')
    this.mustGet(authUserId).banned = true
  }

  async unbanUser(authUserId: string): Promise<void> {
    this.failIf('unbanUser')
    this.mustGet(authUserId).banned = false
  }

  async signOutAll(authUserId: string): Promise<void> {
    this.signedOut.add(authUserId)
  }

  /** A new sign-in after signOutAll. */
  signIn(authUserId: string): void {
    this.signedOut.delete(authUserId)
  }

  async sessionExists(authUserId: string): Promise<boolean> {
    return !this.signedOut.has(authUserId)
  }

  async removeMfaFactors(authUserId: string): Promise<void> {
    this.failIf('removeMfaFactors')
    const user = this.users.get(authUserId)
    if (user) user.mfaFactors = 0
  }

  async deleteUser(authUserId: string): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false
      throw new Error('auth service down')
    }
    this.users.delete(authUserId)
  }

  private mustGet(authUserId: string): FakeUser {
    const user = this.users.get(authUserId)
    if (!user) throw new Error('unknown user')
    return user
  }

  private failIf(operation: NonNullable<FakeAuthProvider['failNext']>): void {
    if (this.failNext !== operation) return
    this.failNext = null
    throw new Error('auth service down')
  }
}

/** In-memory private storage. */
export class FakeStorage implements FileStorage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>()

  async upload(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.files.has(key)) throw new Error('exists')
    this.files.set(key, { bytes, contentType })
  }

  async createSignedUrl(key: string): Promise<string> {
    return `https://storage.test/${key}?token=signed`
  }

  async createSignedUrls(keys: readonly string[]): Promise<Map<string, string>> {
    return new Map(keys.map((key) => [key, `https://storage.test/${key}?token=signed`]))
  }

  async remove(key: string): Promise<void> {
    this.files.delete(key)
  }
}

/**
 * Lists the fake Storage files and Auth users like SqlSupabaseInventory. Items count as created
 * at the epoch unless `createdAt` records a time.
 */
export class FakeInventory implements SupabaseInventory {
  readonly createdAt = new Map<string, Date>()

  constructor(
    private readonly storage: FakeStorage,
    private readonly auth: FakeAuthProvider,
  ) {}

  async listStoredObjects(createdBefore: Date, after: string | null, limit: number): Promise<InventoryPage> {
    return this.page([...this.storage.files.keys()], createdBefore, after, limit)
  }

  async listPlatformAuthUsers(
    createdBefore: Date,
    after: string | null,
    limit: number,
  ): Promise<InventoryPage> {
    const ids = [...this.auth.users.values()]
      .filter((user) => user.accountKind !== null)
      .map((user) => user.id)
    return this.page(ids, createdBefore, after, limit)
  }

  private page(ids: string[], createdBefore: Date, after: string | null, limit: number): InventoryPage {
    const items = ids
      .filter(
        (id) => (this.createdAt.get(id) ?? new Date(0)) < createdBefore && (after === null || id > after),
      )
      .sort()
      .slice(0, limit)
    return { items, next: items.length === limit ? (items.at(-1) ?? null) : null }
  }
}
