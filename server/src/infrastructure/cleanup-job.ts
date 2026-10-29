import type { AccountViews, AuthProvider } from '../identity/index.js'
import type { Clock, FileStorage } from '../kernel/index.js'
import type { AuditService, ModerationService } from '../moderation/index.js'
import type { NotificationService } from '../notifications/index.js'
import type { InteractionService, PublishingService } from '../publishing/index.js'
import type { Logger } from './logger.js'
import type { SupabaseInventory } from './supabase-inventory.js'

const HOUR_MS = 60 * 60 * 1000
export const CLEANUP_INTERVAL_MS = 24 * HOUR_MS
/** Files and users younger than this may belong to a change still in progress. */
export const ORPHAN_GRACE_MS = 24 * HOUR_MS
const PAGE_SIZE = 500

export interface CleanupSummary {
  notifications: number
  viewMarks: number
  evidence: number
  evidenceImages: number
  auditRecords: number
  orphanFiles: number
  orphanAuthUsers: number
  /** Steps that failed; the rest still ran and the next run tries again. */
  failedSteps: string[]
}

export interface CleanupJobDeps {
  clock: Clock
  logger: Logger
  notifications: NotificationService
  interactions: InteractionService
  moderation: ModerationService
  audit: AuditService
  publishing: PublishingService
  accounts: AccountViews
  storage: FileStorage
  authProvider: AuthProvider
  inventory: SupabaseInventory
  /** Inventory page size (default 500). */
  pageSize?: number
}

/**
 * Daily retention task (ODD Table 5, SDD Section 2.3). Each package purges its own tables through
 * its service; the sweeps then retry file and user deletions that failed after a commit. Every
 * step is idempotent, so a missed or repeated run is harmless. Logs hold counts only.
 */
export class CleanupJob {
  private running: Promise<CleanupSummary> | null = null

  constructor(private readonly deps: CleanupJobDeps) {}

  /** Runs once; a call while a run is in progress joins that run. */
  run(now: Date = this.deps.clock.now()): Promise<CleanupSummary> {
    this.running ??= this.runOnce(now).finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Runs now and then every 24 hours until the returned stop function is called. */
  schedule(intervalMs = CLEANUP_INTERVAL_MS): () => void {
    const tick = () => {
      this.run().catch((error: unknown) => this.deps.logger.error({ err: error }, 'cleanup failed'))
    }
    tick()
    const timer = setInterval(tick, intervalMs)
    timer.unref()
    return () => clearInterval(timer)
  }

  private async runOnce(now: Date): Promise<CleanupSummary> {
    const summary: CleanupSummary = {
      notifications: 0,
      viewMarks: 0,
      evidence: 0,
      evidenceImages: 0,
      auditRecords: 0,
      orphanFiles: 0,
      orphanAuthUsers: 0,
      failedSteps: [],
    }
    const step = async (name: string, work: () => Promise<void>) => {
      try {
        await work()
      } catch (error) {
        summary.failedSteps.push(name)
        this.deps.logger.error({ err: error, step: name }, 'cleanup step failed')
      }
    }
    const { deps } = this
    await step('notifications', async () => {
      summary.notifications = await deps.notifications.purgeExpired(now)
    })
    await step('viewMarks', async () => {
      summary.viewMarks = await deps.interactions.purgeViewMarks(now)
    })
    await step('evidence', async () => {
      const result = await deps.moderation.purgeExpiredEvidence(now)
      summary.evidence = result.evidence
      summary.evidenceImages = await this.removeFiles(result.removedImageKeys)
    })
    await step('auditRecords', async () => {
      summary.auditRecords = await deps.audit.purgeExpired(now)
    })
    const cutoff = new Date(now.getTime() - ORPHAN_GRACE_MS)
    await step('orphanFiles', async () => {
      summary.orphanFiles = await this.sweepFiles(cutoff)
    })
    await step('orphanAuthUsers', async () => {
      summary.orphanAuthUsers = await this.sweepAuthUsers(cutoff)
    })
    deps.logger.info({ cleanup: summary }, 'cleanup finished')
    return summary
  }

  /** Stored files that no post or profile picture refers to. */
  private async sweepFiles(cutoff: Date): Promise<number> {
    const orphans: string[] = []
    let after: string | null = null
    do {
      const page = await this.deps.inventory.listStoredObjects(cutoff, after, this.pageSize)
      const [posts, profiles] = await Promise.all([
        this.deps.publishing.findStoredKeys(page.items),
        this.deps.accounts.findStoredKeys(page.items),
      ])
      orphans.push(...page.items.filter((key) => !posts.has(key) && !profiles.has(key)))
      after = page.next
    } while (after !== null)
    return this.removeFiles(orphans)
  }

  /** Auth users marked by the platform whose member or Administrator account no longer exists. */
  private async sweepAuthUsers(cutoff: Date): Promise<number> {
    const orphans: string[] = []
    let after: string | null = null
    do {
      const page = await this.deps.inventory.listPlatformAuthUsers(cutoff, after, this.pageSize)
      const linked = await this.deps.accounts.linkedAuthUserIds(page.items)
      orphans.push(...page.items.filter((id) => !linked.has(id)))
      after = page.next
    } while (after !== null)
    let removed = 0
    for (const id of orphans) {
      try {
        await this.deps.authProvider.deleteUser(id)
        removed += 1
      } catch (error) {
        this.deps.logger.warn({ err: error }, 'could not delete an orphaned auth user')
      }
    }
    return removed
  }

  private get pageSize(): number {
    return this.deps.pageSize ?? PAGE_SIZE
  }

  private async removeFiles(keys: readonly string[]): Promise<number> {
    let removed = 0
    for (const key of keys) {
      try {
        await this.deps.storage.remove(key)
        removed += 1
      } catch (error) {
        this.deps.logger.warn({ err: error, storageKey: key }, 'could not remove a stored file')
      }
    }
    return removed
  }
}
