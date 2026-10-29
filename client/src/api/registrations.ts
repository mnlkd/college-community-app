import type { OwnAccountView, RegistrationInput, RegistrationStatusView } from '@hilcoe/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export const registrationKeys = {
  status: (authUserId: string) => ['registrations', 'me', authUserId] as const,
}

/** Works for any signed-in Supabase user, including one without a platform account yet. */
export function fetchRegistrationStatus(): Promise<RegistrationStatusView> {
  return api<RegistrationStatusView>('/registrations/me')
}

export function useRegistrationStatus(authUserId: string | null) {
  return useQuery({
    queryKey: registrationKeys.status(authUserId ?? ''),
    queryFn: fetchRegistrationStatus,
    enabled: authUserId !== null,
  })
}

export function completeRegistration(input: RegistrationInput): Promise<OwnAccountView> {
  return api<OwnAccountView>('/registrations', { method: 'POST', body: input })
}
