import type { Programme, RegistrationKind } from '@hilcoe/shared'

/**
 * Details typed on the first registration page, kept for the profile step in this tab only.
 * The password is never stored.
 */
export interface RegistrationDraft {
  email: string
  kind: RegistrationKind
  displayName: string
  programme?: Programme | null
  graduationYear?: number | null
  identifyingContext?: string | null
}

const KEY = 'hilcoe.registration'

export function saveRegistrationDraft(draft: RegistrationDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // Storage may be unavailable; the profile step then asks again.
  }
}

export function loadRegistrationDraft(): RegistrationDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const draft = value as Partial<RegistrationDraft>
    if (typeof draft.email !== 'string' || typeof draft.displayName !== 'string') return null
    if (draft.kind !== 'STUDENT_OR_STAFF' && draft.kind !== 'ALUMNI') return null
    return draft as RegistrationDraft
  } catch {
    return null
  }
}

export function clearRegistrationDraft(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
