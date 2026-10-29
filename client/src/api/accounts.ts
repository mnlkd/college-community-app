import type { ActorContextView } from '@hilcoe/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export const accountKeys = {
  me: (authUserId: string) => ['accounts', 'me', authUserId] as const,
  adminMe: (authUserId: string) => ['admin', 'accounts', 'me', authUserId] as const,
}

export function fetchMe(): Promise<ActorContextView> {
  return api<ActorContextView>('/accounts/me')
}

export function fetchAdminMe(): Promise<ActorContextView> {
  return api<ActorContextView>('/admin/accounts/me')
}

/** The signed-in member's ActorContext. Pass the auth user id so a new sign-in never reuses old data. */
export function useMe(authUserId: string | null) {
  return useQuery({
    queryKey: accountKeys.me(authUserId ?? ''),
    queryFn: fetchMe,
    enabled: authUserId !== null,
    staleTime: 60_000,
  })
}

export function useAdminMe(authUserId: string | null) {
  return useQuery({
    queryKey: accountKeys.adminMe(authUserId ?? ''),
    queryFn: fetchAdminMe,
    enabled: authUserId !== null,
    staleTime: 60_000,
  })
}
