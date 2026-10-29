import {
  QUEUE_COUNTS_POLL_MS,
  type AnalyticsWindow,
  type DashboardSummaryView,
  type QueueCountsView,
} from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { DownloadedFile } from './http'

/** View Analytics and Export CSV (FR-11) and the Administrator queue counts. */
export const analyticsKeys = {
  dashboard: (accountId: string, windowDays: AnalyticsWindow) =>
    ['admin', accountId, 'analytics', windowDays] as const,
  queueCounts: (accountId: string) => ['admin', accountId, 'queue-counts'] as const,
}

export function useAnalytics(accountId: string, windowDays: AnalyticsWindow) {
  return useQuery({
    queryKey: analyticsKeys.dashboard(accountId, windowDays),
    queryFn: () => api<DashboardSummaryView>('/admin/analytics', { query: { windowDays } }),
    placeholderData: keepPreviousData,
  })
}

/** Polls every 30 seconds while the page is visible, like the member notice count. */
export function useQueueCounts(accountId: string | null) {
  return useQuery({
    queryKey: analyticsKeys.queueCounts(accountId ?? ''),
    queryFn: () => api<QueueCountsView>('/admin/queue-counts'),
    enabled: accountId !== null,
    refetchInterval: QUEUE_COUNTS_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

/** Hands a downloaded file to the browser as a download. */
export function saveFile(file: DownloadedFile, fallbackName: string): void {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName ?? fallbackName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Downloads the aggregate CSV with the Administrator's token. */
export function useExportAnalytics() {
  return useMutation({
    mutationFn: async (windowDays: AnalyticsWindow) => {
      const file = await api<DownloadedFile>('/admin/analytics/export.csv', {
        query: { windowDays },
        responseType: 'file',
      })
      saveFile(file, `hilcoe-commons-aggregates-${windowDays}d.csv`)
    },
  })
}
