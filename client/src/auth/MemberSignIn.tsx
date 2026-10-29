import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { CredentialsForm } from './CredentialsForm'
import { SignInFrame } from './SignInFrame'
import { useSession } from './session'

/** The page a guard sent the user away from, if it belongs to the same shell. */
export function returnPath(state: unknown, shell: 'member' | 'admin'): string {
  const from = (state as { from?: unknown } | null)?.from
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) {
    return shell === 'admin' ? '/admin' : '/home'
  }
  const isAdminPath = from === '/admin' || from.startsWith('/admin/')
  if (shell === 'admin') return isAdminPath ? from : '/admin'
  return isAdminPath ? '/home' : from
}

/** Member sign-in (01-login). Student, Staff and Alumni accounts; the account determines the role. */
export function MemberSignIn() {
  const { status } = useSession()
  const location = useLocation()
  const [busy, setBusy] = useState(false)

  if (status === 'signedIn' && !busy) {
    return <Navigate to={returnPath(location.state, 'member')} replace />
  }
  return (
    <SignInFrame
      title="Member sign in"
      sub="Student, Staff and Alumni access. Your account determines your role."
      footer={
        <p className="mt-5 border-t border-slate-4 pt-4 text-center text-[13.5px] text-slate-11">
          New here?{' '}
          <Link to="/register" className="font-semibold text-iris-11 hover:underline">
            Create an account
          </Link>
        </p>
      }
    >
      <CredentialsForm
        expectedKind="MEMBER"
        wrongKindMessage="Administrator accounts sign in on the Administrator sign-in page."
        onBusyChange={setBusy}
      />
      <Link
        to="/recover"
        className="mt-4 block text-center text-[13px] font-medium text-iris-11 hover:underline"
      >
        Forgot password?
      </Link>
    </SignInFrame>
  )
}
