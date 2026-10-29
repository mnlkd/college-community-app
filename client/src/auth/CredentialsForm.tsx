import { emailSchema } from '@hilcoe/shared'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Field, Note, TextInput } from '../design/ui'
import { authErrorMessage } from './messages'
import { clearNotice, signOut, useSession, accountKindOf } from './session'
import { getSupabase } from './supabase'
import type { ActorKind } from '@hilcoe/shared'

interface FieldErrors {
  email?: string
  password?: string
}

/** Email and password step shared by both sign-in pages. */
export function CredentialsForm({
  expectedKind,
  wrongKindMessage,
  onBusyChange,
}: {
  /** When the account's recorded kind differs, the new session is ended at once. */
  expectedKind: ActorKind
  wrongKindMessage: string
  onBusyChange?: (busy: boolean) => void
}) {
  const { notice } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setWorking(value: boolean) {
    setBusy(value)
    onBusyChange?.(value)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    clearNotice()
    setError(null)
    const parsedEmail = emailSchema.safeParse(email)
    const errors: FieldErrors = {}
    if (!parsedEmail.success)
      errors.email = parsedEmail.error.issues[0]?.message ?? 'Enter a valid email address'
    if (password.length === 0) errors.password = 'Enter your password'
    setFieldErrors(errors)
    if (!parsedEmail.success || errors.password) return

    setWorking(true)
    try {
      const { data, error: signInError } = await getSupabase().auth.signInWithPassword({
        email: parsedEmail.data,
        password,
      })
      if (signInError) {
        if (signInError.code === 'user_banned' && expectedKind === 'MEMBER') {
          navigate('/account-disabled')
          return
        }
        setError(authErrorMessage(signInError))
        return
      }
      const kind = accountKindOf(data.user)
      if (kind !== null && kind !== expectedKind) {
        await signOut()
        setError(wrongKindMessage)
        return
      }
      setPassword('')
    } catch (cause) {
      setError(authErrorMessage(cause instanceof Error ? cause : new Error(String(cause))))
    } finally {
      setWorking(false)
    }
  }

  const message = error ?? notice
  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {message && <Note tone="red">{message}</Note>}
      <Field label="Email" required error={fieldErrors.email}>
        <TextInput
          type="email"
          name="email"
          autoComplete="username"
          mono
          value={email}
          invalid={Boolean(fieldErrors.email)}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Field label="Password" required error={fieldErrors.password}>
        <TextInput
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          invalid={Boolean(fieldErrors.password)}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Button type="submit" size="lg" block disabled={busy} className="mt-2">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
