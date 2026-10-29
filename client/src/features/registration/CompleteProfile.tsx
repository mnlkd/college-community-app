import {
  DISPLAY_NAME_MAX,
  IDENTIFYING_CONTEXT_MAX,
  registrationInputSchema,
  roleDetailsIssues,
  type RegistrationInput,
  type RegistrationKind,
  type RegistrationStatusView,
  type Role,
} from '@hilcoe/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { completeRegistration, isApiError, useRegistrationStatus } from '../../api'
import {
  AuthShell,
  accountKindOf,
  clearRegistrationDraft,
  loadRegistrationDraft,
  refreshSession,
  signOut,
  signUpMetadataOf,
  useSession,
} from '../../auth'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Button, Field, Note, TextArea, TextInput } from '../../design/ui'
import {
  RoleDetailsFields,
  emptyRoleDetails,
  fieldErrorsOf,
  roleDetailsInput,
  roleDetailsValues,
  type RoleDetailsValues,
} from '../profile/RoleDetailsFields'

const ROLE_REASONS: Record<Role, string> = {
  STAFF: 'Your email is on the Staff email list, so this account has the Staff role.',
  STUDENT: 'Your institutional email is not on the Staff email list, so this account has the Student role.',
  ALUMNI:
    'You registered as Alumni. The account stays Self-Reported until an Administrator confirms these details.',
}
const ROLE_NAMES: Record<Role, string> = { STAFF: 'Staff', STUDENT: 'Student', ALUMNI: 'Alumni' }

/** The path the user chose; a personal email can only be the Alumni path. */
export function registrationKindFor(
  status: RegistrationStatusView,
  chosen: RegistrationKind | undefined,
): RegistrationKind {
  if (!status.institutional) return 'ALUMNI'
  return chosen ?? 'STUDENT_OR_STAFF'
}

export function roleFor(status: RegistrationStatusView, kind: RegistrationKind): Role {
  if (kind === 'ALUMNI') return 'ALUMNI'
  return status.staffListed ? 'STAFF' : 'STUDENT'
}

function ExitButton() {
  return (
    <Button variant="ghost" onClick={() => void signOut()}>
      Exit to sign in
    </Button>
  )
}

/** After the email code: role-specific details, then the platform account is created. */
export function CompleteProfile() {
  const { status, session } = useSession()
  const admin = accountKindOf(session?.user) === 'ADMIN'
  const authUserId = status === 'signedIn' && !admin ? (session?.user.id ?? null) : null
  const registration = useRegistrationStatus(authUserId)

  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: '/register/profile' }} />
  if (admin) return <Navigate to="/admin" replace />
  const shell = (content: ReactNode) => (
    <AuthShell step="Email verified · profile" title="Complete your profile" headerAction={<ExitButton />}>
      {content}
    </AuthShell>
  )
  if (status === 'loading' || registration.isPending) return shell(<LoadingContent />)
  if (registration.isError) {
    return shell(
      <ErrorContent message={registration.error.message} onRetry={() => void registration.refetch()} />,
    )
  }
  if (registration.data.registered) return <Navigate to="/home" replace />

  const metadata = signUpMetadataOf(session?.user.user_metadata)
  const draft = loadRegistrationDraft()
  const sameEmail = draft?.email === registration.data.email ? draft : null
  const kind = registrationKindFor(registration.data, metadata.registration_kind ?? sameEmail?.kind)
  return (
    <ProfileForm
      status={registration.data}
      kind={kind}
      initialName={metadata.display_name ?? sameEmail?.displayName ?? ''}
      initialDetails={roleDetailsValues(sameEmail ?? {})}
      initialContext={sameEmail?.identifyingContext ?? ''}
    />
  )
}

function ProfileForm({
  status,
  kind,
  initialName,
  initialDetails,
  initialContext,
}: {
  status: RegistrationStatusView
  kind: RegistrationKind
  initialName: string
  initialDetails: RoleDetailsValues
  initialContext: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const currentYear = new Date().getUTCFullYear()
  const role = roleFor(status, kind)
  const [displayName, setDisplayName] = useState(initialName)
  const [details, setDetails] = useState<RoleDetailsValues>(
    role === 'STAFF'
      ? { ...emptyRoleDetails, ...initialDetails, programme: '', graduationYear: '' }
      : initialDetails,
  )
  const [identifyingContext, setIdentifyingContext] = useState(initialContext)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const input: RegistrationInput =
      kind === 'ALUMNI'
        ? { kind, displayName, identifyingContext, ...roleDetailsInput(role, details) }
        : { kind, displayName, ...roleDetailsInput(role, details) }
    const parsed = registrationInputSchema.safeParse(input)
    const next: Record<string, string> = {}
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        next[key] ??= issue.message
      }
    } else {
      Object.assign(next, roleDetailsIssues(role, parsed.data, currentYear))
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setBusy(true)
    try {
      await completeRegistration(input)
      clearRegistrationDraft()
      await refreshSession().catch(() => undefined)
      queryClient.removeQueries({ queryKey: ['registrations'] })
      navigate('/home', { replace: true })
    } catch (cause) {
      const fields = fieldErrorsOf(cause)
      if (fields && !fields.email) setErrors(fields)
      else if (fields?.email) setError(fields.email)
      else setError(isApiError(cause) ? cause.message : 'Registration failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      step="Email verified · profile"
      title="Complete your profile"
      sub="These details appear on your profile. You can change them, and add a picture and bio, later."
      headerAction={<ExitButton />}
      aside={
        <Note tone="iris">
          <strong className="font-semibold">Role: {ROLE_NAMES[role]}</strong>
          <br />
          {ROLE_REASONS[role]}
        </Note>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-4">
        {error && <Note tone="red">{error}</Note>}
        <div className="rounded-xl border border-slate-5 bg-slate-2 px-4 py-3">
          <p className="text-[14.5px] font-semibold text-slate-12" data-testid="registration-role">
            Role: {ROLE_NAMES[role]}
          </p>
          <p className="font-mono text-[12px] text-slate-10">{status.email}</p>
        </div>
        <Field
          label={kind === 'ALUMNI' ? 'Full name' : 'Display name'}
          required
          hint={`At most ${DISPLAY_NAME_MAX} characters.`}
          error={errors.displayName}
        >
          <TextInput
            name="displayName"
            autoComplete="name"
            value={displayName}
            invalid={Boolean(errors.displayName)}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <RoleDetailsFields
          role={role}
          values={details}
          errors={errors}
          onChange={setDetails}
          currentYear={currentYear}
        />
        {kind === 'ALUMNI' && (
          <Field
            label="Identifying context"
            hint={`Optional. For example a former adviser or project title. At most ${IDENTIFYING_CONTEXT_MAX} characters.`}
            error={errors.identifyingContext}
          >
            <TextArea
              name="identifyingContext"
              rows={2}
              value={identifyingContext}
              invalid={Boolean(errors.identifyingContext)}
              onChange={(event) => setIdentifyingContext(event.target.value)}
            />
          </Field>
        )}
        {kind === 'ALUMNI' && (
          <Note tone="amber">
            Until an Administrator reviews these details, the account is Self-Reported and can browse only.
          </Note>
        )}
        <Button type="submit" size="lg" block disabled={busy}>
          {busy ? 'Creating account…' : 'Continue to Home'}
        </Button>
      </form>
    </AuthShell>
  )
}
