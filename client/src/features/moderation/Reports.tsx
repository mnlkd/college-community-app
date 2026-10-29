import {
  GUIDELINE_CATEGORIES,
  REPORT_DETAILS_MAX,
  reportInputSchema,
  reportTargetTypeSchema,
  uuidSchema,
  type ActorContextView,
  type GuidelineCategory,
  type ReportView,
} from '@hilcoe/shared'
import { CheckCircle2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { isApiError, useMyReports, useSubmitReport } from '../../api'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Button, Card, ColumnHeader, Field, Note, Select, TextArea, buttonClass } from '../../design/ui'
import { Pager } from '../posts/content'
import { usePageParam } from '../posts/Feeds'
import { publishBlockReason } from '../posts/eligibility'
import { GUIDELINE_LABELS, ReportStateBadge, TARGET_LABELS, formatDay } from '../../design/moderation'
import { canReport, type ReportContext } from './content'

const PRIVACY =
  'Reports are private to you and Administrators. The author is told the outcome but never who reported.'

function readContext(state: unknown): ReportContext | null {
  if (typeof state !== 'object' || state === null) return null
  const value = state as Partial<ReportContext>
  return typeof value.back === 'string'
    ? { back: value.back, author: value.author ?? null, excerpt: value.excerpt ?? null }
    : null
}

function submitError(error: unknown): string {
  if (!isApiError(error)) return 'Something went wrong. Try again.'
  if (error.code === 'DUPLICATE') return 'You already have a pending report about this item.'
  if (error.code === 'NOT_FOUND') return 'This content is no longer available.'
  if (error.code === 'CONFLICT') return 'This content can no longer be reported.'
  return error.message
}

export function ReportContent() {
  const actor = useOutletContext<ActorContextView>()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const context = readContext(location.state)
  const type = reportTargetTypeSchema.safeParse(params.get('targetType'))
  const id = uuidSchema.safeParse(params.get('targetId'))
  const submit = useSubmitReport(actor.accountId)
  const [reason, setReason] = useState<GuidelineCategory | ''>('')
  const [details, setDetails] = useState('')
  const [errors, setErrors] = useState<{ reason?: string; details?: string }>({})
  const [filed, setFiled] = useState<ReportView | null>(null)

  if (!type.success || !id.success) {
    return (
      <>
        <ColumnHeader title="Report content" />
        <Note>Nothing to report. Open a post, comment or opportunity and choose Report.</Note>
      </>
    )
  }
  const noun = TARGET_LABELS[type.data].toLowerCase()
  const back = context?.back ?? '/home'

  if (filed) {
    return (
      <>
        <ColumnHeader title="Report submitted" />
        <Card className="p-5">
          <div className="flex gap-3" role="status">
            <CheckCircle2 className="size-5 shrink-0 text-green-11" aria-hidden="true" />
            <div>
              <p className="font-semibold text-slate-12">Thank you. An Administrator will review it.</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-slate-11">
                The outcome appears in your private report history and in your notifications.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/reports" className={buttonClass({ size: 'sm' })}>
                  View my report history
                </Link>
                <Link to={back} className={buttonClass({ size: 'sm', variant: 'secondary' })}>
                  Back to the {noun}
                </Link>
              </div>
            </div>
          </div>
        </Card>
      </>
    )
  }

  if (!canReport(actor, false)) {
    return (
      <>
        <ColumnHeader title={`Report this ${noun}`} />
        <Note tone="amber">
          {publishBlockReason(actor) ?? 'Your account cannot report content right now.'} Your previous report
          history remains available.
        </Note>
        <Link to="/reports" className="mt-3 inline-block text-[13px] font-semibold text-iris-11">
          My report history
        </Link>
      </>
    )
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!type.success || !id.success) return
    const parsed = reportInputSchema.safeParse({
      targetType: type.data,
      targetId: id.data,
      reason,
      details,
    })
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'reason') next.reason = 'Choose the guideline this breaks'
        if (issue.path[0] === 'details') next.details = issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    submit.mutate(parsed.data, { onSuccess: setFiled })
  }

  const serverFields = isApiError(submit.error) ? submit.error.fields : null
  return (
    <>
      <ColumnHeader title={`Report this ${noun}`} subtitle={PRIVACY} />
      <Card className="p-5">
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {context && (context.author || context.excerpt) && (
            <div className="rounded-xl border border-slate-5 bg-slate-2 p-4">
              {context.author && <p className="font-semibold text-slate-12">{context.author}</p>}
              {context.excerpt && (
                <p className="mt-1.5 line-clamp-4 text-[13.5px] leading-relaxed whitespace-pre-line text-slate-11">
                  {context.excerpt}
                </p>
              )}
            </div>
          )}
          {submit.isError && !serverFields && <Note tone="red">{submitError(submit.error)}</Note>}
          <Field label="Community guideline" required error={errors.reason ?? serverFields?.reason}>
            <Select
              name="reason"
              value={reason}
              invalid={Boolean(errors.reason)}
              onChange={(event) => setReason(event.target.value as GuidelineCategory | '')}
            >
              <option value="">Choose a guideline</option>
              {GUIDELINE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {GUIDELINE_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Additional context (optional)"
            error={errors.details ?? serverFields?.details}
            hint={`Up to ${REPORT_DETAILS_MAX} characters. Never include passwords or codes.`}
          >
            <TextArea
              name="details"
              rows={3}
              maxLength={REPORT_DETAILS_MAX}
              value={details}
              invalid={Boolean(errors.details)}
              onChange={(event) => setDetails(event.target.value)}
            />
          </Field>
          <Note>
            Reports cover posts, comments and opportunities. A post&apos;s images belong to the post report.
            Profiles, pictures and groups are not report targets.
          </Note>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => navigate(back)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit report'}
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}

function targetLink(report: ReportView): string | null {
  if (report.targetType === 'POST') return `/posts/${report.targetId}`
  if (report.targetType === 'OPPORTUNITY') return `/boards/opportunities/listings/${report.targetId}`
  return null
}

const OUTCOME_TEXT: Record<ReportView['state'], string> = {
  PENDING: 'Waiting for an Administrator.',
  UPHELD: 'An Administrator upheld your report. The content is hidden from the community.',
  DISMISSED: 'An Administrator reviewed your report and found no guideline violation.',
}

export function ReportHistory() {
  const actor = useOutletContext<ActorContextView>()
  const [page, setPage] = usePageParam()
  const reports = useMyReports(actor.accountId, page)
  return (
    <>
      <ColumnHeader title="My report history" subtitle="Only you and Administrators can see these reports." />
      {!canReport(actor, false) && (
        <div className="mb-4">
          <Note tone="amber">
            Your account cannot submit new reports right now. Previous report history remains available.
          </Note>
        </div>
      )}
      {reports.isPending ? (
        <LoadingContent />
      ) : reports.isError ? (
        <ErrorContent message={reports.error.message} onRetry={() => void reports.refetch()} />
      ) : reports.data.items.length === 0 ? (
        <Note>{page === 1 ? 'You have not reported anything.' : 'No more reports.'}</Note>
      ) : (
        <>
          <div className="space-y-3">
            {reports.data.items.map((report) => {
              const link = targetLink(report)
              return (
                <Card key={report.id} className="p-4">
                  <article aria-label={`${TARGET_LABELS[report.targetType]} report`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <ReportStateBadge state={report.state} />
                      <span className="font-semibold text-slate-12">
                        {TARGET_LABELS[report.targetType]} report
                      </span>
                      <span className="ml-auto text-[12px] text-slate-9">
                        Filed {formatDay(report.createdAt)}
                        {report.decidedAt && ` · decided ${formatDay(report.decidedAt)}`}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13.5px] text-slate-11">{GUIDELINE_LABELS[report.reason]}</p>
                    {report.details && (
                      <p className="mt-1 text-[13px] whitespace-pre-line text-slate-10">{report.details}</p>
                    )}
                    <p className="mt-2 text-[13px] text-slate-11">{OUTCOME_TEXT[report.state]}</p>
                    {link && report.state !== 'UPHELD' && (
                      <Link to={link} className="mt-2 inline-block text-[12.5px] font-semibold text-iris-11">
                        Open the {TARGET_LABELS[report.targetType].toLowerCase()}
                      </Link>
                    )}
                  </article>
                </Card>
              )
            })}
          </div>
          <Pager page={page} total={reports.data.total} pageSize={reports.data.pageSize} onPage={setPage} />
        </>
      )}
    </>
  )
}
