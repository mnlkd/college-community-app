import {
  ALT_TEXT_MAX,
  POST_BODY_MAX,
  POST_IMAGES_MAX,
  POST_TAGS_MAX,
  normalizeTag,
  type ActorContextView,
  type PostView,
} from '@hilcoe/shared'
import { ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  isApiError,
  useCreatePost,
  useDeletePost,
  useEditPost,
  usePost,
  type PostDraft,
  type PostImageDraft,
} from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Badge, Button, Card, ColumnHeader, Field, Note, TextArea, TextInput } from '../../design/ui'
import { pictureProblem } from '../profile/EditProfile'
import { publishBlockReason } from './eligibility'

/** Problems found before sending; the server checks everything again. */
export function draftProblems(draft: PostDraft): Record<string, string> {
  const problems: Record<string, string> = {}
  const body = draft.body.trim()
  if (body.length > POST_BODY_MAX) problems.body = `At most ${POST_BODY_MAX} characters`
  else if (body === '' && draft.images.length === 0) problems.body = 'Write something or add an image'
  if (draft.images.length > POST_IMAGES_MAX) problems.images = `At most ${POST_IMAGES_MAX} images`
  draft.images.forEach((image, index) => {
    if (image.altText.trim().length > ALT_TEXT_MAX) {
      problems[`images.${index}.altText`] = `At most ${ALT_TEXT_MAX} characters`
    }
  })
  return problems
}

function draftFrom(post: PostView | null): PostDraft {
  if (!post) return { body: '', tags: [], images: [] }
  return {
    body: post.body ?? '',
    tags: [...post.tags],
    images: post.images.map((image) => ({
      kind: 'existing',
      imageId: image.id,
      url: image.url,
      altText: image.altText ?? '',
    })),
  }
}

function PostForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
  extra,
}: {
  initial: PostDraft
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (draft: PostDraft) => void
  onCancel: () => void
  extra?: ReactNode
}) {
  const [draft, setDraft] = useState<PostDraft>(initial)
  const [tagText, setTagText] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const fileInput = useRef<HTMLInputElement>(null)
  const previews = useRef(new Set<string>())

  useEffect(() => {
    const urls = previews.current
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const serverFields = isApiError(error) ? (error.fields ?? {}) : {}
  const fieldError = (name: string) => problems[name] ?? serverFields[name]
  const imageFieldError =
    imageError ??
    fieldError('images') ??
    Object.entries(serverFields).find(([key]) => key.startsWith('images'))?.[1]

  /** Adds the typed tag; returns the new tag list, or null when the typed text is not a valid tag. */
  function addTag(): string[] | null {
    const text = tagText.trim()
    if (text === '') return draft.tags
    const tag = normalizeTag(text)
    if (tag === null) {
      setTagError('Use 1 to 30 letters, digits, hyphens or underscores.')
      return null
    }
    if (draft.tags.includes(tag)) {
      setTagText('')
      return draft.tags
    }
    if (draft.tags.length >= POST_TAGS_MAX) {
      setTagError(`At most ${POST_TAGS_MAX} tags.`)
      return null
    }
    const tags = [...draft.tags, tag]
    setDraft({ ...draft, tags })
    setTagText('')
    setTagError(null)
    return tags
  }

  function onTagKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag()
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return
    const added: PostImageDraft[] = []
    for (const file of Array.from(files)) {
      const problem = pictureProblem(file)
      if (problem) {
        setImageError(problem)
        continue
      }
      const previewUrl = URL.createObjectURL(file)
      previews.current.add(previewUrl)
      added.push({ kind: 'new', file, previewUrl, altText: '' })
    }
    const room = POST_IMAGES_MAX - draft.images.length
    if (added.length > room) setImageError(`At most ${POST_IMAGES_MAX} images.`)
    else if (added.length > 0) setImageError(null)
    setDraft({ ...draft, images: [...draft.images, ...added.slice(0, Math.max(0, room))] })
    if (fileInput.current) fileInput.current.value = ''
  }

  function updateImage(index: number, change: Partial<Pick<PostImageDraft, 'altText'>> | null) {
    const images =
      change === null
        ? draft.images.filter((_, at) => at !== index)
        : draft.images.map((image, at) => (at === index ? { ...image, ...change } : image))
    setDraft({ ...draft, images })
    if (change === null) setImageError(null)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const tags = addTag()
    if (tags === null) return
    const final = { ...draft, tags }
    const found = draftProblems(final)
    setProblems(found)
    if (Object.keys(found).length === 0) onSubmit(final)
  }

  const generalError =
    error && !(isApiError(error) && error.code === 'VALIDATION_FAILED' && error.fields)
      ? isApiError(error) && error.code === 'CONFLICT'
        ? 'This post changed since you opened it. Reload the page to edit the latest version.'
        : (error as Error).message
      : null

  return (
    <form onSubmit={submit} noValidate>
      <Card className="space-y-4 px-5 py-4">
        {generalError && <Note tone="red">{generalError}</Note>}
        <Field
          label="Post"
          hint={`Plain text, paragraphs and links · ${draft.body.trim().length} / ${POST_BODY_MAX}`}
          error={fieldError('body')}
        >
          <TextArea
            rows={6}
            value={draft.body}
            invalid={Boolean(fieldError('body'))}
            placeholder="Share an update, a question, or something useful…"
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
        </Field>

        <Field
          label="Tags"
          hint={`${draft.tags.length} / ${POST_TAGS_MAX} optional tags · press Enter or comma to add`}
          error={tagError ?? fieldError('tags')}
        >
          <TextInput
            value={tagText}
            placeholder="#career"
            invalid={Boolean(tagError)}
            onChange={(event) => setTagText(event.target.value)}
            onKeyDown={onTagKey}
            onBlur={() => addTag()}
          />
        </Field>
        {draft.tags.length > 0 && (
          <ul aria-label="Tags" className="flex flex-wrap gap-2">
            {draft.tags.map((tag) => (
              <li key={tag}>
                <Badge tone="iris">
                  #{tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    className="ml-1"
                    onClick={() => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) })}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="secondary"
              disabled={draft.images.length >= POST_IMAGES_MAX}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="size-4" /> Add images
            </Button>
            <span className="text-[12px] text-slate-10">
              {draft.images.length} / {POST_IMAGES_MAX} images · JPEG, PNG or WebP · maximum 5 MB each
            </span>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            aria-label="Choose images"
            data-testid="post-image-input"
            onChange={(event) => addFiles(event.target.files)}
          />
          {imageFieldError && (
            <p role="alert" className="mt-1.5 text-[12px] text-red-11">
              {imageFieldError}
            </p>
          )}
        </div>
        {draft.images.map((image, index) => (
          <div key={image.kind === 'existing' ? image.imageId : image.previewUrl} className="flex gap-3">
            <img
              src={image.kind === 'existing' ? image.url : image.previewUrl}
              alt={image.altText || `Image ${index + 1}`}
              className="size-24 shrink-0 rounded-lg border border-slate-5 object-cover"
            />
            <div className="min-w-0 flex-1">
              <Field
                label={`Image ${index + 1} description (alt text)`}
                hint={`Optional · read aloud by screen readers · up to ${ALT_TEXT_MAX} characters`}
                error={fieldError(`images.${index}.altText`)}
              >
                <TextInput
                  value={image.altText}
                  onChange={(event) => updateImage(index, { altText: event.target.value })}
                />
              </Field>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1"
                aria-label={`Remove image ${index + 1}`}
                onClick={() => updateImage(index, null)}
              >
                Remove image
              </Button>
            </div>
          </div>
        ))}
        {extra}
      </Card>
      <div className="mt-4 flex justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function NewPost() {
  const actor = useOutletContext<ActorContextView>()
  const navigate = useNavigate()
  const create = useCreatePost(actor.accountId)
  const blocked = publishBlockReason(actor)
  return (
    <>
      <ColumnHeader title="New post" subtitle="Share with the signed-in HiLCoE community." />
      {blocked ? (
        <Note tone="amber">{blocked}</Note>
      ) : (
        <PostForm
          initial={draftFrom(null)}
          submitLabel="Publish"
          pending={create.isPending}
          error={create.error}
          onCancel={() => navigate('/home')}
          onSubmit={(draft) =>
            create.mutate(draft, { onSuccess: (post) => navigate(`/posts/${post.id}`, { replace: true }) })
          }
        />
      )}
    </>
  )
}

export function EditPost() {
  const actor = useOutletContext<ActorContextView>()
  const { postId = '' } = useParams()
  const navigate = useNavigate()
  const post = usePost(actor.accountId, postId)
  const edit = useEditPost(actor.accountId, postId)
  // The version and images the author opened; refetches must not reset the form.
  const [opened, setOpened] = useState<PostView | null>(null)
  if (post.data && opened === null) setOpened(post.data)

  if (post.isPending) return <LoadingContent />
  if (post.isError) return <ErrorContent message={post.error.message} onRetry={() => void post.refetch()} />
  if (!opened) return <LoadingContent />
  const header = <ColumnHeader title="Edit my post" subtitle="Only the author may edit this post." />
  if (!opened.isOwn || opened.state !== 'VISIBLE') {
    return (
      <>
        {header}
        <Note>This post can no longer be edited.</Note>
      </>
    )
  }
  const blocked = publishBlockReason(actor)
  if (blocked) {
    return (
      <>
        {header}
        <Note tone="amber">{blocked}</Note>
      </>
    )
  }
  return (
    <>
      {header}
      <PostForm
        initial={draftFrom(opened)}
        submitLabel="Save changes"
        pending={edit.isPending}
        error={edit.error}
        onCancel={() => navigate(`/posts/${postId}`)}
        onSubmit={(draft) =>
          edit.mutate(
            { draft, version: opened.version },
            { onSuccess: () => navigate(`/posts/${postId}`, { replace: true }) },
          )
        }
        extra={
          <Link to={`/posts/${postId}/delete`} className="block text-[13px] text-red-11">
            Delete this post instead
          </Link>
        }
      />
    </>
  )
}

export function DeletePost() {
  const actor = useOutletContext<ActorContextView>()
  const { postId = '' } = useParams()
  const navigate = useNavigate()
  const post = usePost(actor.accountId, postId)
  const remove = useDeletePost(actor.accountId)
  if (post.isPending) return <LoadingContent />
  if (post.isError) return <ErrorContent message={post.error.message} onRetry={() => void post.refetch()} />
  const header = <ColumnHeader title="Delete my post" />
  if (!post.data.isOwn || post.data.state === 'ARCHIVED') {
    return (
      <>
        {header}
        <Note>This post cannot be deleted.</Note>
      </>
    )
  }
  return (
    <>
      {header}
      <Card className="space-y-4 p-5">
        <p className="text-[14px] leading-relaxed">
          The original text and images are removed. Comments, existing saves and tags remain in a read-only
          deleted post archive.
        </p>
        <Note>
          Retained tags still describe the discussion and may appear in search. No new comments, edits, likes
          or saves can be added to the archive.
        </Note>
        {remove.isError && <Note tone="red">{remove.error.message}</Note>}
      </Card>
      <div className="mt-4 flex justify-end gap-3">
        <Button variant="ghost" onClick={() => navigate(`/posts/${postId}`)}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(postId, { onSuccess: () => navigate(`/posts/${postId}`, { replace: true }) })
          }
        >
          Delete post
        </Button>
      </div>
    </>
  )
}
