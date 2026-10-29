import {
  SAVE_TARGET_PATHS,
  type Page,
  type PostSummaryView,
  type SaveTargetType,
  type SavedItemView,
  type SearchResultView,
} from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { POST_STALE_MS, postKeys, useInvalidatePosts } from './posts'

/** Home feed: visible posts, newest first. */
export function useHomeFeed(accountId: string, page: number) {
  return useQuery({
    queryKey: postKeys.feed(accountId, page),
    queryFn: () => api<Page<PostSummaryView>>('/posts', { query: { page } }),
    staleTime: POST_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

export function useTrendingPosts(accountId: string, limit?: number) {
  return useQuery({
    queryKey: postKeys.trending(accountId, limit ?? 0),
    queryFn: () => api<PostSummaryView[]>('/posts/trending', { query: { limit } }),
    staleTime: POST_STALE_MS,
  })
}

/** Global search by text, tag or both; disabled until one of them is given. */
export function useSearch(accountId: string, text: string, tag: string, page: number) {
  return useQuery({
    queryKey: postKeys.search(accountId, text, tag, page),
    queryFn: () =>
      api<SearchResultView>('/search', { query: { text: text || null, tag: tag || null, page } }),
    enabled: text.trim() !== '' || tag.trim() !== '',
    staleTime: POST_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

export function useSavedItems(accountId: string, page: number) {
  return useQuery({
    queryKey: postKeys.saved(accountId, page),
    queryFn: () => api<Page<SavedItemView>>('/saved-items', { query: { page } }),
    staleTime: POST_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

export function useToggleSave(accountId: string) {
  const queryClient = useQueryClient()
  const invalidatePosts = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: ({ type, id, save }: { type: SaveTargetType; id: string; save: boolean }) =>
      api<void>(`/saved-items/${SAVE_TARGET_PATHS[type]}/${encodeURIComponent(id)}`, {
        method: save ? 'PUT' : 'DELETE',
      }),
    // Listings and groups show savedByMe too.
    onSettled: () =>
      Promise.all([
        invalidatePosts(),
        queryClient.invalidateQueries({ queryKey: ['opportunities', accountId] }),
        queryClient.invalidateQueries({ queryKey: ['groups', accountId] }),
      ]),
  })
}
