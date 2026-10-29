import type { ConsequenceView, Page, ReportInput, ReportView } from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/** A member's reports and consequences (Batch 5). Keys are scoped by the signed-in member. */
export const moderationKeys = {
  all: (accountId: string) => ['moderation', accountId] as const,
  myReports: (accountId: string, page: number) => ['moderation', accountId, 'reports', page] as const,
  myConsequences: (accountId: string) => ['moderation', accountId, 'consequences'] as const,
}

export function useMyReports(accountId: string, page: number) {
  return useQuery({
    queryKey: moderationKeys.myReports(accountId, page),
    queryFn: () => api<Page<ReportView>>('/reports/mine', { query: { page } }),
    placeholderData: keepPreviousData,
  })
}

export function useMyConsequences(accountId: string) {
  return useQuery({
    queryKey: moderationKeys.myConsequences(accountId),
    queryFn: () => api<ConsequenceView[]>('/consequences/mine'),
  })
}

export function useSubmitReport(accountId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ReportInput) => api<ReportView>('/reports', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: moderationKeys.all(accountId) }),
  })
}
