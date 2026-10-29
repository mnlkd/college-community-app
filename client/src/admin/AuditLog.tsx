import {
  AUDIT_ACTIONS,
  auditActionSchema,
  type ActorContextView,
  type AuditAction,
  type AuditRecordView,
} from '@hilcoe/shared'
import { useState, type FormEvent } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { isApiError, useAuditRecords, type AuditFilters } from '../api'
import { ErrorContent, LoadingContent } from '../design/states'
import { Badge, Button, Card, ColumnHeader, Field, Note, Select, TextInput, type Tone } from '../design/ui'
import { OUTCOME_LABELS, formatMoment } from '../design/moderation'
import { reportRef } from './Moderation'
import { Pager } from './kit'

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  ALUMNI_REVIEWED: 'Alumni status reviewed',
  GRADUATION_DECIDED: 'Graduation decided',
  STAFF_EMAIL_ADDED: 'Staff email added',
  STAFF_EMAIL_REMOVED: 'Staff email removed',
  ROLE_CORRECTED: 'Role corrected',
  MEMBER_EMAIL_UPDATED: 'Member email updated',
  ACCOUNT_DISABLED: 'Account disabled',
  ACCOUNT_RESTORED: 'Account restored',
  FAKE_ACCOUNT_DELETED: 'Fake account deleted',
  ADMINISTRATOR_CREATED: 'Administrator created',
  ADMINISTRATOR_MFA_RESET: 'Administrator MFA reset',
  ADMINISTRATOR_REMOVED: 'Administrator removed',
  ADMINISTRATOR_EMAIL_CHANGED: 'Administrator email changed',
  REPORT_DECIDED: 'Report decided',
}

const RED_ACTIONS: AuditAction[] = ['ACCOUNT_DISABLED', 'FAKE_ACCOUNT_DELETED', 'ADMINISTRATOR_REMOVED']

function actionTone(record: AuditRecordView): Tone {
  if (record.outcome) return OUTCOME_LABELS[record.outcome][1]
  return RED_ACTIONS.includes(record.action) ? 'red' : 'blue'
}

const FILTER_KEYS = ['action', 'adminId', 'memberId', 'from', 'to'] as const

function filtersOf(params: URLSearchParams): AuditFilters {
  const action = auditActionSchema.safeParse(params.get('action'))
  return {
    action: action.success ? action.data : null,
    adminId: params.get('adminId') ?? '',
    memberId: params.get('memberId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  }
}

function targetOf(record: AuditRecordView): string {
  if (record.targetMember) return record.targetMember.displayName
  if (record.targetAdmin) return record.targetAdmin.email
  return record.anonymized ? 'Deleted account' : '—'
}

export function AdminAudit() {
  const actor = useOutletContext<ActorContextView>()
  const [params, setParams] = useSearchParams()
  const filters = filtersOf(params)
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [draft, setDraft] = useState<AuditFilters>(filters)
  const records = useAuditRecords(actor.accountId, filters, page)
  const fields = isApiError(records.error) ? records.error.fields : null

  function apply(next: AuditFilters, nextPage = 1) {
    const copy = new URLSearchParams()
    for (const key of FILTER_KEYS) {
      const value = next[key]?.trim()
      if (value) copy.set(key, value)
    }
    if (nextPage > 1) copy.set('page', String(nextPage))
    setParams(copy)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    apply(draft)
  }

  function clear() {
    const empty: AuditFilters = { action: null, adminId: '', memberId: '', from: '', to: '' }
    setDraft(empty)
    apply(empty)
  }

  return (
    <>
      <ColumnHeader
        title="Audit log"
        subtitle="Administrator decisions: actor, target, time and private reason. Newest first."
      />
      <div className="mb-4">
        <Note>
          Records are kept for the account&apos;s lifetime and anonymized for one year after a deletion. They
          cannot be edited. Passwords, codes and tokens are never recorded. There is no export of
          account-level records.
        </Note>
      </div>
      <Card className="mb-4 p-4">
        <form
          noValidate
          onSubmit={submit}
          aria-label="Audit filters"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          <Field label="Action">
            <Select
              name="action"
              value={draft.action ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, action: (event.target.value || null) as AuditAction | null })
              }
            >
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_LABELS[action]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Administrator ID" error={fields?.adminId}>
            <TextInput
              name="adminId"
              mono
              value={draft.adminId}
              onChange={(event) => setDraft({ ...draft, adminId: event.target.value })}
            />
          </Field>
          <Field label="Member ID" error={fields?.memberId}>
            <TextInput
              name="memberId"
              mono
              value={draft.memberId}
              onChange={(event) => setDraft({ ...draft, memberId: event.target.value })}
            />
          </Field>
          <Field label="From (UTC)" error={fields?.from}>
            <TextInput
              type="date"
              name="from"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </Field>
          <Field label="To (UTC)" error={fields?.to}>
            <TextInput
              type="date"
              name="to"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit" size="sm">
              Apply filters
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clear}>
              Clear
            </Button>
          </div>
        </form>
      </Card>
      {records.isPending ? (
        <LoadingContent />
      ) : records.isError ? (
        fields ? null : (
          <ErrorContent message={records.error.message} onRetry={() => void records.refetch()} />
        )
      ) : records.data.items.length === 0 ? (
        <Card className="p-6 text-[14px] text-slate-10">No audit records match.</Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[170px_190px_1fr] gap-3 border-b border-slate-4 bg-slate-2 px-4 py-2.5 font-mono text-[11px] tracking-[0.05em] text-slate-9 uppercase md:grid">
              <span>Time / actor</span>
              <span>Action</span>
              <span>Target / private reason</span>
            </div>
            <ul className="divide-y divide-slate-4" aria-label="Audit records">
              {records.data.items.map((record) => (
                <li
                  key={record.id}
                  className="grid items-start gap-3 px-4 py-3.5 hover:bg-slate-2 md:grid-cols-[170px_190px_1fr]"
                >
                  <div>
                    <p className="font-mono text-[12px] text-slate-12">{formatMoment(record.occurredAt)}</p>
                    <p className="mt-1 text-[11.5px] break-all text-slate-10">
                      {record.actor?.email ?? 'Deleted Administrator'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={actionTone(record)}>{AUDIT_ACTION_LABELS[record.action]}</Badge>
                    {record.outcome && (
                      <Badge tone={OUTCOME_LABELS[record.outcome][1]}>
                        {OUTCOME_LABELS[record.outcome][0]}
                      </Badge>
                    )}
                    {record.anonymized && <Badge>Anonymized</Badge>}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-slate-12">{targetOf(record)}</p>
                    {record.reason && (
                      <p className="mt-0.5 text-[13px] leading-relaxed break-words whitespace-pre-line text-slate-10">
                        {record.reason}
                      </p>
                    )}
                    {record.reportId && (
                      <Link
                        to={`/admin/moderation/${record.reportId}`}
                        className="mt-1 inline-block font-mono text-[12px] text-iris-11"
                      >
                        {reportRef(record.reportId)}
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Pager
            page={page}
            total={records.data.total}
            pageSize={records.data.pageSize}
            onPage={(next) => apply(filters, next)}
          />
        </>
      )}
    </>
  )
}
