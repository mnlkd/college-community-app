import { z } from 'zod'
import { notificationTypeSchema, type NotificationType } from './enums.js'
import { uuidSchema } from './text.js'

// notifications Input/View types (ODD Section 3.8, Tables 19 and 20).

/** The kind of item a notice opens. */
export const NOTIFICATION_TARGET_TYPES = [
  'POST',
  'COMMENT',
  'OPPORTUNITY',
  'MENTORSHIP',
  'GROUP',
  'ALUMNI_REVIEW',
  'GRADUATION_REQUEST',
  'REPORT',
] as const
export const notificationTargetTypeSchema = z.enum(NOTIFICATION_TARGET_TYPES)
export type NotificationTargetType = z.infer<typeof notificationTargetTypeSchema>

export const EVENT_KEY_MAX = 200
export const NOTIFICATION_RETENTION_DAYS = 90
/** Clients poll the unread count this often while the page is visible (FR-12). */
export const NOTIFICATION_POLL_MS = 30_000

/** Given by the package whose change caused the notice, inside its own transaction. */
export const notificationInputSchema = z.object({
  recipientId: uuidSchema,
  type: notificationTypeSchema,
  /** Identifies the event; the same key never gives the same recipient two notices. */
  eventKey: z.string().trim().min(1).max(EVENT_KEY_MAX),
  /** The member who caused it; null for Administrator decisions and report outcomes. */
  actorId: uuidSchema.nullable(),
  targetType: notificationTargetTypeSchema,
  targetId: uuidSchema,
})
export type NotificationInput = z.input<typeof notificationInputSchema>

export interface NotificationView {
  id: string
  type: NotificationType
  /** Null when the notice names no member, or the member's account was deleted. */
  actorId: string | null
  /** The actor's display name, "Deleted User" after deletion, or null when no member is named. */
  actorName: string | null
  targetType: NotificationTargetType
  targetId: string
  unread: boolean
  createdAt: string
}

export interface UnreadCountView {
  count: number
}
