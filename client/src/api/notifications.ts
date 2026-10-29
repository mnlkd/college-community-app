import { NOTIFICATION_POLL_MS, type NotificationView, type Page, type UnreadCountView } from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export const notificationKeys = {
  all: (accountId: string) => ['notifications', accountId] as const,
  list: (accountId: string, page: number) => ['notifications', accountId, 'list', page] as const,
  unread: (accountId: string) => ['notifications', accountId, 'unread'] as const,
}

export function useNotifications(accountId: string, page: number) {
  return useQuery({
    queryKey: notificationKeys.list(accountId, page),
    queryFn: () => api<Page<NotificationView>>('/notifications', { query: { page } }),
    placeholderData: keepPreviousData,
  })
}

/** Polls every 30 seconds while the page is visible; TanStack Query pauses it in the background. */
export function useUnreadCount(accountId: string | null) {
  return useQuery({
    queryKey: notificationKeys.unread(accountId ?? ''),
    queryFn: () => api<UnreadCountView>('/notifications/unread-count'),
    enabled: accountId !== null,
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

function useInvalidateNotifications(accountId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: notificationKeys.all(accountId) })
}

export function useMarkRead(accountId: string) {
  const invalidate = useInvalidateNotifications(accountId)
  return useMutation({
    mutationFn: (notificationId: string) =>
      api<void>(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' }),
    onSettled: invalidate,
  })
}

export function useMarkAllRead(accountId: string) {
  const invalidate = useInvalidateNotifications(accountId)
  return useMutation({
    mutationFn: () => api<void>('/notifications/read-all', { method: 'POST' }),
    onSettled: invalidate,
  })
}
