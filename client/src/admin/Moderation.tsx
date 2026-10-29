import {
  RESTRICTION_DAYS,
  type ActorContextView,
  type AdminReportState,
  type ConsequencePreview,
  type DecisionResultView,
  type ReportDecision,
  type ReportDetailView,
  type ReportSummaryView,
} from '@hilcoe/shared'
import { Flag } from 'lucide-react'
import { useState } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { isApiError, useAdminReport, useAdminReports, useDecideReport } from '../api'
import { ErrorContent, LoadingContent } from '../design/states'
import { Badge, Button, Card, ColumnHeader, Note, buttonClass, cx } from '../design/ui'
import {
  GUIDELINE_LABELS,
  OUTCOME_LABELS,
  ReportStateBadge,
  TARGET_LABELS,
  formatMoment,
} from '../design/moderation'
import { DetailRows, Dialog, LinkTabs, Pager, ReasonField, errorMessage, reasonIssue } from './kit'

const TABS: { key: AdminReportState; label: string; to: string }[] = [
  { key: 'PENDING', label: 'Pending', to: '/admin/moderation' },
  { key: 'UPHELD', label: 'Upheld', to: '/admin/moderation?state=upheld' },
  { key: 'DISMISSED', label: 'Dismissed', to: '/admin/moderation?state=dismissed' },
  { key: 'ALL', label: 'All', to: '/admin/moderation?state=all' },
]

function stateOf(value: string | null): AdminReportState {
  const upper = value?.toUpperCase()
  return TABS.find((tab) => tab.key === upper)?.key ?? 'PENDING'
}

/** A short reference for a report, shown to Administrators only. */
export const reportRef = (id: string) => `RPT-${id.slice(0, 8).toUpperCase()}`

const priorText = (count: number) => `${count} earlier upheld violation${count === 1 ? '' : 's'}`

export function AdminModeration() {
  const actor = useOutletContext<ActorContextView>()
  const [params, setParams] = useSearchParams()
  const state = stateOf(params.get('state'))
  const page = Math.max(1, Number(params.get('page')) || 1)
  const { state: navState } = useLocation()
  const notice = (navState as { notice?: unknown } | null)?.notice
  const reports = useAdminReports(actor.accountId, state, page)

  function onPage(next: number) {
    const copy = new URLSearchParams(params)
    copy.set('page', String(next))
    setParams(copy)
  }

  return (
    <>
      <ColumnHeader
        title="Moderation"
        subtitle="Private reports about posts, comments and opportunities."
        right={
          <Link to="/admin/audit" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Audit log
          </Link>
        }
        tabs={<LinkTabs tabs={TABS} active={state} />}
      />
      {typeof notice === 'string' && (
        <div className="mb-4" role="status">
          <Note tone="iris">{notice}</Note>
        </div>
      )}
      <div className="mb-4">
        <Note>
          Reports are private to the reporter and Administrators. Outcome notices never tell the author who
          reported. Pending reports are listed oldest first.
        </Note>
      </div>
      {reports.isPending ? (
        <LoadingContent />
      ) : reports.isError ? (
        <ErrorContent message={reports.error.message} onRetry={() => void reports.refetch()} />
      ) : reports.data.items.length === 0 ? (
        <Card className="p-6 text-[14px] text-slate-10">
          {page === 1 ? `No ${state === 'ALL' ? '' : state.toLowerCase() + ' '}reports.` : 'No more reports.'}
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {reports.data.items.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
          <Pager page={page} total={reports.data.total} pageSize={reports.data.pageSize} onPage={onPage} />
        </>
      )}
    </>
  )
}

function ReportCard({ report }: { report: ReportSummaryView }) {
  return (
    <Card hover className="p-4">
      <article aria-label={`Report ${reportRef(report.id)}`} className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-red-7/60 bg-red-3/50">
          <Flag className="size-[17px] text-red-11" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-slate-9">{reportRef(report.id)}</span>
            <Badge>{TARGET_LABELS[report.targetType]}</Badge>
            <Badge tone="red">{GUIDELINE_LABELS[report.reason]}</Badge>
            {report.authorPriorViolations > 0 && (
              <Badge tone="amber">{priorText(report.authorPriorViolations)}</Badge>
            )}
            <ReportStateBadge state={report.state} />
            <span className="ml-auto text-[12px] text-slate-9">{formatMoment(report.createdAt)}</span>
          </div>
          {report.excerpt ? (
            <blockquote className="mt-2.5 border-l-2 border-slate-6 pl-3 text-[14px] leading-[1.55] break-words whitespace-pre-line text-slate-11">
              {report.excerpt}
            </blockquote>
          ) : (
            <p className="mt-2.5 text-[13px] text-slate-10 italic">Evidence expired.</p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-9">
            <span>
              Written by <span className="font-medium text-slate-11">{report.author.displayName}</span>
            </span>
            <span>
              Private reporter:{' '}
              <span className="font-medium text-slate-11">{report.reporter.displayName}</span>
            </span>
          </div>
          <div className="mt-3">
            <Link
              to={`/admin/moderation/${report.id}`}
              className={buttonClass({
                size: 'sm',
                variant: report.state === 'PENDING' ? 'primary' : 'secondary',
              })}
            >
              {report.state === 'PENDING' ? 'Review' : 'View decision'}
            </Link>
          </div>
        </div>
      </article>
    </Card>
  )
}

function upholdLabel(preview: ConsequencePreview | null): string {
  if (preview === 'WARNING') return 'Hide content and issue warning'
  if (preview === 'RESTRICTION') return 'Hide content and restrict posting'
  return 'Hide content'
}

function upholdNote(preview: ConsequencePreview | null): string {
  if (preview === 'WARNING') {
    return 'Consequence: a private warning that does not expire. This is the author’s first upheld violation, so posting is not restricted.'
  }
  if (preview === 'RESTRICTION') {
    return `Consequence: posting and commenting are restricted for ${RESTRICTION_DAYS} days from this decision. A later upheld violation restarts the period. Browsing remains available; this is not account disablement.`
  }
  return 'No consequence: the author’s account was deleted, or this item already counts as a violation.'
}

function resultNotice(result: DecisionResultView): string {
  const resolved =
    result.resolvedReports > 1 ? ` ${result.resolvedReports} reports on the item were resolved.` : ''
  if (result.outcome === 'DISMISSED')
    return 'Report dismissed. No violation counted; the reporter was notified.'
  if (result.outcome === 'UPHELD_WARNING') return `Content hidden and a private warning issued.${resolved}`
  if (result.outcome === 'UPHELD_RESTRICTION') {
    const until = result.consequence?.restrictUntil
    return `Content hidden; posting and commenting restricted${until ? ` until ${formatMoment(until)}` : ''}.${resolved}`
  }
  return `Content hidden. No consequence applied.${resolved}`
}

export function AdminReportDecision() {
  const actor = useOutletContext<ActorContextView>()
  const { reportId = '' } = useParams()
  const report = useAdminReport(actor.accountId, reportId)

  const back = (
    <Link to="/admin/moderation" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
      Back to queue
    </Link>
  )
  if (report.isPending) return <LoadingContent />
  if (report.isError) {
    if (isApiError(report.error) && report.error.status === 404) {
      return (
        <>
          <ColumnHeader title="Report unavailable" right={back} />
          <Note>This report does not exist.</Note>
        </>
      )
    }
    return <ErrorContent message={report.error.message} onRetry={() => void report.refetch()} />
  }
  const view = report.data
  return (
    <>
      <ColumnHeader
        title={`Review ${TARGET_LABELS[view.targetType].toLowerCase()} by ${view.author.displayName}`}
        subtitle={`${reportRef(view.id)} · evidence visible to Administrators only`}
        right={back}
      />
      <div className="space-y-4">
        <DetailRows
          rows={[
            ['State', <ReportStateBadge key="state" state={view.state} />],
            ['Guideline', GUIDELINE_LABELS[view.reason]],
            ['Reported', formatMoment(view.createdAt)],
            ['Private reporter', view.reporter.displayName],
            ['Reporter context', view.details ?? '—'],
            ['Author', view.author.displayName],
            ['Earlier violations', String(view.authorPriorViolations)],
            ...(view.otherPendingReports > 0
              ? ([['Other pending reports', String(view.otherPendingReports)]] as [string, string][])
              : []),
          ]}
        />
        <Evidence view={view} />
        {view.decision ? (
          <Card className="p-4">
            <h2 className="font-display text-[15px] font-bold text-slate-12">Decision</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px]">
              <Badge tone={OUTCOME_LABELS[view.decision.outcome][1]}>
                {OUTCOME_LABELS[view.decision.outcome][0]}
              </Badge>
              <span className="text-slate-10">{formatMoment(view.decision.decidedAt)}</span>
            </div>
            {view.decision.reason && (
              <p className="mt-2 text-[13.5px] whitespace-pre-line text-slate-11">{view.decision.reason}</p>
            )}
          </Card>
        ) : view.state === 'PENDING' ? (
          <DecisionForm actor={actor} view={view} />
        ) : (
          <Note>This report was resolved by the decision on another report about the same item.</Note>
        )}
      </div>
    </>
  )
}

function Evidence({ view }: { view: ReportDetailView }) {
  if (view.evidenceExpired || !view.evidence) {
    return <Note>Evidence expired. Snapshots are kept for seven days after the decision.</Note>
  }
  const { snapshotText, images } = view.evidence
  return (
    <Card className="p-4">
      <h2 className="font-display text-[15px] font-bold text-slate-12">Evidence at the time of the report</h2>
      {snapshotText ? (
        <blockquote className="mt-2 rounded-xl border border-slate-5 bg-slate-2 px-4 py-3 text-[14px] leading-[1.55] break-words whitespace-pre-line text-slate-11">
          {snapshotText}
        </blockquote>
      ) : (
        <p className="mt-2 text-[13px] text-slate-10 italic">No text.</p>
      )}
      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((image, index) => (
            <img
              key={image.url}
              src={image.url}
              alt={image.altText ?? `Reported image ${index + 1}`}
              className="aspect-square w-full rounded-lg border border-slate-5 object-cover"
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function DecisionForm({ actor, view }: { actor: ActorContextView; view: ReportDetailView }) {
  const navigate = useNavigate()
  const decide = useDecideReport(actor.accountId)
  const [decision, setDecision] = useState<ReportDecision>('UPHELD')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()
  const [confirming, setConfirming] = useState(false)
  const uphold = decision === 'UPHELD'
  const actionLabel = uphold ? upholdLabel(view.consequencePreview) : 'Dismiss report'

  function review() {
    const issue = reasonIssue(reason)
    setReasonError(issue)
    if (!issue) setConfirming(true)
  }

  function confirm() {
    decide.mutate(
      { reportId: view.id, input: { decision, reason } },
      {
        onSuccess: (result) => navigate('/admin/moderation', { state: { notice: resultNotice(result) } }),
        onError: () => setConfirming(false),
      },
    )
  }

  const conflict = isApiError(decide.error) && decide.error.code === 'CONFLICT'
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-display text-[15px] font-bold text-slate-12">Decide</h2>
      {decide.isError && (
        <Note tone="red">
          {conflict
            ? 'This report was already decided. Reload to see the decision.'
            : errorMessage(decide.error)}
        </Note>
      )}
      <Note tone="amber">
        <strong className="font-semibold">Count distinct upheld content, not reports.</strong> Several reports
        about the same item count once. The first upheld violation gives a private warning; later ones
        restrict posting and commenting for {RESTRICTION_DAYS} days.
      </Note>
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Decision">
        {(['UPHELD', 'DISMISSED'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={decision === value}
            onClick={() => setDecision(value)}
            className={cx(
              'rounded-xl border p-3 text-left text-[14px] font-semibold',
              decision === value ? 'border-iris-8 bg-iris-2 text-iris-11' : 'border-slate-5 text-slate-11',
            )}
          >
            {value === 'UPHELD' ? 'Uphold content violation' : 'Dismiss report'}
          </button>
        ))}
      </div>
      <ReasonField
        label="Decision reason"
        value={reason}
        error={reasonError ?? (isApiError(decide.error) ? decide.error.fields?.reason : undefined)}
        onChange={setReason}
      />
      <Note tone={uphold ? (view.consequencePreview === 'RESTRICTION' ? 'red' : 'amber') : 'iris'}>
        {uphold
          ? upholdNote(view.consequencePreview)
          : 'Dismiss: the content stays visible, no violation is counted and only the reporter is notified.'}
      </Note>
      {uphold && (
        <Note>
          Upholding hides the content from the community, keeps the evidence for seven days and notifies the
          author and every reporter privately.
          {view.otherPendingReports > 0 &&
            ` The ${view.otherPendingReports} other pending report${view.otherPendingReports === 1 ? '' : 's'} on this item are resolved too.`}
        </Note>
      )}
      <div className="flex justify-end gap-2">
        <Link to="/admin/moderation" className={buttonClass({ variant: 'ghost' })}>
          Cancel
        </Link>
        <Button variant={uphold ? 'danger' : 'primary'} onClick={review}>
          {actionLabel}
        </Button>
      </div>
      {confirming && (
        <Dialog
          title={uphold ? 'Uphold this report?' : 'Dismiss this report?'}
          sub="The decision is recorded in the audit log and cannot be changed."
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button variant={uphold ? 'danger' : 'primary'} disabled={decide.isPending} onClick={confirm}>
                {decide.isPending ? 'Saving…' : actionLabel}
              </Button>
            </>
          }
        >
          <DetailRows
            rows={[
              ['Report', reportRef(view.id)],
              ['Author', view.author.displayName],
              ['Decision', uphold ? 'Uphold' : 'Dismiss'],
              ['Reason', reason.trim()],
            ]}
          />
        </Dialog>
      )}
    </Card>
  )
}
