import type { ActorContextView, MemberCardView, OpportunityView, Page } from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi, createQueryClient } from '../src/api'
import {
  EditOpportunity,
  NewOpportunity,
  OpportunitiesBoard,
  OpportunityDetail,
} from '../src/features/opportunities/Opportunities'

vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => {
    throw new Error('Supabase is not used in these tests')
  },
}))

const student: ActorContextView = {
  accountId: '00000000-0000-4000-8000-000000000001',
  kind: 'MEMBER',
  role: 'STUDENT',
  alumniStatus: null,
  accountState: 'ACTIVE',
  restrictedUntil: null,
  mfaVerified: false,
  isFirstAdmin: false,
}

const alumnus: ActorContextView = {
  ...student,
  accountId: '00000000-0000-4000-8000-000000000002',
  role: 'ALUMNI',
  alumniStatus: 'VERIFIED',
}

const yonasCard: MemberCardView = {
  memberId: alumnus.accountId,
  displayName: 'Yonas Bekele',
  role: 'ALUMNI',
  alumniStatus: 'VERIFIED',
  pictureUrl: null,
  deleted: false,
}

const ID = '00000000-0000-4000-8000-0000000000a1'

function listing(overrides: Partial<OpportunityView> = {}): OpportunityView {
  const now = new Date().toISOString()
  return {
    id: ID,
    title: 'Backend intern',
    type: 'INTERNSHIP',
    state: 'OPEN',
    isOwn: false,
    savedByMe: false,
    details: {
      author: yonasCard,
      organization: 'Kifiya',
      location: 'Addis Ababa',
      workArrangement: 'HYBRID',
      description: 'Build payment APIs with the platform team.',
      applyVia: 'Email careers@kifiya.example with your CV.',
      deadline: '2030-06-30',
      version: 3,
      saveCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  }
}

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 20, total: items.length })

function Where() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

function inShell(element: ReactNode, path: string, pattern: string, actor = student) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={actor} />}>
            <Route path={pattern} element={element} />
            <Route path="*" element={<Where />} />
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

const calls = (fetchMock: ReturnType<typeof serve>) =>
  fetchMock.mock.calls.map(([url, init]) => `${init.method ?? 'GET'} ${url.pathname}`)

beforeEach(() => {
  vi.unstubAllGlobals()
  configureApi({ getAccessToken: async () => 'token', onUnauthenticated: () => undefined })
})

describe('OpportunitiesBoard', () => {
  it('lists open listings, filters by type and hides authoring from Students', async () => {
    const fetchMock = serve((url) =>
      url.pathname === '/api/boards/opportunities' ? [200, page([listing()])] : [404, null],
    )
    inShell(<OpportunitiesBoard />, '/boards/opportunities', '/boards/opportunities')

    const card = await screen.findByRole('article', { name: 'Backend intern' })
    expect(within(card).getByText('Kifiya')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Post an opportunity/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'My listings' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Activities' })).toHaveAttribute('href', '/boards/activities')

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'FULL_TIME')
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            url.pathname === '/api/boards/opportunities' && url.searchParams.get('type') === 'FULL_TIME',
        ),
      ).toBe(true),
    )
  })

  it('lets an author switch to their own listings', async () => {
    const fetchMock = serve((url) =>
      url.pathname === '/api/boards/opportunities'
        ? [
            200,
            page([
              listing({ isOwn: true }),
              listing({ id: 'closed', state: 'CLOSED', details: null, title: 'Old role' }),
            ]),
          ]
        : [404, null],
    )
    inShell(<OpportunitiesBoard />, '/boards/opportunities', '/boards/opportunities', alumnus)
    expect(await screen.findByRole('link', { name: /Post an opportunity/ })).toHaveAttribute(
      'href',
      '/boards/opportunities/new',
    )
    await userEvent.click(screen.getByRole('button', { name: 'My listings' }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => url.pathname === '/api/boards/opportunities' && url.searchParams.get('mine') === 'true',
        ),
      ).toBe(true),
    )
    const closed = await screen.findByRole('article', { name: 'Old role' })
    expect(within(closed).getByText('Closed')).toBeInTheDocument()
  })
})

describe('OpportunityDetail', () => {
  const path = `/boards/opportunities/listings/${ID}`
  const pattern = '/boards/opportunities/listings/:opportunityId'

  it('shows an open listing with external application instructions and no author controls', async () => {
    serve((url) => (url.pathname === `/api/opportunities/${ID}` ? [200, listing()] : [404, null]))
    inShell(<OpportunityDetail />, path, pattern)
    expect(await screen.findByRole('heading', { name: 'Backend intern' })).toBeInTheDocument()
    expect(screen.getByText(/Email careers@kifiya.example/)).toBeInTheDocument()
    expect(screen.getByText(/No application is submitted or tracked/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close listing' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save listing' })).toBeEnabled()
  })

  it('shows only title, type and status for a closed listing, to its author too', async () => {
    serve((url) =>
      url.pathname === `/api/opportunities/${ID}`
        ? [200, listing({ state: 'CLOSED', isOwn: true, details: null })]
        : [404, null],
    )
    inShell(<OpportunityDetail />, path, pattern, alumnus)
    expect(await screen.findByRole('heading', { name: 'Backend intern' })).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByText('Kifiya')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit listing' })).not.toBeInTheDocument()
  })

  it('lets the author close a listing after confirming', async () => {
    let view = listing({ isOwn: true })
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/opportunities/${ID}/closure` && init.method === 'POST') {
        view = listing({ isOwn: true, state: 'CLOSED', details: null })
        return [204, null]
      }
      if (url.pathname === `/api/opportunities/${ID}`) return [200, view]
      return [404, null]
    })
    inShell(<OpportunityDetail />, path, pattern, alumnus)
    expect(await screen.findByRole('link', { name: 'Edit listing' })).toHaveAttribute('href', `${path}/edit`)
    await userEvent.click(screen.getByRole('button', { name: 'Close listing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close permanently' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Listing closed')
    expect(calls(fetchMock)).toContain(`POST /api/opportunities/${ID}/closure`)
    await waitFor(() => expect(screen.queryByText('Kifiya')).not.toBeInTheDocument())
  })

  it('reports a listing the viewer may not see as unavailable', async () => {
    serve(() => [404, { error: { code: 'NOT_FOUND', message: 'Not found.', fields: null } }])
    inShell(<OpportunityDetail />, path, pattern)
    expect(await screen.findByText(/does not exist or is not available/)).toBeInTheDocument()
  })
})

describe('NewOpportunity', () => {
  it('tells Students they cannot post', () => {
    serve(() => [404, null])
    inShell(<NewOpportunity />, '/boards/opportunities/new', '/boards/opportunities/new')
    expect(screen.getByText('Only Staff and Verified Alumni can post opportunities.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish listing' })).not.toBeInTheDocument()
  })

  it('validates required fields, then publishes and opens the listing', async () => {
    const fetchMock = serve((url, init) =>
      url.pathname === '/api/opportunities' && init.method === 'POST'
        ? [201, listing({ isOwn: true })]
        : [404, null],
    )
    inShell(<NewOpportunity />, '/boards/opportunities/new', '/boards/opportunities/new', alumnus)

    await userEvent.click(screen.getByRole('button', { name: 'Publish listing' }))
    expect(calls(fetchMock)).toEqual([])

    await userEvent.type(screen.getByLabelText(/Role title/), 'Backend intern')
    await userEvent.type(screen.getByLabelText(/Organisation/), 'Kifiya')
    await userEvent.type(screen.getByLabelText(/Location/), 'Addis Ababa')
    await userEvent.type(screen.getByLabelText(/Description/), 'Build payment APIs.')
    await userEvent.type(screen.getByLabelText(/How to apply/), 'Email careers@kifiya.example')
    await userEvent.click(screen.getByRole('button', { name: 'Publish listing' }))

    expect(await screen.findByTestId('location')).toHaveTextContent(`/boards/opportunities/listings/${ID}`)
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init.body))).toMatchObject({
      title: 'Backend intern',
      type: 'INTERNSHIP',
      workArrangement: 'ON_SITE',
      deadline: null,
    })
  })
})

describe('EditOpportunity', () => {
  const path = `/boards/opportunities/listings/${ID}/edit`
  const pattern = '/boards/opportunities/listings/:opportunityId/edit'

  it('sends the version the author opened and explains a conflict', async () => {
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/opportunities/${ID}` && init.method === 'PUT') {
        return [409, { error: { code: 'CONFLICT', message: 'Changed.', fields: null } }]
      }
      if (url.pathname === `/api/opportunities/${ID}`) return [200, listing({ isOwn: true })]
      return [404, null]
    })
    inShell(<EditOpportunity />, path, pattern, alumnus)
    const title = await screen.findByLabelText(/Role title/)
    expect(title).toHaveValue('Backend intern')
    await userEvent.clear(title)
    await userEvent.type(title, 'Backend engineering intern')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This listing changed since you opened it')
    const put = fetchMock.mock.calls.find(([, init]) => init.method === 'PUT')
    expect(JSON.parse(String(put?.[1].body))).toMatchObject({
      title: 'Backend engineering intern',
      version: 3,
    })
  })
})
