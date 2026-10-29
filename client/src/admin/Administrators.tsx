import { institutionalEmailSchema, type ActorContextView, type AdministratorView } from '@hilcoe/shared'
import { ShieldOff, UserMinus, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import {
  useAdministrators,
  useCreateAdministrator,
  useRemoveAdministrator,
  useResetAdministratorMfa,
} from '../api'
import { ErrorContent, LoadingContent } from '../design/states'
import { Avatar, Badge, Button, Card, ColumnHeader, Field, Note, TextInput, buttonClass } from '../design/ui'
import { Dialog, ReasonField, errorMessage, fieldError, formatDate, reasonIssue } from './kit'

type Pending = { kind: 'reset' | 'remove'; admin: AdministratorView }

export function Administrators() {
  const actor = useOutletContext<ActorContextView>()
  const list = useAdministrators(actor.accountId)
  const [pending, setPending] = useState<Pending | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <>
      <ColumnHeader
        title="Administrators"
        subtitle="Every Administrator signs in with a password and an authenticator app."
        right={
          <Link to="/admin/administrators/new" className={buttonClass({ size: 'sm' })}>
            <UserPlus className="size-4" />
            Create Administrator
          </Link>
        }
      />
      <div className="space-y-4">
        {notice && <Note tone="iris">{notice}</Note>}
        {list.isPending ? (
          <LoadingContent />
        ) : list.isError ? (
          <ErrorContent message={list.error.message} onRetry={() => void list.refetch()} />
        ) : (
          <Card className="overflow-hidden">
            <ul aria-label="Administrators" className="divide-y divide-slate-4">
              {list.data.map((admin) => (
                <li key={admin.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={admin.email} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[13px] text-slate-12">{admin.email}</p>
                    <p className="text-[12px] text-slate-10">Added {formatDate(admin.createdAt)}</p>
                  </div>
                  {admin.isFirstAdmin && <Badge tone="iris">First Administrator</Badge>}
                  {admin.isSelf ? (
                    <Badge>You</Badge>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Reset authenticator for ${admin.email}`}
                        onClick={() => setPending({ kind: 'reset', admin })}
                      >
                        <ShieldOff className="size-3.5" />
                        Reset authenticator
                      </Button>
                      {actor.isFirstAdmin && !admin.isFirstAdmin && (
                        <Button
                          size="sm"
                          variant="dangerGhost"
                          aria-label={`Remove ${admin.email}`}
                          onClick={() => setPending({ kind: 'remove', admin })}
                        >
                          <UserMinus className="size-3.5" />
                          Remove
                        </Button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Note>
          Another Administrator must reset your authenticator if you lose it. Only the first Administrator can
          remove Administrators, and at least two must remain.
        </Note>
      </div>
      {pending && (
        <AdminActionDialog
          accountId={actor.accountId}
          pending={pending}
          onClose={() => setPending(null)}
          onDone={(message) => {
            setPending(null)
            setNotice(message)
          }}
        />
      )}
    </>
  )
}

function AdminActionDialog({
  accountId,
  pending,
  onClose,
  onDone,
}: {
  accountId: string
  pending: Pending
  onClose: () => void
  onDone: (message: string) => void
}) {
  const reset = useResetAdministratorMfa(accountId)
  const remove = useRemoveAdministrator(accountId)
  const action = pending.kind === 'reset' ? reset : remove
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()
  const { admin } = pending

  function submit() {
    const issue = reasonIssue(reason)
    setReasonError(issue)
    if (issue) return
    action.mutate(
      { adminId: admin.id, input: { reason } },
      {
        onSuccess: () =>
          onDone(
            pending.kind === 'reset'
              ? `${admin.email} must enroll a new authenticator at the next sign-in.`
              : `${admin.email} was removed.`,
          ),
      },
    )
  }

  return (
    <Dialog
      title={pending.kind === 'reset' ? 'Reset authenticator' : 'Remove Administrator'}
      sub={admin.email}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={action.isPending} onClick={submit}>
            {pending.kind === 'reset' ? 'Reset authenticator' : 'Remove Administrator'}
          </Button>
        </>
      }
    >
      {action.isError && <Note tone="red">{errorMessage(action.error)}</Note>}
      <Note tone="amber">
        {pending.kind === 'reset'
          ? 'Their authenticator is removed and every session is signed out. Confirm their identity first; they enroll a new authenticator at the next sign-in.'
          : 'Their access ends at once. Audit records keep the action but no longer name this Administrator.'}
      </Note>
      <ReasonField value={reason} error={reasonError} onChange={setReason} />
    </Dialog>
  )
}

export function CreateAdministrator() {
  const actor = useOutletContext<ActorContextView>()
  const navigate = useNavigate()
  const create = useCreateAdministrator(actor.accountId)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string>()

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = institutionalEmailSchema.safeParse(email)
    setEmailError(parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Enter a college email'))
    if (!parsed.success) return
    create.mutate({ email: parsed.data }, { onSuccess: () => navigate('/admin/administrators') })
  }

  return (
    <>
      <ColumnHeader
        title="Create Administrator"
        subtitle="Invite a college email to become an Administrator."
        right={
          <Link to="/admin/administrators" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Back to Administrators
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-fit p-5">
          <form noValidate onSubmit={submit} className="space-y-4">
            {create.isError && !fieldError(create.error, 'email') && (
              <Note tone="red">{errorMessage(create.error)}</Note>
            )}
            <Field
              label="Administrator email"
              required
              hint="A @hilcoeschool.com address that is not used by any account."
              error={emailError ?? fieldError(create.error, 'email')}
            >
              <TextInput
                type="email"
                name="email"
                mono
                value={email}
                invalid={Boolean(emailError)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Sending invitation…' : 'Send invitation'}
            </Button>
          </form>
        </Card>
        <div className="space-y-4">
          <Note tone="iris">
            The invitation email has a 6-digit code. The new Administrator enters it on the invitation page,
            sets a password and enrolls an authenticator app before any access.
          </Note>
          <Note>There is no public Administrator sign-up, and community members cannot be promoted.</Note>
        </div>
      </div>
    </>
  )
}
