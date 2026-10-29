import {
  STUDENT_MENTOR_LIMIT,
  type ActorContextView,
  type ContactKind,
  type MentorRequestBlock,
  type MentorSummaryView,
  type MentorshipAcceptBlock,
  type MentorshipState,
  type MentorshipView,
} from '@hilcoe/shared'
import { ArrowLeft, Check, Clock, Mail, UserCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  isApiError,
  useMentorContacts,
  useMentorshipAction,
  useMyMentorships,
  type MentorshipAction,
} from '../../api'
import { RoleChip } from '../../design/content'
import { Avatar, Badge, Button, Card, CapacityMeter, Note, type Tone } from '../../design/ui'
import { MemberLine } from '../posts/content'

export const BOARD_PATH = '/boards/mentorship'
export const MY_REQUESTS_PATH = '/boards/mentorship/my-requests'
export const AVAILABILITY_PATH = '/boards/mentorship/availability'
export const mentorPath = (mentorId: string) => `${BOARD_PATH}/mentors/${mentorId}`
export const requestPath = (mentorId: string) => `${mentorPath(mentorId)}/request`

/** A quiet "← Mentorship Board" link above a mentorship page's title. */
export function BackToBoard() {
  return (
    <Link
      to={BOARD_PATH}
      className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-10 hover:text-slate-12"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" /> Mentorship Board
    </Link>
  )
}

/** Staff and Verified Alumni may offer mentorship (FR-5); the server checks again. */
export function canMentor(actor: ActorContextView): boolean {
  return (
    actor.accountState === 'ACTIVE' &&
    (actor.role === 'STAFF' || (actor.role === 'ALUMNI' && actor.alumniStatus === 'VERIFIED'))
  )
}

export const CONTACT_LABELS: Record<ContactKind, string> = {
  EMAIL: 'Email',
  TELEGRAM: 'Telegram',
  PHONE: 'Phone',
  OTHER: 'Other',
}

const STATE_BADGES: Record<MentorshipState, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'amber' },
  ACTIVE: { label: 'Active', tone: 'green' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  ENDED: { label: 'Ended', tone: 'neutral' },
}

export function StateBadge({ state }: { state: MentorshipState }) {
  const badge = STATE_BADGES[state]
  return <Badge tone={badge.tone}>{badge.label}</Badge>
}

/** Why a request cannot be sent, as a sentence. */
export const REQUEST_BLOCK_TEXT: Record<MentorRequestBlock, string> = {
  NOT_STUDENT: 'Only Students can request mentorship.',
  CANNOT_INTERACT: 'Your account cannot send mentorship requests right now.',
  UNAVAILABLE: 'This mentor is not taking new requests at the moment.',
  MENTOR_FULL: 'This mentor has no open places. New requests stop while every place is in use.',
  STUDENT_LIMIT: `You already have ${STUDENT_MENTOR_LIMIT} active mentors. End one before requesting another.`,
  OPEN_MENTORSHIP: 'You already have a pending or active mentorship with this mentor.',
}

const ACCEPT_BLOCK_TEXT: Record<MentorshipAcceptBlock, string> = {
  MENTOR_INELIGIBLE: 'Your account cannot accept mentees right now.',
  STUDENT_INELIGIBLE: 'This Student can no longer be accepted.',
  MENTOR_FULL: 'Every one of your places is in use.',
  STUDENT_LIMIT: `This Student already has ${STUDENT_MENTOR_LIMIT} active mentors.`,
}

export function openPlaces(mentor: Pick<MentorSummaryView, 'capacity' | 'activeCount'>): number {
  return Math.max(0, mentor.capacity - mentor.activeCount)
}

/** A mentor on the board or in search results; contacts are never shown here. */
export function MentorCard({
  mentor,
  onTopic,
}: {
  mentor: MentorSummaryView
  /** Filters the board by a topic when given; otherwise topics are plain labels. */
  onTopic?: (topic: string) => void
}) {
  const profile = mentor.mentor
  const relation = viewerRelation(mentor)
  const headline = profile.currentPosition ?? profile.studyOrExpertise
  return (
    <Card hover className="relative px-5 py-4">
      <article aria-label={profile.displayName} className="flex items-start gap-3">
        <Avatar name={profile.displayName} size={46} src={profile.pictureUrl ?? undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* The link covers the whole card; the topic filters sit above it. */}
            <Link
              to={mentorPath(profile.memberId)}
              className="font-display text-[15.5px] font-bold text-slate-12 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-iris-8"
            >
              {profile.displayName}
            </Link>
            <RoleChip role={profile.role} alumniStatus={profile.alumniStatus} />
          </div>
          {headline && <p className="mt-0.5 text-[13.5px] text-slate-11">{headline}</p>}
          {mentor.introduction && (
            <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-slate-11">
              {mentor.introduction}
            </p>
          )}
          {mentor.topics.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {mentor.topics.map((topic) =>
                onTopic ? (
                  <button
                    key={topic}
                    type="button"
                    className="relative z-10"
                    onClick={() => onTopic(topic)}
                    aria-label={`Show mentors for ${topic}`}
                  >
                    <Badge tone="iris">{topic}</Badge>
                  </button>
                ) : (
                  <Badge key={topic} tone="iris">
                    {topic}
                  </Badge>
                ),
              )}
            </div>
          )}
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-slate-4 pt-3">
            <div className="flex items-center gap-3">
              <CapacityMeter filled={mentor.activeCount} total={mentor.capacity} />
              {!mentor.available && <span className="text-[12.5px] text-slate-9">Not taking requests</span>}
            </div>
            {relation && (
              <span className="flex items-center gap-1 text-[12px] font-medium text-slate-10">
                <relation.icon className="size-3.5" aria-hidden="true" />
                {relation.label}
              </span>
            )}
          </div>
        </div>
      </article>
    </Card>
  )
}

/** A quiet note when the viewer already has a pending or active mentorship with this mentor. */
function viewerRelation(mentor: MentorSummaryView): { label: string; icon: typeof UserCheck } | null {
  if (mentor.viewerMentorship?.state === 'ACTIVE') return { label: 'Your mentor', icon: UserCheck }
  if (mentor.viewerMentorship) return { label: 'Request sent', icon: Clock }
  return null
}

/** The Student's active mentors out of three; pending requests reserve no place. */
export function StudentCapacity({ accountId }: { accountId: string }) {
  const active = useMyMentorships(accountId, { side: 'STUDENT', states: ['ACTIVE'] }, 1)
  const count = active.data?.total ?? 0
  return (
    <Card className="mb-4 border-iris-6 bg-iris-2 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[14px] font-semibold text-slate-12">
            Your active mentors · {active.isPending ? '…' : count} of {STUDENT_MENTOR_LIMIT}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-10">
            Accepted, active mentorships use places. Pending requests reserve no place, yours or a
            mentor&apos;s.
          </p>
        </div>
        <CapacityMeter filled={count} total={STUDENT_MENTOR_LIMIT} />
      </div>
    </Card>
  )
}

/** The mentor's chosen contacts, shown to an active mentee only. */
export function ContactsBlock({ accountId, mentorId }: { accountId: string; mentorId: string }) {
  const contacts = useMentorContacts(accountId, mentorId, true)
  return (
    <section
      className="mt-3 rounded-xl border border-iris-6 bg-white px-3.5 py-3"
      aria-label="Mentor contacts"
    >
      <p className="font-mono text-[11.5px] tracking-[0.04em] text-slate-9 uppercase">
        Mentor contacts · visible only to you
      </p>
      {contacts.isPending ? (
        <p className="mt-2 text-[13px] text-slate-10">Loading…</p>
      ) : contacts.isError ? (
        <p className="mt-2 text-[13px] text-slate-10">
          {isApiError(contacts.error) && contacts.error.status === 403
            ? 'These contacts are not available right now.'
            : contacts.error.message}
        </p>
      ) : (
        <dl className="mt-2 space-y-1">
          {contacts.data.map((contact) => (
            <div key={contact.kind} className="flex gap-2 text-[13.5px] text-slate-11">
              <dt>{CONTACT_LABELS[contact.kind]}:</dt>
              <dd className="font-mono break-all text-iris-11">{contact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-[12.5px] leading-relaxed text-slate-10">
        Chosen by your mentor. Continue the conversation outside HiLCoE Commons.
      </p>
    </section>
  )
}

export function ContactsPrivateNote() {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-4 bg-slate-2 px-4 py-3">
      <Mail className="size-4 shrink-0 text-slate-9" aria-hidden="true" />
      <div>
        <p className="text-[13.5px] font-medium text-slate-12">Mentorship contacts are private</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-10">
          The mentor chooses how to be contacted. Only a Student in an accepted, active mentorship sees those
          details, never on this profile.
        </p>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function stateLine(mentorship: MentorshipView): string {
  switch (mentorship.state) {
    case 'PENDING':
      return `Requested ${formatDate(mentorship.requestedAt)}`
    case 'ACTIVE':
      return `Active since ${formatDate(mentorship.decidedAt ?? mentorship.updatedAt)}`
    case 'DECLINED':
      return `Declined ${formatDate(mentorship.decidedAt ?? mentorship.updatedAt)}`
    case 'WITHDRAWN':
      return `Withdrawn ${formatDate(mentorship.updatedAt)}`
    case 'ENDED':
      return `Ended ${formatDate(mentorship.updatedAt)}`
  }
}

const DONE_TEXT: Record<MentorshipAction, (name: string) => string> = {
  accept: (name) => `Request accepted. ${name} has been notified and can now see your contacts.`,
  decline: (name) => `Request declined. ${name} has been notified.`,
  withdraw: (name) => `Request withdrawn. ${name} has been notified.`,
  end: (name) => `Mentorship ended. ${name} has been notified and both places are released.`,
}

/**
 * One mentorship from the viewer's side, with the actions that side may take. Every action is
 * checked again by the server; a refused action leaves the card as it was and shows why.
 */
export function MentorshipCard({
  accountId,
  mentorship,
  onDone,
}: {
  accountId: string
  mentorship: MentorshipView
  onDone?: (message: string) => void
}) {
  const action = useMentorshipAction(accountId)
  const [error, setError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const asMentor = mentorship.viewerSide === 'MENTOR'
  const other = asMentor ? mentorship.student : mentorship.mentor
  const { state } = mentorship

  // mutateAsync rather than per-call callbacks: the refetched list may unmount this card first,
  // and the page must still report the outcome.
  async function run(kind: MentorshipAction) {
    setError(null)
    try {
      await action.mutateAsync({ id: mentorship.id, action: kind })
    } catch (cause) {
      setError(isApiError(cause) ? cause.message : 'That did not work. Try again.')
      return
    }
    setConfirmEnd(false)
    onDone?.(DONE_TEXT[kind](other.displayName))
  }

  return (
    <Card className={state === 'ACTIVE' ? 'border-iris-6 bg-iris-2 p-4' : 'p-4'}>
      <article aria-label={`Mentorship with ${other.displayName}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <MemberLine member={other} size={44} meta={stateLine(mentorship)} />
          <StateBadge state={state} />
        </div>
        <div className="mt-3 pl-[56px]">
          <Badge>{mentorship.topic}</Badge>
          <p className="mt-2 text-[14px] leading-[1.55] whitespace-pre-line text-slate-12 [overflow-wrap:anywhere]">
            {mentorship.note}
          </p>
          {asMentor && state === 'PENDING' && (
            <p className="mt-2 text-[12.5px] text-slate-10">
              This Student has {mentorship.studentActiveMentors} of {STUDENT_MENTOR_LIMIT} active mentors. A
              pending request reserves no place.
            </p>
          )}
          {!asMentor && state === 'PENDING' && (
            <p className="mt-2 text-[12.5px] text-slate-10">
              No place is reserved while the request is pending. Contacts are shared only after acceptance.
            </p>
          )}
          {!asMentor && state === 'ACTIVE' && mentorship.mentor.memberId && (
            <ContactsBlock accountId={accountId} mentorId={mentorship.mentor.memberId} />
          )}
          {error && (
            <div className="mt-3">
              <Note tone="red">{error}</Note>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {asMentor && state === 'PENDING' && (
              <>
                <Button
                  size="sm"
                  disabled={action.isPending || mentorship.acceptBlock !== null}
                  onClick={() => void run('accept')}
                >
                  <Check className="size-3.5" aria-hidden="true" /> Accept
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.isPending}
                  onClick={() => void run('decline')}
                >
                  <X className="size-3.5" aria-hidden="true" /> Decline
                </Button>
              </>
            )}
            {!asMentor && state === 'PENDING' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={action.isPending}
                onClick={() => void run('withdraw')}
              >
                Withdraw request
              </Button>
            )}
            {state === 'ACTIVE' &&
              (confirmEnd ? (
                <>
                  <span className="text-[13px] text-slate-11">
                    End this mentorship? {other.displayName} will be notified
                    {asMentor ? '.' : ' and your access to the contacts ends.'}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={action.isPending}
                    onClick={() => void run('end')}
                  >
                    Confirm end
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setConfirmEnd(true)}>
                  End mentorship
                </Button>
              ))}
          </div>
          {asMentor && state === 'PENDING' && mentorship.acceptBlock && (
            <p className="mt-2 text-[12px] text-amber-11">
              {ACCEPT_BLOCK_TEXT[mentorship.acceptBlock]} The request stays pending.
            </p>
          )}
        </div>
      </article>
    </Card>
  )
}
