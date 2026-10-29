import { PASSWORD_MAX, PASSWORD_MIN, passwordSchema, sixDigitCodeSchema } from '@hilcoe/shared'
import { Field, TextInput } from '../design/ui'

export const PASSWORD_HINT = `${PASSWORD_MIN}–${PASSWORD_MAX} characters. A phrase of four or more words is easy to remember; spaces are allowed and symbols or digits are not required.`

/** The first problem with a new password and its confirmation, keyed by field. */
export function newPasswordIssues(
  password: string,
  confirm: string,
  names: { password: string; confirm: string } = { password: 'password', confirm: 'confirm' },
): Record<string, string> {
  const issues: Record<string, string> = {}
  const parsed = passwordSchema.safeParse(password)
  if (!parsed.success) issues[names.password] = parsed.error.issues[0]?.message ?? 'Not valid'
  else if (password !== confirm) issues[names.confirm] = 'The passwords do not match'
  return issues
}

/** Returns the six digits, or null with the message to show. */
export function parseCode(value: string): { code: string | null; error: string | null } {
  const parsed = sixDigitCodeSchema.safeParse(value)
  return parsed.success
    ? { code: parsed.data, error: null }
    : { code: null, error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code' }
}

export function CodeField({
  label = '6-digit code',
  hint,
  value,
  error,
  onChange,
}: {
  label?: string
  hint?: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label} required hint={hint} error={error}>
      <TextInput
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        mono
        className="text-[18px] tracking-[0.3em]"
        value={value}
        invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function PasswordInput({
  label,
  name,
  value,
  error,
  hint,
  autoComplete = 'new-password',
  onChange,
}: {
  label: string
  name: string
  value: string
  error?: string
  hint?: string
  autoComplete?: 'new-password' | 'current-password'
  onChange: (value: string) => void
}) {
  return (
    <Field label={label} required hint={hint} error={error}>
      <TextInput
        type="password"
        name={name}
        autoComplete={autoComplete}
        value={value}
        invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}
