import { emailSchema } from '@hilcoe/shared'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Field, Note, TextInput } from '../design/ui'
import { AuthFlowError, setInvitedPassword, verifyInviteCode } from './account-auth'
import { CodeField, PASSWORD_HINT, PasswordInput, newPasswordIssues, parseCode } from './fields'
import { signOut } from './session'
import { SignInFrame } from './SignInFrame'

type Step = 'code' | 'password'

/**
 * Accept an Administrator invitation: the email and the 6-digit code from the invitation, then a
 * password. The sign-in page then enrolls the authenticator before any Administrator access.
 */
export function AcceptInvite() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('code')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      if (cause instanceof AuthFlowError && cause.field) setErrors({ [cause.field]: cause.message })
      else setError(cause instanceof AuthFlowError ? cause.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function submitCode(event: FormEvent) {
    event.preventDefault()
    const parsedEmail = emailSchema.safeParse(email)
    const parsedCode = parseCode(code)
    const issues: Record<string, string> = {}
    if (!parsedEmail.success) issues.email = parsedEmail.error.issues[0]?.message ?? 'Enter your email'
    if (parsedCode.error) issues.code = parsedCode.error
    setErrors(issues)
    if (!parsedEmail.success || !parsedCode.code) return
    const value = parsedCode.code
    void run(async () => {
      await verifyInviteCode(parsedEmail.data, value)
      setStep('password')
    })
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault()
    const issues = newPasswordIssues(password, confirm)
    setErrors(issues)
    if (Object.keys(issues).length > 0) return
    void run(async () => {
      await setInvitedPassword(password)
      navigate('/admin/login', { replace: true })
    })
  }

  return (
    <SignInFrame
      admin
      title={step === 'code' ? 'Accept your invitation' : 'Set your password'}
      sub={
        step === 'code'
          ? 'Enter your college email and the 6-digit code from the invitation email.'
          : 'Next you will set up an authenticator app.'
      }
    >
      <div className="space-y-4">
        {error && <Note tone="red">{error}</Note>}
        {step === 'code' ? (
          <form noValidate onSubmit={submitCode} className="space-y-4">
            <Field label="Email" required error={errors.email}>
              <TextInput
                type="email"
                name="email"
                autoComplete="email"
                mono
                value={email}
                invalid={Boolean(errors.email)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <CodeField value={code} error={errors.code} onChange={setCode} />
            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? 'Checking…' : 'Continue'}
            </Button>
          </form>
        ) : (
          <form noValidate onSubmit={submitPassword} className="space-y-4">
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
            <Button type="submit" size="lg" block disabled={busy}>
              {busy ? 'Saving…' : 'Set password and continue'}
            </Button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="block w-full text-center text-[13px] font-medium text-slate-10 hover:text-slate-12"
            >
              Cancel and sign out
            </button>
          </form>
        )}
      </div>
    </SignInFrame>
  )
}
