import type { ActorContextView, NotificationView, ProfileView } from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi, createQueryClient } from '../src/api'
import { Notifications } from '../src/features/notifications/Notifications'
import { ProfileCard } from '../src/features/profile/Profile'
import { DeleteAccount } from '../src/features/settings/DeleteAccount'
import type * as SessionModule from '../src/auth/session'

vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => {
    throw new Error('Supabase is not used in these tests')
  },
}))

const signOutMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('../src/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionModule>()
  return { ...actual, signOut: signOutMock }
})

const actor: ActorContextView = {
  accountId: '00000000-0000-4000-8000-000000000001',
  kind: 'MEMBER',
  role: 'STUDENT',
  alumniStatus: null,
  accountState: 'ACTIVE',
  restrictedUntil: null,
  mfaVerified: false,
  isFirstAdmin: false,
}

function inShell(element: ReactNode, path = '/page') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={actor} />}>
            <Route path="/page" element={element} />
            <Route path="/settings" element={<p>settings page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

type Handler = (url: URL, init: RequestInit) => [number, unknown]

function serve(handler: Handler) {
  const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
    const [status, body] = handler(url, init)
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.unstubAllGlobals()
  signOutMock.mockClear()
  configureApi({ getAccessToken: async () => 'token', onUnauthenticated: () => undefined })
})

describe('ProfileCard', () => {
  const profile: ProfileView = {
    memberId: 'm1',
    displayName: 'Dawit Bekele',
    role: 'ALUMNI',
    alumniStatus: 'VERIFIED',
    programme: 'COMPUTER_SCIENCE',
    bio: 'Backend engineer.',
    studyOrExpertise: null,
    graduationYear: 2019,
    currentPosition: 'Engineer at Safaricom',
    pictureUrl: null,
  }

  it('shows the public profile with role, programme and year, and no email', () => {
    render(
      <MemoryRouter>
        <ProfileCard profile={profile} own={false} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Dawit Bekele' })).toBeInTheDocument()
    expect(screen.getByText(/Alumni/)).toHaveTextContent('Alumni · Verified')
    expect(screen.getByText('Computer Science')).toBeInTheDocument()
    expect(screen.getByText('Graduated 2019')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit profile' })).not.toBeInTheDocument()
  })

  it('offers editing on the own profile and labels a Student year as expected', () => {
    render(
      <MemoryRouter>
        <ProfileCard
          profile={{ ...profile, role: 'STUDENT', alumniStatus: null, graduationYear: 2028 }}
          own
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/profile/edit')
    expect(screen.getByText('Expected graduation 2028')).toBeInTheDocument()
  })
})

describe('Notifications', () => {
  function notice(id: string, unread: boolean): NotificationView {
    return {
      id,
      type: 'COMMENT',
      actorId: 'a1',
      actorName: `Member ${id}`,
      targetType: 'POST',
      targetId: 't1',
      unread,
      createdAt: new Date().toISOString(),
    }
  }

  it('marks one notice read, then all, refreshing the list and count', async () => {
    const items = [notice('n1', true), notice('n2', true), notice('n3', false)]
    const fetchMock = serve((url, init) => {
      if (url.pathname === '/api/notifications') return [200, { items, page: 1, pageSize: 20, total: 3 }]
      if (url.pathname === '/api/notifications/unread-count') {
        return [200, { count: items.filter((item) => item.unread).length }]
      }
      if (init.method === 'POST' && url.pathname === '/api/notifications/n1/read') {
        items.splice(0, 1, { ...notice('n1', false) })
        return [204, null]
      }
      if (init.method === 'POST' && url.pathname === '/api/notifications/read-all') {
        items.forEach((item, index) => (items[index] = { ...item, unread: false }))
        return [204, null]
      }
      return [500, { error: { code: 'INTERNAL', message: 'unexpected', fields: null } }]
    })
    const user = userEvent.setup()
    inShell(<Notifications />)

    const list = await screen.findByRole('list', { name: 'Notifications' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('Member n1')).toBeInTheDocument()
    expect(within(list).getAllByRole('button', { name: /as read/ })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Mark notification from Member n1 as read' }))
    await waitFor(() => expect(within(list).getAllByRole('button', { name: /as read/ })).toHaveLength(1))

    const markAll = screen.getByRole('button', { name: 'Mark all read' })
    await waitFor(() => expect(markAll).toBeEnabled())
    await user.click(markAll)
    await waitFor(() => expect(within(list).queryAllByRole('button', { name: /as read/ })).toHaveLength(0))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled())
    expect(
      fetchMock.mock.calls.some(([url]) => (url as URL).pathname === '/api/notifications/read-all'),
    ).toBe(true)
  })

  it('says so when there are no notifications', async () => {
    serve((url) =>
      url.pathname === '/api/notifications'
        ? [200, { items: [], page: 1, pageSize: 20, total: 0 }]
        : [200, { count: 0 }],
    )
    inShell(<Notifications />)
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
  })
})

describe('DeleteAccount', () => {
  it('requires the confirmation word and the password before calling the server', async () => {
    const fetchMock = serve(() => [204, null])
    const user = userEvent.setup()
    inShell(<DeleteAccount />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect(screen.getByText('Type DELETE exactly as shown')).toBeInTheDocument()
    expect(screen.getByText('Enter your current password')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a wrong password on the password field and keeps the account', async () => {
    serve(() => [
      422,
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Check the highlighted fields.',
          fields: { currentPassword: 'The password is not correct' },
        },
      },
    ])
    const user = userEvent.setup()
    inShell(<DeleteAccount />)
    await user.type(screen.getByLabelText(/Type DELETE to confirm/), 'DELETE')
    await user.type(screen.getByLabelText(/Current password/), 'wrong password value')
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect(await screen.findByText('The password is not correct')).toBeInTheDocument()
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('signs out after the account is deleted', async () => {
    const fetchMock = serve(() => [204, null])
    const user = userEvent.setup()
    inShell(<DeleteAccount />)
    await user.type(screen.getByLabelText(/Type DELETE to confirm/), 'DELETE')
    await user.type(screen.getByLabelText(/Current password/), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith('Your account was deleted.'))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/api/members/me')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(String(init.body))).toEqual({ currentPassword: 'correct horse battery staple' })
  })
})
