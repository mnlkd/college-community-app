import type { AlumniStatus, Programme, Role } from '@hilcoe/shared'
import { BadgeCheck, Badge as BadgeOutline } from 'lucide-react'
import { Badge } from './ui'

export const ROLE_LABELS: Record<Role, string> = { STUDENT: 'Student', STAFF: 'Staff', ALUMNI: 'Alumni' }
export const ALUMNI_STATUS_LABELS: Record<AlumniStatus, string> = {
  VERIFIED: 'Verified',
  SELF_REPORTED: 'Self-Reported',
  FLAGGED: 'Flagged',
}
export const PROGRAMME_LABELS: Record<Programme, string> = {
  COMPUTER_SCIENCE: 'Computer Science',
  SOFTWARE_ENGINEERING: 'Software Engineering',
}
const ROLE = ROLE_LABELS
const ALUMNI = ALUMNI_STATUS_LABELS

/** Role badge; only Verified Alumni get the check mark. */
export function RoleChip({ role, alumniStatus }: { role: Role; alumniStatus: AlumniStatus | null }) {
  if (role === 'ALUMNI') {
    const verified = alumniStatus === 'VERIFIED'
    return (
      <Badge
        tone={verified ? 'amber' : 'neutral'}
        icon={verified ? <BadgeCheck className="size-3" /> : undefined}
      >
        {verified || !alumniStatus ? 'Alumni' : `Alumni · ${ALUMNI_STATUS_LABELS[alumniStatus]}`}
        {verified && <span className="sr-only"> · Verified</span>}
      </Badge>
    )
  }
  if (role === 'STAFF') return <Badge tone="blue">Staff</Badge>
  return <Badge tone="green">Student</Badge>
}

/**
 * Compact role mark for names in posts, comments and likers (profiles and admin screens keep
 * RoleChip): a check badge in the role's colour (Student green, Staff blue, Verified Alumni amber);
 * other Alumni get a grey badge without the check. Hover shows the role; screen readers read it.
 */
export function RoleMark({ role, alumniStatus }: { role: Role; alumniStatus: AlumniStatus | null }) {
  const unverifiedAlumni = role === 'ALUMNI' && alumniStatus !== 'VERIFIED'
  const label =
    role !== 'ALUMNI'
      ? ROLE[role]
      : !unverifiedAlumni
        ? 'Verified Alumni'
        : alumniStatus
          ? `Alumni · ${ALUMNI[alumniStatus]}`
          : 'Alumni'
  const color = {
    STUDENT: 'text-green-11',
    STAFF: 'text-blue-11',
    ALUMNI: unverifiedAlumni ? 'text-slate-9' : 'text-amber-11',
  }[role]
  const Icon = unverifiedAlumni ? BadgeOutline : BadgeCheck
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 ${color}`}>
      <Icon className="size-[15px]" strokeWidth={2.25} aria-hidden="true" />
    </span>
  )
}
