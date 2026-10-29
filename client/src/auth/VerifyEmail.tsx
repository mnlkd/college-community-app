import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button, Note } from '../design/ui'
import { AuthFlowError, resendSignUpCode, verifySignUpCode } from './account-auth'
import { AuthShell } from './AuthShell'
import { CodeField, parseCode } from './fields'
import { loadRegistrationDraft } from './registration-draft'

export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? `${email[0]}…${email.slice(at)}` : email
}

/** Enter the 6-digit code; a valid code signs the new user in and leads to the profile step. */
export function VerifyEmail() {
  const location = useLocation()
  const navigate = useNavigate()
  const stateEmail = (location.state as { email?: unknown } | null)?.email
  const email = typeof stateEmail === 'string' ? stateEmail : (loadRegistrationDraft()?.email ?? null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!email) {
    return (
      <AuthShell step="Email verification" title="Start registration first">
        <div className="space-y-4">
          <Note>We could not tell which email to verify. Start again from the registration page.</Note>
          <Link to="/register" className="block">
            <Button block>Go to registration</Button>
          </Link>
        </div>
      </AuthShell>
    )
  }
  const address = email

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setInfo(null)
    const parsed = parseCode(code)
    setCodeError(parsed.error ?? undefined)
    if (!parsed.code) return
    setBusy(true)
    try {
      await verifySignUpCode(address, parsed.code)
      navigate('/register/profile', { replace: true })
    } catch (cause) {
      const message = cause instanceof AuthFlowError ? cause.message : 'The code could not be checked.'
      if (cause instanceof AuthFlowError && cause.field === 'code') setCodeError(message)
      else setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      await resendSignUpCode(address)
      setInfo('A new code is on its way. Use the latest email; older codes no longer work.')
    } catch (cause) {
      setError(cause instanceof AuthFlowError ? cause.message : 'The code could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      step="Email verification"
      title="Enter the 6-digit code"
      sub={`We sent a 6-digit code to ${maskEmail(address)}.`}
    >
      <form noValidate onSubmit={submit} className="space-y-5">
        {error && <Note tone="red">{error}</Note>}
        {info && <Note tone="iris">{info}</Note>}
        <CodeField value={code} error={codeError} onChange={setCode} />
        <Note>
          Code expires in one hour. Resending creates a new code and the older email should be ignored.
        </Note>
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => void resend()}>
            Resend code
          </Button>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Checking…' : 'Verify email'}
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}
