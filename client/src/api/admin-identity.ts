import type {
  AdministratorInput,
  AdministratorView,
  AdminMemberFilter,
  AdminMemberSummaryView,
  AdminMemberView,
  AlumniDecisionInput,
  AlumniReviewView,
  GraduationDecisionInput,
  MemberEmailUpdateInput,
  Page,
  PendingGraduationView,
  ReasonInput,
  RoleCorrectionInput,
  StaffEmailInput,
  StaffEmailView,
} from '@hilcoe/shared'
import { hashKey, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/** Administrator identity data (Batch 1b). Keys are scoped by the signed-in Administrator. */
export const adminKeys = {
  all: (accountId: string) => ['admin', accountId] as const,
  members: (accountId: string, filter: AdminMemberFilter, query: string, page: number) =>
    ['admin', accountId, 'members', filter, query, page] as const,
  member: (accountId: string, memberId: string) => ['admin', accountId, 'member', memberId] as const,
  alumniReviews: (accountId: string, page: number) => ['admin', accountId, 'alumni-reviews', page] as const,
  graduationRequests: (accountId: string, page: number) =>
    ['admin', accountId, 'graduation-requests', page] as const,
  staffEmails: (accountId: string, query: string, page: number) =>
    ['admin', accountId, 'staff-emails', query, page] as const,
  administrators: (accountId: string) => ['admin', accountId, 'administrators'] as const,
}

const textOrUndefined = (value: string) => (value.trim() === '' ? undefined : value.trim())

export function useAdminMembers(accountId: string, filter: AdminMemberFilter, query: string, page: number) {
  return useQuery({
    queryKey: adminKeys.members(accountId, filter, query, page),
    queryFn: () =>
      api<Page<AdminMemberSummaryView>>('/admin/members', {
        query: { filter, page, query: textOrUndefined(query) },
      }),
    placeholderData: keepPreviousData,
  })
}

export function useAdminMember(accountId: string, memberId: string) {
  return useQuery({
    queryKey: adminKeys.member(accountId, memberId),
    queryFn: () => api<AdminMemberView>(`/admin/members/${encodeURIComponent(memberId)}`),
  })
}

export function useAlumniReviews(accountId: string, page: number) {
  return useQuery({
    queryKey: adminKeys.alumniReviews(accountId, page),
    queryFn: () => api<Page<AlumniReviewView>>('/admin/alumni-reviews', { query: { page } }),
    placeholderData: keepPreviousData,
  })
}

export function usePendingGraduationRequests(accountId: string, page: number) {
  return useQuery({
    queryKey: adminKeys.graduationRequests(accountId, page),
    queryFn: () => api<Page<PendingGraduationView>>('/admin/graduation-requests', { query: { page } }),
    placeholderData: keepPreviousData,
  })
}

export function useStaffEmails(accountId: string, query: string, page: number) {
  return useQuery({
    queryKey: adminKeys.staffEmails(accountId, query, page),
    queryFn: () =>
      api<Page<StaffEmailView>>('/admin/staff-emails', { query: { page, query: textOrUndefined(query) } }),
    placeholderData: keepPreviousData,
  })
}

export function useAdministrators(accountId: string) {
  return useQuery({
    queryKey: adminKeys.administrators(accountId),
    queryFn: () => api<AdministratorView[]>('/admin/administrators'),
  })
}

/** Every identity change can move an account between lists, so all Administrator data is refetched. */
function useInvalidateAdmin(accountId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: adminKeys.all(accountId) })
}

const memberPath = (memberId: string) => `/admin/members/${encodeURIComponent(memberId)}`

export function useReviewAlumni(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ reviewId, input }: { reviewId: string; input: AlumniDecisionInput }) =>
      api<void>(`/admin/alumni-reviews/${encodeURIComponent(reviewId)}/decision`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  })
}

export function useDecideGraduation(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ requestId, input }: { requestId: string; input: GraduationDecisionInput }) =>
      api<void>(`/admin/graduation-requests/${encodeURIComponent(requestId)}/decision`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  })
}

export function useCorrectRole(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: RoleCorrectionInput }) =>
      api<void>(`${memberPath(memberId)}/role`, { method: 'PUT', body: input }),
    onSuccess: invalidate,
  })
}

export function useUpdateMemberEmail(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: MemberEmailUpdateInput }) =>
      api<void>(`${memberPath(memberId)}/email`, { method: 'PUT', body: input }),
    onSuccess: invalidate,
  })
}

export function useDisableAccount(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: ReasonInput }) =>
      api<void>(`${memberPath(memberId)}/disable`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useRestoreAccount(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: ReasonInput }) =>
      api<void>(`${memberPath(memberId)}/restore`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useDeleteFakeAccount(accountId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: ReasonInput }) =>
      api<void>(memberPath(memberId), { method: 'DELETE', body: input }),
    // The deleted account's own page is not refetched: its 404 would replace the page before the
    // caller's onSuccess navigates away.
    onSuccess: (_data, { memberId }) => {
      const deleted = hashKey(adminKeys.member(accountId, memberId))
      return queryClient.invalidateQueries({
        queryKey: adminKeys.all(accountId),
        predicate: (query) => query.queryHash !== deleted,
      })
    },
  })
}

export function useAddStaffEmail(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: (input: StaffEmailInput) =>
      api<StaffEmailView>('/admin/staff-emails', { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useRemoveStaffEmail(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: (email: string) =>
      api<void>(`/admin/staff-emails/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useCreateAdministrator(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: (input: AdministratorInput) =>
      api<AdministratorView>('/admin/administrators', { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useResetAdministratorMfa(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ adminId, input }: { adminId: string; input: ReasonInput }) =>
      api<void>(`/admin/administrators/${encodeURIComponent(adminId)}/mfa-reset`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  })
}

export function useRemoveAdministrator(accountId: string) {
  const invalidate = useInvalidateAdmin(accountId)
  return useMutation({
    mutationFn: ({ adminId, input }: { adminId: string; input: ReasonInput }) =>
      api<void>(`/admin/administrators/${encodeURIComponent(adminId)}`, { method: 'DELETE', body: input }),
    onSuccess: invalidate,
  })
}

/** Copies the email Supabase Auth now holds into the Administrator account, after the email code. */
export function syncOwnAdministratorEmail(): Promise<AdministratorView> {
  return api<AdministratorView>('/admin/administrators/me/email', { method: 'PUT' })
}
