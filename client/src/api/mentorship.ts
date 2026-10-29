import type {
  MentorContactView,
  MentorProfileInput,
  MentorProfileView,
  MentorSummaryView,
  MentorshipRequestInput,
  MentorshipSide,
  MentorshipState,
  MentorshipView,
  OwnMentorSettingsView,
  Page,
} from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface MentorBoardFilters {
  text: string
  tag: string
  topic: string
  openOnly: boolean
}

export interface MentorshipListFilters {
  side: MentorshipSide | null
  states: readonly MentorshipState[]
}

/** Every mentorship query sits under one account-scoped prefix, so one change refreshes them all. */
export const mentorshipKeys = {
  all: (accountId: string) => ['mentorship', accountId] as const,
  board: (accountId: string, filters: MentorBoardFilters, page: number) =>
    ['mentorship', accountId, 'board', filters, page] as const,
  mentor: (accountId: string, mentorId: string) => ['mentorship', accountId, 'mentor', mentorId] as const,
  contacts: (accountId: string, mentorId: string) => ['mentorship', accountId, 'contacts', mentorId] as const,
  own: (accountId: string) => ['mentorship', accountId, 'own'] as const,
  list: (accountId: string, filters: MentorshipListFilters, page: number) =>
    ['mentorship', accountId, 'list', filters.side, filters.states.join(','), page] as const,
  detail: (accountId: string, id: string) => ['mentorship', accountId, 'detail', id] as const,
}

/** Mentor pictures are 60-second signed links, so mentor data is refetched before they expire. */
const MENTOR_STALE_MS = 30_000

/** Mentorship changes also alter the mentor results of global search. */
function useInvalidateMentorship(accountId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: mentorshipKeys.all(accountId) }),
      queryClient.invalidateQueries({ queryKey: ['posts', accountId, 'search'] }),
    ])
}

const mentorPath = (mentorId: string) => `/mentors/${encodeURIComponent(mentorId)}`
const mentorshipPath = (id: string) => `/mentorships/${encodeURIComponent(id)}`

/** The Mentorship Board: available mentors, filtered by keyword, #tag, topic and open places. */
export function useMentorBoard(accountId: string, filters: MentorBoardFilters, page: number) {
  return useQuery({
    queryKey: mentorshipKeys.board(accountId, filters, page),
    queryFn: () =>
      api<Page<MentorSummaryView>>('/boards/mentorship', {
        query: {
          text: filters.text.trim() || null,
          tag: filters.tag.trim() || null,
          topic: filters.topic.trim() || null,
          openOnly: filters.openOnly ? 'true' : null,
          page,
        },
      }),
    staleTime: MENTOR_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

export function useMentorProfile(accountId: string, mentorId: string) {
  return useQuery({
    queryKey: mentorshipKeys.mentor(accountId, mentorId),
    queryFn: () => api<MentorProfileView>(mentorPath(mentorId)),
    staleTime: MENTOR_STALE_MS,
  })
}

/** Contacts are shown to the mentor's active mentees only; the server refuses everyone else. */
export function useMentorContacts(accountId: string, mentorId: string, enabled: boolean) {
  return useQuery({
    queryKey: mentorshipKeys.contacts(accountId, mentorId),
    queryFn: () => api<MentorContactView[]>(`${mentorPath(mentorId)}/contacts`),
    enabled,
  })
}

export function useOwnMentorSettings(accountId: string) {
  return useQuery({
    queryKey: mentorshipKeys.own(accountId),
    queryFn: () => api<OwnMentorSettingsView>('/mentors/me'),
  })
}

export function useUpdateMentorSettings(accountId: string) {
  const invalidate = useInvalidateMentorship(accountId)
  return useMutation({
    mutationFn: (input: MentorProfileInput) =>
      api<OwnMentorSettingsView>('/mentors/me', { method: 'PUT', body: input }),
    onSettled: invalidate,
  })
}

export function useRequestMentorship(accountId: string) {
  const invalidate = useInvalidateMentorship(accountId)
  return useMutation({
    mutationFn: ({ mentorId, input }: { mentorId: string; input: MentorshipRequestInput }) =>
      api<MentorshipView>(`${mentorPath(mentorId)}/mentorships`, { method: 'POST', body: input }),
    onSettled: invalidate,
  })
}

export function useMyMentorships(accountId: string, filters: MentorshipListFilters, page: number) {
  return useQuery({
    queryKey: mentorshipKeys.list(accountId, filters, page),
    queryFn: () =>
      api<Page<MentorshipView>>('/mentorships', {
        query: {
          side: filters.side,
          state: filters.states.length > 0 ? filters.states.join(',') : null,
          page,
        },
      }),
    staleTime: MENTOR_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

export function useMentorship(accountId: string, id: string) {
  return useQuery({
    queryKey: mentorshipKeys.detail(accountId, id),
    queryFn: () => api<MentorshipView>(mentorshipPath(id)),
    staleTime: MENTOR_STALE_MS,
  })
}

export type MentorshipAction = 'accept' | 'decline' | 'withdraw' | 'end'

const ACTION_PATHS: Record<MentorshipAction, string> = {
  accept: 'acceptance',
  decline: 'decline',
  withdraw: 'withdrawal',
  end: 'end',
}

/** Accept, decline, withdraw or end; every state is checked again by the server. */
export function useMentorshipAction(accountId: string) {
  const invalidate = useInvalidateMentorship(accountId)
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: MentorshipAction }) =>
      api<MentorshipView | undefined>(`${mentorshipPath(id)}/${ACTION_PATHS[action]}`, { method: 'POST' }),
    onSettled: invalidate,
  })
}
