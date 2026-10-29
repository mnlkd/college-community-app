import {
  isApiError,
  useAdminMe,
  useMe,
  useOwnAccount,
  useQueueCounts,
  useRegistrationStatus,
  useUnreadCount,
} from '../api'
import { accountKindOf, assuranceOf, signOut, useSession } from '../auth'
import type { ActorContextView } from '@hilcoe/shared'
import type { UseQueryResult } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { MemberRail } from '../features/posts/MemberRail'
import { AppShell } from './AppShell'
import { shellIdentity } from './identity'
import { AccessDeniedContent, ErrorContent, LoadingContent } from './states'

function ShellContent({ query, admin }: { query: UseQueryResult<ActorContextView>; admin: boolean }) {
  if (query.isPending) return <LoadingContent />
  if (query.isError) {
    const error = query.error
    // A 401 already signed the session out; the guard redirects on the next render.
    if (isApiError(error) && error.status === 401) return <LoadingContent />
    if (isApiError(error) && error.status === 403) {
      return (
        <AccessDeniedContent
          message={error.message}
          onSignOut={() => void signOut()}
          otherShell={
            admin
              ? { to: '/home', label: 'Go to member pages' }
              : { to: '/admin', label: 'Go to Administrator pages' }
          }
        />
      )
    }
    return <ErrorContent message={error.message} onRetry={() => void query.refetch()} />
  }
  return <Outlet context={query.data} />
}

/**
 * Member shell guard: signed-out users go to member sign-in; the server decides the account type.
 * A verified user without the account-kind hint may not have finished registration, so the guard
 * asks the server first and sends an unregistered user to the profile step.
 */
export function RequireMember() {
  const { status, session } = useSession()
  const location = useLocation()
  const user = status === 'signedIn' ? (session?.user ?? null) : null
  const hinted = accountKindOf(user) !== null
  const registration = useRegistrationStatus(user && !hinted ? user.id : null)
  const ready = user !== null && (hinted || registration.data?.registered === true)
  const me = useMe(ready ? user.id : null)
  const accountId = me.data?.kind === 'MEMBER' ? me.data.accountId : null
  const own = useOwnAccount(accountId)
  const unread = useUnreadCount(accountId)

  if (status === 'signedOut') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (registration.data?.registered === false) return <Navigate to="/register/profile" replace />

  const identity = shellIdentity(session?.user.email, me.data, own.data)
  let content
  if (status === 'loading' || (user && !hinted && registration.isPending)) content = <LoadingContent />
  else if (registration.isError) {
    content = (
      <ErrorContent message={registration.error.message} onRetry={() => void registration.refetch()} />
    )
  } else content = <ShellContent query={me} admin={false} />

  return (
    <AppShell
      identity={identity}
      badges={{ '/notifications': unread.data?.count ?? 0 }}
      rail={
        ['/home', '/search'].includes(location.pathname) ? <MemberRail accountId={accountId} /> : undefined
      }
    >
      {content}
    </AppShell>
  )
}

/** Administrator shell guard: requires a session at AAL2, then the server's Administrator check. */
export function RequireAdmin() {
  const { status, session } = useSession()
  const location = useLocation()
  const aal2 = assuranceOf(session).current === 'aal2'
  const me = useAdminMe(status === 'signedIn' && aal2 ? (session?.user.id ?? null) : null)
  const queues = useQueueCounts(me.data?.kind === 'ADMIN' ? me.data.accountId : null)

  if (status === 'signedOut' || (status === 'signedIn' && !aal2)) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />
  }
  return (
    <AppShell
      admin
      identity={shellIdentity(session?.user.email, me.data)}
      badges={{
        '/admin/users':
          (queues.data?.pendingAlumniReviews ?? 0) + (queues.data?.pendingGraduationRequests ?? 0),
        '/admin/moderation': queues.data?.pendingReports ?? 0,
      }}
      onSignOut={() => void signOut()}
    >
      {status === 'loading' ? <LoadingContent /> : <ShellContent query={me} admin />}
    </AppShell>
  )
}
