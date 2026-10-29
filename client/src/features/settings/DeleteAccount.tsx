import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteOwnAccount, isApiError } from '../../api'
import { PasswordInput, signOut } from '../../auth'
import { Button, Card, ColumnHeader, Field, Note, TextInput } from '../../design/ui'
import { fieldErrorsOf } from '../profile/RoleDetailsFields'

const CONFIRM_WORD = 'DELETE'

export function DeleteAccount() {
  const navigate = useNavigate()
  const [confirmation, setConfirmation] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const issues: Record<string, string> = {}
    if (confirmation.trim() !== CONFIRM_WORD) issues.confirmation = `Type ${CONFIRM_WORD} exactly as shown`
    if (password.length === 0) issues.currentPassword = 'Enter your current password'
    setErrors(issues)
    if (Object.keys(issues).length > 0) return
    setBusy(true)
    try {
      await deleteOwnAccount({ currentPassword: password })
      await signOut('Your account was deleted.')
    } catch (cause) {
      const fields = fieldErrorsOf(cause)
      if (fields) setErrors(fields)
      else setError(isApiError(cause) ? cause.message : 'The account could not be deleted. Try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <ColumnHeader title="Delete your account" subtitle="Review what is removed and retained." />
      <Card className="max-w-2xl border-red-7 p-5">
        <form noValidate onSubmit={submit} className="space-y-4">
          {error && <Note tone="red">{error}</Note>}
          <p className="text-[13.5px] leading-relaxed text-slate-11">
            Your profile, bio, pictures, credentials and notifications are removed. Your posts, comments and
            likes remain as <strong>Deleted User</strong>, without a profile link.
          </p>
          <p className="text-[13.5px] leading-relaxed text-slate-11">
            Mentorships end and both sides regain capacity. Memberships are removed; a group closes if
            ownership was not already transferred. Owned opportunities close and contact details are removed.
          </p>
          <Note>
            Necessary pending-report evidence is preserved under its retention rule. The deleted
            account&apos;s email is removed from authentication records. This cannot be undone.
          </Note>
          <Field label={`Type ${CONFIRM_WORD} to confirm`} required error={errors.confirmation}>
            <TextInput
              name="confirmation"
              mono
              autoComplete="off"
              value={confirmation}
              invalid={Boolean(errors.confirmation)}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          <PasswordInput
            label="Current password"
            name="currentPassword"
            autoComplete="current-password"
            value={password}
            error={errors.currentPassword}
            onChange={setPassword}
          />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => navigate('/settings')}>
              Keep account
            </Button>
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}
