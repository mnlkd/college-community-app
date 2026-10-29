import type { ActorContextView, OwnAccountView } from '@hilcoe/shared'
import type { ShellIdentity } from './AppShell'

const ROLE_LABELS = { STUDENT: 'Student', STAFF: 'Staff', ALUMNI: 'Alumni' } as const
const ALUMNI_LABELS = { VERIFIED: 'Verified', SELF_REPORTED: 'Self-Reported', FLAGGED: 'Flagged' } as const

export function roleLabel(actor: ActorContextView): string {
  if (actor.kind === 'ADMIN') return 'Administrator'
  if (!actor.role) return 'Member'
  const label = ROLE_LABELS[actor.role]
  return actor.role === 'ALUMNI' && actor.alumniStatus
    ? `${label} · ${ALUMNI_LABELS[actor.alumniStatus]}`
    : label
}

/** Members are shown by display name and picture once loaded; Administrators by email. */
export function shellIdentity(
  email: string | undefined,
  actor: ActorContextView | undefined,
  own?: OwnAccountView,
): ShellIdentity | undefined {
  if (!actor) return undefined
  return {
    name: own?.displayName ?? email ?? 'Signed in',
    roleLabel: roleLabel(actor),
    pictureUrl: own?.profile.pictureUrl ?? undefined,
  }
}
