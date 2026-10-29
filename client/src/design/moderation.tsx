// Moderation labels shared by member screens and the Administrator console.
import type {
  AuditOutcome,
  ConsequenceKind,
  GuidelineCategory,
  ReportState,
  ReportTargetType,
} from '@hilcoe/shared'
import { Badge, type Tone } from './ui'

export const GUIDELINE_LABELS: Record<GuidelineCategory, string> = {
  HARASSMENT: 'Harassment or bullying',
  SPAM: 'Spam or advertising',
  IMPERSONATION: 'Impersonation',
  PRIVATE_INFORMATION: 'Sharing private information',
  FALSE_INFORMATION: 'False or misleading information',
}

export const TARGET_LABELS: Record<ReportTargetType, string> = {
  POST: 'Post',
  COMMENT: 'Comment',
  OPPORTUNITY: 'Opportunity',
}

const STATE_LABELS: Record<ReportState, [string, Tone]> = {
  PENDING: ['Pending', 'amber'],
  UPHELD: ['Upheld', 'green'],
  DISMISSED: ['Dismissed', 'neutral'],
}

export function ReportStateBadge({ state }: { state: ReportState }) {
  const [label, tone] = STATE_LABELS[state]
  return <Badge tone={tone}>{label}</Badge>
}

export const OUTCOME_LABELS: Record<AuditOutcome, [string, Tone]> = {
  DISMISSED: ['Dismissed', 'neutral'],
  UPHELD_WARNING: ['Upheld · warning', 'amber'],
  UPHELD_RESTRICTION: ['Upheld · restriction', 'red'],
  UPHELD_NO_CONSEQUENCE: ['Upheld · no consequence', 'blue'],
}

export const CONSEQUENCE_LABELS: Record<ConsequenceKind, string> = {
  WARNING: 'Private warning',
  RESTRICTION: '14-day posting and commenting restriction',
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
