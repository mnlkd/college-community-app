import type {
  OpportunityEditInput,
  OpportunityInput,
  OpportunityType,
  OpportunityView,
  Page,
  WorkArrangement,
} from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface OpportunityBoardFilters {
  text: string
  tag: string
  type: OpportunityType | null
  workArrangement: WorkArrangement | null
  /** The actor's own listings in every state. */
  mine: boolean
}

export const opportunityKeys = {
  all: (accountId: string) => ['opportunities', accountId] as const,
  board: (accountId: string, filters: OpportunityBoardFilters, page: number) =>
    ['opportunities', accountId, 'board', filters, page] as const,
  detail: (accountId: string, id: string) => ['opportunities', accountId, 'detail', id] as const,
}

/** Author pictures are 60-second signed links, so listings are refetched before they expire. */
const OPPORTUNITY_STALE_MS = 30_000

const opportunityPath = (id: string) => `/opportunities/${encodeURIComponent(id)}`

/** Listing changes also alter global search and saved items, which sit under the posts prefix. */
function useInvalidateOpportunities(accountId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: opportunityKeys.all(accountId) }),
      queryClient.invalidateQueries({ queryKey: ['posts', accountId, 'search'] }),
      queryClient.invalidateQueries({ queryKey: ['posts', accountId, 'saved'] }),
    ])
}

/** The Opportunities Board: open listings by keyword, #tag, type and arrangement, or "My listings". */
export function useOpportunityBoard(accountId: string, filters: OpportunityBoardFilters, page: number) {
  return useQuery({
    queryKey: opportunityKeys.board(accountId, filters, page),
    queryFn: () =>
      api<Page<OpportunityView>>('/boards/opportunities', {
        query: {
          text: filters.text.trim() || null,
          tag: filters.tag.trim() || null,
          type: filters.type,
          workArrangement: filters.workArrangement,
          mine: filters.mine ? 'true' : null,
          page,
        },
      }),
    staleTime: OPPORTUNITY_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

export function useOpportunity(accountId: string, id: string) {
  return useQuery({
    queryKey: opportunityKeys.detail(accountId, id),
    queryFn: () => api<OpportunityView>(opportunityPath(id)),
    staleTime: OPPORTUNITY_STALE_MS,
  })
}

export function useCreateOpportunity(accountId: string) {
  const invalidate = useInvalidateOpportunities(accountId)
  return useMutation({
    mutationFn: (input: OpportunityInput) =>
      api<OpportunityView>('/opportunities', { method: 'POST', body: input }),
    onSettled: invalidate,
  })
}

export function useEditOpportunity(accountId: string) {
  const invalidate = useInvalidateOpportunities(accountId)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: OpportunityEditInput }) =>
      api<OpportunityView>(opportunityPath(id), { method: 'PUT', body: input }),
    onSettled: invalidate,
  })
}

/** Closure is final. */
export function useCloseOpportunity(accountId: string) {
  const invalidate = useInvalidateOpportunities(accountId)
  return useMutation({
    mutationFn: (id: string) => api<void>(`${opportunityPath(id)}/closure`, { method: 'POST' }),
    onSettled: invalidate,
  })
}
