import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AuthFlowError,
  PASSWORD_HINT,
  PasswordInput,
  changePassword,
  newPasswordIssues,
  useSession,
} from '../../auth'
import { Button, Card, ColumnHeader, Note, buttonClass } from '../../design/ui'

export function ChangePassword() {
  const navigate = useNavigate()
  const { session } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const issues: Record<string, string> = newPasswordIssues(next, confirm, {
      password: 'newPassword',
      confirm: 'confirm',
    })
    if (current.length === 0) issues.currentPassword = 'Enter your current password'
    else if (!issues.newPassword && next === current) issues.newPassword = 'Choose a different password'
    setErrors(issues)
    const email = session?.user.email
    if (Object.keys(issues).length > 0 || !email) return
    setBusy(true)
    try {
      await changePassword({ email, currentPassword: current, newPassword: next })
      navigate('/settings/password/done', { replace: true })
    } catch (cause) {
      if (cause instanceof AuthFlowError && cause.field) setErrors({ [cause.field]: cause.message })
      else setError(cause instanceof AuthFlowError ? cause.message : 'The password could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ColumnHeader
        title="Change password"
        subtitle="Keep this device signed in; other devices will need to sign in again."
      />
      <Card className="max-w-xl p-5">
        <form noValidate onSubmit={submit} className="space-y-4">
          {error && <Note tone="red">{error}</Note>}
          <PasswordInput
            label="Current password"
            name="currentPassword"
            autoComplete="current-password"
            value={current}
            error={errors.currentPassword}
            onChange={setCurrent}
          />
          <PasswordInput
            label="New password"
            name="newPassword"
            hint={PASSWORD_HINT}
            value={next}
            error={errors.newPassword}
            onChange={setNext}
          />
          <PasswordInput
            label="Confirm new password"
            name="confirm"
            value={confirm}
            error={errors.confirm}
            onChange={setConfirm}
          />
          <Note>Other sessions are signed out. Your role and account restrictions do not change.</Note>
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/settings')}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}

export function PasswordChanged() {
  return (
    <>
      <ColumnHeader title="Password changed" />
      <Note tone="iris">
        This device stays signed in. Older sessions on other devices are signed out and must sign in again.
        Your role and any restrictions are unchanged.
      </Note>
      <Link to="/settings" className={buttonClass() + ' mt-4'}>
        Back to settings
      </Link>
    </>
  )
}
