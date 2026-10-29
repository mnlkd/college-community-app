import { emailSchema, type ActorContextView } from '@hilcoe/shared'
import { useState, type FormEvent } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { isApiError, useOwnAccount, useSyncEmail } from '../../api'
import {
  AuthFlowError,
  CodeField,
  PasswordInput,
  parseCode,
  requestEmailChange,
  resendEmailChangeCode,
  useSession,
  verifyEmailChangeCode,
} from '../../auth'
import { Button, Card, ColumnHeader, Field, Note, TextInput } from '../../design/ui'

export function ChangeEmail() {
  const actor = useOutletContext<ActorContextView>()
  const navigate = useNavigate()
  const { session } = useSession()
  const account = useOwnAccount(actor.accountId)
  const sync = useSyncEmail(actor.accountId)
  const currentEmail = session?.user.email ?? account.data?.email ?? ''
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [needsSync, setNeedsSync] = useState(false)

  async function run(action: () => Promise<void>) {
    setError(null)
    setInfo(null)
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

  async function finish() {
    await sync.mutateAsync()
    navigate('/settings', { replace: true, state: { notice: 'Your account email was changed.' } })
  }

  function sendCode(event: FormEvent) {
    event.preventDefault()
    const parsed = emailSchema.safeParse(newEmail)
    const issues: Record<string, string> = {}
    if (!parsed.success) issues.newEmail = parsed.error.issues[0]?.message ?? 'Enter a valid email address'
    else if (parsed.data === currentEmail.toLowerCase())
      issues.newEmail = 'This is already your account email'
    if (password.length === 0) issues.currentPassword = 'Enter your current password'
    setErrors(issues)
    if (!parsed.success || Object.keys(issues).length > 0) return
    void run(async () => {
      await requestEmailChange({ email: currentEmail, currentPassword: password, newEmail: parsed.data })
      setPassword('')
      setSentTo(parsed.data)
    })
  }

  function confirmCode(event: FormEvent) {
    event.preventDefault()
    if (!sentTo) return
    const parsed = parseCode(code)
    setErrors(parsed.error ? { code: parsed.error } : {})
    if (!parsed.code) return
    const value = parsed.code
    void run(async () => {
      await verifyEmailChangeCode(sentTo, value)
      setNeedsSync(true)
      await finish()
    })
  }

  return (
    <>
      <ColumnHeader
        title="Change account email"
        subtitle="Use an address you will keep, such as a personal email."
      />
      <Card className="max-w-xl p-5">
        {error && (
          <div className="mb-4">
            <Note tone="red">{error}</Note>
          </div>
        )}
        {info && (
          <div className="mb-4">
            <Note tone="iris">{info}</Note>
          </div>
        )}
        {needsSync ? (
          <div className="space-y-4">
            <Note>The new email is confirmed. Finish saving it to your account.</Note>
            <Button disabled={busy} onClick={() => void run(finish)}>
              Try again
            </Button>
          </div>
        ) : sentTo ? (
          <form noValidate onSubmit={confirmCode} className="space-y-4">
            <p className="text-[14px] text-slate-11">
              Enter the 6-digit code sent to <span className="font-mono">{sentTo}</span>.
            </p>
            <CodeField value={code} error={errors.code} onChange={setCode} />
            <Note>Until you enter the code, you keep signing in with your current email.</Note>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? 'Checking…' : 'Confirm new email'}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
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
            <Field label="New email" required error={errors.newEmail}>
              <TextInput
                type="email"
                name="newEmail"
                autoComplete="email"
                mono
                value={newEmail}
                invalid={Boolean(errors.newEmail)}
                onChange={(event) => setNewEmail(event.target.value)}
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
            <Note tone="iris">
              A 6-digit code is sent to the new address. Until you enter it, you keep signing in with your
              current email. Your role and status do not change.
            </Note>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send code to new email'}
              </Button>
              <Button variant="ghost" onClick={() => navigate('/settings')}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Card>
    </>
  )
}
