import type { ActorContextView, OpportunityType, OpportunityView, WorkArrangement } from '@hilcoe/shared'
import { Briefcase, CalendarDays, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Card } from '../../design/ui'
import { OPPORTUNITIES_PATH, Pill, SaveToggle } from '../boards/content'
import { canMentor } from '../mentorship/content'
import { isRestricted } from '../posts/eligibility'
import { timeAgo } from '../notifications/Notifications'

export const NEW_OPPORTUNITY_PATH = `${OPPORTUNITIES_PATH}/new`
export const opportunityPath = (id: string) => `${OPPORTUNITIES_PATH}/listings/${id}`
export const editOpportunityPath = (id: string) => `${opportunityPath(id)}/edit`

export const TYPE_LABELS: Record<OpportunityType, string> = {
  INTERNSHIP: 'Internship',
  PART_TIME: 'Part-time',
  FULL_TIME: 'Full-time',
}

export const ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  ON_SITE: 'On-site',
  REMOTE: 'Remote',
  HYBRID: 'Hybrid',
}

/** Staff and Verified Alumni may post listings (FR-6); the server checks again. */
export function canAuthorOpportunity(actor: ActorContextView): boolean {
  return canMentor(actor)
}

/** Creating and editing also need no active restriction; closing does not. */
export function canPostOpportunity(actor: ActorContextView, now = Date.now()): boolean {
  return canAuthorOpportunity(actor) && !isRestricted(actor, now)
}

/** A calendar date (YYYY-MM-DD) as a readable date, with no time-zone shift. */
export function formatDeadline(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
}

/** A listing in a list. A closed listing shows only its title, type and status. */
export function OpportunityCard({
  opportunity,
  actor,
}: {
  opportunity: OpportunityView
  actor: ActorContextView
}) {
  const details = opportunity.details
  const title = (
    <Link
      to={opportunityPath(opportunity.id)}
      className="font-display text-[15.5px] font-bold text-slate-12 hover:underline"
    >
      {opportunity.title}
    </Link>
  )
  if (!details) {
    return (
      <Card className="px-5 py-4">
        <article aria-label={opportunity.title}>
          <div className="flex items-start justify-between gap-3">
            {title}
            <SaveToggle
              actor={actor}
              type="OPPORTUNITY"
              id={opportunity.id}
              saved={opportunity.savedByMe}
              open={false}
              noun="listing"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <Badge>{TYPE_LABELS[opportunity.type]}</Badge>
            <Badge>Closed</Badge>
          </div>
        </article>
      </Card>
    )
  }
  const place =
    details.location === ARRANGEMENT_LABELS[details.workArrangement]
      ? details.location
      : `${details.location} · ${ARRANGEMENT_LABELS[details.workArrangement]}`
  return (
    <Card hover className="px-5 py-4">
      <article aria-label={opportunity.title} className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-iris-9 text-white">
          <Briefcase className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            {title}
            <div className="flex shrink-0 gap-1.5">
              {opportunity.state === 'HIDDEN' && <Badge tone="red">Hidden by moderation</Badge>}
              <Badge tone="iris">{TYPE_LABELS[opportunity.type]}</Badge>
            </div>
          </div>
          <p className="mt-0.5 font-display text-[13.5px] font-semibold text-slate-11">
            {details.organization}
          </p>
          <p className="mt-2 line-clamp-2 text-[13.5px] leading-relaxed break-words text-slate-10">
            {details.description}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Pill icon={<MapPin className="size-3.5" aria-hidden="true" />}>{place}</Pill>
            {details.deadline && (
              <Pill icon={<CalendarDays className="size-3.5" aria-hidden="true" />}>
                Apply by {formatDeadline(details.deadline)}
              </Pill>
            )}
          </div>
          <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-slate-4 pt-3">
            <p className="min-w-0 truncate text-[12px] text-slate-10">
              Posted {timeAgo(details.createdAt)} by {details.author.displayName}
            </p>
            <SaveToggle
              actor={actor}
              type="OPPORTUNITY"
              id={opportunity.id}
              saved={opportunity.savedByMe}
              open={opportunity.state === 'OPEN'}
              noun="listing"
            />
          </div>
        </div>
      </article>
    </Card>
  )
}
