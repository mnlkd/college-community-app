import type { MentorshipState } from '@hilcoe/shared'

/** At most one of these per Student and mentor pair (partial unique index). */
export const OPEN_MENTORSHIP_STATES: MentorshipState[] = ['PENDING', 'ACTIVE']
