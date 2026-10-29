import type {
  DeleteAccountInput,
  GraduationInput,
  GraduationRequestView,
  OwnAccountView,
  ProfileInput,
  ProfileView,
} from '@hilcoe/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/** Keys are scoped by the signed-in account so another account never sees cached data. */
export const memberKeys = {
  all: (accountId: string) => ['members', accountId] as const,
  own: (accountId: string) => ['members', accountId, 'me'] as const,
  profile: (accountId: string, memberId: string) => ['members', accountId, 'profile', memberId] as const,
  graduationRequests: (accountId: string) => ['members', accountId, 'graduation-requests'] as const,
}

/** Signed picture links last 60 seconds, so profile data is refetched before they expire. */
const PICTURE_STALE_MS = 45_000

export function useOwnAccount(accountId: string | null) {
  return useQuery({
    queryKey: memberKeys.own(accountId ?? ''),
    queryFn: () => api<OwnAccountView>('/members/me'),
    enabled: accountId !== null,
    staleTime: PICTURE_STALE_MS,
  })
}

export function useProfile(accountId: string, memberId: string) {
  return useQuery({
    queryKey: memberKeys.profile(accountId, memberId),
    queryFn: () => api<ProfileView>(`/members/${encodeURIComponent(memberId)}/profile`),
    staleTime: PICTURE_STALE_MS,
  })
}

export function useGraduationRequests(accountId: string) {
  return useQuery({
    queryKey: memberKeys.graduationRequests(accountId),
    queryFn: () => api<GraduationRequestView[]>('/members/me/graduation-requests'),
  })
}

function useInvalidateMember(accountId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: memberKeys.all(accountId) })
}

export function useUpdateProfile(accountId: string) {
  const invalidate = useInvalidateMember(accountId)
  return useMutation({
    mutationFn: (input: ProfileInput) =>
      api<ProfileView>('/members/me/profile', { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  })
}

/** The server takes the image in the multipart field `picture`. */
export function useUploadProfilePicture(accountId: string) {
  const invalidate = useInvalidateMember(accountId)
  return useMutation({
    mutationFn: (file: Blob) => {
      const body = new FormData()
      body.append('picture', file)
      return api<ProfileView>('/members/me/profile-picture', { method: 'PUT', body })
    },
    onSuccess: invalidate,
  })
}

export function useRemoveProfilePicture(accountId: string) {
  const invalidate = useInvalidateMember(accountId)
  return useMutation({
    mutationFn: () => api<ProfileView>('/members/me/profile-picture', { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

/** Copies the email Supabase Auth now holds into the platform account, after the email code. */
export function useSyncEmail(accountId: string) {
  const invalidate = useInvalidateMember(accountId)
  return useMutation({
    mutationFn: () => api<OwnAccountView>('/members/me/email', { method: 'PUT' }),
    onSuccess: invalidate,
  })
}

export function useRequestGraduation(accountId: string) {
  const invalidate = useInvalidateMember(accountId)
  return useMutation({
    mutationFn: (input: GraduationInput) =>
      api<GraduationRequestView>('/members/me/graduation-requests', { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function deleteOwnAccount(input: DeleteAccountInput): Promise<void> {
  return api<void>('/members/me', { method: 'DELETE', body: input })
}
