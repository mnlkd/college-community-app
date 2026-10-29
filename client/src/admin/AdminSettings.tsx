import { institutionalEmailSchema } from '@hilcoe/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { isApiError, syncOwnAdministratorEmail } from '../api'
import {
  AuthFlowError,
  CodeField,
  PASSWORD_HINT,
  PasswordInput,
  changePassword,
  newPasswordIssues,
  parseCode,
  requestEmailChange,
  resendEmailChangeCode,
  useSession,
  verifyEmailChangeCode,
} from '../auth'
import { Button, Card, ColumnHeader, Field, Note, TextInput } from '../design/ui'

type Errors = Record<string, string>

/** Runs a Supabase Auth or API step and turns its failure into form or page errors. */
function useStep() {
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      if (cause instanceof AuthFlowError && cause.field) setErrors({ [cause.field]: cause.message })
      else if (cause instanceof AuthFlowError || isApiError(cause)) setError(cause.message)
      else setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return { errors, setErrors, error, busy, run }
}

export function AdminSettings() {
  return (
    <>
      <ColumnHeader title="Settings" subtitle="Your Administrator sign-in details." />
      <div className="grid gap-4 lg:grid-cols-2">
        <PasswordCard />
        <EmailCard />
      </div>
    </>
  )
}

function PasswordCard() {
  const { session } = useSession()
  const step = useStep()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    setDone(false)
    const issues: Errors = newPasswordIssues(next, confirm, { password: 'newPassword', confirm: 'confirm' })
    if (current.length === 0) issues.currentPassword = 'Enter your current password'
    else if (!issues.newPassword && next === current) issues.newPassword = 'Choose a different password'
    step.setErrors(issues)
    const email = session?.user.email
    if (Object.keys(issues).length > 0 || !email) return
    void step.run(async () => {
      await changePassword({ email, currentPassword: current, newPassword: next, keepSession: true })
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    })
  }

  return (
    <Card className="h-fit p-5">
      <form noValidate onSubmit={submit} className="space-y-4">
        <h2 className="font-display text-[16px] font-bold text-slate-12">Change password</h2>
        {done && <Note tone="iris">Your password was changed. Other sessions were signed out.</Note>}
        {step.error && <Note tone="red">{step.error}</Note>}
        <PasswordInput
          label="Current password"
          name="currentPassword"
          autoComplete="current-password"
          value={current}
          error={step.errors.currentPassword}
          onChange={setCurrent}
        />
        <PasswordInput
          label="New password"
          name="newPassword"
          hint={PASSWORD_HINT}
          value={next}
          error={step.errors.newPassword}
          onChange={setNext}
        />
        <PasswordInput
          label="Confirm new password"
          name="confirm"
          value={confirm}
          error={step.errors.confirm}
          onChange={setConfirm}
        />
        <Button type="submit" disabled={step.busy}>
          {step.busy ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </Card>
  )
}

function EmailCard() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  const step = useStep()
  const currentEmail = session?.user.email ?? ''
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [needsSync, setNeedsSync] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  async function finish() {
    await syncOwnAdministratorEmail()
    await queryClient.invalidateQueries({ queryKey: ['admin'] })
    setNeedsSync(false)
    setSentTo(null)
    setCode('')
    setNewEmail('')
    setInfo('Your Administrator email was changed.')
  }

  function sendCode(event: FormEvent) {
    event.preventDefault()
    setInfo(null)
    const parsed = institutionalEmailSchema.safeParse(newEmail)
    const issues: Errors = {}
    if (!parsed.success) issues.newEmail = parsed.error.issues[0]?.message ?? 'Enter a college email'
    else if (parsed.data === currentEmail.toLowerCase()) issues.newEmail = 'This is already your email'
    if (password.length === 0) issues.currentPassword = 'Enter your current password'
    step.setErrors(issues)
    if (!parsed.success || Object.keys(issues).length > 0) return
    void step.run(async () => {
      await requestEmailChange({
        email: currentEmail,
        currentPassword: password,
        newEmail: parsed.data,
        keepSession: true,
      })
      setPassword('')
      setSentTo(parsed.data)
    })
  }

  function confirmCode(event: FormEvent) {
    event.preventDefault()
    if (!sentTo) return
    const parsed = parseCode(code)
    step.setErrors(parsed.error ? { code: parsed.error } : {})
    if (!parsed.code) return
    const value = parsed.code
    void step.run(async () => {
      await verifyEmailChangeCode(sentTo, value)
      setNeedsSync(true)
      await finish()
    })
  }

  return (
    <Card className="h-fit p-5">
      <div className="space-y-4">
        <h2 className="font-display text-[16px] font-bold text-slate-12">Change email</h2>
        {info && <Note tone="iris">{info}</Note>}
        {step.error && <Note tone="red">{step.error}</Note>}
        {needsSync ? (
          <>
            <Note>The new email is confirmed. Finish saving it to your account.</Note>
            <Button disabled={step.busy} onClick={() => void step.run(finish)}>
              Try again
            </Button>
          </>
        ) : sentTo ? (
          <form noValidate onSubmit={confirmCode} className="space-y-4">
            <p className="text-[14px] text-slate-11">
              Enter the 6-digit code sent to <span className="font-mono">{sentTo}</span>.
            </p>
            <CodeField value={code} error={step.errors.code} onChange={setCode} />
            <div className="flex gap-3">
              <Button type="submit" disabled={step.busy}>
                {step.busy ? 'Checking…' : 'Confirm new email'}
              </Button>
              <Button
                variant="secondary"
                disabled={step.busy}
                onClick={() =>
                  void step.run(async () => {
                    await resendEmailChangeCode(sentTo)
                    setInfo('A new code is on its way. Use the latest email.')
                  })
                }
              >
                Resend code
              </Button>
            </div>
          </form>
        ) : (
          <form noValidate onSubmit={sendCode} className="space-y-4">
            <Field label="Current email">
              <TextInput value={currentEmail} mono readOnly disabled />
            </Field>
            <Field
              label="New email"
              required
              hint="Administrator emails must be @hilcoeschool.com addresses."
              error={step.errors.newEmail}
            >
              <TextInput
                type="email"
                name="newEmail"
                mono
                value={newEmail}
                invalid={Boolean(step.errors.newEmail)}
                onChange={(event) => setNewEmail(event.target.value)}
              />
            </Field>
            <PasswordInput
              label="Current password"
              name="emailCurrentPassword"
              autoComplete="current-password"
              value={password}
              error={step.errors.currentPassword}
              onChange={setPassword}
            />
            <Button type="submit" disabled={step.busy}>
              {step.busy ? 'Sending…' : 'Send code to new email'}
            </Button>
          </form>
        )}
      </div>
    </Card>
  )
}
