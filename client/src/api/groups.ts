import type {
  GroupEditInput,
  GroupInput,
  GroupRelation,
  GroupState,
  GroupSummaryView,
  GroupTransferView,
  GroupView,
  MembershipView,
  Page,
} from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface GroupBoardFilters {
  text: string
  tag: string
}

export interface MyGroupsFilters {
  relation: GroupRelation | null
  state: GroupState | null
}

/** Every group query sits under one account-scoped prefix, so one change refreshes them all. */
export const groupKeys = {
  all: (accountId: string) => ['groups', accountId] as const,
  board: (accountId: string, filters: GroupBoardFilters, page: number) =>
    ['groups', accountId, 'board', filters, page] as const,
  mine: (accountId: string, filters: MyGroupsFilters, page: number) =>
    ['groups', accountId, 'mine', filters, page] as const,
  detail: (accountId: string, id: string) => ['groups', accountId, 'detail', id] as const,
  requests: (accountId: string, id: string, page: number) =>
    ['groups', accountId, 'requests', id, page] as const,
}

/** Member pictures are 60-second signed links, so group data is refetched before they expire. */
const GROUP_STALE_MS = 30_000

const groupPath = (id: string) => `/groups/${encodeURIComponent(id)}`
const transferPath = (id: string) => `/group-transfers/${encodeURIComponent(id)}`

/** Group changes also alter global search and saved items, which sit under the posts prefix. */
function useInvalidateGroups(accountId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: groupKeys.all(accountId) }),
      queryClient.invalidateQueries({ queryKey: ['posts', accountId, 'search'] }),
      queryClient.invalidateQueries({ queryKey: ['posts', accountId, 'saved'] }),
    ])
}

/** The Activities Board: open groups by keyword or #tag. */
export function useGroupBoard(accountId: string, filters: GroupBoardFilters, page: number) {
  return useQuery({
    queryKey: groupKeys.board(accountId, filters, page),
    queryFn: () =>
      api<Page<GroupSummaryView>>('/boards/activities', {
        query: { text: filters.text.trim() || null, tag: filters.tag.trim() || null, page },
      }),
    staleTime: GROUP_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

/** Groups the actor owns, has joined or asked to join. */
export function useMyGroups(accountId: string, filters: MyGroupsFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: groupKeys.mine(accountId, filters, page),
    queryFn: () =>
      api<Page<GroupSummaryView>>('/groups/mine', {
        query: { relation: filters.relation, state: filters.state, page },
      }),
    staleTime: GROUP_STALE_MS,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useGroup(accountId: string, id: string) {
  return useQuery({
    queryKey: groupKeys.detail(accountId, id),
    queryFn: () => api<GroupView>(groupPath(id)),
    staleTime: GROUP_STALE_MS,
  })
}

/** The owner's queue of pending join requests, oldest first. */
export function useJoinRequests(accountId: string, id: string, page: number, enabled = true) {
  return useQuery({
    queryKey: groupKeys.requests(accountId, id, page),
    queryFn: () => api<Page<MembershipView>>(`${groupPath(id)}/join-requests`, { query: { page } }),
    staleTime: GROUP_STALE_MS,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useCreateGroup(accountId: string) {
  const invalidate = useInvalidateGroups(accountId)
  return useMutation({
    mutationFn: (input: GroupInput) => api<GroupView>('/groups', { method: 'POST', body: input }),
    onSettled: invalidate,
  })
}

export function useEditGroup(accountId: string) {
  const invalidate = useInvalidateGroups(accountId)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GroupEditInput }) =>
      api<GroupView>(groupPath(id), { method: 'PUT', body: input }),
    onSettled: invalidate,
  })
}

export type GroupAction = 'close' | 'join' | 'withdraw' | 'leave'

const GROUP_ACTIONS: Record<GroupAction, { method: 'POST' | 'DELETE'; path: string }> = {
  close: { method: 'POST', path: 'closure' },
  join: { method: 'POST', path: 'memberships' },
  withdraw: { method: 'DELETE', path: 'memberships/me' },
  leave: { method: 'POST', path: 'departure' },
}

/** Close, request to join, withdraw a request or leave; every state is checked again by the server. */
export function useGroupAction(accountId: string) {
  const invalidate = useInvalidateGroups(accountId)
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: GroupAction }) => {
      const { method, path } = GROUP_ACTIONS[action]
      return api<unknown>(`${groupPath(id)}/${path}`, { method })
    },
    onSettled: invalidate,
  })
}

/** The owner approves or declines a pending join request. */
export function useDecideJoinRequest(accountId: string) {
  const invalidate = useInvalidateGroups(accountId)
  return useMutation({
    mutationFn: ({ membershipId, approve }: { membershipId: string; approve: boolean }) =>
      api<void>(
        `/group-memberships/${encodeURIComponent(membershipId)}/${approve ? 'approval' : 'decline'}`,
        {
          method: 'POST',
        },
      ),
    onSettled: invalidate,
  })
}

export function useProposeTransfer(accountId: string) {
  const invalidate = useInvalidateGroups(accountId)
  return useMutation({
    mutationFn: ({ groupId, memberId }: { groupId: string; memberId: string }) =>
      api<GroupTransferView>(`${groupPath(groupId)}/transfers`, { method: 'POST', body: { memberId } }),
    onSettled: invalidate,
  })
}

export type TransferAction = 'accept' | 'decline' | 'cancel'

const TRANSFER_PATHS: Record<TransferAction, string> = {
  accept: 'acceptance',
  decline: 'decline',
  cancel: 'cancellation',
}

/** The recipient accepts or declines; the owner cancels. */
export function useTransferAction(accountId: string) {
  const invalidate = useInvalidateGroups(accountId)
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: TransferAction }) =>
      api<void>(`${transferPath(id)}/${TRANSFER_PATHS[action]}`, { method: 'POST' }),
    onSettled: invalidate,
  })
}
