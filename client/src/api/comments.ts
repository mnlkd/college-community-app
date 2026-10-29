import type { CommentEditInput, CommentInput, CommentView, Page } from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from './client'
import { POST_STALE_MS, postKeys, useInvalidatePosts } from './posts'

const commentPath = (commentId: string) => `/comments/${encodeURIComponent(commentId)}`

/** Top-level comments oldest first, each with its replies. */
export function useComments(accountId: string, postId: string, page: number) {
  return useQuery({
    queryKey: postKeys.comments(accountId, postId, page),
    queryFn: () =>
      api<Page<CommentView>>(`/posts/${encodeURIComponent(postId)}/comments`, { query: { page } }),
    staleTime: POST_STALE_MS,
    placeholderData: keepPreviousData,
  })
}

/** One comment, used to open the post a comment notice points at. */
export function fetchComment(commentId: string): Promise<CommentView> {
  return api<CommentView>(commentPath(commentId))
}

export function useCreateComment(accountId: string, postId: string) {
  const invalidate = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: (input: CommentInput) =>
      api<CommentView>(`/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useEditComment(accountId: string) {
  const invalidate = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: ({ commentId, input }: { commentId: string; input: CommentEditInput }) =>
      api<CommentView>(commentPath(commentId), { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  })
}

export function useDeleteComment(accountId: string) {
  const invalidate = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: (commentId: string) => api<void>(commentPath(commentId), { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
