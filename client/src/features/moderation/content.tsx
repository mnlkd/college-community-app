import type { ActorContextView, ReportTargetType } from '@hilcoe/shared'
import { Flag } from 'lucide-react'
import { Link } from 'react-router-dom'
import { TARGET_LABELS } from '../../design/moderation'
import { canInteract } from '../posts/eligibility'

/**
 * Who may report (UC-23): an ACTIVE Student, Staff member or Verified Alumni, about content they
 * did not write. A restriction does not prevent reporting. The server checks again.
 */
export function canReport(actor: ActorContextView, isOwn: boolean): boolean {
  return canInteract(actor) && !isOwn
}

export function reportPath(type: ReportTargetType, id: string): string {
  return `/reports/new?${new URLSearchParams({ targetType: type, targetId: id }).toString()}`
}

/** What the report page shows about the content, carried in the link's state (display only). */
export interface ReportContext {
  back: string
  author: string | null
  excerpt: string | null
}

export function ReportLink({
  type,
  id,
  context,
}: {
  type: ReportTargetType
  id: string
  context: ReportContext
}) {
  const noun = TARGET_LABELS[type].toLowerCase()
  return (
    <Link
      to={reportPath(type, id)}
      state={context}
      aria-label={`Report this ${noun}`}
      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] text-slate-10 hover:bg-slate-3 hover:text-red-11"
    >
      <Flag className="size-[14px]" aria-hidden="true" />
      Report
    </Link>
  )
}
