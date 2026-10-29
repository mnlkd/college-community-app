import {
  NOTIFICATION_RETENTION_DAYS,
  type ActorContextView,
  type NotificationType,
  type NotificationView,
} from '@hilcoe/shared'
import {
  Bell,
  BadgeCheck,
  Flag,
  GraduationCap,
  Handshake,
  Heart,
  MessageCircle,
  Reply,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { fetchComment, useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Button, Card, ColumnHeader, Note, cx } from '../../design/ui'

const TEXT: Record<NotificationType, (notice: NotificationView) => string> = {
  COMMENT: () => 'commented on your post.',
  REPLY: () => 'replied to your comment.',
  LIKE: (notice) => (notice.targetType === 'COMMENT' ? 'liked your comment.' : 'liked your post.'),
  MENTORSHIP_REQUEST: () => 'sent you a mentorship request.',
  MENTORSHIP_OUTCOME: () => 'updated a mentorship with you.',
  GROUP_REQUEST: () => 'asked to join your group.',
  GROUP_OUTCOME: () => 'updated your group membership.',
  GROUP_TRANSFER: () => 'updated a group ownership transfer.',
  ALUMNI_DECISION: () => 'Your Alumni status review has a decision.',
  GRADUATION_DECISION: () => 'Your graduation request has a decision.',
  MODERATION_OUTCOME: () => 'A moderation decision was made about your content.',
  REPORT_OUTCOME: () => 'A report you made has been reviewed.',
}

const ICON: Record<NotificationType, LucideIcon> = {
  COMMENT: MessageCircle,
  REPLY: Reply,
  LIKE: Heart,
  MENTORSHIP_REQUEST: Handshake,
  MENTORSHIP_OUTCOME: Handshake,
  GROUP_REQUEST: Users,
  GROUP_OUTCOME: Users,
  GROUP_TRANSFER: Users,
  ALUMNI_DECISION: BadgeCheck,
  GRADUATION_DECISION: GraduationCap,
  MODERATION_OUTCOME: Flag,
  REPORT_OUTCOME: Flag,
}

/** The sentence for a notice; member-caused notices start with the actor's name. */
export function noticeText(notice: NotificationView): { actor: string | null; text: string } {
  const text = TEXT[notice.type](notice)
  const startsWithActor = text.charAt(0) === text.charAt(0).toLowerCase()
  if (!startsWithActor) return { actor: null, text }
  return { actor: notice.actorName ?? 'A member', text }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(0, 'second')
}

/**
 * Notices about posts and comments open the post; mentorship and group notices open their item.
 * A report outcome opens the report history; a moderation outcome opens the moderation standing.
 */
export function canOpenNotice(notice: NotificationView): boolean {
  return (
    notice.targetType === 'POST' ||
    notice.targetType === 'COMMENT' ||
    notice.targetType === 'MENTORSHIP' ||
    notice.targetType === 'GROUP' ||
    notice.targetType === 'OPPORTUNITY' ||
    notice.targetType === 'REPORT'
  )
}

export function Notifications() {
  const actor = useOutletContext<ActorContextView>()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [openError, setOpenError] = useState<string | null>(null)
  const list = useNotifications(actor.accountId, page)
  const unread = useUnreadCount(actor.accountId)
  const markRead = useMarkRead(actor.accountId)
  const markAll = useMarkAllRead(actor.accountId)
  const unreadCount = unread.data?.count ?? 0

  async function openNotice(notice: NotificationView) {
    setOpenError(null)
    if (notice.unread) markRead.mutate(notice.id)
    if (notice.targetType === 'MENTORSHIP') {
      navigate(`/boards/mentorship/requests/${notice.targetId}`)
      return
    }
    if (notice.targetType === 'GROUP') {
      navigate(`/boards/activities/groups/${notice.targetId}`)
      return
    }
    if (notice.targetType === 'REPORT') {
      navigate(notice.type === 'MODERATION_OUTCOME' ? '/settings#moderation' : '/reports')
      return
    }
    if (notice.targetType === 'OPPORTUNITY') {
      navigate(`/boards/opportunities/listings/${notice.targetId}`)
      return
    }
    try {
      const postId =
        notice.targetType === 'COMMENT' ? (await fetchComment(notice.targetId)).postId : notice.targetId
      navigate(`/posts/${postId}`)
    } catch {
      setOpenError('That post or comment is no longer available.')
    }
  }

  const header = (
    <ColumnHeader
      title="Notifications"
      subtitle="Your discussion, mentorship, group and account updates."
      right={
        <Button
          size="sm"
          variant="secondary"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </Button>
      }
    />
  )
  if (list.isPending) return <LoadingContent />
  if (list.isError) return <ErrorContent message={list.error.message} onRetry={() => void list.refetch()} />
  const { items, total, pageSize } = list.data
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      {header}
      {(markRead.isError || markAll.isError || openError) && (
        <div className="mb-4">
          <Note tone="red">{openError ?? (markRead.error ?? markAll.error)?.message}</Note>
        </div>
      )}
      {items.length === 0 ? (
        <Note>{page === 1 ? 'No notifications yet.' : 'No more notifications.'}</Note>
      ) : (
        <Card className="divide-y divide-slate-4">
          <ul aria-label="Notifications">
            {items.map((notice) => {
              const Icon = ICON[notice.type] ?? Bell
              const { actor: name, text } = noticeText(notice)
              return (
                <li
                  key={notice.id}
                  data-unread={notice.unread || undefined}
                  className={cx('flex gap-3 px-4 py-4', notice.unread && 'bg-iris-2/60')}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-5 bg-white">
                    <Icon className="size-4 text-iris-11" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-relaxed text-slate-12">
                      {name && <strong>{name} </strong>}
                      {text}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-9">
                      <time dateTime={notice.createdAt}>{timeAgo(notice.createdAt)}</time>
                      {notice.unread && <span className="sr-only"> · unread</span>}
                    </p>
                  </div>
                  {canOpenNotice(notice) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Open notification from ${name ?? 'HiLCoE Commons'}`}
                      onClick={() => void openNotice(notice)}
                    >
                      Open
                    </Button>
                  )}
                  {notice.unread && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={markRead.isPending}
                      aria-label={`Mark notification from ${name ?? 'HiLCoE Commons'} as read`}
                      onClick={() => markRead.mutate(notice.id)}
                    >
                      Mark read
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <span className="text-[13px] text-slate-10">
            Page {page} of {pages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      )}
      <p className="mt-4 text-[12px] text-slate-9">
        Notifications are kept for {NOTIFICATION_RETENTION_DAYS} days.
      </p>
    </>
  )
}
