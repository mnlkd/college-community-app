import {
  isInstitutionalEmail,
  registrationInputSchema,
  roleDetailsIssues,
  type OwnAccountView,
  type RegistrationStatusView,
  type Role,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  DuplicateError,
  PermissionDeniedError,
  ValidationError,
  isUniqueViolation,
  parseInput,
  type Clock,
  type TransactionRunner,
  type Tx,
} from '../kernel/index.js'
import type { AccountViews } from './account-views.js'
import type { AuthProvider } from './auth-provider.js'
import { hashEmail } from './email-hash.js'

/** A Supabase user whose access token was verified but who may not have a platform account yet. */
export interface AuthenticatedUser {
  authUserId: string
}

const ALREADY_REGISTERED = 'An account with this email already exists. Sign in instead.'
const BLOCKED = 'This email cannot be used to register. Contact the college if you think this is wrong.'

/** Register Account, Verify Email Code and Self-report Alumni Details (ODD Table 8). */
export class RegistrationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly transactions: TransactionRunner,
    private readonly authProvider: AuthProvider,
    private readonly views: AccountViews,
    private readonly clock: Clock,
    private readonly emailHashSecret: string,
  ) {}

  /** Tells the client whether to complete registration and which role the email would get. */
  async getStatus(authUser: AuthenticatedUser): Promise<RegistrationStatusView> {
    const user = await this.authProvider.getUser(authUser.authUserId)
    const [member, staff] = await Promise.all([
      this.db.memberAccount.findUnique({ where: { authUserId: authUser.authUserId }, select: { id: true } }),
      this.db.staffEmailEntry.findFirst({
        where: { email: user.email, active: true },
        select: { email: true },
      }),
    ])
    return {
      registered: member !== null,
      email: user.email,
      institutional: isInstitutionalEmail(user.email),
      staffListed: staff !== null,
    }
  }

  /**
   * Creates the MemberAccount and Profile once Supabase Auth has accepted the email code.
   * Email verification alone never gives VERIFIED Alumni status (NFR-2).
   */
  async completeRegistration(authUser: AuthenticatedUser, rawInput: unknown): Promise<OwnAccountView> {
    const input = parseInput(registrationInputSchema, rawInput)
    const user = await this.authProvider.getUser(authUser.authUserId)
    if (!user.emailConfirmed) throw new PermissionDeniedError('Verify your email code first.')
    const email = user.email.toLowerCase()
    const institutional = isInstitutionalEmail(email)
    if (input.kind === 'STUDENT_OR_STAFF' && !institutional) {
      throw new ValidationError({ email: 'Students and Staff register with their @hilcoeschool.com email.' })
    }

    let memberId: string
    try {
      memberId = await this.transactions.run(async (tx) => {
        await this.assertEmailAvailable(tx, authUser.authUserId, email)
        const role = input.kind === 'ALUMNI' ? 'ALUMNI' : await this.roleForInstitutionalEmail(tx, email)
        const issues = roleDetailsIssues(role, input, this.clock.now().getUTCFullYear())
        if (Object.keys(issues).length > 0) throw new ValidationError(issues)

        const account = await tx.memberAccount.create({
          data: {
            authUserId: authUser.authUserId,
            email,
            displayName: input.displayName,
            role,
            alumniStatus: role === 'ALUMNI' ? 'SELF_REPORTED' : null,
            programme: input.programme,
            profile: {
              create: {
                studyOrExpertise: input.studyOrExpertise,
                graduationYear: input.graduationYear,
                currentPosition: input.currentPosition,
              },
            },
          },
          select: { id: true },
        })
        if (input.kind === 'ALUMNI') {
          await tx.alumniReview.create({
            data: {
              memberId: account.id,
              registrationPath: institutional ? 'INSTITUTIONAL_EMAIL' : 'PERSONAL_EMAIL',
              claimedFullName: input.displayName,
              identifyingContext: input.identifyingContext,
            },
          })
        }
        return account.id
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateError(ALREADY_REGISTERED)
      throw error
    }
    // Only a hint for the sign-in pages, set once the account exists. The client checks
    // GET /registrations/me when the hint is missing, so a failure here is not fatal.
    await this.authProvider.setAccountKind(authUser.authUserId, 'MEMBER').catch(() => undefined)
    return this.views.ownAccount(memberId)
  }

  private async assertEmailAvailable(tx: Tx, authUserId: string, email: string): Promise<void> {
    const [member, admin, blocked] = await Promise.all([
      tx.memberAccount.findFirst({
        where: { OR: [{ authUserId }, { email }] },
        select: { id: true },
      }),
      tx.administratorAccount.findFirst({
        where: { OR: [{ authUserId }, { email }] },
        select: { id: true },
      }),
      tx.blockedEmailHash.findUnique({
        where: { emailHmac: hashEmail(email, this.emailHashSecret) },
        select: { emailHmac: true },
      }),
    ])
    if (blocked) throw new PermissionDeniedError(BLOCKED)
    if (admin) throw new PermissionDeniedError('Administrator accounts cannot join the community.')
    if (member) throw new DuplicateError(ALREADY_REGISTERED)
  }

  private async roleForInstitutionalEmail(tx: Tx, email: string): Promise<Role> {
    const staff = await tx.staffEmailEntry.findFirst({
      where: { email, active: true },
      select: { email: true },
    })
    return staff ? 'STAFF' : 'STUDENT'
  }
}
