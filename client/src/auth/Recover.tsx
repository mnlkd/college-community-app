import { emailSchema } from '@hilcoe/shared'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Field, Note, TextInput } from '../design/ui'
import {
  AuthFlowError,
  completePasswordReset,
  requestPasswordReset,
  verifyRecoveryCode,
} from './account-auth'
import { AuthShell } from './AuthShell'
import { CodeField, PASSWORD_HINT, PasswordInput, newPasswordIssues, parseCode } from './fields'

type Step = 'code' | 'password' | 'done'

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof AuthFlowError ? cause.message : fallback
}

/** Recover Forgotten Password: email code, then a new password; other sessions are signed out. */
export function Recover() {
  const [step, setStep] = useState<Step>('code')
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>, fallback: string, field?: string) {
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      const message = messageOf(cause, fallback)
      if (cause instanceof AuthFlowError && cause.field && field) setErrors({ [field]: message })
      else setError(message)
    } finally {
      setBusy(false)
    }
  }

  function sendCode() {
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setErrors({ email: parsed.error.issues[0]?.message ?? 'Enter a valid email address' })
      return
    }
    setErrors({})
    void run(async () => {
      await requestPasswordReset(parsed.data)
      setSentTo(parsed.data)
      setInfo('If an account uses this email, a 6-digit code is on its way. Use the latest email.')
    }, 'The reset code could not be sent.')
  }

  function submitCode(event: FormEvent) {
    event.preventDefault()
    if (!sentTo) {
      sendCode()
      return
    }
    const parsed = parseCode(code)
    setErrors(parsed.error ? { code: parsed.error } : {})
    if (!parsed.code) return
    const value = parsed.code
    void run(
      async () => {
        await verifyRecoveryCode(sentTo, value)
        setStep('password')
      },
      'The code could not be checked.',
      'code',
    )
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault()
    const issues = newPasswordIssues(password, confirm)
    setErrors(issues)
    if (Object.keys(issues).length > 0) return
    void run(
      async () => {
        await completePasswordReset(password)
        setPassword('')
        setConfirm('')
        setStep('done')
      },
      'The password could not be changed.',
      'password',
    )
  }

  const title =
    step === 'done'
      ? 'Password reset complete'
      : step === 'password'
        ? 'Set a new password'
        : 'Reset your password'
  return (
    <AuthShell
      step="Password reset"
      title={title}
      sub={
        step === 'password'
          ? 'The reset code permits only this password-setting step. Other sessions are signed out.'
          : 'Request a password reset and enter the 6-digit code sent to the account email.'
      }
      aside={
        <>
          <Note tone="iris">
            Forgotten-password recovery is self-service by email for members and Administrators.
          </Note>
          <Note>
            If a mailbox is lost, an Administrator updates the account email after in-person corroboration;
            the member then uses the normal reset.
          </Note>
          <Note tone="amber">Reset and password change actions sign out other sessions.</Note>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Note tone="red">{error}</Note>}
        {info && <Note tone="iris">{info}</Note>}
        {step === 'done' ? (
          <>
            <Badge tone="green">Password reset complete</Badge>
            <Note>
              The code is used up and older sessions are signed out. Sign in with your new password.
            </Note>
            <Link to="/login" className="block">
              <Button block>Return to member sign in</Button>
            </Link>
          </>
        ) : step === 'password' ? (
          <form noValidate onSubmit={submitPassword} className="space-y-4">
            <Badge tone="amber">Password-setting access only</Badge>
            <PasswordInput
              label="New password"
              name="password"
              hint={PASSWORD_HINT}
              value={password}
              error={errors.password}
              onChange={setPassword}
            />
            <PasswordInput
              label="Confirm password"
              name="confirm"
              value={confirm}
              error={errors.confirm}
              onChange={setConfirm}
            />
            <Note>Choose a valid new password different from the previous one.</Note>
            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? 'Saving…' : 'Set new password'}
            </Button>
          </form>
        ) : (
          <form noValidate onSubmit={submitCode} className="space-y-4">
            <Field label="Account email" required error={errors.email}>
              <TextInput
                type="email"
                name="email"
                autoComplete="username"
                mono
                value={email}
                invalid={Boolean(errors.email)}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setSentTo(null)
                }}
              />
            </Field>
            {sentTo && (
              <CodeField
                label="6-digit reset code"
                hint="Sent to the account email and expires in one hour."
                value={code}
                error={errors.code}
                onChange={setCode}
              />
            )}
            {sentTo && (
              <Note tone="amber">
                Use the latest email. Resending creates a new code and invalidates the older one.
              </Note>
            )}
            <div className="flex items-center justify-between gap-3">
              {sentTo ? (
                <Button variant="secondary" disabled={busy} onClick={sendCode}>
                  Resend code
                </Button>
              ) : (
                <Link to="/login" className="text-[13.5px] font-medium text-slate-10 hover:text-slate-12">
                  Back to sign in
                </Link>
              )}
              <Button type="submit" size="lg" disabled={busy}>
                {sentTo ? 'Continue' : busy ? 'Sending…' : 'Send reset code'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AuthShell>
  )
}
