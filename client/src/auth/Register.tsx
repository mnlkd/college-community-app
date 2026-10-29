// The profile step lives in client.features because it calls the server.
import {
  DISPLAY_NAME_MAX,
  GRADUATION_YEAR_MIN,
  IDENTIFYING_CONTEXT_MAX,
  PROGRAMMES,
  emailSchema,
  institutionalEmailSchema,
  optionalText,
  pastGraduationYearSchema,
  programmeSchema,
  requiredText,
  type Programme,
  type RegistrationKind,
} from '@hilcoe/shared'
import { ArrowRight, GraduationCap, Mail, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { PROGRAMME_LABELS } from '../design/content'
import { Button, Field, Note, Select, TextArea, TextInput } from '../design/ui'
import { AuthFlowError, signUpMember } from './account-auth'
import { AuthShell } from './AuthShell'
import { PASSWORD_HINT, PasswordInput, newPasswordIssues } from './fields'
import { saveRegistrationDraft } from './registration-draft'
import { useSession } from './session'

const ALREADY_REGISTERED =
  'An account with this email already exists. Sign in, or reset your password if you forgot it.'

/** Signed-in users go to the profile step, which sends registered members on to Home. */
function useSignedInRedirect() {
  const { status } = useSession()
  return status === 'signedIn' ? <Navigate to="/register/profile" replace /> : null
}

/** 02-register-role: choose a registration path. */
export function RegisterRole() {
  const redirect = useSignedInRedirect()
  if (redirect) return redirect
  const paths = [
    {
      title: 'Student or Staff',
      icon: Users,
      to: '/register/student',
      detail:
        'Use a working @hilcoeschool.com mailbox. Staff role is assigned when the email is on the Staff list; otherwise the account starts as Student.',
    },
    {
      title: 'Alumni with institutional email',
      icon: Mail,
      to: '/register/student?path=alumni',
      detail:
        'Verify a working @hilcoeschool.com mailbox, then wait for Administrator confirmation before Alumni access becomes Verified.',
    },
    {
      title: 'Alumni without institutional email',
      icon: GraduationCap,
      to: '/register/alumni',
      detail:
        'Use a personal email, self-report your details, and browse read-only until an Administrator reviews the account.',
    },
  ]
  return (
    <AuthShell
      step="Getting started"
      title="Choose a registration path"
      sub="Every path verifies the entered mailbox with a 6-digit code. Your account state determines what you can do after sign-in."
    >
      <div className="space-y-3">
        {paths.map(({ title, icon: Icon, to, detail }) => (
          <Link
            key={to}
            to={to}
            className="flex gap-3.5 rounded-xl border border-slate-5 p-4 transition-colors hover:border-iris-8 hover:bg-iris-2"
          >
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-5 bg-slate-2">
              <Icon className="size-5 text-iris-11" strokeWidth={1.95} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display text-[15.5px] font-bold tracking-[-0.022em] text-slate-12">
                {title}
              </span>
              <span className="mt-1 block text-[13px] leading-relaxed text-slate-11">{detail}</span>
            </span>
            <ArrowRight className="mt-1 size-4 shrink-0 text-slate-9" />
          </Link>
        ))}
      </div>
      <p className="mt-5 text-center text-[13.5px] text-slate-11">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-iris-11 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}

type Errors = Record<string, string>

function firstIssue(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  return result.error?.issues[0]?.message ?? 'Not valid'
}

/** Shared submit: create the Supabase user, keep the draft, then go to the code step. */
function useSignUp() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(input: {
    email: string
    password: string
    kind: RegistrationKind
    displayName: string
    programme?: Programme | null
    graduationYear?: number | null
    identifyingContext?: string | null
  }) {
    setError(null)
    setBusy(true)
    try {
      const result = await signUpMember({
        email: input.email,
        password: input.password,
        metadata: { display_name: input.displayName, registration_kind: input.kind },
      })
      if (result === 'exists') {
        setError(ALREADY_REGISTERED)
        return
      }
      const { password: _password, ...draft } = input
      saveRegistrationDraft(draft)
      navigate('/register/verify', { state: { email: input.email } })
    } catch (cause) {
      setError(cause instanceof AuthFlowError ? cause.message : 'Registration failed. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error }
}

/** 03-register-student: institutional email for Students, Staff and Alumni who still have it. */
export function RegisterInstitutional() {
  const redirect = useSignedInRedirect()
  const [params] = useSearchParams()
  const alumni = params.get('path') === 'alumni'
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const signUp = useSignUp()

  if (redirect) return redirect

  function submit(event: FormEvent) {
    event.preventDefault()
    const next: Errors = {}
    const parsedEmail = institutionalEmailSchema.safeParse(email)
    if (!parsedEmail.success) next.email = firstIssue(parsedEmail)
    const parsedName = requiredText(DISPLAY_NAME_MAX).safeParse(displayName)
    if (!parsedName.success) next.displayName = firstIssue(parsedName)
    Object.assign(next, newPasswordIssues(password, confirm))
    setErrors(next)
    if (!parsedEmail.success || !parsedName.success || Object.keys(next).length > 0) return
    void signUp.run({
      email: parsedEmail.data,
      password,
      kind: alumni ? 'ALUMNI' : 'STUDENT_OR_STAFF',
      displayName: parsedName.data,
    })
  }

  return (
    <AuthShell
      step={alumni ? 'Institutional email · Alumni' : 'Institutional email · Student / Staff'}
      title="Register with institutional email"
      sub={
        alumni
          ? 'Use a working HiLCoE mailbox. After email verification, an Administrator confirms Alumni status before full participation.'
          : 'Students and Staff use their HiLCoE mailbox. Staff role is assigned when the email is on the Staff list.'
      }
      aside={
        <Note tone="iris">
          <strong className="font-semibold">Mailbox verification first.</strong>
          <br />A 6-digit code is emailed to the address you enter and expires in one hour. Profile details
          come after verification.
        </Note>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-4">
        {signUp.error && <Note tone="red">{signUp.error}</Note>}
        <Field
          label="Institutional email"
          required
          hint="Must end in @hilcoeschool.com."
          error={errors.email}
        >
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
        <Field label="Display name" required error={errors.displayName}>
          <TextInput
            name="displayName"
            autoComplete="name"
            value={displayName}
            invalid={Boolean(errors.displayName)}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <PasswordInput
          label="Password"
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
        <Note tone="iris">Next, enter the 6-digit code sent to this email address.</Note>
        <div className="flex items-center justify-between gap-3 pt-2">
          <Link to="/register" className="text-[13.5px] font-medium text-slate-10 hover:text-slate-12">
            Back
          </Link>
          <Button type="submit" size="lg" disabled={signUp.busy}>
            {signUp.busy ? 'Sending code…' : 'Email verification'} <ArrowRight className="size-4" />
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}

export function graduationYearOptions(currentYear: number): number[] {
  return Array.from({ length: currentYear - GRADUATION_YEAR_MIN + 1 }, (_, index) => currentYear - index)
}

/** 04-register-alumni: personal email with self-reported Alumni details. */
export function RegisterAlumni() {
  const redirect = useSignedInRedirect()
  const currentYear = new Date().getUTCFullYear()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [programme, setProgramme] = useState('')
  const [graduationYear, setGraduationYear] = useState('')
  const [identifyingContext, setIdentifyingContext] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const signUp = useSignUp()

  if (redirect) return redirect

  function submit(event: FormEvent) {
    event.preventDefault()
    const next: Errors = {}
    const parsedEmail = emailSchema.safeParse(email)
    if (!parsedEmail.success) next.email = firstIssue(parsedEmail)
    const parsedName = requiredText(DISPLAY_NAME_MAX).safeParse(displayName)
    if (!parsedName.success) next.displayName = firstIssue(parsedName)
    const parsedProgramme = programmeSchema.safeParse(programme)
    if (!parsedProgramme.success) next.programme = 'Required'
    const parsedYear = pastGraduationYearSchema(currentYear).safeParse(Number(graduationYear))
    if (graduationYear === '') next.graduationYear = 'Required'
    else if (!parsedYear.success) next.graduationYear = firstIssue(parsedYear)
    const parsedContext = optionalText(IDENTIFYING_CONTEXT_MAX).safeParse(identifyingContext)
    if (!parsedContext.success) next.identifyingContext = firstIssue(parsedContext)
    Object.assign(next, newPasswordIssues(password, confirm))
    setErrors(next)
    if (
      Object.keys(next).length > 0 ||
      !parsedEmail.success ||
      !parsedName.success ||
      !parsedProgramme.success ||
      !parsedYear.success ||
      !parsedContext.success
    )
      return
    void signUp.run({
      email: parsedEmail.data,
      password,
      kind: 'ALUMNI',
      displayName: parsedName.data,
      programme: parsedProgramme.data,
      graduationYear: parsedYear.data,
      identifyingContext: parsedContext.data,
    })
  }

  return (
    <AuthShell
      step="Alumni · self-report"
      title="Register with a personal email"
      sub="Use this path when you no longer have a working institutional mailbox. Your email is verified by code before read-only browsing."
      aside={
        <>
          <Note tone="amber">
            <strong className="font-semibold">While Self-Reported or Flagged</strong>
            <br />
            Browse read-only. No new reports or saves. Prior report history remains available, and prior saves
            can still be viewed or removed.
          </Note>
          <Note>
            Administrator review uses your name, programme, graduation year and optional context with trusted
            corroboration outside the app.
          </Note>
        </>
      }
    >
      <form noValidate onSubmit={submit} className="space-y-4">
        {signUp.error && <Note tone="red">{signUp.error}</Note>}
        <Field
          label="Personal email"
          required
          hint="A 6-digit verification code will be emailed."
          error={errors.email}
        >
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
        <Field label="Full name" required error={errors.displayName}>
          <TextInput
            name="displayName"
            autoComplete="name"
            value={displayName}
            invalid={Boolean(errors.displayName)}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Programme" required error={errors.programme}>
            <Select
              name="programme"
              value={programme}
              invalid={Boolean(errors.programme)}
              onChange={(event) => setProgramme(event.target.value)}
            >
              <option value="">Choose…</option>
              {PROGRAMMES.map((value) => (
                <option key={value} value={value}>
                  {PROGRAMME_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Graduation year" required error={errors.graduationYear}>
            <Select
              name="graduationYear"
              value={graduationYear}
              invalid={Boolean(errors.graduationYear)}
              onChange={(event) => setGraduationYear(event.target.value)}
            >
              <option value="">Choose…</option>
              {graduationYearOptions(currentYear).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </Field>
        </div>
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
        <PasswordInput
          label="Password"
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
        <Note tone="amber">
          Email is verified by code. Until an Administrator reviews the self-report, this account is
          browse-only (Self-Reported).
        </Note>
        <div className="flex items-center justify-between gap-3 pt-2">
          <Link to="/register" className="text-[13.5px] font-medium text-slate-10 hover:text-slate-12">
            Back
          </Link>
          <Button type="submit" size="lg" disabled={signUp.busy}>
            {signUp.busy ? 'Sending code…' : 'Create Self-Reported account'}
          </Button>
        </div>
      </form>
    </AuthShell>
  )
}
