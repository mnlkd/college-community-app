import { Ban } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Button, Note } from '../design/ui'
import { AuthShell } from './AuthShell'

/** Shown when Supabase refuses sign-in because the account is disabled. */
export function AccountDisabled() {
  return (
    <AuthShell
      step="Community account · access denied"
      title="Account disabled"
      sub="An Administrator has disabled this account. This is separate from verification status and posting restrictions, and it has no automatic expiry."
    >
      <div className="space-y-5">
        <Badge tone="red" icon={<Ban className="size-3.5" />}>
          Disabled · all community access denied
        </Badge>
        <Note>
          Current sessions were ended when the account was disabled. Your data, ownership and accepted
          relationships are preserved.
        </Note>
        <Note tone="iris">
          If you lost access to your mailbox, contact an Administrator in person. The Administrator can update
          the email, then you use the normal password reset.
        </Note>
        <Link to="/login" className="block">
          <Button variant="secondary" block>
            Back to sign in
          </Button>
        </Link>
      </div>
    </AuthShell>
  )
}
