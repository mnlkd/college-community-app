import type {
  ActorContextView,
  GroupView,
  MemberCardView,
  MembershipView,
  NotificationView,
  Page,
} from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi, createQueryClient } from '../src/api'
import { ActivitiesBoard, GroupDetail, ManageGroup, NewGroup } from '../src/features/groups/Groups'
import { Notifications } from '../src/features/notifications/Notifications'

vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => {
    throw new Error('Supabase is not used in these tests')
  },
}))

const owner: ActorContextView = {
  accountId: '00000000-0000-4000-8000-000000000001',
  kind: 'MEMBER',
  role: 'STUDENT',
  alumniStatus: null,
  accountState: 'ACTIVE',
  restrictedUntil: null,
  mfaVerified: false,
  isFirstAdmin: false,
}

const other: ActorContextView = { ...owner, accountId: '00000000-0000-4000-8000-000000000003' }

const card = (memberId: string, displayName: string): MemberCardView => ({
  memberId,
  displayName,
  role: 'STUDENT',
  alumniStatus: null,
  pictureUrl: null,
  deleted: false,
})

const ownerCard = card(owner.accountId, 'Selamawit Haile')
const otherCard = card(other.accountId, 'Dawit Mengistu')

const ID = '00000000-0000-4000-8000-0000000000b1'

function group(overrides: Partial<GroupView> = {}): GroupView {
  const now = new Date().toISOString()
  return {
    id: ID,
    owner: ownerCard,
    title: 'Algorithms study circle',
    description: 'Weekly practice, Saturdays 10:00.',
    maxOccupancy: 5,
    occupancy: 2,
    state: 'OPEN',
    version: 1,
    createdAt: now,
    updatedAt: now,
    viewerRelation: null,
    joinBlock: null,
    pendingCount: null,
    savedByMe: false,
    coordinationDetails: null,
    coordinationWithheld: false,
    members: null,
    pendingTransfer: null,
    ...overrides,
  }
}

const members = [
  { membershipId: 'ms1', member: ownerCard, isOwner: true, joinedAt: new Date().toISOString() },
  { membershipId: 'ms2', member: otherCard, isOwner: false, joinedAt: new Date().toISOString() },
]

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 20, total: items.length })

function Where() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

function inShell(element: ReactNode, path: string, pattern: string, actor = other) {
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

describe('ActivitiesBoard', () => {
  it('lists open groups with capacity and switches to my groups', async () => {
    const fetchMock = serve((url) => {
      if (url.pathname === '/api/boards/activities') return [200, page([group()])]
      if (url.pathname === '/api/groups/mine') return [200, page([group({ viewerRelation: 'MEMBER' })])]
      return [404, null]
    })
    inShell(<ActivitiesBoard />, '/boards/activities', '/boards/activities')
    const article = await screen.findByRole('article', { name: 'Algorithms study circle' })
    expect(within(article).getByRole('img', { name: '2 of 5 places filled' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /New group/ })).toHaveAttribute('href', '/boards/activities/new')

    await userEvent.click(screen.getByRole('button', { name: 'My groups' }))
    expect(await screen.findByText('You are a member')).toBeInTheDocument()
    expect(calls(fetchMock)).toContain('GET /api/groups/mine')
    await userEvent.click(screen.getByRole('button', { name: 'Owned' }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => url.pathname === '/api/groups/mine' && url.searchParams.get('relation') === 'OWNER',
        ),
      ).toBe(true),
    )
  })
})

describe('GroupDetail', () => {
  const path = `/boards/activities/groups/${ID}`
  const pattern = '/boards/activities/groups/:groupId'

  it('lets a Student request to join, hiding coordination until approval', async () => {
    let view = group()
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/groups/${ID}/memberships` && init.method === 'POST') {
        view = group({ viewerRelation: 'PENDING' })
        return [201, { id: 'r1' }]
      }
      if (url.pathname === `/api/groups/${ID}`) return [200, view]
      return [404, null]
    })
    inShell(<GroupDetail />, path, pattern)
    expect(
      await screen.findByText(/coordination details appear only after the owner approves/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Private coordination' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Request to join' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Request sent. Selamawit Haile has been notified.',
    )
    expect(calls(fetchMock)).toContain(`POST /api/groups/${ID}/memberships`)
    expect(await screen.findByRole('button', { name: 'Withdraw request' })).toBeInTheDocument()
  })

  it('explains why a viewer cannot join', async () => {
    serve((url) =>
      url.pathname === `/api/groups/${ID}` ? [200, group({ joinBlock: 'FULL', occupancy: 5 })] : [404, null],
    )
    inShell(<GroupDetail />, path, pattern)
    expect(await screen.findByText(/This group is full/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request to join' })).not.toBeInTheDocument()
  })

  it('shows coordination and members to an accepted member, who may leave after confirming', async () => {
    let view = group({ viewerRelation: 'MEMBER', coordinationDetails: 'Library room 2', members })
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/groups/${ID}/departure` && init.method === 'POST') {
        view = group()
        return [204, null]
      }
      if (url.pathname === `/api/groups/${ID}`) return [200, view]
      return [404, null]
    })
    inShell(<GroupDetail />, path, pattern)
    const coordination = await screen.findByRole('region', { name: 'Private coordination' })
    expect(within(coordination).getByText('Library room 2')).toBeInTheDocument()
    expect(screen.getByText('Owner and members · 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Leave group' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm leave' }))
    expect(await screen.findByRole('status')).toHaveTextContent('You left the group.')
    expect(calls(fetchMock)).toContain(`POST /api/groups/${ID}/departure`)
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Private coordination' })).not.toBeInTheDocument(),
    )
  })

  it('tells the owner they cannot leave and links to Manage group', async () => {
    serve((url) =>
      url.pathname === `/api/groups/${ID}`
        ? [200, group({ viewerRelation: 'OWNER', members, pendingCount: 1 })]
        : [404, null],
    )
    inShell(<GroupDetail />, path, pattern, owner)
    expect(await screen.findByText(/As the owner you cannot leave/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Leave group' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage group' })).toHaveAttribute('href', `${path}/manage`)
  })

  it('lets the proposed member accept an ownership offer', async () => {
    const transfer = {
      id: 't1',
      group: {
        id: ID,
        title: 'Algorithms study circle',
        state: 'OPEN' as const,
        occupancy: 2,
        maxOccupancy: 5,
      },
      fromOwner: ownerCard,
      toMember: otherCard,
      state: 'PENDING' as const,
      createdAt: new Date().toISOString(),
      decidedAt: null,
      viewerSide: 'RECIPIENT' as const,
    }
    const fetchMock = serve((url, init) => {
      if (url.pathname === '/api/group-transfers/t1/acceptance' && init.method === 'POST') {
        return [200, { ...transfer, state: 'ACCEPTED' }]
      }
      if (url.pathname === `/api/groups/${ID}`) {
        return [200, group({ viewerRelation: 'MEMBER', members, pendingTransfer: transfer })]
      }
      return [404, null]
    })
    inShell(<GroupDetail />, path, pattern)
    const offer = await screen.findByRole('region', { name: 'Ownership offer' })
    expect(offer).toHaveTextContent('Selamawit Haile has offered you ownership')
    await userEvent.click(within(offer).getByRole('button', { name: 'Accept ownership' }))
    expect(await screen.findByRole('status')).toHaveTextContent('You now own this group.')
    expect(calls(fetchMock)).toContain('POST /api/group-transfers/t1/acceptance')
  })
})

describe('ManageGroup', () => {
  const path = `/boards/activities/groups/${ID}/manage`
  const pattern = '/boards/activities/groups/:groupId/manage'

  function request(overrides: Partial<MembershipView> = {}): MembershipView {
    return {
      id: 'r1',
      groupId: ID,
      member: card('00000000-0000-4000-8000-000000000004', 'Hana Girma'),
      state: 'PENDING',
      requestedAt: new Date().toISOString(),
      joinedAt: null,
      approveBlock: null,
      ...overrides,
    }
  }

  it('approves a join request and explains one that cannot be approved', async () => {
    const blocked = request({
      id: 'r2',
      member: card('00000000-0000-4000-8000-000000000005', 'Abel Tesfaye'),
      approveBlock: 'REQUESTER_INELIGIBLE',
    })
    const fetchMock = serve((url, init) => {
      if (url.pathname === '/api/group-memberships/r1/approval' && init.method === 'POST') {
        return [200, request({ state: 'ACCEPTED' })]
      }
      if (url.pathname === `/api/groups/${ID}/join-requests`) return [200, page([request(), blocked])]
      if (url.pathname === `/api/groups/${ID}`) {
        return [200, group({ viewerRelation: 'OWNER', members, pendingCount: 2 })]
      }
      return [404, null]
    })
    inShell(<ManageGroup />, path, pattern, owner)

    const hana = await screen.findByRole('listitem', { name: 'Request from Hana Girma' })
    const abel = screen.getByRole('listitem', { name: 'Request from Abel Tesfaye' })
    expect(within(abel).getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(abel).toHaveTextContent('This member can no longer join groups.')

    await userEvent.click(within(hana).getByRole('button', { name: 'Approve' }))
    const requests = screen.getByRole('region', { name: 'Join requests' })
    expect(await within(requests).findByRole('status')).toHaveTextContent('Hana Girma is now a member')
    expect(calls(fetchMock)).toContain('POST /api/group-memberships/r1/approval')
  })

  it('offers ownership to an accepted member', async () => {
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/groups/${ID}/transfers` && init.method === 'POST') {
        return [201, { id: 't1', toMember: otherCard }]
      }
      if (url.pathname === `/api/groups/${ID}/join-requests`) return [200, page([])]
      if (url.pathname === `/api/groups/${ID}`) return [200, group({ viewerRelation: 'OWNER', members })]
      return [404, null]
    })
    inShell(<ManageGroup />, path, pattern, owner)
    const ownership = await screen.findByRole('region', { name: 'Ownership' })
    expect(within(ownership).getByLabelText('New owner')).toHaveValue(other.accountId)
    await userEvent.click(within(ownership).getByRole('button', { name: 'Offer ownership' }))
    expect(await within(ownership).findByRole('status')).toHaveTextContent(
      'Ownership offered to Dawit Mengistu',
    )
    const post = fetchMock.mock.calls.find(([url]) => url.pathname === `/api/groups/${ID}/transfers`)
    expect(JSON.parse(String(post?.[1].body))).toEqual({ memberId: other.accountId })
  })

  it('is only for the owner of an open group', async () => {
    serve((url) =>
      url.pathname === `/api/groups/${ID}`
        ? [200, group({ viewerRelation: 'MEMBER', members })]
        : [404, null],
    )
    inShell(<ManageGroup />, path, pattern)
    expect(await screen.findByText(/Only the owner/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Join requests' })).not.toBeInTheDocument()
  })
})

describe('NewGroup', () => {
  it('creates a group and opens it with a notice', async () => {
    const fetchMock = serve((url, init) =>
      url.pathname === '/api/groups' && init.method === 'POST'
        ? [201, group({ viewerRelation: 'OWNER', occupancy: 1 })]
        : [404, null],
    )
    inShell(<NewGroup />, '/boards/activities/new', '/boards/activities/new', owner)
    await userEvent.type(screen.getByLabelText(/Name/), 'Algorithms study circle')
    await userEvent.type(screen.getByLabelText(/Description/), 'Weekly practice, Saturdays 10:00.')
    await userEvent.click(screen.getByRole('button', { name: /Create group/ }))
    expect(await screen.findByTestId('location')).toHaveTextContent(`/boards/activities/groups/${ID}`)
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init.body))).toMatchObject({ title: 'Algorithms study circle', maxOccupancy: 5 })
  })
})

describe('Notifications', () => {
  it('opens the group from a group notice', async () => {
    const notice: NotificationView = {
      id: 'n1',
      type: 'GROUP_REQUEST',
      actorId: other.accountId,
      actorName: 'Dawit Mengistu',
      targetType: 'GROUP',
      targetId: ID,
      unread: true,
      createdAt: new Date().toISOString(),
    }
    serve((url) => {
      if (url.pathname === '/api/notifications') return [200, page([notice])]
      if (url.pathname === '/api/notifications/unread-count') return [200, { count: 1 }]
      if (url.pathname === '/api/notifications/n1/read') return [204, null]
      return [404, null]
    })
    inShell(<Notifications />, '/notifications', '/notifications', owner)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open notification from Dawit Mengistu' }),
    )
    expect(await screen.findByTestId('location')).toHaveTextContent(`/boards/activities/groups/${ID}`)
  })
})
