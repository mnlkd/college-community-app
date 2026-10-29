import { AnalyticsService } from '../analytics/index.js'
import { BoardsService, SavedItemStats, TrendingRanker } from '../boards/index.js'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  AccessPolicy,
  AccountLifecyclePublisher,
  AccountService,
  AccountViews,
  AdminIdentityService,
  IdentityMemberDirectory,
  RegistrationService,
  type AuthProvider,
} from '../identity/index.js'
import { GroupLifecycleHandler, GroupService } from '../groups/index.js'
import { MentorshipLifecycleHandler, MentorshipService } from '../mentorship/index.js'
import { systemClock, type Clock, type FileStorage, type TransactionRunner } from '../kernel/index.js'
import {
  AuditService,
  ModerationLifecycleHandler,
  ModerationService,
  RestrictionLookup,
} from '../moderation/index.js'
import { NotificationService } from '../notifications/index.js'
import { OpportunityLifecycleHandler, OpportunityService } from '../opportunities/index.js'
import {
  InteractionService,
  PostViews,
  PublishingLifecycleHandler,
  PublishingService,
} from '../publishing/index.js'
import { CleanupJob } from './cleanup-job.js'
import { AuthMiddleware, type AccessTokenVerifier, type SessionDirectory } from './auth-middleware.js'
import type { AppConfig } from './config.js'
import { ErrorHandler } from './error-handler.js'
import { ImageProcessor } from './image-processor.js'
import { createLogger, type Logger } from './logger.js'
import { createPrismaClient } from './prisma.js'
import { PrismaTransactionRunner } from './prisma-transaction-runner.js'
import { RateLimiter, type RateLimitRule } from './rate-limiter.js'
import { StorageAdapter } from './storage-adapter.js'
import { SupabaseAuthAdapter } from './supabase-auth-adapter.js'
import { SqlSupabaseInventory, type SupabaseInventory } from './supabase-inventory.js'

const HOUR = 60 * 60

/** Change limits per account (NFR-5). Later batches add their actions here. */
export const RATE_LIMIT_RULES: Readonly<Record<string, RateLimitRule>> = {
  registration: { limit: 5, windowSeconds: HOUR },
  'profile.update': { limit: 30, windowSeconds: HOUR },
  'profile.picture': { limit: 10, windowSeconds: HOUR },
  'email.sync': { limit: 10, windowSeconds: HOUR },
  'graduation.request': { limit: 5, windowSeconds: 24 * HOUR },
  'account.delete': { limit: 5, windowSeconds: 15 * 60 },
  'admin.create': { limit: 10, windowSeconds: 24 * HOUR },
  'admin.memberEmail': { limit: 20, windowSeconds: HOUR },
  'admin.email.sync': { limit: 10, windowSeconds: HOUR },
  'post.create': { limit: 20, windowSeconds: HOUR },
  'post.edit': { limit: 30, windowSeconds: HOUR },
  comment: { limit: 60, windowSeconds: HOUR },
  like: { limit: 300, windowSeconds: HOUR },
  save: { limit: 120, windowSeconds: HOUR },
  'mentor.update': { limit: 30, windowSeconds: HOUR },
  'mentorship.request': { limit: 20, windowSeconds: 24 * HOUR },
  'mentorship.decide': { limit: 120, windowSeconds: HOUR },
  'opportunity.create': { limit: 10, windowSeconds: 24 * HOUR },
  'opportunity.edit': { limit: 30, windowSeconds: HOUR },
  'group.create': { limit: 10, windowSeconds: 24 * HOUR },
  'group.edit': { limit: 30, windowSeconds: HOUR },
  'group.join': { limit: 30, windowSeconds: HOUR },
  'group.decide': { limit: 120, windowSeconds: HOUR },
  'report.submit': { limit: 20, windowSeconds: HOUR },
  'report.decide': { limit: 120, windowSeconds: HOUR },
  'analytics.export': { limit: 30, windowSeconds: HOUR },
}

/** Composition root: builds every long-lived object once at start-up. */
export interface Container {
  config: AppConfig
  logger: Logger
  clock: Clock
  prisma: PrismaClient
  transactions: TransactionRunner
  authAdapter: SupabaseAuthAdapter
  tokenVerifier: AccessTokenVerifier
  authProvider: AuthProvider
  storage: FileStorage
  images: ImageProcessor
  rateLimiter: RateLimiter
  auth: AuthMiddleware
  errors: ErrorHandler
  lifecycle: AccountLifecyclePublisher
  accessPolicy: AccessPolicy
  audit: AuditService
  notifications: NotificationService
  registrations: RegistrationService
  accounts: AccountService
  adminIdentity: AdminIdentityService
  publishing: PublishingService
  interactions: InteractionService
  mentorship: MentorshipService
  opportunities: OpportunityService
  groups: GroupService
  moderation: ModerationService
  boards: BoardsService
  analytics: AnalyticsService
  cleanup: CleanupJob
}

export interface ContainerOverrides {
  clock?: Clock
  logger?: Logger
  tokenVerifier?: AccessTokenVerifier
  sessions?: SessionDirectory
  rateLimitRules?: Readonly<Record<string, RateLimitRule>>
  /** Test doubles for Supabase Auth and Storage. */
  authProvider?: AuthProvider
  storage?: FileStorage
  inventory?: SupabaseInventory
}

export function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? createLogger(config.logLevel)
  const clock = overrides.clock ?? systemClock
  const prisma = createPrismaClient({ databaseUrl: config.databaseUrl, sslCaFile: config.databaseSslCaFile })
  const transactions = new PrismaTransactionRunner(prisma)
  const authAdapter = new SupabaseAuthAdapter({
    sql: prisma,
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
    jwtSecret: config.supabaseJwtSecret,
  })
  const tokenVerifier = overrides.tokenVerifier ?? authAdapter
  const authProvider = overrides.authProvider ?? authAdapter
  const sessions = overrides.sessions ?? authAdapter
  const storage =
    overrides.storage ??
    new StorageAdapter({ supabaseUrl: config.supabaseUrl, serviceRoleKey: config.supabaseServiceRoleKey })
  const images = new ImageProcessor()
  const lifecycle = new AccountLifecyclePublisher()
  const notifications = new NotificationService(prisma, new IdentityMemberDirectory(prisma), clock)
  const views = new AccountViews(prisma, storage)
  const audit = new AuditService({ db: prisma, clock, views })
  const accessPolicy = new AccessPolicy(clock, new RestrictionLookup())
  const saveStats = new SavedItemStats(prisma)
  const postViews = new PostViews(prisma, storage, views, saveStats)
  const publishing = new PublishingService({
    db: prisma,
    transactions,
    clock,
    access: accessPolicy,
    storage,
    images,
    notifications,
    views: postViews,
    logger,
  })
  const mentorship = new MentorshipService({
    db: prisma,
    transactions,
    clock,
    access: accessPolicy,
    notifications,
    views,
  })
  const opportunities = new OpportunityService({
    db: prisma,
    transactions,
    clock,
    access: accessPolicy,
    views,
    saves: saveStats,
  })
  const groups = new GroupService({
    db: prisma,
    transactions,
    clock,
    access: accessPolicy,
    notifications,
    views,
    saves: saveStats,
  })
  lifecycle.register(new PublishingLifecycleHandler())
  lifecycle.register(new MentorshipLifecycleHandler(notifications))
  lifecycle.register(new OpportunityLifecycleHandler())
  lifecycle.register(new GroupLifecycleHandler(accessPolicy, notifications))
  lifecycle.register(new ModerationLifecycleHandler())
  const interactions = new InteractionService({
    db: prisma,
    transactions,
    clock,
    access: accessPolicy,
    notifications,
    views: postViews,
  })
  const moderation = new ModerationService({
    db: prisma,
    transactions,
    clock,
    access: accessPolicy,
    views,
    publishing,
    opportunities,
    notifications,
    audit,
  })
  return {
    config,
    logger,
    clock,
    prisma,
    transactions,
    authAdapter,
    tokenVerifier,
    authProvider,
    storage,
    images,
    rateLimiter: new RateLimiter(overrides.rateLimitRules ?? RATE_LIMIT_RULES, clock),
    auth: new AuthMiddleware(prisma, tokenVerifier, sessions, transactions, clock),
    errors: new ErrorHandler(logger),
    lifecycle,
    accessPolicy,
    audit,
    notifications,
    registrations: new RegistrationService(
      prisma,
      transactions,
      authProvider,
      views,
      clock,
      config.emailHashSecret,
    ),
    accounts: new AccountService({
      db: prisma,
      transactions,
      clock,
      authProvider,
      storage,
      images,
      notifications,
      lifecycle,
      audit,
      views,
      logger,
    }),
    adminIdentity: new AdminIdentityService({
      db: prisma,
      transactions,
      clock,
      authProvider,
      storage,
      notifications,
      lifecycle,
      audit,
      logger,
      emailHashSecret: config.emailHashSecret,
    }),
    publishing,
    interactions,
    mentorship,
    opportunities,
    groups,
    moderation,
    boards: new BoardsService({
      db: prisma,
      transactions,
      clock,
      publishing,
      mentorship,
      opportunities,
      groups,
      ranker: new TrendingRanker(),
    }),
    analytics: new AnalyticsService({ db: prisma, clock }),
    cleanup: new CleanupJob({
      clock,
      logger,
      notifications,
      interactions,
      moderation,
      audit,
      publishing,
      accounts: views,
      storage,
      authProvider,
      inventory: overrides.inventory ?? new SqlSupabaseInventory(prisma),
    }),
  }
}
