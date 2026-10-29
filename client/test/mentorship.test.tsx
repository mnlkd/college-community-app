import type {
  ActorContextView,
  MemberCardView,
  MentorProfileView,
  MentorSummaryView,
  MentorshipView,
  NotificationView,
  OwnMentorSettingsView,
  Page,
  ProfileView,
} from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi, createQueryClient } from '../src/api'
import { MentorAvailability } from '../src/features/mentorship/Availability'
import { MentorProfilePage, MentorshipBoard, RequestMentorship } from '../src/features/mentorship/Board'
import { MyRequests, OpenMentorship } from '../src/features/mentorship/MyRequests'
import { Notifications } from '../src/features/notifications/Notifications'

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

const yonasProfile: ProfileView = {
  memberId: alumnus.accountId,
  displayName: 'Yonas Bekele',
  role: 'ALUMNI',
  alumniStatus: 'VERIFIED',
  programme: null,
  bio: null,
  studyOrExpertise: null,
  graduationYear: 2019,
  currentPosition: 'Backend engineer',
  pictureUrl: null,
}

const studentCard: MemberCardView = {
  memberId: student.accountId,
  displayName: 'Selamawit Haile',
  role: 'STUDENT',
  alumniStatus: null,
  pictureUrl: null,
  deleted: false,
}

const yonasCard: MemberCardView = {
  memberId: alumnus.accountId,
  displayName: 'Yonas Bekele',
  role: 'ALUMNI',
  alumniStatus: 'VERIFIED',
  pictureUrl: null,
  deleted: false,
}

function mentor(overrides: Partial<MentorProfileView> = {}): MentorProfileView {
  return {
    mentor: yonasProfile,
    available: true,
    capacity: 3,
    activeCount: 1,
    introduction: 'Happy to help with backend work.',
    topics: ['Backend APIs', 'Career advice'],
    viewerMentorship: null,
    requestBlock: null,
    viewerActiveMentors: 0,
    ...overrides,
  }
}

function mentorship(overrides: Partial<MentorshipView> = {}): MentorshipView {
  const now = new Date().toISOString()
  return {
    id: 'm1',
    student: studentCard,
    mentor: yonasCard,
    topic: 'Backend APIs',
    note: 'I would like help designing my senior project API.',
    state: 'PENDING',
    requestedAt: now,
    decidedAt: null,
    updatedAt: now,
    viewerSide: 'MENTOR',
    studentActiveMentors: 1,
    acceptBlock: null,
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

describe('MentorshipBoard', () => {
  it('lists mentors with capacity and shows why a request is blocked', async () => {
    const full: MentorSummaryView = {
      ...mentor({ activeCount: 3, requestBlock: 'MENTOR_FULL' }),
      mentor: { ...yonasProfile, memberId: 'full', displayName: 'Meseret Alemu' },
    }
    const mine: MentorSummaryView = {
      ...mentor({ viewerMentorship: { id: 'm9', state: 'ACTIVE' }, requestBlock: 'OPEN_MENTORSHIP' }),
      mentor: { ...yonasProfile, memberId: 'mine', displayName: 'Hana Girma' },
    }
    const fetchMock = serve((url) => {
      if (url.pathname === '/api/boards/mentorship') return [200, page([mentor(), full, mine])]
      if (url.pathname === '/api/mentorships') return [200, page([])]
      return [404, null]
    })
    inShell(<MentorshipBoard />, '/boards/mentorship?open=1', '/boards/mentorship')

    const open = await screen.findByRole('article', { name: 'Yonas Bekele' })
    expect(within(open).getByRole('img', { name: '1 of 3 places filled' })).toBeInTheDocument()
    expect(within(open).queryByText('Your mentor')).not.toBeInTheDocument()
    // The whole card opens the mentor profile; nothing else on it is a link.
    expect(within(open).getAllByRole('link')).toHaveLength(1)
    expect(within(open).getByRole('link', { name: 'Yonas Bekele' })).toHaveAttribute(
      'href',
      `/boards/mentorship/mentors/${alumnus.accountId}`,
    )
    const closed = screen.getByRole('article', { name: 'Meseret Alemu' })
    expect(within(closed).getByRole('img', { name: '3 of 3 places filled' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('article', { name: 'Hana Girma' })).getByText('Your mentor'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open places' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(within(open).getByRole('button', { name: 'Show mentors for Career advice' }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            url.pathname === '/api/boards/mentorship' && url.searchParams.get('topic') === 'Career advice',
        ),
      ).toBe(true),
    )

    const boardCall = fetchMock.mock.calls.find(([url]) => url.pathname === '/api/boards/mentorship')
    expect(boardCall?.[0].searchParams.get('openOnly')).toBe('true')
  })
})

describe('MentorProfilePage', () => {
  const path = `/boards/mentorship/mentors/${alumnus.accountId}`
  const pattern = '/boards/mentorship/mentors/:mentorId'

  it('ends the places card with the request button', async () => {
    serve((url) => (url.pathname === `/api/mentors/${alumnus.accountId}` ? [200, mentor()] : [404, null]))
    inShell(<MentorProfilePage />, path, pattern)
    expect(await screen.findByText('1 of 3 filled · 2 open')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request mentorship' })).toHaveAttribute(
      'href',
      `${path}/request`,
    )
    expect(screen.queryByRole('region', { name: 'Mentor contacts' })).not.toBeInTheDocument()
    // A page of its own: the mentor in one line, linking to the full member profile.
    expect(screen.getByRole('heading', { name: 'Yonas Bekele' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View full profile' })).toHaveAttribute(
      'href',
      `/members/${alumnus.accountId}`,
    )
    expect(screen.getByRole('link', { name: 'Mentorship Board' })).toHaveAttribute(
      'href',
      '/boards/mentorship',
    )
  })

  it('shows a pending request with a withdraw action, and explains a blocked one', async () => {
    let view = mentor({ viewerMentorship: { id: 'm1', state: 'PENDING' }, requestBlock: 'OPEN_MENTORSHIP' })
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/mentors/${alumnus.accountId}`) return [200, view]
      if (url.pathname === '/api/mentorships/m1/withdrawal' && init.method === 'POST') {
        view = mentor()
        return [204, null]
      }
      return [404, null]
    })
    const { unmount } = inShell(<MentorProfilePage />, path, pattern)
    expect(await screen.findByText('Request pending')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Request mentorship' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw request' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Request withdrawn. Yonas Bekele')
    expect(calls(fetchMock)).toContain('POST /api/mentorships/m1/withdrawal')
    expect(await screen.findByRole('link', { name: 'Request mentorship' })).toBeInTheDocument()
    unmount()

    view = mentor({ activeCount: 3, requestBlock: 'MENTOR_FULL' })
    inShell(<MentorProfilePage />, path, pattern)
    expect(await screen.findByText(/This mentor has no open places/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Request mentorship' })).not.toBeInTheDocument()
  })

  it('replaces the button with the contacts once accepted, and ends after confirmation', async () => {
    const view = mentor({ viewerMentorship: { id: 'm1', state: 'ACTIVE' }, requestBlock: 'OPEN_MENTORSHIP' })
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/mentors/${alumnus.accountId}`) return [200, view]
      if (url.pathname === `/api/mentors/${alumnus.accountId}/contacts`)
        return [200, [{ kind: 'TELEGRAM', value: '@yonas' }]]
      if (url.pathname === '/api/mentorships/m1/end' && init.method === 'POST') return [204, null]
      return [404, null]
    })
    inShell(<MentorProfilePage />, path, pattern)
    const contacts = await screen.findByRole('region', { name: 'Mentor contacts' })
    expect(await within(contacts).findByText('@yonas')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Request mentorship' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'End mentorship' }))
    expect(calls(fetchMock)).not.toContain('POST /api/mentorships/m1/end')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm end' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Mentorship ended.')
    expect(calls(fetchMock)).toContain('POST /api/mentorships/m1/end')
  })
})

describe('RequestMentorship', () => {
  it('requires a note and returns to the mentor after sending', async () => {
    const fetchMock = serve((url, init) => {
      if (url.pathname === `/api/mentors/${alumnus.accountId}`) return [200, mentor()]
      if (url.pathname === `/api/mentors/${alumnus.accountId}/mentorships` && init.method === 'POST')
        return [201, mentorship({ id: 'new1', viewerSide: 'STUDENT' })]
      return [404, null]
    })
    inShell(
      <RequestMentorship />,
      `/boards/mentorship/mentors/${alumnus.accountId}/request`,
      '/boards/mentorship/mentors/:mentorId/request',
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(calls(fetchMock)).not.toContain(`POST /api/mentors/${alumnus.accountId}/mentorships`)

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Topic/ }), 'Career advice')
    await userEvent.type(screen.getByRole('textbox', { name: /Your note/ }), '  Help with interviews  ')
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/boards/mentorship/mentors/${alumnus.accountId}`,
      ),
    )
    const post = fetchMock.mock.calls.find(([, init]) => init.method === 'POST')
    expect(JSON.parse(post?.[1].body as string)).toEqual({
      topic: 'Career advice',
      note: 'Help with interviews',
    })
  })

  it('explains a blocked request instead of showing the form', async () => {
    serve((url) => {
      if (url.pathname === `/api/mentors/${alumnus.accountId}`)
        return [200, mentor({ requestBlock: 'STUDENT_LIMIT', viewerActiveMentors: 3 })]
      return [404, null]
    })
    inShell(
      <RequestMentorship />,
      `/boards/mentorship/mentors/${alumnus.accountId}/request`,
      '/boards/mentorship/mentors/:mentorId/request',
    )
    expect(await screen.findByText(/You already have 3 active mentors/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument()
  })
})

describe('MyRequests', () => {
  it('lets a mentor accept a pending request and reports it', async () => {
    let accepted = false
    const fetchMock = serve((url, init) => {
      if (url.pathname === '/api/mentorships') return [200, page(accepted ? [] : [mentorship()])]
      if (url.pathname === '/api/mentors/me')
        return [
          200,
          {
            configured: true,
            available: true,
            capacity: 3,
            introduction: null,
            topics: [],
            contacts: [{ kind: 'EMAIL', value: 'yonas@example.com' }],
            activeCount: 1,
            pendingCount: 1,
          } satisfies OwnMentorSettingsView,
        ]
      if (url.pathname === '/api/mentorships/m1/acceptance' && init.method === 'POST') {
        accepted = true
        return [200, mentorship({ state: 'ACTIVE' })]
      }
      return [404, null]
    })
    inShell(<MyRequests />, '/boards/mentorship/my-requests', '/boards/mentorship/my-requests', alumnus)

    const card = await screen.findByRole('article', { name: 'Mentorship with Selamawit Haile' })
    expect(within(card).getByText(/This Student has 1 of 3 active mentors/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My availability' })).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Accept' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Request accepted. Selamawit Haile has been notified',
    )
    expect(calls(fetchMock)).toContain('POST /api/mentorships/m1/acceptance')
    const list = fetchMock.mock.calls.find(([url]) => url.pathname === '/api/mentorships')
    expect(list?.[0].searchParams.get('side')).toBe('MENTOR')
    expect(list?.[0].searchParams.get('state')).toBe('PENDING')
  })

  it('disables Accept and explains why when the request cannot be accepted now', async () => {
    serve((url) => {
      if (url.pathname === '/api/mentorships')
        return [200, page([mentorship({ acceptBlock: 'STUDENT_LIMIT', studentActiveMentors: 3 })])]
      if (url.pathname === '/api/mentors/me')
        return [403, { error: { code: 'PERMISSION_DENIED', message: 'x' } }]
      return [404, null]
    })
    inShell(<MyRequests />, '/boards/mentorship/my-requests', '/boards/mentorship/my-requests', alumnus)
    const card = await screen.findByRole('article', { name: 'Mentorship with Selamawit Haile' })
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(within(card).getByText(/The request stays pending/)).toBeInTheDocument()
  })

  it('shows an active Student their mentor contacts and ends after confirmation', async () => {
    const active = mentorship({ state: 'ACTIVE', viewerSide: 'STUDENT', decidedAt: new Date().toISOString() })
    const fetchMock = serve((url, init) => {
      if (url.pathname === '/api/mentorships') return [200, page([active])]
      if (url.pathname === `/api/mentors/${alumnus.accountId}/contacts`)
        return [200, [{ kind: 'TELEGRAM', value: '@yonas' }]]
      if (url.pathname === '/api/mentorships/m1/end' && init.method === 'POST') return [204, null]
      return [404, null]
    })
    inShell(<MyRequests />, '/boards/mentorship/my-requests?tab=active', '/boards/mentorship/my-requests')

    const card = await screen.findByRole('article', { name: 'Mentorship with Yonas Bekele' })
    expect(await within(card).findByText('@yonas')).toBeInTheDocument()
    expect(screen.getByText(/Your active mentors · 1 of 3/)).toBeInTheDocument()

    await userEvent.click(within(card).getByRole('button', { name: 'End mentorship' }))
    expect(calls(fetchMock)).not.toContain('POST /api/mentorships/m1/end')
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm end' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Mentorship ended.')
    expect(calls(fetchMock)).toContain('POST /api/mentorships/m1/end')
  })

  it('reports a mentorship the viewer may not see as unavailable', async () => {
    serve(() => [404, { error: { code: 'NOT_FOUND', message: 'Not found' } }])
    inShell(
      <OpenMentorship />,
      '/boards/mentorship/requests/gone',
      '/boards/mentorship/requests/:mentorshipId',
    )
    expect(await screen.findByRole('heading', { name: 'Mentorship unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mentorship Board' })).toHaveAttribute(
      'href',
      '/boards/mentorship',
    )
  })
})

describe('OpenMentorship', () => {
  const at = (id: string, actor: ActorContextView) =>
    inShell(
      <OpenMentorship />,
      `/boards/mentorship/requests/${id}`,
      '/boards/mentorship/requests/:mentorshipId',
      actor,
    )

  it('takes a Student to the mentor page and a mentor to the matching My Requests tab', async () => {
    serve((url) => {
      if (url.pathname === '/api/mentorships/s1') return [200, mentorship({ viewerSide: 'STUDENT' })]
      if (url.pathname === '/api/mentorships/s2')
        return [200, mentorship({ viewerSide: 'STUDENT', state: 'DECLINED' })]
      if (url.pathname === '/api/mentorships/t1') return [200, mentorship()]
      if (url.pathname === '/api/mentorships/t2') return [200, mentorship({ state: 'ACTIVE' })]
      return [404, null]
    })
    const expected: [string, ActorContextView, string][] = [
      ['s1', student, `/boards/mentorship/mentors/${alumnus.accountId}`],
      ['s2', student, '/boards/mentorship/my-requests?tab=history'],
      ['t1', alumnus, '/boards/mentorship/my-requests?tab=requests'],
      ['t2', alumnus, '/boards/mentorship/my-requests?tab=mentees'],
    ]
    for (const [id, actor, location] of expected) {
      const { unmount } = at(id, actor)
      expect(await screen.findByTestId('location')).toHaveTextContent(location)
      unmount()
    }
  })
})

describe('MentorAvailability', () => {
  const unconfigured: OwnMentorSettingsView = {
    configured: false,
    available: false,
    capacity: 3,
    introduction: null,
    topics: [],
    contacts: [],
    activeCount: 2,
    pendingCount: 0,
  }

  it('requires a contact method and a valid capacity before saving', async () => {
    const fetchMock = serve((url, init) => {
      if (url.pathname === '/api/mentors/me' && init.method === 'PUT') {
        const body = JSON.parse(init.body as string) as OwnMentorSettingsView
        return [200, { ...unconfigured, ...body, configured: true }]
      }
      if (url.pathname === '/api/mentors/me') return [200, unconfigured]
      return [404, null]
    })
    inShell(
      <MentorAvailability />,
      '/boards/mentorship/availability',
      '/boards/mentorship/availability',
      alumnus,
    )

    const capacity = await screen.findByRole('spinbutton', { name: /Maximum active mentees/ })
    await userEvent.clear(capacity)
    await userEvent.type(capacity, '11')
    await userEvent.click(screen.getByRole('button', { name: 'Save availability' }))
    expect(await screen.findByText('Choose at least one contact method')).toBeInTheDocument()
    expect(screen.getByText('At most 10')).toBeInTheDocument()
    expect(calls(fetchMock)).not.toContain('PUT /api/mentors/me')

    await userEvent.clear(capacity)
    await userEvent.type(capacity, '4')
    await userEvent.type(screen.getByRole('textbox', { name: /Mentorship topics/ }), 'Backend APIs{Enter}')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Telegram' }))
    await userEvent.type(screen.getByRole('textbox', { name: /Telegram username to share/ }), '@yonas')
    await userEvent.click(screen.getByRole('button', { name: 'Save availability' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Availability saved.')
    const put = fetchMock.mock.calls.find(([, init]) => init.method === 'PUT')
    expect(JSON.parse(put?.[1].body as string)).toMatchObject({
      available: true,
      capacity: 4,
      topics: ['Backend APIs'],
      contacts: [{ kind: 'TELEGRAM', value: '@yonas' }],
    })
  })

  it('maps a server error on a contact value to that contact field', async () => {
    serve((url, init) => {
      if (url.pathname === '/api/mentors/me' && init.method === 'PUT')
        return [
          400,
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Check the highlighted fields',
              fields: { 'contacts.0.value': 'Enter a valid phone number' },
            },
          },
        ]
      if (url.pathname === '/api/mentors/me')
        return [200, { ...unconfigured, configured: true, contacts: [{ kind: 'PHONE', value: '+251 911' }] }]
      return [404, null]
    })
    inShell(
      <MentorAvailability />,
      '/boards/mentorship/availability',
      '/boards/mentorship/availability',
      alumnus,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Save availability' }))
    const phone = screen.getByRole('textbox', { name: /Phone number to share/ })
    expect(await screen.findByText('Enter a valid phone number')).toBeInTheDocument()
    expect(phone).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Notifications', () => {
  it('opens the mentorship a mentorship notice points at', async () => {
    const notice: NotificationView = {
      id: 'n1',
      type: 'MENTORSHIP_REQUEST',
      actorId: student.accountId,
      actorName: 'Selamawit Haile',
      targetType: 'MENTORSHIP',
      targetId: 'm1',
      unread: false,
      createdAt: new Date().toISOString(),
    }
    serve((url) => {
      if (url.pathname === '/api/notifications') return [200, page([notice])]
      if (url.pathname === '/api/notifications/unread-count') return [200, { count: 0 }]
      return [404, null]
    })
    inShell(<Notifications />, '/notifications', '/notifications', alumnus)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open notification from Selamawit Haile' }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/boards/mentorship/requests/m1'),
    )
  })
})
