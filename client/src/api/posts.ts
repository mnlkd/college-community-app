import {
  POST_IMAGES_FIELD,
  POST_JSON_FIELD,
  type LikeTargetType,
  type LikeView,
  type MemberCardView,
  type Page,
  type PostEditInput,
  type PostInput,
  type PostView,
} from '@hilcoe/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/**
 * Every publishing and boards query sits under one account-scoped prefix, so a change to a post,
 * comment, like or save refreshes the feed, trending list, search results and saved items at once.
 */
export const postKeys = {
  all: (accountId: string) => ['posts', accountId] as const,
  feed: (accountId: string, page: number) => ['posts', accountId, 'feed', page] as const,
  trending: (accountId: string, limit: number) => ['posts', accountId, 'trending', limit] as const,
  detail: (accountId: string, postId: string) => ['posts', accountId, 'detail', postId] as const,
  comments: (accountId: string, postId: string, page: number) =>
    ['posts', accountId, 'comments', postId, page] as const,
  likers: (accountId: string, type: LikeTargetType, id: string, page: number) =>
    ['posts', accountId, 'likers', type, id, page] as const,
  search: (accountId: string, text: string, tag: string, page: number) =>
    ['posts', accountId, 'search', text, tag, page] as const,
  saved: (accountId: string, page: number) => ['posts', accountId, 'saved', page] as const,
}

/** Signed image and picture links last 60 seconds, so post data is refetched before they expire. */
export const POST_STALE_MS = 30_000

export function useInvalidatePosts(accountId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: postKeys.all(accountId) })
}

/** One image of a post being written: an image the post already has, or a new file. */
export type PostImageDraft =
  | { kind: 'existing'; imageId: string; url: string; altText: string }
  | { kind: 'new'; file: File; previewUrl: string; altText: string }

export interface PostDraft {
  body: string
  tags: string[]
  images: PostImageDraft[]
}

/**
 * The multipart body of Create Post and Edit Post: the JSON field `post` lists the image slots in
 * display order (imageId null takes the next uploaded file), followed by the new files.
 */
export function buildPostForm(draft: PostDraft, version?: number): FormData {
  const input: PostInput | PostEditInput = {
    body: draft.body,
    tags: draft.tags,
    images: draft.images.map((image) => ({
      imageId: image.kind === 'existing' ? image.imageId : null,
      altText: image.altText,
    })),
    ...(version === undefined ? {} : { version }),
  }
  const form = new FormData()
  form.append(POST_JSON_FIELD, JSON.stringify(input))
  for (const image of draft.images) {
    if (image.kind === 'new') form.append(POST_IMAGES_FIELD, image.file, image.file.name)
  }
  return form
}

const postPath = (postId: string) => `/posts/${encodeURIComponent(postId)}`

export function usePost(accountId: string, postId: string) {
  return useQuery({
    queryKey: postKeys.detail(accountId, postId),
    queryFn: () => api<PostView>(postPath(postId)),
    staleTime: POST_STALE_MS,
  })
}

export function useCreatePost(accountId: string) {
  const invalidate = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: (draft: PostDraft) => api<PostView>('/posts', { method: 'POST', body: buildPostForm(draft) }),
    onSuccess: invalidate,
  })
}

export function useEditPost(accountId: string, postId: string) {
  const invalidate = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: ({ draft, version }: { draft: PostDraft; version: number }) =>
      api<PostView>(postPath(postId), { method: 'PUT', body: buildPostForm(draft, version) }),
    onSuccess: invalidate,
  })
}

export function useDeletePost(accountId: string) {
  const invalidate = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: (postId: string) => api<void>(postPath(postId), { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

/** Counts a qualifying view; the server ignores the author's own views and repeats on one UTC day. */
export function recordPostView(postId: string): Promise<void> {
  return api<void>(`${postPath(postId)}/views`, { method: 'POST' })
}

const likePath = (type: LikeTargetType, id: string) =>
  `/${type === 'POST' ? 'posts' : 'comments'}/${encodeURIComponent(id)}/likes`

export function useToggleLike(accountId: string) {
  const invalidate = useInvalidatePosts(accountId)
  return useMutation({
    mutationFn: ({ type, id, like }: { type: LikeTargetType; id: string; like: boolean }) =>
      api<LikeView>(likePath(type, id), { method: like ? 'PUT' : 'DELETE' }),
    onSettled: invalidate,
  })
}

export function useLikers(accountId: string, type: LikeTargetType, id: string, page: number, enabled = true) {
  return useQuery({
    queryKey: postKeys.likers(accountId, type, id, page),
    queryFn: () => api<Page<MemberCardView>>(likePath(type, id), { query: { page } }),
    enabled,
    staleTime: POST_STALE_MS,
    placeholderData: keepPreviousData,
  })
}
