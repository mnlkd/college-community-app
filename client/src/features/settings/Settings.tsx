import type { ActorContextView } from '@hilcoe/shared'
import { Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation, useOutletContext } from 'react-router-dom'
import { useOwnAccount } from '../../api'
import { signOut } from '../../auth'
import { ErrorContent, LoadingContent } from '../../design/states'
import { Button, Card, ColumnHeader, Note, buttonClass } from '../../design/ui'
import { ModerationStanding } from '../moderation/Standing'

function Row({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <p className="font-semibold text-slate-12">{title}</p>
        <div className="mt-0.5 text-[13px] text-slate-10">{children}</div>
      </div>
      {action}
    </div>
  )
}

function linkButton(to: string, label: string) {
  return (
    <Link to={to} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
      {label}
    </Link>
  )
}

export function Settings() {
  const actor = useOutletContext<ActorContextView>()
  const location = useLocation()
  const notice = (location.state as { notice?: unknown } | null)?.notice
  const account = useOwnAccount(actor.accountId)
  if (account.isPending) return <LoadingContent />
  if (account.isError)
    return <ErrorContent message={account.error.message} onRetry={() => void account.refetch()} />
  const { email, role, graduationRequest } = account.data
  const pending = graduationRequest?.decision === 'PENDING'

  return (
    <>
      <ColumnHeader title="Settings" subtitle="Your account, password and privacy." />
      {typeof notice === 'string' && (
        <div className="mb-4">
          <Note tone="iris">{notice}</Note>
        </div>
      )}
      <Card className="divide-y divide-slate-4">
        <Row title="Account email" action={linkButton('/settings/email', 'Change email')}>
          <p className="font-mono text-[13.5px] text-slate-12" data-testid="account-email">
            {email}
          </p>
          <p className="mt-1 text-[12px]">Verified account email. Not displayed on your profile.</p>
        </Row>
        <Row title="Profile" action={linkButton('/profile/edit', 'Edit profile')}>
          Optional picture and bio; study and current-position details.
        </Row>
        <Row title="Password" action={linkButton('/settings/password', 'Change password')}>
          Changing it requires your current password.
        </Row>
        {role === 'STUDENT' && (
          <Row title="Graduation" action={linkButton('/settings/graduation', 'Request Alumni status')}>
            {pending
              ? 'Your graduation request is waiting for an Administrator. You keep Student access until then.'
              : 'Finished your programme? Ask an Administrator to change your role to Alumni.'}
          </Row>
        )}
        <div className="px-4 py-3.5">
          <p className="font-semibold text-slate-12">Forgotten password</p>
          <p className="mt-1 text-[13px] text-slate-10">
            Request a reset code by email, then set a new password. If you lost the mailbox, an Administrator
            can update the email after in-person corroboration.
          </p>
          <Link to="/recover" className="mt-2 inline-block text-[13px] font-semibold text-iris-11">
            Reset by email code
          </Link>
        </div>
      </Card>

      <h2 className="font-display mt-6 mb-2 text-[15px] font-bold text-slate-12">Notifications</h2>
      <Card className="p-4">
        <p className="text-[13.5px] leading-relaxed text-slate-11">
          Comments, replies, likes, mentorship and group decisions, Alumni review and moderation outcomes. The
          unread count refreshes every 30 seconds while this page is visible.
        </p>
        <Link to="/notifications" className="mt-3 inline-block text-[13px] font-semibold text-iris-11">
          Open notifications
        </Link>
      </Card>

      <ModerationStanding actor={actor} />

      <h2 className="font-display mt-6 mb-2 text-[15px] font-bold text-red-11">Account deletion</h2>
      <Card className="border-red-7 bg-red-3/30 p-4">
        <p className="text-[13.5px] leading-relaxed text-slate-11">
          Remove your profile, pictures, credentials and private data. Posts, comments and likes remain under
          Deleted User.
        </p>
        <Link to="/settings/delete" className={buttonClass({ variant: 'dangerGhost' }) + ' mt-3'}>
          <Trash2 className="size-4" />
          Delete my account
        </Link>
      </Card>
      <Button variant="ghost" className="mt-5" onClick={() => void signOut()}>
        Sign out
      </Button>
    </>
  )
}
