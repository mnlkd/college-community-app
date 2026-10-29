import type {
  ActorContextView,
  AdministratorView,
  AdminMemberSummaryView,
  AdminMemberView,
  AlumniReviewView,
} from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Administrators } from '../src/admin/Administrators'
import { ManageUser } from '../src/admin/ManageUser'
import { StaffEmails } from '../src/admin/StaffEmails'
import { AdminUsers } from '../src/admin/Users'
import { configureApi, createQueryClient } from '../src/api'
import { AcceptInvite } from '../src/auth/AcceptInvite'

const supabaseAuth = vi.hoisted(() => ({ verifyOtp: vi.fn(), updateUser: vi.fn() }))
vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => ({ auth: supabaseAuth }),
  getPasswordCheckClient: () => {
    throw new Error('not used')
  },
}))

const admin: ActorContextView = {
  accountId: '00000000-0000-4000-8000-0000000000a1',
  kind: 'ADMIN',
  role: null,
  alumniStatus: null,
  accountState: 'ACTIVE',
  restrictedUntil: null,
  mfaVerified: true,
  isFirstAdmin: false,
}

const MEMBER_ID = '00000000-0000-4000-8000-000000000011'

function inShell(element: ReactNode, path = '/page', actor = admin, pattern = '/page') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={actor} />}>
            <Route path={pattern} element={element} />
            <Route path="/admin/users" element={<p>users page</p>} />
            <Route path="/admin/login" element={<p>admin sign-in page</p>} />
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

function callsTo(fetchMock: ReturnType<typeof serve>, method: string, pathname: string) {
  return fetchMock.mock.calls
    .map(([url, init]) => [url as URL, init as RequestInit] as const)
    .filter(([url, init]) => url.pathname === pathname && (init.method ?? 'GET') === method)
}

const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, total: items.length })

const summary: AdminMemberSummaryView = {
  id: MEMBER_ID,
  displayName: 'Selamawit Girma',
  email: 'selamawit.girma@hilcoeschool.com',
  role: 'STUDENT',
  alumniStatus: null,
  programme: 'COMPUTER_SCIENCE',
  state: 'ACTIVE',
  createdAt: '2025-01-10T08:00:00.000Z',
}

const review: AlumniReviewView = {
  id: '00000000-0000-4000-8000-0000000000b1',
  memberId: MEMBER_ID,
  displayName: 'Hanan Ali',
  email: 'hanan@example.com',
  registrationPath: 'PERSONAL_EMAIL',
  claimedFullName: 'Hanan Mohammed Ali',
  identifyingContext: 'Final project on clinic scheduling',
  programme: 'SOFTWARE_ENGINEERING',
  graduationYear: 2022,
  decision: 'PENDING',
  createdAt: '2025-02-01T08:00:00.000Z',
}

beforeEach(() => {
  vi.unstubAllGlobals()
  supabaseAuth.verifyOtp.mockReset()
  supabaseAuth.updateUser.mockReset()
  configureApi({ getAccessToken: async () => 'token', onUnauthenticated: () => undefined })
})

describe('AdminUsers', () => {
  it('lists accounts and searches by name or email', async () => {
    const fetchMock = serve(() => [200, page([summary])])
    const user = userEvent.setup()
    inShell(<AdminUsers />)
    expect(await screen.findByText('Selamawit Girma')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage Selamawit Girma' })).toHaveAttribute(
      'href',
      `/admin/users/${MEMBER_ID}`,
    )
    await user.type(screen.getByLabelText('Search by name or email'), 'selam')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(
        callsTo(fetchMock, 'GET', '/api/admin/members').some(
          ([url]) => url.searchParams.get('query') === 'selam',
        ),
      ).toBe(true),
    )
  })

  it('needs a private reason before deciding an Alumni review, then posts the decision', async () => {
    const fetchMock = serve((url) =>
      url.pathname.endsWith('/decision') ? [204, null] : [200, page([review])],
    )
    const user = userEvent.setup()
    inShell(<AdminUsers />, '/page?tab=reviews')
    await user.click(await screen.findByRole('button', { name: 'Review Hanan Ali' }))
    const dialog = screen.getByRole('dialog', { name: 'Review Hanan Ali' })
    expect(dialog).toHaveTextContent('Hanan Mohammed Ali')
    await user.click(screen.getByRole('button', { name: 'Move to Verified' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/required|Enter/i)
    expect(callsTo(fetchMock, 'POST', `/api/admin/alumni-reviews/${review.id}/decision`)).toHaveLength(0)

    await user.type(screen.getByLabelText(/Private reason/), 'Matched the registrar list.')
    await user.click(screen.getByRole('button', { name: 'Move to Verified' }))
    expect(await screen.findByText('Hanan Ali is now Verified Alumni.')).toBeInTheDocument()
    const [, init] = callsTo(fetchMock, 'POST', `/api/admin/alumni-reviews/${review.id}/decision`)[0]!
    expect(JSON.parse(String(init.body))).toEqual({
      decision: 'VERIFIED',
      reason: 'Matched the registrar list.',
    })
  })
})

describe('ManageUser', () => {
  const view: AdminMemberView = {
    ...summary,
    studyOrExpertise: null,
    graduationYear: 2027,
    currentPosition: null,
    pendingAlumniReview: null,
    pendingGraduationRequest: null,
  }

  it('asks for the Alumni status when correcting to Alumni and sends it', async () => {
    const fetchMock = serve((_url, init) => (init.method === 'PUT' ? [204, null] : [200, view]))
    const user = userEvent.setup()
    inShell(<ManageUser />, `/admin/users/${MEMBER_ID}`, admin, '/admin/users/:memberId')
    await user.selectOptions(await screen.findByLabelText(/^Role/), 'ALUMNI')
    await user.selectOptions(screen.getByLabelText(/Alumni status/), 'SELF_REPORTED')
    const reasons = screen.getAllByLabelText(/Private reason/)
    await user.type(reasons[0]!, 'Graduated in 2024 per registrar.')
    await user.click(screen.getByRole('button', { name: 'Correct role' }))
    expect(await screen.findByText('The role was corrected.')).toBeInTheDocument()
    const [, init] = callsTo(fetchMock, 'PUT', `/api/admin/members/${MEMBER_ID}/role`)[0]!
    expect(JSON.parse(String(init.body))).toEqual({
      newRole: 'ALUMNI',
      alumniStatus: 'SELF_REPORTED',
      reason: 'Graduated in 2024 per registrar.',
    })
  })

  it('requires the fake-account confirmation before deleting', async () => {
    const fetchMock = serve((_url, init) => (init.method === 'DELETE' ? [204, null] : [200, view]))
    const user = userEvent.setup()
    inShell(<ManageUser />, `/admin/users/${MEMBER_ID}`, admin, '/admin/users/:memberId')
    await user.type(await screen.findByLabelText(/Private deletion reason/), 'Impersonation confirmed.')
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(screen.getByText('Confirm that the account is fake')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'DELETE', `/api/admin/members/${MEMBER_ID}`)).toHaveLength(0)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByText('users page')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'DELETE', `/api/admin/members/${MEMBER_ID}`)).toHaveLength(1)
  })
})

describe('StaffEmails', () => {
  it('accepts only college emails and removes by email', async () => {
    const fetchMock = serve((_url, init) =>
      init.method === 'POST'
        ? [201, { email: 'dawit.bekele@hilcoeschool.com', updatedAt: '2025-01-01T00:00:00.000Z' }]
        : init.method === 'DELETE'
          ? [204, null]
          : [200, page([{ email: 'meseret@hilcoeschool.com', updatedAt: '2025-01-01T00:00:00.000Z' }])],
    )
    const user = userEvent.setup()
    inShell(<StaffEmails />)
    await user.type(screen.getByRole('textbox', { name: /^Staff email/ }), 'dawit@gmail.com')
    await user.click(screen.getByRole('button', { name: 'Add Staff email' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(callsTo(fetchMock, 'POST', '/api/admin/staff-emails')).toHaveLength(0)

    await user.clear(screen.getByRole('textbox', { name: /^Staff email/ }))
    await user.type(screen.getByRole('textbox', { name: /^Staff email/ }), 'Dawit.Bekele@hilcoeschool.com')
    await user.click(screen.getByRole('button', { name: 'Add Staff email' }))
    expect(
      await screen.findByText('dawit.bekele@hilcoeschool.com was added to the Staff list.'),
    ).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Remove meseret@hilcoeschool.com' }))
    await waitFor(() =>
      expect(callsTo(fetchMock, 'DELETE', '/api/admin/staff-emails/meseret%40hilcoeschool.com')).toHaveLength(
        1,
      ),
    )
  })
})

describe('Administrators', () => {
  const list: AdministratorView[] = [
    {
      id: admin.accountId,
      email: 'me@hilcoeschool.com',
      isFirstAdmin: false,
      isSelf: true,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-0000000000a2',
      email: 'other@hilcoeschool.com',
      isFirstAdmin: false,
      isSelf: false,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ]

  it('offers removal only to the first Administrator and never for oneself', async () => {
    serve(() => [200, list])
    inShell(<Administrators />)
    expect(
      await screen.findByRole('button', { name: 'Reset authenticator for other@hilcoeschool.com' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /me@hilcoeschool.com/ })).not.toBeInTheDocument()
  })

  it('lets the first Administrator remove another with a reason', async () => {
    const fetchMock = serve((_url, init) => (init.method === 'DELETE' ? [204, null] : [200, list]))
    const user = userEvent.setup()
    inShell(<Administrators />, '/page', { ...admin, isFirstAdmin: true })
    await user.click(await screen.findByRole('button', { name: 'Remove other@hilcoeschool.com' }))
    await user.type(screen.getByLabelText(/Private reason/), 'Left the college.')
    await user.click(screen.getByRole('button', { name: 'Remove Administrator' }))
    expect(await screen.findByText('other@hilcoeschool.com was removed.')).toBeInTheDocument()
    const [, init] = callsTo(fetchMock, 'DELETE', `/api/admin/administrators/${list[1]!.id}`)[0]!
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Left the college.' })
  })
})

describe('AcceptInvite', () => {
  it('checks the invitation code, sets the password and goes to authenticator setup', async () => {
    supabaseAuth.verifyOtp.mockResolvedValue({ data: {}, error: null })
    supabaseAuth.updateUser.mockResolvedValue({ data: {}, error: null })
    const user = userEvent.setup()
    inShell(<AcceptInvite />)
    await user.type(screen.getByLabelText(/Email/), 'new.admin@hilcoeschool.com')
    await user.type(screen.getByLabelText(/6-digit code/), '123456')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(supabaseAuth.verifyOtp).toHaveBeenCalledWith({
      email: 'new.admin@hilcoeschool.com',
      token: '123456',
      type: 'invite',
    })
    await user.type(await screen.findByLabelText(/New password/), 'correct horse battery staple')
    await user.type(screen.getByLabelText(/Confirm password/), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Set password and continue' }))
    expect(await screen.findByText('admin sign-in page')).toBeInTheDocument()
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({ password: 'correct horse battery staple' })
  })
})
