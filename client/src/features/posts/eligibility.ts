import type { ActorContextView } from '@hilcoe/shared'

/**
 * Client copies of the server's ActorContext checks, used only to enable or explain controls; the
 * server decides. Liking and saving need an ACTIVE Student, Staff member or Verified Alumni.
 */
export function canInteract(actor: ActorContextView): boolean {
  if (actor.kind !== 'MEMBER' || actor.accountState !== 'ACTIVE') return false
  if (actor.role === 'STUDENT' || actor.role === 'STAFF') return true
  return actor.role === 'ALUMNI' && actor.alumniStatus === 'VERIFIED'
}

export function isRestricted(actor: ActorContextView, now = Date.now()): boolean {
  return actor.restrictedUntil !== null && new Date(actor.restrictedUntil).getTime() > now
}

/** Posting and commenting also need no active restriction. */
export function canPublish(actor: ActorContextView, now = Date.now()): boolean {
  return canInteract(actor) && !isRestricted(actor, now)
}

/** Why the member cannot publish, or null when they can. */
export function publishBlockReason(actor: ActorContextView, now = Date.now()): string | null {
  if (canPublish(actor, now)) return null
  if (actor.role === 'ALUMNI' && actor.alumniStatus !== 'VERIFIED') {
    return 'Posting, commenting, likes and new saves are available once your Alumni status is verified.'
  }
  if (isRestricted(actor, now) && actor.restrictedUntil) {
    const until = new Date(actor.restrictedUntil).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    return `Posting and commenting are restricted until ${until}.`
  }
  return 'Your account cannot publish right now.'
}
