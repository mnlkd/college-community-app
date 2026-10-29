import { ROLES, emailSchema, type ActorContextView, type AdminMemberView, type Role } from '@hilcoe/shared'
import { Ban, KeyRound, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  useAdminMember,
  useCorrectRole,
  useDeleteFakeAccount,
  useDisableAccount,
  useRestoreAccount,
  useUpdateMemberEmail,
} from '../api'
import { PROGRAMME_LABELS, ROLE_LABELS, RoleChip } from '../design/content'
import { ErrorContent, LoadingContent } from '../design/states'
import { Avatar, Button, Card, ColumnHeader, Field, Note, Select, TextInput, buttonClass } from '../design/ui'
import { DetailRows, ReasonField, StateBadge, errorMessage, fieldError, formatDate, reasonIssue } from './kit'

export function ManageUser() {
  const actor = useOutletContext<ActorContextView>()
  const { memberId = '' } = useParams()
  const member = useAdminMember(actor.accountId, memberId)
  const back = (
    <Link to="/admin/users" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
      All users
    </Link>
  )

  if (member.isPending) return <LoadingContent />
  if (member.isError) {
    return (
      <>
        <ColumnHeader title="Manage account" right={back} />
        <ErrorContent message={member.error.message} onRetry={() => void member.refetch()} />
      </>
    )
  }
  const view = member.data
  return (
    <>
      <ColumnHeader title="Manage account" subtitle="Private Administrator account controls." right={back} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <MemberSummary member={view} />
          <RoleCorrection
            key={`role-${view.role}-${view.alumniStatus}`}
            accountId={actor.accountId}
            member={view}
          />
        </div>
        <div className="space-y-4">
          <EmailUpdate key={`email-${view.email}`} accountId={actor.accountId} member={view} />
          <AccessControl key={`access-${view.state}`} accountId={actor.accountId} member={view} />
          <DeleteFake accountId={actor.accountId} member={view} />
        </div>
      </div>
    </>
  )
}

function MemberSummary({ member }: { member: AdminMemberView }) {
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <Avatar name={member.displayName} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] font-bold text-slate-12">{member.displayName}</p>
          <p className="truncate font-mono text-[12px] text-slate-10">{member.email}</p>
        </div>
        <StateBadge state={member.state} />
      </div>
      <DetailRows
        rows={[
          ['Role', <RoleChip role={member.role} alumniStatus={member.alumniStatus} />],
          ['Programme', member.programme ? PROGRAMME_LABELS[member.programme] : 'Not given'],
          ['Graduation year', member.graduationYear ?? 'Not given'],
          ['Joined', formatDate(member.createdAt)],
        ]}
      />
      {member.pendingAlumniReview && (
        <Note tone="amber">
          An Alumni self-report is waiting.{' '}
          <Link to="/admin/users?tab=reviews" className="font-semibold underline">
            Open self-report reviews
          </Link>
        </Note>
      )}
      {member.pendingGraduationRequest && (
        <Note tone="amber">
          A graduation request is waiting.{' '}
          <Link to="/admin/users?tab=graduation" className="font-semibold underline">
            Open graduation requests
          </Link>
        </Note>
      )}
    </Card>
  )
}

function RoleCorrection({ accountId, member }: { accountId: string; member: AdminMemberView }) {
  const correct = useCorrectRole(accountId)
  const [newRole, setNewRole] = useState<Role>(member.role)
  const [alumniStatus, setAlumniStatus] = useState<'VERIFIED' | 'SELF_REPORTED'>('VERIFIED')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()
  const [done, setDone] = useState(false)
  const unchanged = newRole === member.role && (newRole !== 'ALUMNI' || alumniStatus === member.alumniStatus)

  function submit(event: FormEvent) {
    event.preventDefault()
    const issue = reasonIssue(reason)
    setReasonError(issue)
    if (issue || unchanged) return
    setDone(false)
    correct.mutate(
      {
        memberId: member.id,
        input: { newRole, alumniStatus: newRole === 'ALUMNI' ? alumniStatus : null, reason },
      },
      { onSuccess: () => setDone(true) },
    )
  }

  return (
    <Card className="p-5">
      <form noValidate onSubmit={submit} className="space-y-4">
        <h2 className="font-display text-[16px] font-bold text-slate-12">Correct community role</h2>
        {done && <Note tone="iris">The role was corrected.</Note>}
        {correct.isError && <Note tone="red">{errorMessage(correct.error)}</Note>}
        <Field label="Role" required>
          <Select name="newRole" value={newRole} onChange={(event) => setNewRole(event.target.value as Role)}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </Field>
        {newRole === 'ALUMNI' && (
          <Field
            label="Alumni status"
            required
            hint="Self-Reported opens a new review in the self-report queue."
          >
            <Select
              name="alumniStatus"
              value={alumniStatus}
              onChange={(event) => setAlumniStatus(event.target.value as 'VERIFIED' | 'SELF_REPORTED')}
            >
              <option value="VERIFIED">Verified</option>
              <option value="SELF_REPORTED">Self-Reported</option>
            </Select>
          </Field>
        )}
        <ReasonField value={reason} error={reasonError} onChange={setReason} />
        <Note tone="iris">
          Student and Staff need a college email. Details the new role cannot keep, such as a Staff member’s
          programme, are cleared. This never makes a member an Administrator.
        </Note>
        <Button type="submit" disabled={correct.isPending || unchanged}>
          {correct.isPending ? 'Saving…' : 'Correct role'}
        </Button>
      </form>
    </Card>
  )
}

function EmailUpdate({ accountId, member }: { accountId: string; member: AdminMemberView }) {
  const update = useUpdateMemberEmail(accountId)
  const [newEmail, setNewEmail] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = emailSchema.safeParse(newEmail)
    const issues = {
      newEmail: parsed.success
        ? undefined
        : (parsed.error.issues[0]?.message ?? 'Enter a valid email address'),
      reason: reasonIssue(reason),
    }
    if (parsed.success && parsed.data === member.email) issues.newEmail = 'This is already the account email'
    setErrors(issues)
    if (issues.newEmail || issues.reason || !parsed.success) return
    update.mutate({ memberId: member.id, input: { newEmail: parsed.data, reason } })
  }

  return (
    <Card className="p-5">
      <form noValidate onSubmit={submit} className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-[16px] font-bold text-slate-12">
          <KeyRound className="size-4" />
          Update account email
        </h2>
        {update.isSuccess && (
          <Note tone="iris">The email was updated. The member now uses the normal password reset.</Note>
        )}
        {update.isError && !fieldError(update.error, 'newEmail') && (
          <Note tone="red">{errorMessage(update.error)}</Note>
        )}
        <Field label="New email" required error={errors.newEmail ?? fieldError(update.error, 'newEmail')}>
          <TextInput
            type="email"
            name="newEmail"
            mono
            value={newEmail}
            invalid={Boolean(errors.newEmail)}
            onChange={(event) => setNewEmail(event.target.value)}
          />
        </Field>
        <ReasonField
          label="Private corroboration reason"
          value={reason}
          error={errors.reason}
          onChange={setReason}
        />
        <Note>
          Confirm the claimant’s identity in person first. Changing the email does not restore a disabled
          account; the member then resets the password with a code sent to the new address.
        </Note>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Update email'}
        </Button>
      </form>
    </Card>
  )
}

function AccessControl({ accountId, member }: { accountId: string; member: AdminMemberView }) {
  const disable = useDisableAccount(accountId)
  const restore = useRestoreAccount(accountId)
  const action = member.state === 'ACTIVE' ? disable : restore
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()

  function submit(event: FormEvent) {
    event.preventDefault()
    const issue = reasonIssue(reason)
    setReasonError(issue)
    if (issue) return
    action.mutate({ memberId: member.id, input: { reason } })
  }

  const disabling = member.state === 'ACTIVE'
  return (
    <Card className="p-5">
      <form noValidate onSubmit={submit} className="space-y-4">
        <h2 className="font-display text-[16px] font-bold text-slate-12">
          {disabling ? 'Disable account' : 'Restore account'}
        </h2>
        {action.isError && <Note tone="red">{errorMessage(action.error)}</Note>}
        <ReasonField
          label={disabling ? 'Private disable reason' : 'Private restore reason'}
          value={reason}
          error={reasonError}
          onChange={setReason}
        />
        <Note tone="amber">
          {disabling
            ? 'Disabling signs the member out everywhere and blocks all access until an Administrator restores it. It does not expire and does not change the Alumni status.'
            : 'Restore only after the legitimate claimant is confirmed. Alumni status and other restrictions stay as they are.'}
        </Note>
        <Button type="submit" variant={disabling ? 'danger' : 'primary'} disabled={action.isPending}>
          {disabling ? <Ban className="size-4" /> : <RotateCcw className="size-4" />}
          {disabling ? 'Disable account' : 'Restore account'}
        </Button>
      </form>
    </Card>
  )
}

function DeleteFake({ accountId, member }: { accountId: string; member: AdminMemberView }) {
  const remove = useDeleteFakeAccount(accountId)
  const navigate = useNavigate()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [errors, setErrors] = useState<{ reason?: string; confirm?: string }>({})

  function submit(event: FormEvent) {
    event.preventDefault()
    const issues = {
      reason: reasonIssue(reason),
      confirm: confirmed ? undefined : 'Confirm that the account is fake',
    }
    setErrors(issues)
    if (issues.reason || issues.confirm) return
    remove.mutate(
      { memberId: member.id, input: { reason } },
      {
        onSuccess: () =>
          navigate('/admin/users', {
            replace: true,
            state: { notice: `${member.displayName}’s account was deleted.` },
          }),
      },
    )
  }

  return (
    <Card className="p-5">
      <form noValidate onSubmit={submit} className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-[16px] font-bold text-red-11">
          <Trash2 className="size-4" />
          Delete confirmed-fake account
        </h2>
        {remove.isError && <Note tone="red">{errorMessage(remove.error)}</Note>}
        <ReasonField
          label="Private deletion reason"
          value={reason}
          error={errors.reason}
          onChange={setReason}
        />
        <label className="flex items-start gap-2 text-[13.5px] text-slate-12">
          <input
            type="checkbox"
            name="confirmFake"
            className="mt-1"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            The investigation confirmed this account is fake. Its content is removed and the email cannot
            register again.
          </span>
        </label>
        {errors.confirm && (
          <p role="alert" className="text-[12px] text-red-11">
            {errors.confirm}
          </p>
        )}
        <Button type="submit" variant="danger" disabled={remove.isPending}>
          Delete account
        </Button>
      </form>
    </Card>
  )
}
