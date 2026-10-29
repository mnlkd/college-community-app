import type {
  ActorContextView,
  AdminMemberFilter,
  AlumniReviewView,
  PendingGraduationView,
} from '@hilcoe/shared'
import { Check, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useOutletContext, useSearchParams } from 'react-router-dom'
import {
  useAdminMembers,
  useAlumniReviews,
  useDecideGraduation,
  usePendingGraduationRequests,
  useReviewAlumni,
} from '../api'
import { PROGRAMME_LABELS, RoleChip } from '../design/content'
import { ErrorContent, LoadingContent } from '../design/states'
import { Avatar, Badge, Button, Card, ColumnHeader, Note, TextInput, buttonClass } from '../design/ui'
import {
  DetailRows,
  Dialog,
  LinkTabs,
  Pager,
  ReasonField,
  StateBadge,
  errorMessage,
  formatDate,
  reasonIssue,
} from './kit'

type Tab = 'all' | 'reviews' | 'graduation' | 'flagged' | 'disabled'

const TABS: { key: Tab; label: string; to: string }[] = [
  { key: 'all', label: 'All users', to: '/admin/users' },
  { key: 'reviews', label: 'Self-report reviews', to: '/admin/users?tab=reviews' },
  { key: 'graduation', label: 'Graduation requests', to: '/admin/users?tab=graduation' },
  { key: 'flagged', label: 'Flagged', to: '/admin/users?tab=flagged' },
  { key: 'disabled', label: 'Disabled', to: '/admin/users?tab=disabled' },
]

const FILTERS: Partial<Record<Tab, AdminMemberFilter>> = {
  all: 'ALL',
  flagged: 'FLAGGED',
  disabled: 'DISABLED',
}

function tabOf(value: string | null): Tab {
  return TABS.some((tab) => tab.key === value) ? (value as Tab) : 'all'
}

export function AdminUsers() {
  const actor = useOutletContext<ActorContextView>()
  const [params] = useSearchParams()
  const tab = tabOf(params.get('tab'))
  const filter = FILTERS[tab]
  const { state } = useLocation()
  const notice = (state as { notice?: unknown } | null)?.notice
  return (
    <>
      <ColumnHeader
        title="Users"
        subtitle="Community accounts, Alumni self-report reviews and graduation requests."
        right={
          <Link to="/admin/staff-emails" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Staff emails
          </Link>
        }
        tabs={<LinkTabs tabs={TABS} active={tab} />}
      />
      {typeof notice === 'string' && (
        <div className="mb-4">
          <Note tone="iris">{notice}</Note>
        </div>
      )}
      {filter ? (
        <MemberList key={tab} accountId={actor.accountId} filter={filter} />
      ) : tab === 'reviews' ? (
        <AlumniReviewList accountId={actor.accountId} />
      ) : (
        <GraduationList accountId={actor.accountId} />
      )}
    </>
  )
}

function MemberList({ accountId, filter }: { accountId: string; filter: AdminMemberFilter }) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const list = useAdminMembers(accountId, filter, query, page)

  function search(event: FormEvent) {
    event.preventDefault()
    setQuery(draft.trim())
    setPage(1)
  }

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={search} className="flex max-w-md gap-2">
        <TextInput
          type="search"
          name="query"
          aria-label="Search by name or email"
          placeholder="Search by name or email"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="secondary" aria-label="Search">
          <Search className="size-4" />
        </Button>
      </form>
      {filter === 'FLAGGED' && (
        <Note>Flagged Alumni stay read-only until an Administrator corrects their role or status.</Note>
      )}
      {list.isPending ? (
        <LoadingContent />
      ) : list.isError ? (
        <ErrorContent message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Note>{query ? 'No accounts match this search.' : 'No accounts in this list.'}</Note>
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul aria-label="Accounts" className="divide-y divide-slate-4">
              {list.data.items.map((member) => (
                <li
                  key={member.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 hover:bg-slate-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.displayName} size={34} />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-slate-12">{member.displayName}</p>
                      <p className="truncate font-mono text-[11px] text-slate-9">{member.email}</p>
                    </div>
                  </div>
                  <RoleChip role={member.role} alumniStatus={member.alumniStatus} />
                  <StateBadge state={member.state} />
                  <Link
                    to={`/admin/users/${member.id}`}
                    aria-label={`Manage ${member.displayName}`}
                    className={buttonClass({ variant: 'secondary', size: 'sm' })}
                  >
                    Manage
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
        </>
      )}
    </div>
  )
}

function AlumniReviewList({ accountId }: { accountId: string }) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<AlumniReviewView | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const list = useAlumniReviews(accountId, page)

  if (list.isPending) return <LoadingContent />
  if (list.isError) return <ErrorContent message={list.error.message} onRetry={() => void list.refetch()} />
  return (
    <div className="space-y-4">
      {done && <Note tone="iris">{done}</Note>}
      {list.data.items.length === 0 ? (
        <Note>No Alumni self-reports are waiting for review.</Note>
      ) : (
        <Card className="overflow-hidden">
          <ul aria-label="Alumni self-reports" className="divide-y divide-slate-4">
            {list.data.items.map((review) => (
              <li key={review.id} className="flex items-center gap-4 bg-amber-3/30 px-4 py-3">
                <Avatar name={review.displayName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-slate-12">{review.displayName}</p>
                  <p className="truncate font-mono text-[11px] text-slate-9">{review.email}</p>
                </div>
                <span className="text-[12px] text-slate-10">{formatDate(review.createdAt)}</span>
                <Button size="sm" aria-label={`Review ${review.displayName}`} onClick={() => setOpen(review)}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
      {open && (
        <AlumniReviewDialog
          accountId={accountId}
          review={open}
          onClose={() => setOpen(null)}
          onDone={(message) => {
            setOpen(null)
            setDone(message)
          }}
        />
      )}
    </div>
  )
}

function AlumniReviewDialog({
  accountId,
  review,
  onClose,
  onDone,
}: {
  accountId: string
  review: AlumniReviewView
  onClose: () => void
  onDone: (message: string) => void
}) {
  const decide = useReviewAlumni(accountId)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()

  function submit(decision: 'VERIFIED' | 'FLAGGED') {
    const issue = reasonIssue(reason)
    setReasonError(issue)
    if (issue) return
    decide.mutate(
      { reviewId: review.id, input: { decision, reason } },
      {
        onSuccess: () =>
          onDone(
            decision === 'VERIFIED'
              ? `${review.displayName} is now Verified Alumni.`
              : `${review.displayName} is marked Flagged.`,
          ),
      },
    )
  }

  return (
    <Dialog
      title={`Review ${review.displayName}`}
      sub="Alumni self-report · private Administrator review"
      onClose={onClose}
      footer={
        <>
          <Button variant="dangerGhost" disabled={decide.isPending} onClick={() => submit('FLAGGED')}>
            Mark Flagged
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Later
            </Button>
            <Button disabled={decide.isPending} onClick={() => submit('VERIFIED')}>
              <Check className="size-4" />
              Move to Verified
            </Button>
          </div>
        </>
      }
    >
      {decide.isError && <Note tone="red">{errorMessage(decide.error)}</Note>}
      <DetailRows
        rows={[
          ['Email', <span className="font-mono">{review.email}</span>],
          ['Full name', review.claimedFullName],
          ['Programme', review.programme ? PROGRAMME_LABELS[review.programme] : 'Not given'],
          ['Graduation year', review.graduationYear ?? 'Not given'],
          ['Identifying context', review.identifyingContext ?? 'None given'],
          [
            'Registered with',
            review.registrationPath === 'PERSONAL_EMAIL' ? 'Personal email' : 'College email',
          ],
        ]}
      />
      <Note tone="iris">
        Check these details against trusted college records before deciding. A name match alone, or another
        member’s unsupported claim, is not proof. Leave uncertain cases pending.
      </Note>
      <ReasonField value={reason} error={reasonError} onChange={setReason} />
      <Note tone="amber">
        Flagged accounts stay read-only. Flagging does not disable the account; that is a separate decision.
      </Note>
    </Dialog>
  )
}

function GraduationList({ accountId }: { accountId: string }) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<PendingGraduationView | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const list = usePendingGraduationRequests(accountId, page)

  if (list.isPending) return <LoadingContent />
  if (list.isError) return <ErrorContent message={list.error.message} onRetry={() => void list.refetch()} />
  return (
    <div className="space-y-4">
      {done && <Note tone="iris">{done}</Note>}
      {list.data.items.length === 0 ? (
        <Note>No graduation requests are waiting.</Note>
      ) : (
        <Card className="overflow-hidden">
          <ul aria-label="Graduation requests" className="divide-y divide-slate-4">
            {list.data.items.map((request) => (
              <li key={request.id} className="flex items-center gap-4 px-4 py-3">
                <Avatar name={request.displayName} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-slate-12">{request.displayName}</p>
                  <p className="truncate font-mono text-[11px] text-slate-9">{request.email}</p>
                </div>
                <Badge tone="blue">
                  {PROGRAMME_LABELS[request.programme]} · {request.graduationYear}
                </Badge>
                {request.blockers.length > 0 && <Badge tone="amber">Owns a group</Badge>}
                <Button
                  size="sm"
                  aria-label={`Decide ${request.displayName}`}
                  onClick={() => setOpen(request)}
                >
                  Decide
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />
      {open && (
        <GraduationDialog
          accountId={accountId}
          request={open}
          onClose={() => setOpen(null)}
          onDone={(message) => {
            setOpen(null)
            setDone(message)
          }}
        />
      )}
    </div>
  )
}

function GraduationDialog({
  accountId,
  request,
  onClose,
  onDone,
}: {
  accountId: string
  request: PendingGraduationView
  onClose: () => void
  onDone: (message: string) => void
}) {
  const decide = useDecideGraduation(accountId)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()

  function submit(decision: 'CONFIRMED' | 'DECLINED') {
    const issue = reasonIssue(reason)
    setReasonError(issue)
    if (issue) return
    decide.mutate(
      { requestId: request.id, input: { decision, reason } },
      {
        onSuccess: () =>
          onDone(
            decision === 'CONFIRMED'
              ? `Graduation confirmed. ${request.displayName} is now Verified Alumni.`
              : `The graduation request from ${request.displayName} was declined.`,
          ),
      },
    )
  }

  return (
    <Dialog
      title={`Graduation request · ${request.displayName}`}
      sub="Student asking to become Alumni"
      onClose={onClose}
      footer={
        <>
          <Button variant="dangerGhost" disabled={decide.isPending} onClick={() => submit('DECLINED')}>
            Decline
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Later
            </Button>
            <Button
              disabled={decide.isPending || request.blockers.length > 0}
              onClick={() => submit('CONFIRMED')}
            >
              <Check className="size-4" />
              Confirm graduation
            </Button>
          </div>
        </>
      }
    >
      {decide.isError && <Note tone="red">{errorMessage(decide.error)}</Note>}
      {request.blockers.length > 0 && (
        <Note tone="amber">
          <strong className="font-semibold">Cannot be confirmed yet.</strong> The member must first transfer
          or close:
          <ul aria-label="Graduation blockers" className="mt-1.5 list-disc space-y-1 pl-5">
            {request.blockers.map((blocker) => (
              <li key={`${blocker.kind}:${blocker.id}`}>Group “{blocker.label}”</li>
            ))}
          </ul>
        </Note>
      )}
      <DetailRows
        rows={[
          ['Email', <span className="font-mono">{request.email}</span>],
          [
            'Current programme',
            request.currentProgramme ? PROGRAMME_LABELS[request.currentProgramme] : 'Not given',
          ],
          ['Programme completed', PROGRAMME_LABELS[request.programme]],
          ['Graduation year', request.graduationYear],
          ['Requested', formatDate(request.createdAt)],
        ]}
      />
      <Note>
        Confirming makes the member Verified Alumni and ends their Student-only mentorships and memberships.
        The member is notified of either decision.
      </Note>
      <ReasonField value={reason} error={reasonError} onChange={setReason} />
    </Dialog>
  )
}
