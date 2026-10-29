import { PRIVATE_REASON_MAX, privateReasonSchema, type AdminMemberSummaryView } from '@hilcoe/shared'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { isApiError } from '../api'
import { Badge, Button, Field, TextArea, type Tone } from '../design/ui'

/** The message to show for a failed Administrator action. */
export function errorMessage(cause: unknown): string {
  if (isApiError(cause)) return cause.message
  return 'Something went wrong. Try again.'
}

/** The server's field error for `field`, if the failure was a validation error. */
export function fieldError(cause: unknown, field: string): string | undefined {
  return isApiError(cause) ? cause.fields?.[field] : undefined
}

/** Client check of a private reason; the server checks it again. */
export function reasonIssue(reason: string): string | undefined {
  const parsed = privateReasonSchema.safeParse(reason)
  return parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Enter a reason')
}

export function ReasonField({
  label = 'Private reason',
  value,
  error,
  onChange,
}: {
  label?: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <Field
      label={label}
      required
      error={error}
      hint="Seen only by Administrators in the audit record. Never include passwords, codes or tokens."
    >
      <TextArea
        name="reason"
        rows={2}
        maxLength={PRIVATE_REASON_MAX}
        value={value}
        invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

const STATE_TONES: Record<AdminMemberSummaryView['state'], Tone> = {
  ACTIVE: 'green',
  DISABLED: 'red',
}

export function StateBadge({ state }: { state: AdminMemberSummaryView['state'] }) {
  return <Badge tone={STATE_TONES[state]}>{state === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>
}

export { LinkTabs } from '../design/ui'

export function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number
  total: number
  pageSize: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1 && page === 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-[13px] text-slate-10">
      <span>
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

/** A modal panel; Escape or the backdrop closes it. */
export function Dialog({
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  title: string
  sub?: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-12/40 p-4" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[600px] overflow-hidden rounded-2xl bg-white shadow-xl outline-none"
      >
        <div className="border-b border-slate-4 px-5 py-4">
          <h2 id={titleId} className="font-display text-[18px] font-bold tracking-[-0.02em] text-slate-12">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-[13px] text-slate-10">{sub}</p>}
        </div>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-4 bg-slate-2 px-5 py-3.5">
          {footer}
        </div>
      </div>
    </div>
  )
}

/** Label and value rows used in the review dialogs. */
export function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-4 rounded-xl border border-slate-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-4 px-4 py-2.5">
          <dt className="w-[160px] shrink-0 font-mono text-[11px] text-slate-9 uppercase">{label}</dt>
          <dd className="text-[13.5px] text-slate-12">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
