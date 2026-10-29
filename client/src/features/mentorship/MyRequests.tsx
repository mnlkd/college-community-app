import {
  CLOSED_MENTORSHIP_STATES,
  type ActorContextView,
  type MentorshipSide,
  type MentorshipState,
} from '@hilcoe/shared'
import { useState } from 'react'
import { Link, Navigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { isApiError, useMentorship, useMyMentorships, useOwnMentorSettings } from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Card, CapacityMeter, ColumnHeader, LinkTabs, Note } from '../../design/ui'
import { Pager } from '../posts/content'
import {
  AVAILABILITY_PATH,
  BOARD_PATH,
  BackToBoard,
  MY_REQUESTS_PATH,
  MentorshipCard,
  StudentCapacity,
  canMentor,
  mentorPath,
} from './content'

interface Tab {
  key: string
  label: string
  states: readonly MentorshipState[]
  empty: string
}

const STUDENT_TABS: Tab[] = [
  { key: 'all', label: 'All', states: [], empty: 'You have not requested mentorship yet.' },
  { key: 'pending', label: 'Pending', states: ['PENDING'], empty: 'No pending requests.' },
  { key: 'active', label: 'Active', states: ['ACTIVE'], empty: 'No active mentorships.' },
  { key: 'history', label: 'History', states: CLOSED_MENTORSHIP_STATES, empty: 'No past requests.' },
]

const MENTOR_TABS: Tab[] = [
  { key: 'requests', label: 'Requests', states: ['PENDING'], empty: 'No pending requests.' },
  { key: 'mentees', label: 'Current mentees', states: ['ACTIVE'], empty: 'No active mentees.' },
  { key: 'history', label: 'History', states: CLOSED_MENTORSHIP_STATES, empty: 'No past requests.' },
]

/** The signed-in member's mentorships: a Student's requests, or a mentor's requests and mentees. */
export function MyRequests() {
  const actor = useOutletContext<ActorContextView>()
  const side: MentorshipSide = actor.role === 'STUDENT' ? 'STUDENT' : 'MENTOR'
  const tabs = side === 'STUDENT' ? STUDENT_TABS : MENTOR_TABS
  const [params, setParams] = useSearchParams()
  const tab = tabs.find((each) => each.key === params.get('tab')) ?? tabs[0]!
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [done, setDone] = useState<string | null>(null)
  const list = useMyMentorships(actor.accountId, { side, states: tab.states }, page)

  function setPage(next: number) {
    const copy = new URLSearchParams(params)
    if (next > 1) copy.set('page', String(next))
    else copy.delete('page')
    setParams(copy)
  }

  return (
    <>
      <ColumnHeader
        title="My Requests"
        subtitle={
          side === 'STUDENT'
            ? 'Your mentorship requests and mentors.'
            : 'Students asking for your guidance, and your current mentees.'
        }
        tabs={
          <LinkTabs
            tabs={[
              ...tabs.map((each) => ({
                key: each.key,
                label: each.label,
                to: `${MY_REQUESTS_PATH}?tab=${each.key}`,
              })),
              ...(side === 'MENTOR' && canMentor(actor)
                ? [{ key: 'availability', label: 'My availability', to: AVAILABILITY_PATH }]
                : []),
            ]}
            active={tab.key}
          />
        }
      />
      {done && (
        <div className="mb-4" role="status">
          <Note tone="iris">{done}</Note>
        </div>
      )}
      {side === 'STUDENT' ? (
        <StudentCapacity accountId={actor.accountId} />
      ) : (
        canMentor(actor) && <MentorSummary accountId={actor.accountId} />
      )}
      {list.isPending ? (
        <LoadingContent />
      ) : list.isError ? (
        <ErrorContent message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Note>
          {page > 1 ? 'No more requests.' : tab.empty}
          {side === 'STUDENT' && page === 1 && tab.key === 'all' && (
            <>
              {' '}
              <Link to={BOARD_PATH} className="font-semibold text-iris-11 hover:underline">
                Find a mentor
              </Link>
            </>
          )}
        </Note>
      ) : (
        <>
          <div className="space-y-3">
            {list.data.items.map((mentorship) => (
              <MentorshipCard
                key={mentorship.id}
                accountId={actor.accountId}
                mentorship={mentorship}
                onDone={setDone}
              />
            ))}
          </div>
          <Pager
            page={page}
            total={list.data.total}
            pageSize={list.data.pageSize}
            onPage={setPage}
            previous="Previous"
            next="Next"
          />
        </>
      )}
      <div className="mt-4">
        <Note>
          Either participant can end an active mentorship. Ending releases one mentor place and one Student
          place, and the mentor&apos;s contacts are no longer shown.
        </Note>
      </div>
    </>
  )
}

function MentorSummary({ accountId }: { accountId: string }) {
  const settings = useOwnMentorSettings(accountId)
  if (!settings.data) return null
  const view = settings.data
  return (
    <Card className="mb-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[13.5px] font-medium text-slate-12">
            {!view.configured
              ? 'You have not set up mentoring yet'
              : view.available
                ? 'Available on the Mentorship Board'
                : 'Availability off · hidden from new requests'}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-slate-10">
            {view.configured
              ? `${view.activeCount} of ${view.capacity} places in use. ${
                  view.available
                    ? 'When every place is in use, new requests stop and pending requests stay.'
                    : 'Your pending requests and mentees are kept.'
                }`
              : 'Choose your capacity, topics and contacts to appear on the Mentorship Board.'}
          </p>
        </div>
        {view.configured && <CapacityMeter filled={view.activeCount} total={view.capacity} />}
      </div>
    </Card>
  )
}

/**
 * Where a mentorship notice leads. There is no separate mentorship page: a Student's pending or
 * active mentorship lives on the mentor's page, and everything else in My Requests.
 */
export function OpenMentorship() {
  const actor = useOutletContext<ActorContextView>()
  const { mentorshipId = '' } = useParams()
  const mentorship = useMentorship(actor.accountId, mentorshipId)

  if (mentorship.isPending) return <LoadingContent />
  if (mentorship.isError) {
    if (isApiError(mentorship.error) && mentorship.error.status === 404) {
      return (
        <>
          <BackToBoard />
          <ColumnHeader title="Mentorship unavailable" />
          <Note>This mentorship does not exist or is not yours.</Note>
        </>
      )
    }
    return <ErrorContent message={mentorship.error.message} onRetry={() => void mentorship.refetch()} />
  }
  const { state, viewerSide, mentor } = mentorship.data
  const open = state === 'PENDING' || state === 'ACTIVE'
  if (viewerSide === 'STUDENT' && open && mentor.memberId) {
    return <Navigate to={mentorPath(mentor.memberId)} replace />
  }
  const tab =
    viewerSide === 'STUDENT'
      ? open
        ? 'all'
        : 'history'
      : state === 'PENDING'
        ? 'requests'
        : state === 'ACTIVE'
          ? 'mentees'
          : 'history'
  return <Navigate to={`${MY_REQUESTS_PATH}?tab=${tab}`} replace />
}
