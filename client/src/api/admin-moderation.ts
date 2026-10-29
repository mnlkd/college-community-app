import type {
  AdminReportState,
  AuditAction,
  AuditRecordView,
  DecisionResultView,
  Page,
  ReportDecisionInput,
  ReportDetailView,
  ReportSummaryView,
} from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface AuditFilters {
  action: AuditAction | null
  adminId: string
  memberId: string
  from: string
  to: string
}

/** Administrator moderation queue and audit log (Batch 5). Keys are scoped by the Administrator. */
export const adminModerationKeys = {
  all: (accountId: string) => ['admin', accountId, 'moderation'] as const,
  reports: (accountId: string, state: AdminReportState, page: number) =>
    ['admin', accountId, 'moderation', 'reports', state, page] as const,
  report: (accountId: string, reportId: string) =>
    ['admin', accountId, 'moderation', 'report', reportId] as const,
  audit: (accountId: string, filters: AuditFilters, page: number) =>
    ['admin', accountId, 'audit', filters, page] as const,
}

/** Evidence images are 60-second signed links, so a report is refetched before they expire. */
const EVIDENCE_STALE_MS = 30_000

const reportPath = (reportId: string) => `/admin/reports/${encodeURIComponent(reportId)}`

export function useAdminReports(accountId: string, state: AdminReportState, page: number) {
  return useQuery({
    queryKey: adminModerationKeys.reports(accountId, state, page),
    queryFn: () => api<Page<ReportSummaryView>>('/admin/reports', { query: { state, page } }),
    staleTime: EVIDENCE_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

export function useAdminReport(accountId: string, reportId: string) {
  return useQuery({
    queryKey: adminModerationKeys.report(accountId, reportId),
    queryFn: () => api<ReportDetailView>(reportPath(reportId)),
    staleTime: EVIDENCE_STALE_MS,
    refetchInterval: EVIDENCE_STALE_MS,
  })
}

export function useDecideReport(accountId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reportId, input }: { reportId: string; input: ReportDecisionInput }) =>
      api<DecisionResultView>(`${reportPath(reportId)}/decision`, { method: 'POST', body: input }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: adminModerationKeys.all(accountId) }),
        queryClient.invalidateQueries({ queryKey: ['admin', accountId, 'audit'] }),
      ]),
  })
}

export function useAuditRecords(accountId: string, filters: AuditFilters, page: number) {
  return useQuery({
    queryKey: adminModerationKeys.audit(accountId, filters, page),
    queryFn: () =>
      api<Page<AuditRecordView>>('/admin/audit-records', {
        query: {
          action: filters.action,
          adminId: filters.adminId.trim() || null,
          memberId: filters.memberId.trim() || null,
          from: filters.from || null,
          to: filters.to || null,
          page,
        },
      }),
    placeholderData: keepPreviousData,
  })
}
