import type { ActorContextView, DashboardSummaryView } from '@hilcoe/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from '../src/admin/Dashboard'
import { configureApi, createQueryClient } from '../src/api'

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

function summaryFor(windowDays: 7 | 30): DashboardSummaryView {
  const dailyActivity = Array.from({ length: windowDays }, (_, index) => ({
    date: new Date(Date.UTC(2026, 9, 1 - (windowDays - 1) + index)).toISOString().slice(0, 10),
    posts: index === windowDays - 1 ? 2 : 0,
    comments: index === windowDays - 1 ? 3 : 0,
  }))
  return {
    windowDays,
    generatedAt: '2026-10-01T09:00:00.000Z',
    from: dailyActivity[0]!.date,
    to: '2026-10-01',
    accountCounts: {
      byRole: { STUDENT: 4, STAFF: 1, ALUMNI: 3 },
      byAlumniStatus: { SELF_REPORTED: 1, VERIFIED: 2, FLAGGED: 0 },
      byState: { ACTIVE: 7, DISABLED: 1, DELETED: 0 },
      communityAccounts: 8,
      administrators: 2,
    },
    activeMembers: windowDays === 7 ? 4 : 7,
    dailyActivity,
    totalPosts: 2,
    totalComments: 3,
    pendingReports: 3,
    pendingAlumniReviews: 1,
    pendingGraduationRequests: 0,
    openOpportunities: 5,
    activeGroups: 1,
    activeMentorships: 2,
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={admin} />}>
            <Route path="/admin" element={<Dashboard />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  configureApi({ getAccessToken: async () => 'token', onUnauthenticated: () => undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Administrator dashboard', () => {
  it('shows the 30-day aggregates by default and links each queue', async () => {
    const fetchMock = vi.fn(async (url: URL) =>
      json(200, summaryFor(Number(url.searchParams.get('windowDays')) as 7 | 30)),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/admin')

    expect(await screen.findByTestId('stat-active-members')).toHaveTextContent('7')
    expect((fetchMock.mock.calls[0]![0] as URL).searchParams.get('windowDays')).toBe('30')
    expect(screen.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('stat-posts-comments')).toHaveTextContent('2 / 3')
    expect(screen.getByText('Accounts by role · total 10')).toBeInTheDocument()
    expect(screen.getByText('4 pending items')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review 3 content reports' })).toHaveAttribute(
      'href',
      '/admin/moderation',
    )
    expect(screen.getByRole('link', { name: 'Review 1 self-reported Alumni account' })).toHaveAttribute(
      'href',
      '/admin/users?tab=reviews',
    )
    expect(screen.getByText('5 open opportunities · 1 active group')).toBeInTheDocument()
    // The chart is described for screen readers by a table of the daily counts.
    expect(screen.getAllByRole('row')).toHaveLength(31)
  })

  it('switches to the 7-day window from the tabs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => json(200, summaryFor(Number(url.searchParams.get('windowDays')) as 7 | 30))),
    )
    const user = userEvent.setup()
    renderAt('/admin')
    await screen.findByTestId('stat-active-members')
    await user.click(screen.getByRole('link', { name: 'Last 7 days' }))
    await waitFor(() => expect(screen.getByTestId('stat-active-members')).toHaveTextContent('4'))
    expect(screen.getAllByRole('row')).toHaveLength(8)
  })

  it('downloads the CSV with the Administrator token and the server file name', async () => {
    const fetchMock = vi.fn(async (url: URL) =>
      url.pathname.endsWith('/export.csv')
        ? new Response('metric,window_days,utc_date,count\r\n', {
            status: 200,
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename="hilcoe-commons-aggregates-7d-2026-10-01.csv"',
            },
          })
        : json(200, summaryFor(7)),
    )
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:csv')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('hilcoe-commons-aggregates-7d-2026-10-01.csv')
      expect(this.href).toBe('blob:csv')
    })
    const user = userEvent.setup()
    renderAt('/admin?period=7')
    await screen.findByTestId('stat-active-members')
    await user.click(screen.getByRole('button', { name: 'Export aggregate CSV' }))

    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/api/admin/analytics/export.csv')
    expect(url.searchParams.get('windowDays')).toBe('7')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token')
    expect(createObjectURL).toHaveBeenCalledOnce()
  })

  it('shows the server message when the export is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) =>
        url.pathname.endsWith('/export.csv')
          ? json(429, {
              error: { code: 'RATE_LIMITED', message: 'Too many exports. Try again later.', fields: null },
            })
          : json(200, summaryFor(30)),
      ),
    )
    const user = userEvent.setup()
    renderAt('/admin')
    await screen.findByTestId('stat-active-members')
    await user.click(screen.getByRole('button', { name: 'Export aggregate CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many exports. Try again later.')
  })
})
