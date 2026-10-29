import { COMMENT_BODY_MAX, type ActorContextView, type CommentView, type PostView } from '@hilcoe/shared'
import { Heart } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import {
  isApiError,
  recordPostView,
  useComments,
  useCreateComment,
  useDeleteComment,
  useEditComment,
  useLikers,
  usePost,
  useToggleLike,
} from '../../api'
import { RoleMark } from '../../design/content'
import { ErrorContent, LoadingContent } from '../../design/states'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ColumnHeader,
  Field,
  Note,
  TextArea,
  buttonClass,
  cx,
} from '../../design/ui'
import { ReportLink, canReport } from '../moderation/content'
import { timeAgo } from '../notifications/Notifications'
import {
  ActionButton,
  ArchivedNote,
  LinkedText,
  MemberLine,
  Pager,
  PostActions,
  PostImages,
  TagLink,
  plural,
} from './content'
import { canInteract, canPublish, publishBlockReason } from './eligibility'

function errorText(error: unknown): string {
  if (isApiError(error) && error.code === 'CONFLICT') {
    return 'This changed since you opened it, or the discussion is closed. Reload to see the latest version.'
  }
  if (isApiError(error) && error.fields) return Object.values(error.fields)[0] ?? error.message
  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}

function CommentForm({
  label,
  initial = '',
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
  rows = 2,
}: {
  label: string
  initial?: string
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (body: string, reset: () => void) => void
  onCancel?: () => void
  rows?: number
}) {
  const [body, setBody] = useState(initial)
  const [problem, setProblem] = useState<string | null>(null)
  function submit(event: FormEvent) {
    event.preventDefault()
    const text = body.trim()
    if (text === '') return setProblem('Write a comment first.')
    if (text.length > COMMENT_BODY_MAX) return setProblem(`At most ${COMMENT_BODY_MAX} characters.`)
    setProblem(null)
    onSubmit(text, () => setBody(''))
  }
  const shown = problem ?? (error ? errorText(error) : undefined)
  return (
    <form onSubmit={submit} noValidate>
      <Field label={label} error={shown}>
        <TextArea
          rows={rows}
          value={body}
          invalid={Boolean(shown)}
          placeholder="Join the discussion…"
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function CommentItem({
  comment,
  post,
  actor,
  depth = 0,
}: {
  comment: CommentView
  post: PostView
  actor: ActorContextView
  depth?: number
}) {
  const [mode, setMode] = useState<'view' | 'reply' | 'edit' | 'delete'>('view')
  const like = useToggleLike(actor.accountId)
  const reply = useCreateComment(actor.accountId, post.id)
  const edit = useEditComment(actor.accountId)
  const remove = useDeleteComment(actor.accountId)
  const open = post.state === 'VISIBLE'
  const visible = comment.state === 'VISIBLE'
  const publish = open && canPublish(actor)

  return (
    <div>
      <div className="flex gap-3 py-3">
        {comment.author ? (
          comment.author.deleted ? (
            <span
              className="shrink-0 rounded-full border border-dashed border-slate-7"
              style={{ width: depth ? 30 : 36, height: depth ? 30 : 36 }}
            />
          ) : (
            <Avatar
              name={comment.author.displayName}
              size={depth ? 30 : 36}
              src={comment.author.pictureUrl ?? undefined}
            />
          )
        ) : (
          <span
            className="shrink-0 rounded-full bg-slate-3"
            style={{ width: depth ? 30 : 36, height: depth ? 30 : 36 }}
          />
        )}
        <div className="min-w-0 flex-1">
          {comment.author ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[13.5px]">
              <MemberName member={comment.author} />
              {comment.author.role && (
                <RoleMark role={comment.author.role} alumniStatus={comment.author.alumniStatus} />
              )}
              <span className="text-[12px] text-slate-9">
                · <time dateTime={comment.createdAt}>{timeAgo(comment.createdAt)}</time>
                {comment.editedAt && ' · edited'}
              </span>
            </div>
          ) : null}
          {mode === 'edit' ? (
            <div className="mt-2">
              <CommentForm
                label="Edit my comment"
                initial={comment.body ?? ''}
                submitLabel="Save changes"
                pending={edit.isPending}
                error={edit.error}
                rows={3}
                onCancel={() => setMode('view')}
                onSubmit={(body) =>
                  edit.mutate(
                    { commentId: comment.id, input: { body, version: comment.version } },
                    { onSuccess: () => setMode('view') },
                  )
                }
              />
            </div>
          ) : visible ? (
            <LinkedText text={comment.body ?? ''} className="mt-1 text-[14px] leading-[1.6] text-slate-12" />
          ) : (
            <p className="text-[13.5px] text-slate-10 italic">
              {comment.state === 'HIDDEN' ? 'Comment hidden by moderation.' : 'Deleted comment.'}
            </p>
          )}
          {visible && mode !== 'edit' && (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <ActionButton
                icon={<Heart className={cx('size-[15px]', comment.likedByMe && 'fill-current')} />}
                label={comment.likedByMe ? 'Unlike comment' : 'Like comment'}
                pressed={comment.likedByMe}
                disabled={
                  like.isPending || comment.isOwn || (!comment.likedByMe && (!canInteract(actor) || !open))
                }
                onClick={() => like.mutate({ type: 'COMMENT', id: comment.id, like: !comment.likedByMe })}
              >
                {comment.likeCount}
              </ActionButton>
              {publish && (
                <button
                  type="button"
                  className="text-[12px] text-slate-10 hover:text-slate-12"
                  onClick={() => setMode(mode === 'reply' ? 'view' : 'reply')}
                >
                  Reply
                </button>
              )}
              {comment.isOwn && publish && (
                <button
                  type="button"
                  className="text-[12px] text-slate-10 hover:text-slate-12"
                  onClick={() => setMode('edit')}
                >
                  Edit
                </button>
              )}
              {comment.isOwn && (
                <button
                  type="button"
                  className="text-[12px] text-red-11"
                  onClick={() => setMode(mode === 'delete' ? 'view' : 'delete')}
                >
                  Delete
                </button>
              )}
              {canReport(actor, comment.isOwn) && (
                <ReportLink
                  type="COMMENT"
                  id={comment.id}
                  context={{
                    back: `/posts/${post.id}`,
                    author: comment.author?.displayName ?? null,
                    excerpt: comment.body ? comment.body.slice(0, 300) : null,
                  }}
                />
              )}
            </div>
          )}
          {like.isError && (
            <p role="alert" className="mt-1 text-[12px] text-red-11">
              {errorText(like.error)}
            </p>
          )}
          {mode === 'delete' && (
            <div className="mt-2 space-y-2">
              <Note>
                Delete this comment? Replies by other members remain under a deleted comment placeholder.
              </Note>
              {remove.isError && <Note tone="red">{errorText(remove.error)}</Note>}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(comment.id, { onSuccess: () => setMode('view') })}
                >
                  Delete comment
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
                  Keep comment
                </Button>
              </div>
            </div>
          )}
          {mode === 'reply' && (
            <div className="mt-2">
              <CommentForm
                label={`Reply to ${comment.author?.displayName ?? 'this comment'}`}
                submitLabel="Reply"
                pending={reply.isPending}
                error={reply.error}
                onCancel={() => setMode('view')}
                onSubmit={(body) =>
                  reply.mutate({ body, parentCommentId: comment.id }, { onSuccess: () => setMode('view') })
                }
              />
            </div>
          )}
        </div>
      </div>
      {comment.replies.length > 0 && (
        <div className="ml-[18px] border-l border-slate-4 pl-4">
          {comment.replies.map((child) => (
            <CommentItem key={child.id} comment={child} post={post} actor={actor} depth={1} />
          ))}
        </div>
      )}
    </div>
  )
}

function MemberName({ member }: { member: NonNullable<CommentView['author']> }) {
  if (!member.memberId || member.deleted) {
    return <span className="font-display font-bold text-slate-10">{member.displayName}</span>
  }
  return (
    <Link to={`/members/${member.memberId}`} className="font-display font-bold text-slate-12 hover:underline">
      {member.displayName}
    </Link>
  )
}

function Likers({ post, actor }: { post: PostView; actor: ActorContextView }) {
  const [page, setPage] = useState(1)
  const likers = useLikers(actor.accountId, 'POST', post.id, page)
  if (likers.isPending) return <LoadingContent label="Loading likes…" />
  if (likers.isError) return <Note tone="red">{likers.error.message}</Note>
  if (likers.data.items.length === 0) return <Note>No likes yet.</Note>
  return (
    <div className="px-5 pb-4">
      <ul aria-label="Liked by" className="space-y-3">
        {likers.data.items.map((member, index) => (
          <li key={member.memberId ?? `deleted-${index}`}>
            <MemberLine member={member} size={32} />
          </li>
        ))}
      </ul>
      <Pager
        page={page}
        total={likers.data.total}
        pageSize={likers.data.pageSize}
        onPage={setPage}
        previous="Previous"
        next="Next"
      />
    </div>
  )
}

function Comments({ post, actor }: { post: PostView; actor: ActorContextView }) {
  const [page, setPage] = useState(1)
  const comments = useComments(actor.accountId, post.id, page)
  if (comments.isPending) return <LoadingContent label="Loading comments…" />
  if (comments.isError) {
    return <ErrorContent message={comments.error.message} onRetry={() => void comments.refetch()} />
  }
  if (comments.data.items.length === 0) {
    return <Note>{page === 1 ? 'No comments yet.' : 'No more comments.'}</Note>
  }
  return (
    <>
      <Card className="divide-y divide-slate-4 px-5">
        {comments.data.items.map((comment) => (
          <CommentItem key={comment.id} comment={comment} post={post} actor={actor} />
        ))}
      </Card>
      <Pager
        page={page}
        total={comments.data.total}
        pageSize={comments.data.pageSize}
        onPage={setPage}
        previous="Earlier comments"
        next="Later comments"
      />
    </>
  )
}

/** Counts one view per member per UTC day; the server skips the author and Administrators. */
function useRecordView(post: PostView | undefined) {
  const recorded = useRef<string | null>(null)
  useEffect(() => {
    if (!post || post.isOwn || post.state !== 'VISIBLE' || recorded.current === post.id) return
    recorded.current = post.id
    recordPostView(post.id).catch(() => undefined)
  }, [post])
}

export function PostDetail() {
  const actor = useOutletContext<ActorContextView>()
  const { postId = '' } = useParams()
  const post = usePost(actor.accountId, postId)
  const comment = useCreateComment(actor.accountId, postId)
  const [showLikers, setShowLikers] = useState(false)
  useRecordView(post.data)

  if (post.isPending) return <LoadingContent />
  if (post.isError) {
    if (isApiError(post.error) && post.error.status === 404) {
      return (
        <>
          <ColumnHeader title="Post unavailable" />
          <Note>This post does not exist or is not available to you.</Note>
        </>
      )
    }
    return <ErrorContent message={post.error.message} onRetry={() => void post.refetch()} />
  }
  const view = post.data
  const archived = view.state === 'ARCHIVED'
  const blocked = publishBlockReason(actor)

  return (
    <>
      <ColumnHeader
        title={archived ? 'Archived discussion' : 'Post'}
        subtitle={
          archived
            ? 'The author deleted this post. Its tags and comments remain read-only.'
            : `A discussion started by ${view.author.displayName}.`
        }
        right={
          view.isOwn && !archived ? (
            <>
              {view.state === 'VISIBLE' && canPublish(actor) && (
                <Link
                  to={`/posts/${view.id}/edit`}
                  className={buttonClass({ size: 'sm', variant: 'secondary' })}
                >
                  Edit
                </Link>
              )}
              <Link
                to={`/posts/${view.id}/delete`}
                className={buttonClass({ size: 'sm', variant: 'dangerGhost' })}
              >
                Delete
              </Link>
            </>
          ) : undefined
        }
      />
      {view.state === 'HIDDEN' && (
        <div className="mb-3">
          <Note tone="red">
            An Administrator hid this post. Only you can see it, and it no longer accepts comments, likes or
            saves.
          </Note>
        </div>
      )}
      {archived && (
        <div className="mb-3">
          <ArchivedNote />
        </div>
      )}
      <Card className="mb-3">
        <article aria-label={`Post by ${view.author.displayName}`} className="px-5 py-4">
          <MemberLine
            member={view.author}
            meta={
              <>
                <time dateTime={view.createdAt}>{timeAgo(view.createdAt)}</time>
                {view.editedAt && ' · edited'}
              </>
            }
          />
          {view.body && (
            <LinkedText text={view.body} className="mt-3 text-[14.5px] leading-[1.62] text-slate-12" />
          )}
          <PostImages post={view} full />
          {view.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
              {view.tags.map((tag) => (
                <TagLink key={tag} tag={tag} />
              ))}
            </div>
          )}
          <PostActions post={view} actor={actor} />
        </article>
        <div className="flex flex-wrap gap-4 border-t border-slate-4 px-5 py-3 text-[12px] text-slate-10">
          <button
            type="button"
            className="hover:text-slate-12 hover:underline"
            aria-expanded={showLikers}
            onClick={() => setShowLikers(!showLikers)}
          >
            {plural(view.likeCount, 'like')}
          </button>
          <span>{plural(view.commentCount, 'comment')}</span>
          <span>{plural(view.saveCount, 'save')} · identities private</span>
          <span>{plural(view.viewCount, 'view')}</span>
          {view.state !== 'VISIBLE' && <Badge>Read-only</Badge>}
        </div>
        {showLikers && <Likers post={view} actor={actor} />}
      </Card>
      {view.state === 'VISIBLE' &&
        (blocked ? (
          <div className="mb-3">
            <Note tone="amber">{blocked}</Note>
          </div>
        ) : (
          <Card className="mb-3 px-5 py-4">
            <CommentForm
              label="Add a comment"
              submitLabel="Comment"
              pending={comment.isPending}
              error={comment.error}
              onSubmit={(body, reset) => comment.mutate({ body }, { onSuccess: reset })}
            />
          </Card>
        ))}
      <Comments post={view} actor={actor} />
      <p className="mt-4 text-[12px] text-slate-10">
        One reply level. View totals exclude the author and count each member once per post per UTC day.
      </p>
    </>
  )
}
