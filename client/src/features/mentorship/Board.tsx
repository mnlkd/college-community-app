import {
  MENTORSHIP_NOTE_MAX,
  MENTORSHIP_TOPIC_MAX,
  SEARCH_TEXT_MAX,
  STUDENT_MENTOR_LIMIT,
  mentorshipRequestInputSchema,
  normalizeTag,
  type ActorContextView,
  type MentorProfileView,
  type ProfileView,
} from '@hilcoe/shared'
import { ChevronRight, Clock, Handshake, Search as SearchIcon, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  isApiError,
  useMentorBoard,
  useMentorProfile,
  useMentorshipAction,
  useRequestMentorship,
} from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CapacityMeter,
  ColumnHeader,
  Field,
  Note,
  Select,
  TextArea,
  TextInput,
  buttonClass,
} from '../../design/ui'
import { RoleChip } from '../../design/content'
import { BoardIntro, BoardsHeader } from '../boards/content'
import { Pager } from '../posts/content'
import { fieldErrorsOf } from '../profile/RoleDetailsFields'
import {
  AVAILABILITY_PATH,
  BOARD_PATH,
  BackToBoard,
  ContactsBlock,
  ContactsPrivateNote,
  MentorCard,
  REQUEST_BLOCK_TEXT,
  StudentCapacity,
  canMentor,
  mentorPath,
  openPlaces,
  requestPath,
} from './content'

function BoardSkeleton() {
  return <LoadingContent label="Loading mentors…" />
}

/** The Mentorship Board: available, eligible mentors, with keyword, #tag, topic and open-place filters. */
export function MentorshipBoard() {
  const actor = useOutletContext<ActorContextView>()
  const [params, setParams] = useSearchParams()
  const text = params.get('text') ?? ''
  const tag = normalizeTag(params.get('tag') ?? '') ?? ''
  const topic = params.get('topic') ?? ''
  const openOnly = params.get('open') === '1'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [typed, setTyped] = useState(text)
  const board = useMentorBoard(actor.accountId, { text, tag, topic, openOnly }, page)

  function update(next: { text?: string; tag?: string; topic?: string; openOnly?: boolean; page?: number }) {
    const copy = new URLSearchParams()
    const values = {
      text: (next.text ?? text).trim(),
      tag: next.tag ?? tag,
      topic: next.topic ?? topic,
    }
    for (const [key, value] of Object.entries(values)) if (value) copy.set(key, value)
    if (next.openOnly ?? openOnly) copy.set('open', '1')
    if ((next.page ?? 1) > 1) copy.set('page', String(next.page))
    setParams(copy)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = typed.trim()
    const asTag = /^#\S+$/.test(value) ? normalizeTag(value) : null
    if (asTag) {
      setTyped('')
      update({ text: '', tag: asTag })
    } else update({ text: value })
  }

  const filtered = text !== '' || tag !== '' || topic !== '' || openOnly
  return (
    <>
      <BoardsHeader
        active="MENTORSHIP"
        right={
          canMentor(actor) && (
            <Link to={AVAILABILITY_PATH} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              My availability
            </Link>
          )
        }
      />
      <form role="search" onSubmit={submit} className="mb-3 flex gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-slate-5 bg-white px-3.5 shadow-xs focus-within:border-iris-8">
          <SearchIcon className="size-4 shrink-0 text-slate-9" aria-hidden="true" />
          <span className="sr-only">Search mentors</span>
          <input
            type="search"
            value={typed}
            maxLength={SEARCH_TEXT_MAX}
            placeholder="Search available mentors by keyword, or #tag"
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none! focus-visible:outline-none!"
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Show mentors"
          className="inline-flex rounded-lg border border-slate-5 bg-slate-2 p-0.5"
        >
          {[
            { value: false, label: 'All mentors' },
            { value: true, label: 'Open places' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={openOnly === option.value}
              onClick={() => update({ openOnly: option.value })}
              className={
                'rounded-md px-3 py-1 text-[12.5px] font-semibold transition-colors ' +
                (openOnly === option.value
                  ? 'bg-white text-slate-12 shadow-xs'
                  : 'text-slate-10 hover:text-slate-12')
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        {tag && (
          <Badge tone="iris">
            #{tag}
            <button type="button" aria-label={`Remove tag filter ${tag}`} onClick={() => update({ tag: '' })}>
              <X className="size-3" />
            </button>
          </Badge>
        )}
        {topic && (
          <Badge tone="iris">
            Topic: {topic}
            <button
              type="button"
              aria-label={`Remove topic filter ${topic}`}
              onClick={() => update({ topic: '' })}
            >
              <X className="size-3" />
            </button>
          </Badge>
        )}
      </div>
      <BoardIntro>Staff and Verified Alumni who offer guidance to Students.</BoardIntro>
      {actor.role === 'STUDENT' && <StudentCapacity accountId={actor.accountId} />}
      {board.isPending ? (
        <BoardSkeleton />
      ) : board.isError ? (
        <ErrorContent message={board.error.message} onRetry={() => void board.refetch()} />
      ) : board.data.items.length === 0 ? (
        <Note>
          {page > 1
            ? 'No more mentors.'
            : filtered
              ? 'No available mentors match these filters.'
              : 'No mentors are available right now. Check back later.'}
        </Note>
      ) : (
        <>
          <div className="space-y-3">
            {board.data.items.map((mentor) => (
              <MentorCard
                key={mentor.mentor.memberId}
                mentor={mentor}
                onTopic={(value) => update({ topic: value })}
              />
            ))}
          </div>
          <Pager
            page={page}
            total={board.data.total}
            pageSize={board.data.pageSize}
            onPage={(next) => update({ page: next })}
            previous="Previous"
            next="Next"
          />
        </>
      )}
      <div className="mt-4">
        <Note>
          A Student may have at most three active mentors, and a mentor stops taking requests when every place
          is in use. Both limits are checked again when the mentor accepts.
        </Note>
      </div>
    </>
  )
}

function MentorUnavailable({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isApiError(error) && error.status === 404) {
    return (
      <>
        <ColumnHeader title="Mentor unavailable" />
        <Note>This mentor does not exist or is not offering mentorship.</Note>
        <Link to={BOARD_PATH} className={buttonClass({ variant: 'secondary' }) + ' mt-4'}>
          Back to the Mentorship Board
        </Link>
      </>
    )
  }
  return <ErrorContent message={error.message} onRetry={onRetry} />
}

const DONE_TEXT = {
  withdraw: (name: string) => `Request withdrawn. ${name} has been notified.`,
  end: (name: string) => `Mentorship ended. ${name} has been notified and both places are released.`,
}

/**
 * The end of the Mentee places card: the viewer's next step with this mentor. A request button,
 * the pending request, or, once accepted, the mentor's contacts; on one's own profile, a link to
 * edit availability.
 */
function PlacesAction({
  accountId,
  mentor,
  own,
}: {
  accountId: string
  mentor: MentorProfileView
  own: boolean
}) {
  const location = useLocation()
  const sent = (location.state as { sent?: boolean } | null)?.sent === true
  const action = useMentorshipAction(accountId)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const name = mentor.mentor.displayName
  const mentorship = mentor.viewerMentorship

  async function run(kind: 'withdraw' | 'end') {
    if (!mentorship) return
    setError(null)
    try {
      await action.mutateAsync({ id: mentorship.id, action: kind })
    } catch (cause) {
      setError(isApiError(cause) ? cause.message : 'That did not work. Try again.')
      return
    }
    setConfirmEnd(false)
    setDone(DONE_TEXT[kind](name))
  }

  const row = 'flex flex-wrap items-center justify-between gap-3'
  let body: ReactNode
  if (own) {
    body = (
      <div className={row}>
        <p className="text-[13.5px] text-slate-11">This is how Students see your mentor profile.</p>
        <Link to={AVAILABILITY_PATH} className={buttonClass({ variant: 'secondary' })}>
          Edit availability
        </Link>
      </div>
    )
  } else if (mentorship?.state === 'ACTIVE') {
    body = (
      <>
        <ContactsBlock accountId={accountId} mentorId={mentor.mentor.memberId} />
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {confirmEnd ? (
            <>
              <span className="text-[13px] text-slate-11">
                End this mentorship? {name} will be notified and your access to the contacts ends.
              </span>
              <Button size="sm" variant="danger" disabled={action.isPending} onClick={() => void run('end')}>
                Confirm end
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(true)}>
              End mentorship
            </Button>
          )}
        </div>
      </>
    )
  } else if (mentorship) {
    body = (
      <div className={row}>
        <div className="flex items-start gap-2.5">
          <Clock className="mt-0.5 size-4 shrink-0 text-slate-9" aria-hidden="true" />
          <div>
            <p className="text-[13.5px] font-medium text-slate-12">Request pending</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-10">
              No place is reserved until {name} accepts. Contacts are shared after acceptance.
            </p>
          </div>
        </div>
        <Button variant="secondary" disabled={action.isPending} onClick={() => void run('withdraw')}>
          Withdraw request
        </Button>
      </div>
    )
  } else if (mentor.requestBlock === 'NOT_STUDENT') {
    body = <ContactsPrivateNote />
  } else if (mentor.requestBlock) {
    body = <p className="text-[13.5px] text-slate-10">{REQUEST_BLOCK_TEXT[mentor.requestBlock]}</p>
  } else {
    body = (
      <div className={row}>
        <p className="text-[12.5px] leading-relaxed text-slate-10">
          The mentor&apos;s contacts are shared only after they accept.
        </p>
        <Link to={requestPath(mentor.mentor.memberId)} className={buttonClass()}>
          <Handshake className="size-4" aria-hidden="true" />
          Request mentorship
        </Link>
      </div>
    )
  }

  const status = done
    ? done
    : sent && mentorship?.state === 'PENDING'
      ? `Request sent. ${name} has been notified, and you will get a notification when it is accepted or declined.`
      : null
  return (
    <div className="mt-5 border-t border-slate-4 pt-4">
      {status && (
        <div className="mb-3" role="status">
          <Note tone="iris">{status}</Note>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Note tone="red">{error}</Note>
        </div>
      )}
      {body}
    </div>
  )
}

/**
 * A mentor's mentorship page, separate from their member profile: who they are in one line, their
 * places, introduction and topics, and the viewer's step. Contacts stay private until acceptance.
 */
export function MentorProfilePage() {
  const actor = useOutletContext<ActorContextView>()
  const { mentorId = '' } = useParams()
  const mentor = useMentorProfile(actor.accountId, mentorId)
  if (mentor.isPending) return <LoadingContent />
  if (mentor.isError) return <MentorUnavailable error={mentor.error} onRetry={() => void mentor.refetch()} />
  const view = mentor.data
  const own = view.mentor.memberId === actor.accountId
  const open = openPlaces(view)
  return (
    <>
      <BackToBoard />
      <ColumnHeader title="Mentor" />
      <MentorHeader profile={view.mentor} />
      <Card className="mt-3 p-5">
        <p className="font-mono text-[11.5px] tracking-[0.04em] text-slate-9 uppercase">Mentee places</p>
        <p className="mt-1 text-[14px] font-medium text-slate-12">
          {view.activeCount} of {view.capacity} filled · {open} open
        </p>
        {!view.available && (
          <div className="mt-3">
            <Badge tone="amber">Not taking new requests</Badge>
          </div>
        )}
        {view.viewerActiveMentors !== null && (
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-slate-10">
            You have {view.viewerActiveMentors} of {STUDENT_MENTOR_LIMIT} active mentors. Pending requests
            reserve no place.
          </p>
        )}
        {view.introduction && (
          <>
            <p className="mt-5 font-mono text-[11.5px] tracking-[0.04em] text-slate-9 uppercase">
              Introduction
            </p>
            <p className="mt-2 text-[14px] leading-[1.6] whitespace-pre-line text-slate-11 [overflow-wrap:anywhere]">
              {view.introduction}
            </p>
          </>
        )}
        {view.topics.length > 0 && (
          <>
            <p className="mt-5 font-mono text-[11.5px] tracking-[0.04em] text-slate-9 uppercase">
              Happy to talk about
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {view.topics.map((topic) => (
                <Badge key={topic} tone="iris">
                  {topic}
                </Badge>
              ))}
            </div>
          </>
        )}
        <PlacesAction accountId={actor.accountId} mentor={view} own={own} />
      </Card>
    </>
  )
}

/** The mentor in one line, with a link to their full member profile. */
function MentorHeader({ profile }: { profile: ProfileView }) {
  const headline = profile.currentPosition ?? profile.studyOrExpertise
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
      <Avatar name={profile.displayName} src={profile.pictureUrl ?? undefined} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="font-display text-[17px] font-bold text-slate-12">{profile.displayName}</h2>
          <RoleChip role={profile.role} alumniStatus={profile.alumniStatus} />
        </div>
        {headline && <p className="mt-0.5 text-[13.5px] text-slate-11">{headline}</p>}
      </div>
      <Link
        to={`/members/${profile.memberId}`}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-iris-11 hover:underline"
      >
        View full profile
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </Link>
    </Card>
  )
}

/** Request Mentorship: a topic from the mentor's list and a note. */
export function RequestMentorship() {
  const actor = useOutletContext<ActorContextView>()
  const { mentorId = '' } = useParams()
  const mentor = useMentorProfile(actor.accountId, mentorId)
  if (mentor.isPending) return <LoadingContent />
  if (mentor.isError) return <MentorUnavailable error={mentor.error} onRetry={() => void mentor.refetch()} />
  return <RequestForm accountId={actor.accountId} mentor={mentor.data} />
}

function RequestForm({ accountId, mentor }: { accountId: string; mentor: MentorProfileView }) {
  const navigate = useNavigate()
  const request = useRequestMentorship(accountId)
  const profile = mentor.mentor
  const [topic, setTopic] = useState(mentor.topics[0] ?? '')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const header = <ColumnHeader title={`Request mentorship from ${profile.displayName}`} />

  if (mentor.requestBlock) {
    return (
      <>
        {header}
        <Note tone="amber">{REQUEST_BLOCK_TEXT[mentor.requestBlock]}</Note>
        <div className="mt-4">
          <Link to={mentorPath(profile.memberId)} className={buttonClass({ variant: 'secondary' })}>
            Back to mentor
          </Link>
        </div>
      </>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const parsed = mentorshipRequestInputSchema.safeParse({ topic, note })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] ??= issue.message
      setErrors(next)
      return
    }
    setErrors({})
    request.mutate(
      { mentorId: profile.memberId, input: parsed.data },
      {
        onSuccess: () => navigate(mentorPath(profile.memberId), { replace: true, state: { sent: true } }),
        onError: (cause) => {
          const fields = fieldErrorsOf(cause)
          if (fields) setErrors(fields)
          else setError(isApiError(cause) ? cause.message : 'The request could not be sent. Try again.')
        },
      },
    )
  }

  return (
    <>
      {header}
      <Card className="max-w-2xl">
        <form noValidate onSubmit={submit}>
          <div className="space-y-4 px-5 py-4">
            <div className="flex items-center gap-3 rounded-xl border border-slate-5 bg-slate-2 px-3.5 py-3">
              <Avatar name={profile.displayName} src={profile.pictureUrl ?? undefined} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px] font-semibold text-slate-12">{profile.displayName}</span>
                  <RoleChip role={profile.role} alumniStatus={profile.alumniStatus} />
                </div>
                {profile.currentPosition && (
                  <p className="text-[12.5px] text-slate-10">{profile.currentPosition}</p>
                )}
              </div>
              <CapacityMeter filled={mentor.activeCount} total={mentor.capacity} />
            </div>
            {error && <Note tone="red">{error}</Note>}
            <Field label="Topic" required error={errors.topic}>
              {mentor.topics.length > 0 ? (
                <Select
                  name="topic"
                  value={topic}
                  invalid={Boolean(errors.topic)}
                  onChange={(event) => setTopic(event.target.value)}
                >
                  {mentor.topics.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              ) : (
                <TextInput
                  name="topic"
                  value={topic}
                  maxLength={MENTORSHIP_TOPIC_MAX}
                  invalid={Boolean(errors.topic)}
                  onChange={(event) => setTopic(event.target.value)}
                />
              )}
            </Field>
            <Field
              label="Your note"
              required
              error={errors.note}
              hint={`Explain what you hope to discuss. ${note.length}/${MENTORSHIP_NOTE_MAX}`}
            >
              <TextArea
                name="note"
                rows={5}
                value={note}
                invalid={Boolean(errors.note)}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Note>
              You have {mentor.viewerActiveMentors ?? 0} of {STUDENT_MENTOR_LIMIT} active mentors. This
              request reserves no place on either side. The mentor&apos;s contacts are shared only after
              acceptance.
            </Note>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-4 bg-slate-2 px-5 py-3.5">
            <span className="text-[11.5px] text-slate-9">You can withdraw while it is pending.</span>
            <div className="flex gap-2.5">
              <Link to={mentorPath(profile.memberId)} className={buttonClass({ variant: 'ghost' })}>
                Cancel
              </Link>
              <Button type="submit" disabled={request.isPending}>
                Send request
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </>
  )
}
