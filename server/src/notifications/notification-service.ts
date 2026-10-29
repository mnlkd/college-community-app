import {
  DELETED_USER_NAME,
  NOTIFICATION_RETENTION_DAYS,
  notificationInputSchema,
  pageRequestSchema,
  type NotificationInput,
  type NotificationTargetType,
  type NotificationView,
  type Page,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  NotFoundError,
  PermissionDeniedError,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type Clock,
  type Tx,
} from '../kernel/index.js'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Member facts the notifications package needs without reading identity tables. Implemented by
 * identity (which may depend on notifications) and given at start-up, avoiding a package cycle.
 */
export interface MemberDirectory {
  /** False when the account does not exist or is DELETED. */
  isLive(tx: Tx, memberId: string): Promise<boolean>
  /** Display names of live accounts; deleted or unknown accounts are absent from the map. */
  displayNames(memberIds: readonly string[]): Promise<Map<string, string>>
}

/** FR-12 notices (ODD Table 20). Administrators receive none. */
export class NotificationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly directory: MemberDirectory,
    private readonly clock: Clock,
  ) {}

  /**
   * Stores a notice in the caller's transaction unless the recipient is the actor or deleted,
   * or the recipient already has a notice with this eventKey.
   */
  async notify(tx: Tx, input: NotificationInput): Promise<void> {
    const notice = notificationInputSchema.parse(input)
    if (notice.actorId !== null && notice.actorId === notice.recipientId) return
    if (!(await this.directory.isLive(tx, notice.recipientId))) return
    const now = this.clock.now()
    await tx.notification.createMany({
      data: [
        {
          recipientId: notice.recipientId,
          type: notice.type,
          eventKey: notice.eventKey,
          actorId: notice.actorId,
          targetType: notice.targetType,
          targetId: notice.targetId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + NOTIFICATION_RETENTION_DAYS * DAY_MS),
        },
      ],
      skipDuplicates: true,
    })
  }

  async listNotifications(actor: ActorContext, page: unknown): Promise<Page<NotificationView>> {
    const recipientId = this.recipient(actor)
    const request = parseInput(pageRequestSchema, page)
    const where = { recipientId, expiresAt: { gt: this.clock.now() } }
    const [rows, total] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageWindow(request),
      }),
      this.db.notification.count({ where }),
    ])
    const actorIds = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))]
    const names = await this.directory.displayNames(actorIds)
    const items = rows.map((row): NotificationView => {
      const actorName = row.actorId ? (names.get(row.actorId) ?? null) : null
      return {
        id: row.id,
        type: row.type,
        actorId: actorName === null ? null : row.actorId,
        actorName: row.actorId ? (actorName ?? DELETED_USER_NAME) : null,
        targetType: row.targetType as NotificationTargetType,
        targetId: row.targetId,
        unread: row.unread,
        createdAt: row.createdAt.toISOString(),
      }
    })
    return toPage(items, request, total)
  }

  async countUnread(actor: ActorContext): Promise<number> {
    return this.db.notification.count({
      where: { recipientId: this.recipient(actor), unread: true, expiresAt: { gt: this.clock.now() } },
    })
  }

  /** Idempotent; a notice of another member or an expired one is reported as not found. */
  async markRead(actor: ActorContext, notificationId: string): Promise<void> {
    const result = await this.db.notification.updateMany({
      where: { id: notificationId, recipientId: this.recipient(actor), expiresAt: { gt: this.clock.now() } },
      data: { unread: false },
    })
    if (result.count === 0) throw new NotFoundError('The notice was not found.')
  }

  async markAllRead(actor: ActorContext): Promise<void> {
    await this.db.notification.updateMany({
      where: { recipientId: this.recipient(actor), unread: true },
      data: { unread: false },
    })
  }

  /** CleanupJob: removes notices whose 90 days have passed (NFR-8). Returns the number removed. */
  async purgeExpired(now: Date): Promise<number> {
    const { count } = await this.db.notification.deleteMany({ where: { expiresAt: { lte: now } } })
    return count
  }

  /** Removes every notice addressed to a member whose account is being deleted. */
  async removeForRecipient(tx: Tx, memberId: string): Promise<void> {
    await tx.notification.deleteMany({ where: { recipientId: memberId } })
  }

  private recipient(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('Administrators do not receive notices.')
    return actor.accountId
  }
}
