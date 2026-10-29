import {
  PROGRAMMES,
  graduationInputSchema,
  pastGraduationYearSchema,
  type ActorContextView,
  type OwnAccountView,
} from '@hilcoe/shared'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { isApiError, useMyGroups, useOwnAccount, useRequestGraduation } from '../../api'
import { PROGRAMME_LABELS } from '../../design/content'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Badge, Button, Card, ColumnHeader, Field, Note, Select } from '../../design/ui'
import { groupPath } from '../groups/content'
import { fieldErrorsOf, yearOptions } from '../profile/RoleDetailsFields'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** The notice the SRS requires before submission (Request Alumni Status, FR-9). */
export function GraduationNotice() {
  return (
    <Note tone="amber">
      <strong className="font-semibold">Before you send this request</strong>
      <ul className="mt-1.5 list-disc space-y-1 pl-5">
        <li>When an Administrator confirms it, your role changes from Student to Verified Alumni.</li>
        <li>Your mentorships as a mentee end and their contacts are removed.</li>
        <li>Your group memberships end.</li>
        <li>Pending mentorship and group requests are withdrawn.</li>
        <li>Your posts, comments, likes and saved items stay.</li>
        <li>Any group you own must first be transferred to another member or closed.</li>
      </ul>
    </Note>
  )
}

export function GraduationRequest() {
  const actor = useOutletContext<ActorContextView>()
  const account = useOwnAccount(actor.accountId)
  if (account.isPending) return <LoadingContent />
  if (account.isError)
    return <ErrorContent message={account.error.message} onRetry={() => void account.refetch()} />
  return <GraduationForm accountId={actor.accountId} account={account.data} />
}

function GraduationForm({ accountId, account }: { accountId: string; account: OwnAccountView }) {
  const navigate = useNavigate()
  const request = useRequestGraduation(accountId)
  const currentYear = new Date().getUTCFullYear()
  const [programme, setProgramme] = useState<string>(account.profile.programme ?? '')
  const [graduationYear, setGraduationYear] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const latest = account.graduationRequest

  const header = (
    <ColumnHeader title="Request Alumni status" subtitle="For Students who have completed their programme." />
  )
  if (account.role !== 'STUDENT') {
    return (
      <>
        {header}
        <Note>Only Students can request Alumni status.</Note>
      </>
    )
  }
  if (latest?.decision === 'PENDING') {
    return (
      <>
        {header}
        <Card className="max-w-2xl space-y-3 p-5">
          <Badge tone="amber">Waiting for an Administrator</Badge>
          <p className="text-[14px] text-slate-11">
            Sent {formatDate(latest.createdAt)} · {PROGRAMME_LABELS[latest.programme]} ·{' '}
            {latest.graduationYear}
          </p>
          <Note>You keep Student access until an Administrator decides. You will get a notification.</Note>
        </Card>
      </>
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const input = { programme, graduationYear: graduationYear === '' ? undefined : Number(graduationYear) }
    const next: Record<string, string> = {}
    const parsed = graduationInputSchema.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] ??= 'Required'
    } else {
      const year = pastGraduationYearSchema(currentYear).safeParse(parsed.data.graduationYear)
      if (!year.success) next.graduationYear = year.error.issues[0]?.message ?? 'Not valid'
    }
    setErrors(next)
    if (!parsed.success || Object.keys(next).length > 0) return
    request.mutate(parsed.data, {
      onSuccess: () =>
        navigate('/settings', {
          replace: true,
          state: {
            notice:
              'Graduation request sent. You keep Student access until an Administrator confirms it, and you will get a notification with the decision.',
          },
        }),
      onError: (cause) => {
        const fields = fieldErrorsOf(cause)
        if (fields) setErrors(fields)
        else setError(isApiError(cause) ? cause.message : 'The request could not be sent. Try again.')
      },
    })
  }

  return (
    <>
      {header}
      <Card className="max-w-2xl p-5">
        <form noValidate onSubmit={submit} className="space-y-4">
          {error && <Note tone="red">{error}</Note>}
          {latest?.decision === 'DECLINED' && (
            <Note>Your previous request was declined. You can send a new one.</Note>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Programme completed" required error={errors.programme}>
              <Select
                name="programme"
                value={programme}
                invalid={Boolean(errors.programme)}
                onChange={(event) => setProgramme(event.target.value)}
              >
                <option value="">Choose…</option>
                {PROGRAMMES.map((value) => (
                  <option key={value} value={value}>
                    {PROGRAMME_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Graduation year" required error={errors.graduationYear}>
              <Select
                name="graduationYear"
                value={graduationYear}
                invalid={Boolean(errors.graduationYear)}
                onChange={(event) => setGraduationYear(event.target.value)}
              >
                <option value="">Choose…</option>
                {yearOptions('ALUMNI', currentYear).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <GraduationNotice />
          <OwnedGroups accountId={accountId} />
          <Note>
            Your @hilcoeschool.com mailbox may be closed after graduation.{' '}
            <Link to="/settings/email" className="font-semibold text-iris-11 underline">
              Change your account email
            </Link>{' '}
            to a personal address so you can still sign in and reset your password.
          </Note>
          <div className="flex gap-3">
            <Button type="submit" disabled={request.isPending}>
              {request.isPending ? 'Sending…' : 'Send request'}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/settings')}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}

/** Open groups the Student owns; an Administrator cannot confirm graduation while any remain. */
function OwnedGroups({ accountId }: { accountId: string }) {
  const owned = useMyGroups(accountId, { relation: 'OWNER', state: 'OPEN' }, 1)
  if (!owned.data || owned.data.items.length === 0) return null
  return (
    <Note tone="amber">
      <strong className="font-semibold">You own open groups.</strong> Transfer or close them before an
      Administrator can confirm your graduation:
      <ul aria-label="Groups you own" className="mt-1.5 list-disc space-y-1 pl-5">
        {owned.data.items.map((group) => (
          <li key={group.id}>
            <Link to={groupPath(group.id)} className="font-semibold underline">
              {group.title}
            </Link>
          </li>
        ))}
      </ul>
    </Note>
  )
}
