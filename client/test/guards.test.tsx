import type * as SessionModule from '../src/auth/session'
import type { SessionSnapshot } from '../src/auth/session'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi, createQueryClient } from '../src/api'
import { RequireAdmin, RequireMember } from '../src/app/guards'

const state = vi.hoisted(() => ({ snapshot: null as unknown }))

vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => {
    throw new Error('Supabase is not used in these tests')
  },
}))

vi.mock('../src/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>()
  return { ...actual, useSession: () => state.snapshot, signOut: vi.fn(async () => undefined) }
})

function jwt(aal: string): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '')
  return `${encode({ alg: 'ES256' })}.${encode({ aal })}.sig`
}

function signedIn(aal: 'aal1' | 'aal2', accountKind: 'MEMBER' | 'ADMIN' | null = 'MEMBER'): SessionSnapshot {
  return {
    status: 'signedIn',
    notice: null,
    session: {
      access_token: jwt(aal),
      user: {
        id: 'user-1',
        email: 'selamawit.girma@hilcoeschool.com',
        app_metadata: accountKind ? { account_kind: accountKind } : {},
      },
    },
  } as unknown as SessionSnapshot
}

const actor = {
  accountId: '00000000-0000-4000-8000-000000000001',
  kind: 'MEMBER',
  role: 'STUDENT',
  alumniStatus: null,
  accountState: 'ACTIVE',
  restrictedUntil: null,
  mfaVerified: false,
  isFirstAdmin: false,
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>member sign-in page</p>} />
          <Route path="/admin/login" element={<p>admin sign-in page</p>} />
          <Route path="/register/profile" element={<p>complete profile page</p>} />
          <Route element={<RequireMember />}>
            <Route path="/home" element={<p>home content</p>} />
          </Route>
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<p>admin content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => json(status, body))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Answers by path; unknown paths fail the test with a 500. */
function respondByPath(routes: Record<string, [number, unknown]>) {
  const fetchMock = vi.fn(async (url: URL) => {
    const route = routes[url.pathname]
    return route
      ? json(...route)
      : json(500, { error: { code: 'INTERNAL', message: url.pathname, fields: null } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function pathsCalled(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => (call[0] as URL).pathname)
}

const ownAccount = {
  id: actor.accountId,
  email: 'selamawit.girma@hilcoeschool.com',
  displayName: 'Selamawit Girma',
  role: 'STUDENT',
  alumniStatus: null,
  state: 'ACTIVE',
  profile: { memberId: actor.accountId, displayName: 'Selamawit Girma', pictureUrl: null },
  graduationRequest: null,
}

beforeEach(() => {
  configureApi({ getAccessToken: async () => 'token', onUnauthenticated: () => undefined })
  vi.unstubAllGlobals()
})

describe('RequireMember', () => {
  it('sends a signed-out visitor to member sign-in', () => {
    state.snapshot = { status: 'signedOut', session: null, notice: null }
    renderAt('/home')
    expect(screen.getByText('member sign-in page')).toBeInTheDocument()
  })

  it('shows a loading state, then the page with the role, name and unread badge from the server', async () => {
    state.snapshot = signedIn('aal1')
    const fetchMock = respondByPath({
      '/api/accounts/me': [200, actor],
      '/api/members/me': [200, ownAccount],
      '/api/notifications/unread-count': [200, { count: 3 }],
    })
    renderAt('/home')
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByText('home content')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Selamawit Girma, your profile' })).toHaveAttribute(
      'href',
      '/profile',
    )
    expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toHaveAttribute(
      'href',
      '/notifications',
    )
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(pathsCalled(fetchMock)[0]).toBe('/api/accounts/me')
    expect(pathsCalled(fetchMock)).not.toContain('/api/registrations/me')
  })

  it('sends a verified user who has not finished registration to the profile step', async () => {
    state.snapshot = signedIn('aal1', null)
    const fetchMock = respondByPath({
      '/api/registrations/me': [
        200,
        { registered: false, email: 'new@hilcoeschool.com', institutional: true, staffListed: false },
      ],
    })
    renderAt('/home')
    expect(await screen.findByText('complete profile page')).toBeInTheDocument()
    expect(pathsCalled(fetchMock)).toEqual(['/api/registrations/me'])
  })

  it('lets a registered member without the account-kind hint through', async () => {
    state.snapshot = signedIn('aal1', null)
    const fetchMock = respondByPath({
      '/api/registrations/me': [
        200,
        { registered: true, email: ownAccount.email, institutional: true, staffListed: false },
      ],
      '/api/accounts/me': [200, actor],
      '/api/members/me': [200, ownAccount],
      '/api/notifications/unread-count': [200, { count: 0 }],
    })
    renderAt('/home')
    expect(await screen.findByText('home content')).toBeInTheDocument()
    expect(pathsCalled(fetchMock).slice(0, 2)).toEqual(['/api/registrations/me', '/api/accounts/me'])
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument()
  })

  it('shows the server refusal for an Administrator account', async () => {
    state.snapshot = signedIn('aal2', 'ADMIN')
    respond(403, {
      error: { code: 'FORBIDDEN', message: 'This page is for community members.', fields: null },
    })
    renderAt('/home')
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This page is for community members.')
    expect(screen.queryByText('home content')).not.toBeInTheDocument()
  })
})

describe('RequireAdmin', () => {
  it('sends a signed-out visitor to Administrator sign-in', () => {
    state.snapshot = { status: 'signedOut', session: null, notice: null }
    renderAt('/admin')
    expect(screen.getByText('admin sign-in page')).toBeInTheDocument()
  })

  it('sends a password-only (AAL1) session to the authenticator step without calling the API', () => {
    state.snapshot = signedIn('aal1')
    const fetchMock = respond(200, actor)
    renderAt('/admin')
    expect(screen.getByText('admin sign-in page')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the Administrator page at AAL2 once the server agrees', async () => {
    state.snapshot = signedIn('aal2')
    respond(200, { ...actor, kind: 'ADMIN', role: null, mfaVerified: true })
    renderAt('/admin')
    expect(await screen.findByText('admin content')).toBeInTheDocument()
    expect(screen.getByTestId('shell-role')).toHaveTextContent('Administrator')
  })

  it('shows the pending queues beside Users and Moderation', async () => {
    state.snapshot = signedIn('aal2', 'ADMIN')
    respondByPath({
      '/api/admin/accounts/me': [200, { ...actor, kind: 'ADMIN', role: null, mfaVerified: true }],
      '/api/admin/queue-counts': [
        200,
        { pendingReports: 4, pendingAlumniReviews: 2, pendingGraduationRequests: 1 },
      ],
    })
    renderAt('/admin')
    expect(await screen.findByText('admin content')).toBeInTheDocument()
    expect(await screen.findByTestId('nav-badge-users')).toHaveTextContent('3 awaiting review')
    expect(screen.getByTestId('nav-badge-moderation')).toHaveTextContent('4 pending reports')
  })
})

describe('AppShell on narrow screens', () => {
  it('opens the navigation from the top bar and closes it with Escape', async () => {
    state.snapshot = signedIn('aal1')
    respondByPath({
      '/api/accounts/me': [200, actor],
      '/api/members/me': [200, ownAccount],
      '/api/notifications/unread-count': [200, { count: 0 }],
    })
    const user = userEvent.setup()
    renderAt('/home')
    expect(await screen.findByText('home content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Navigation' })
    expect(within(drawer).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(within(drawer).getByRole('button', { name: 'Close navigation' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus()
  })
})
