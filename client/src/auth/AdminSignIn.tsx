import { sixDigitCodeSchema } from '@hilcoe/shared'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Button, Field, Note, TextInput } from '../design/ui'
import { CredentialsForm } from './CredentialsForm'
import { returnPath } from './MemberSignIn'
import { authErrorMessage } from './messages'
import { accountKindOf, assuranceOf, signOut, useSession } from './session'
import { SignInFrame } from './SignInFrame'
import { getSupabase } from './supabase'

type Step = 'credentials' | 'enroll' | 'challenge' | 'done'

/**
 * Administrator sign-in (45-admin-login): password, then the authenticator code (Verify
 * Authenticator Code). An Administrator without a verified factor enrolls one first (NFR-1).
 */
export function AdminSignIn() {
  const { status, session } = useSession()
  const location = useLocation()
  const [busy, setBusy] = useState(false)

  let step: Step = 'credentials'
  if (status === 'signedIn' && accountKindOf(session?.user) === 'ADMIN' && !busy) {
    const assurance = assuranceOf(session)
    step = assurance.current === 'aal2' ? 'done' : assurance.hasVerifiedFactor ? 'challenge' : 'enroll'
  }

  if (step === 'done') return <Navigate to={returnPath(location.state, 'admin')} replace />

  return (
    <SignInFrame
      admin
      title={step === 'enroll' ? 'Set up your authenticator' : 'Administrator sign in'}
      sub={
        step === 'enroll'
          ? 'Administrator accounts require an authenticator app. Enroll one to continue.'
          : 'Administrator accounts require an authenticator app code.'
      }
      footer={
        step === 'credentials' && (
          <p className="mt-5 border-t border-slate-4 pt-4 text-[12.5px] leading-relaxed text-slate-10">
            Existing Administrators invite new Administrators by email. The invitee sets a password and
            enrolls an authenticator app before dashboard access.
          </p>
        )
      }
    >
      {step === 'credentials' && (
        <CredentialsForm
          expectedKind="ADMIN"
          wrongKindMessage="This page is for Administrators. Community members sign in on the member sign-in page."
          onBusyChange={setBusy}
        />
      )}
      {step === 'challenge' && <ChallengeStep />}
      {step === 'enroll' && <EnrollStep />}
    </SignInFrame>
  )
}

interface PendingFactor {
  id: string
  qrCode: string
  secret: string
}

function EnrollStep() {
  const [factor, setFactor] = useState<PendingFactor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const mfa = getSupabase().auth.mfa
        // An abandoned enrollment leaves an unverified factor; remove it so a fresh one can be made.
        const { data: list, error: listError } = await mfa.listFactors()
        if (listError) throw listError
        for (const stale of list.all.filter((item) => item.status === 'unverified')) {
          const { error: removeError } = await mfa.unenroll({ factorId: stale.id })
          if (removeError) throw removeError
        }
        const { data, error: enrollError } = await mfa.enroll({
          factorType: 'totp',
          friendlyName: 'HiLCoE Commons',
        })
        if (enrollError) throw enrollError
        setFactor({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
      } catch (cause) {
        setError(authErrorMessage(cause instanceof Error ? cause : new Error(String(cause))))
      }
    })()
  }, [])

  return (
    <div className="space-y-4">
      {error && <Note tone="red">{error}</Note>}
      {factor ? (
        <>
          <p className="text-[13.5px] leading-relaxed text-slate-11">
            Scan the QR code with your authenticator app, or enter the setup key by hand. Then enter the
            6-digit code it shows.
          </p>
          <div className="flex justify-center">
            <img
              src={factor.qrCode}
              alt="QR code for your authenticator app"
              className="size-44 rounded-lg border border-slate-5 bg-white p-2"
            />
          </div>
          <Field label="Setup key">
            <TextInput
              readOnly
              mono
              value={factor.secret}
              data-testid="totp-secret"
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <CodeForm factorId={factor.id} submitLabel="Verify and continue" />
        </>
      ) : (
        !error && (
          <p className="text-center text-[13.5px] text-slate-10">Preparing your authenticator setup…</p>
        )
      )}
      <CancelLink />
    </div>
  )
}

function ChallengeStep() {
  const { session } = useSession()
  const factor = (session?.user.factors ?? []).find(
    (item) => item.factor_type === 'totp' && item.status === 'verified',
  )
  return (
    <div className="space-y-4">
      {factor && <CodeForm factorId={factor.id} submitLabel="Verify" />}
      <CancelLink />
    </div>
  )
}

function CodeForm({ factorId, submitLabel }: { factorId: string; submitLabel: string }) {
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const parsed = sixDigitCodeSchema.safeParse(code)
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter the 6-digit code')
      return
    }
    setFieldError(undefined)
    setBusy(true)
    try {
      const { error: verifyError } = await getSupabase().auth.mfa.challengeAndVerify({
        factorId,
        code: parsed.data,
      })
      if (verifyError) {
        setError(authErrorMessage(verifyError))
        setCode('')
      }
    } catch (cause) {
      setError(authErrorMessage(cause instanceof Error ? cause : new Error(String(cause))))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {error && <Note tone="red">{error}</Note>}
      <Field
        label="Authenticator app code"
        required
        hint="The current code from your authenticator app."
        error={fieldError}
      >
        <TextInput
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          mono
          autoFocus
          value={code}
          invalid={Boolean(fieldError)}
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Button type="submit" size="lg" block disabled={busy}>
        {busy ? 'Verifying…' : submitLabel}
      </Button>
    </form>
  )
}

function CancelLink() {
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="block w-full text-center text-[13px] font-medium text-slate-10 hover:text-slate-12"
    >
      Cancel and sign out
    </button>
  )
}
