import type {
  ActorContextView,
  AuditRecordView,
  ConsequenceView,
  MemberCardView,
  Page,
  PostView,
  ReportDetailView,
  ReportView,
} from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminAudit } from '../src/admin/AuditLog'
import { AdminModeration, AdminReportDecision } from '../src/admin/Moderation'
import { configureApi, createQueryClient } from '../src/api'
import { ReportContent, ReportHistory } from '../src/features/moderation/Reports'
import { ModerationBanners, activeRestriction } from '../src/features/moderation/Standing'
import { canOpenNotice } from '../src/features/notifications/Notifications'
import { PostCard } from '../src/features/posts/content'

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

const pendingAlumnus: ActorContextView = { ...student, role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' }

const admin: ActorContextView = {
  ...student,
  accountId: '00000000-0000-4000-8000-0000000000ad',
  kind: 'ADMIN',
  role: null,
  mfaVerified: true,
}

const card = (name: string, id = '00000000-0000-4000-8000-000000000002'): MemberCardView => ({
  memberId: id,
  displayName: name,
  role: 'STUDENT',
  alumniStatus: null,
  pictureUrl: null,
  deleted: false,
})

const POST_ID = '00000000-0000-4000-8000-0000000000a1'
const REPORT_ID = 'abcdef12-0000-4000-8000-0000000000b1'

function post(overrides: Partial<PostView> = {}): PostView {
  return {
    id: POST_ID,
    author: card('Hana Tesfaye'),
    body: 'Buy cheap followers now.',
    images: [],
    tags: [],
    state: 'VISIBLE',
    version: 1,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    saveCount: 0,
    likedByMe: false,
    savedByMe: false,
    isOwn: false,
    createdAt: new Date().toISOString(),
    editedAt: null,
    ...overrides,
  }
}

const page = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 20, total: items.length })

function Where() {
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  return (
    <>
      <p data-testid="location">{location.pathname + location.search}</p>
      {notice && <p data-testid="notice">{notice}</p>}
    </>
  )
}

function inShell(element: ReactNode, path: string, pattern: string, actor = student, state?: unknown) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter
        initialEntries={[{ pathname: path.split('?')[0], search: path.split('?')[1] ?? '', state }]}
      >
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
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const bodyOf = (fetchMock: ReturnType<typeof serve>, path: string) => {
  const call = fetchMock.mock.calls.find(([url, init]) => url.pathname === path && init.method === 'POST')
  return call ? (JSON.parse(String(call[1].body)) as unknown) : undefined
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  configureApi({ getAccessToken: async () => 'token', onUnauthenticated: () => undefined })
})

const filed: ReportView = {
  id: REPORT_ID,
  targetType: 'POST',
  targetId: POST_ID,
  reason: 'SPAM',
  details: null,
  state: 'PENDING',
  createdAt: new Date().toISOString(),
  decidedAt: null,
}

describe('report link', () => {
  it('offers Report on another member’s post and not on my own', () => {
    serve(() => [404, null])
    const { unmount } = inShell(<PostCard post={post()} actor={student} />, '/home', '/home')
    expect(screen.getByRole('link', { name: 'Report this post' })).toHaveAttribute(
      'href',
      `/reports/new?targetType=POST&targetId=${POST_ID}`,
    )
    unmount()
    inShell(<PostCard post={post({ isOwn: true })} actor={student} />, '/home', '/home')
    expect(screen.queryByRole('link', { name: 'Report this post' })).not.toBeInTheDocument()
  })

  it('is not offered to an unverified Alumni member', () => {
    serve(() => [404, null])
    inShell(<PostCard post={post()} actor={pendingAlumnus} />, '/home', '/home')
    expect(screen.queryByRole('link', { name: 'Report this post' })).not.toBeInTheDocument()
  })
})

describe('ReportContent', () => {
  const path = `/reports/new?targetType=POST&targetId=${POST_ID}`
  const context = { back: `/posts/${POST_ID}`, author: 'Hana Tesfaye', excerpt: 'Buy cheap followers now.' }

  it('requires a guideline, submits the report and links to the history', async () => {
    const fetchMock = serve((url) => (url.pathname === '/api/reports' ? [201, filed] : [404, null]))
    inShell(<ReportContent />, path, '/reports/new', student, context)
    expect(screen.getByText('Buy cheap followers now.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    expect(screen.getByText('Choose the guideline this breaks')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await userEvent.selectOptions(screen.getByLabelText(/Community guideline/), 'SPAM')
    await userEvent.type(screen.getByLabelText(/Additional context/), '  Repeated advert  ')
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    expect(await screen.findByText(/An Administrator will review it/)).toBeInTheDocument()
    expect(bodyOf(fetchMock, '/api/reports')).toEqual({
      targetType: 'POST',
      targetId: POST_ID,
      reason: 'SPAM',
      details: 'Repeated advert',
    })
    expect(screen.getByRole('link', { name: 'View my report history' })).toHaveAttribute('href', '/reports')
    expect(screen.getByRole('link', { name: 'Back to the post' })).toHaveAttribute(
      'href',
      `/posts/${POST_ID}`,
    )
  })

  it('explains a duplicate pending report', async () => {
    serve(() => [409, { error: { code: 'DUPLICATE', message: 'Duplicate', fields: null } }])
    inShell(<ReportContent />, path, '/reports/new', student, context)
    await userEvent.selectOptions(screen.getByLabelText(/Community guideline/), 'HARASSMENT')
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    expect(await screen.findByText('You already have a pending report about this item.')).toBeInTheDocument()
  })

  it('does not offer the form to an unverified Alumni member', () => {
    serve(() => [404, null])
    inShell(<ReportContent />, path, '/reports/new', pendingAlumnus)
    expect(screen.queryByRole('button', { name: 'Submit report' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My report history' })).toHaveAttribute('href', '/reports')
  })
})

describe('ReportHistory', () => {
  it('lists my reports with their outcome', async () => {
    serve((url) =>
      url.pathname === '/api/reports/mine'
        ? [
            200,
            page([
              { ...filed, state: 'UPHELD', decidedAt: new Date().toISOString() },
              { ...filed, id: 'other', targetType: 'COMMENT', state: 'DISMISSED' },
            ]),
          ]
        : [404, null],
    )
    inShell(<ReportHistory />, '/reports', '/reports')
    const upheld = await screen.findByRole('article', { name: 'Post report' })
    expect(within(upheld).getByText('Upheld')).toBeInTheDocument()
    expect(within(upheld).getByText(/content is hidden/)).toBeInTheDocument()
    const dismissed = screen.getByRole('article', { name: 'Comment report' })
    expect(within(dismissed).getByText(/found no guideline violation/)).toBeInTheDocument()
  })
})

describe('moderation banners', () => {
  const warning: ConsequenceView = {
    id: 'w1',
    kind: 'WARNING',
    targetType: 'COMMENT',
    targetId: POST_ID,
    decidedAt: new Date().toISOString(),
    restrictUntil: null,
  }
  const restriction: ConsequenceView = {
    ...warning,
    id: 'r1',
    kind: 'RESTRICTION',
    targetType: 'POST',
    restrictUntil: new Date(Date.now() + 86_400_000).toISOString(),
  }

  it('shows the warning until dismissed and remembers the dismissal', async () => {
    serve((url) => (url.pathname === '/api/consequences/mine' ? [200, [warning]] : [404, null]))
    const { unmount } = inShell(<ModerationBanners actor={student} />, '/home', '/home')
    const banner = await screen.findByRole('region', { name: 'Moderation warning' })
    expect(within(banner).getByText(/report on your comment/)).toBeInTheDocument()
    await userEvent.click(within(banner).getByRole('button', { name: 'Dismiss warning' }))
    expect(screen.queryByRole('region', { name: 'Moderation warning' })).not.toBeInTheDocument()
    unmount()

    inShell(<ModerationBanners actor={student} />, '/home', '/home')
    await waitFor(() => expect(screen.queryByText(/Loading/)).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Moderation warning' })).not.toBeInTheDocument()
  })

  it('shows an active restriction and ignores an ended one', async () => {
    const ended = { ...restriction, id: 'r0', restrictUntil: new Date(Date.now() - 1000).toISOString() }
    expect(activeRestriction([ended])).toBeNull()
    expect(activeRestriction([restriction, ended])?.id).toBe('r1')
    serve((url) => (url.pathname === '/api/consequences/mine' ? [200, [restriction, warning]] : [404, null]))
    inShell(<ModerationBanners actor={student} />, '/home', '/home')
    const banner = await screen.findByRole('region', { name: 'Posting restriction' })
    expect(within(banner).getByText(/Posting and commenting restricted until/)).toBeInTheDocument()
  })
})

describe('notifications', () => {
  it('opens report notices', () => {
    expect(
      canOpenNotice({
        id: 'n',
        type: 'REPORT_OUTCOME',
        targetType: 'REPORT',
        targetId: REPORT_ID,
        actorId: null,
        actorName: null,
        unread: true,
        createdAt: new Date().toISOString(),
      }),
    ).toBe(true)
  })
})

function detail(overrides: Partial<ReportDetailView> = {}): ReportDetailView {
  return {
    ...filed,
    excerpt: 'Buy cheap followers now.',
    author: card('Hana Tesfaye'),
    reporter: card('Abel Girma', '00000000-0000-4000-8000-000000000003'),
    authorPriorViolations: 0,
    evidence: { snapshotText: 'Buy cheap followers now.', images: [] },
    evidenceExpired: false,
    consequencePreview: 'WARNING',
    otherPendingReports: 1,
    postId: POST_ID,
    decision: null,
    ...overrides,
  }
}

describe('AdminModeration', () => {
  it('lists pending reports with the private reporter and links to the review', async () => {
    const fetchMock = serve((url) =>
      url.pathname === '/api/admin/reports' ? [200, page([detail()])] : [404, null],
    )
    inShell(<AdminModeration />, '/admin/moderation', '/admin/moderation', admin)
    const row = await screen.findByRole('article', { name: /Report RPT-ABCDEF12/ })
    expect(within(row).getByText('Abel Girma')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      `/admin/moderation/${REPORT_ID}`,
    )
    expect(fetchMock.mock.calls[0]?.[0].searchParams.get('state')).toBe('PENDING')
  })

  it('uses the tab in the address', async () => {
    const fetchMock = serve(() => [200, page([])])
    inShell(<AdminModeration />, '/admin/moderation?state=dismissed', '/admin/moderation', admin)
    expect(await screen.findByText('No dismissed reports.')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0]?.[0].searchParams.get('state')).toBe('DISMISSED')
  })
})

describe('AdminReportDecision', () => {
  const path = `/admin/moderation/${REPORT_ID}`

  it('requires a reason, confirms and upholds with a warning', async () => {
    const fetchMock = serve((url) => {
      if (url.pathname === `/api/admin/reports/${REPORT_ID}/decision`) {
        return [
          200,
          {
            reportId: REPORT_ID,
            state: 'UPHELD',
            outcome: 'UPHELD_WARNING',
            resolvedReports: 2,
            consequence: { kind: 'WARNING', restrictUntil: null },
            auditRecordId: 'a1',
          },
        ]
      }
      return url.pathname === `/api/admin/reports/${REPORT_ID}` ? [200, detail()] : [404, null]
    })
    inShell(<AdminReportDecision />, path, '/admin/moderation/:reportId', admin)
    expect(await screen.findByText(/non-expiring|does not expire/)).toBeInTheDocument()
    expect(screen.getByText(/other pending report on this item/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hide content and issue warning' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Decision reason/), 'Commercial spam.')
    await userEvent.click(screen.getByRole('button', { name: 'Hide content and issue warning' }))
    const dialog = screen.getByRole('dialog', { name: 'Uphold this report?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hide content and issue warning' }))

    expect(await screen.findByTestId('notice')).toHaveTextContent('private warning issued. 2 reports')
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/moderation')
    expect(bodyOf(fetchMock, `/api/admin/reports/${REPORT_ID}/decision`)).toEqual({
      decision: 'UPHELD',
      reason: 'Commercial spam.',
    })
  })

  it('dismisses', async () => {
    const fetchMock = serve((url) => {
      if (url.pathname.endsWith('/decision')) {
        return [
          200,
          {
            reportId: REPORT_ID,
            state: 'DISMISSED',
            outcome: 'DISMISSED',
            resolvedReports: 1,
            consequence: null,
            auditRecordId: 'a1',
          },
        ]
      }
      return [200, detail({ consequencePreview: 'RESTRICTION', otherPendingReports: 0 })]
    })
    inShell(<AdminReportDecision />, path, '/admin/moderation/:reportId', admin)
    expect(
      await screen.findByRole('button', { name: 'Hide content and restrict posting' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss report' }))
    await userEvent.type(screen.getByLabelText(/Decision reason/), 'No violation.')
    const submit = screen.getAllByRole('button', { name: 'Dismiss report' }).at(-1)
    await userEvent.click(submit!)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss report' }))
    expect(await screen.findByTestId('notice')).toHaveTextContent('Report dismissed')
    expect(bodyOf(fetchMock, `/api/admin/reports/${REPORT_ID}/decision`)).toMatchObject({
      decision: 'DISMISSED',
    })
  })

  it('shows a decided report without the form, and expired evidence', async () => {
    serve(() => [
      200,
      detail({
        state: 'UPHELD',
        evidence: null,
        evidenceExpired: true,
        excerpt: null,
        consequencePreview: null,
        decision: {
          outcome: 'UPHELD_RESTRICTION',
          reason: 'Second violation.',
          decidedAt: new Date().toISOString(),
        },
      }),
    ])
    inShell(<AdminReportDecision />, path, '/admin/moderation/:reportId', admin)
    expect(await screen.findByText('Upheld · restriction')).toBeInTheDocument()
    expect(screen.getByText('Second violation.')).toBeInTheDocument()
    expect(screen.getByText(/Evidence expired/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Decision' })).not.toBeInTheDocument()
  })
})

describe('AdminAudit', () => {
  const record: AuditRecordView = {
    id: 'a1',
    occurredAt: new Date().toISOString(),
    action: 'REPORT_DECIDED',
    outcome: 'UPHELD_WARNING',
    actor: { adminId: admin.accountId, email: 'admin@hilcoeschool.com' },
    targetMember: { memberId: '00000000-0000-4000-8000-000000000002', displayName: 'Hana Tesfaye' },
    targetAdmin: null,
    reason: 'Commercial spam.',
    reportId: REPORT_ID,
    anonymized: false,
  }

  it('lists records and applies filters through the address', async () => {
    const fetchMock = serve((url) =>
      url.pathname === '/api/admin/audit-records' ? [200, page([record])] : [404, null],
    )
    inShell(<AdminAudit />, '/admin/audit', '/admin/audit', admin)
    const list = await screen.findByRole('list', { name: 'Audit records' })
    expect(within(list).getByText('Report decided')).toBeInTheDocument()
    expect(within(list).getByText('Upheld · warning')).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'RPT-ABCDEF12' })).toHaveAttribute(
      'href',
      `/admin/moderation/${REPORT_ID}`,
    )

    await userEvent.selectOptions(screen.getByLabelText('Action'), 'REPORT_DECIDED')
    await userEvent.type(screen.getByLabelText('From (UTC)'), '2026-10-01')
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => {
      const last = fetchMock.mock.calls.at(-1)?.[0]
      expect(last?.searchParams.get('action')).toBe('REPORT_DECIDED')
      expect(last?.searchParams.get('from')).toBe('2026-10-01')
    })
  })
})
