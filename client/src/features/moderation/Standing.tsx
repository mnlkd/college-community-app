import { RESTRICTION_DAYS, type ActorContextView, type ConsequenceView } from '@hilcoe/shared'
import { AlertTriangle, Ban, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMyConsequences } from '../../api'
import { Badge, Card, IconButton, Note } from '../../design/ui'
import { CONSEQUENCE_LABELS, TARGET_LABELS, formatDay, formatMoment } from '../../design/moderation'

const DISMISSED_KEY = 'hilcoe.moderation.dismissedWarnings'

function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** The restriction that ends last, if it has not ended yet. */
export function activeRestriction(consequences: ConsequenceView[], now = Date.now()) {
  let latest: ConsequenceView | null = null
  for (const item of consequences) {
    if (item.kind !== 'RESTRICTION' || !item.restrictUntil) continue
    if (new Date(item.restrictUntil).getTime() <= now) continue
    if (!latest || item.restrictUntil > (latest.restrictUntil ?? '')) latest = item
  }
  return latest
}

const noun = (item: ConsequenceView) => TARGET_LABELS[item.targetType].toLowerCase()

/** Home banners: an active restriction, and the latest warning until the member dismisses it. */
export function ModerationBanners({ actor }: { actor: ActorContextView }) {
  const consequences = useMyConsequences(actor.accountId)
  const [dismissed, setDismissed] = useState(readDismissed)
  if (!consequences.data) return null
  const restriction = activeRestriction(consequences.data)
  const warning = consequences.data.find((item) => item.kind === 'WARNING')
  const showWarning = warning && !dismissed.includes(warning.id)

  function dismiss(id: string) {
    const next = [...dismissed, id]
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    setDismissed(next)
  }

  return (
    <>
      {restriction?.restrictUntil && (
        <Card className="mb-4 border-red-7 bg-red-3/40 p-4">
          <section aria-label="Posting restriction" className="flex gap-3">
            <Ban className="size-5 shrink-0 text-red-11" aria-hidden="true" />
            <div>
              <h2 className="font-display font-bold text-slate-12">
                Posting and commenting restricted until {formatMoment(restriction.restrictUntil)}
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-slate-11">
                An Administrator upheld a report on your {noun(restriction)} on{' '}
                {formatDay(restriction.decidedAt)}. It is hidden. You can still browse, like, save, report and
                edit your profile. A further upheld violation restarts the {RESTRICTION_DAYS} days from that
                decision. This is not account disablement.
              </p>
            </div>
          </section>
        </Card>
      )}
      {showWarning && (
        <Card className="mb-4 border-amber-7 bg-amber-2 p-4">
          <section aria-label="Moderation warning" className="flex gap-3">
            <AlertTriangle className="size-5 shrink-0 text-amber-11" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display font-bold text-slate-12">
                Warning: private to you and Administrators
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-slate-11">
                An Administrator upheld a report on your {noun(warning)} on {formatDay(warning.decidedAt)}. It
                is hidden. This warning does not expire, but you can still post and comment. A later upheld
                violation on different content restricts posting and commenting for {RESTRICTION_DAYS} days.
              </p>
              <Link
                to="/settings#moderation"
                className="mt-2 inline-block text-[13px] font-semibold text-iris-11"
              >
                See my moderation standing
              </Link>
            </div>
            <IconButton aria-label="Dismiss warning" onClick={() => dismiss(warning.id)}>
              <X className="size-4" />
            </IconButton>
          </section>
        </Card>
      )}
    </>
  )
}

/** Settings section listing every consequence; the reporters and the deciding Administrator are never shown. */
export function ModerationStanding({ actor }: { actor: ActorContextView }) {
  const consequences = useMyConsequences(actor.accountId)
  const restriction = consequences.data ? activeRestriction(consequences.data) : null
  const { hash } = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)
  const loaded = !consequences.isPending
  useEffect(() => {
    if (hash === '#moderation' && loaded) heading.current?.scrollIntoView?.({ block: 'start' })
  }, [hash, loaded])
  return (
    <>
      <h2
        ref={heading}
        id="moderation"
        className="font-display mt-6 mb-2 text-[15px] font-bold text-slate-12"
      >
        Moderation standing
      </h2>
      <Card className="p-4">
        {consequences.isPending ? (
          <p className="text-[13.5px] text-slate-10">Loading…</p>
        ) : consequences.isError ? (
          <Note tone="red">{consequences.error.message}</Note>
        ) : consequences.data.length === 0 ? (
          <p className="text-[13.5px] text-slate-11">You have no warnings or restrictions.</p>
        ) : (
          <>
            {restriction?.restrictUntil && (
              <div className="mb-3">
                <Note tone="red">
                  Posting and commenting are restricted until {formatMoment(restriction.restrictUntil)}.
                </Note>
              </div>
            )}
            <ul className="divide-y divide-slate-4" aria-label="Consequences">
              {consequences.data.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 py-2.5 text-[13.5px]">
                  <Badge tone={item.kind === 'WARNING' ? 'amber' : 'red'}>
                    {CONSEQUENCE_LABELS[item.kind]}
                  </Badge>
                  <span className="text-slate-11">
                    {TARGET_LABELS[item.targetType]} hidden on {formatDay(item.decidedAt)}
                    {item.restrictUntil && ` · until ${formatMoment(item.restrictUntil)}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <Link to="/reports" className="mt-3 inline-block text-[13px] font-semibold text-iris-11">
          My report history
        </Link>
      </Card>
    </>
  )
}
