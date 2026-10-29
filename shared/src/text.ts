import { z } from 'zod'

export const INSTITUTIONAL_EMAIL_DOMAIN = 'hilcoeschool.com'
export const EMAIL_MAX = 254
export const PASSWORD_MIN = 15
export const PASSWORD_MAX = 72

/** Trimmed text that must not be blank and must not exceed max characters. */
export function requiredText(max: number) {
  return z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`)
}

/** Trimmed optional text; blank, missing or null input becomes null. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value))
}

/** Emails are trimmed and compared in lower case (ODD Section 1.2). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(EMAIL_MAX, `At most ${EMAIL_MAX} characters`))

export const institutionalEmailSchema = emailSchema.refine(
  (email) => email.endsWith(`@${INSTITUTIONAL_EMAIL_DOMAIN}`),
  `Use an @${INSTITUTIONAL_EMAIL_DOMAIN} address`,
)

/** NFR-1: 15 to 72 characters with no composition rules. Passwords are never trimmed. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`)

export const uuidSchema = z.uuid()

/** Literal "true"/"false" query values; missing means false. */
export const queryFlag = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
  .nullish()
  .transform((value) => value ?? false)

/** A calendar date (deadlines), YYYY-MM-DD. */
export const calendarDateSchema = z.iso.date()

/** Six-digit email or authenticator code; spaces are ignored. */
export const sixDigitCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'))
