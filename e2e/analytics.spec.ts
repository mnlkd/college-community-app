import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  accessTokenFor,
  accounts,
  callApi,
  resetFactors,
  seedPassword,
  signInAdministrator,
  sql,
} from './support'

// View Analytics and Export CSV (FR-11) and the Administrator queue counts (FR-12). The seeded
// Student writes a post and another member reports it; the dashboard, the CSV and the navigation
// badge count it.

test.describe.configure({ mode: 'serial' })

const factor = { secret: null as string | null, used: { value: 0 } }
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const postIds: string[] = []
let studentToken = ''
let reporterToken = ''

/** A seeded member other than the author: nobody may report their own post. */
const REPORTER = 'mahlet.tesfaye@hilcoeschool.com'

async function stat(page: Page, name: string): Promise<string> {
  return (await page.getByTestId(`stat-${name}`).textContent())?.trim() ?? ''
}

async function badge(page: Page, label: string): Promise<number> {
  const element = page.getByRole('navigation', { name: 'Administrator' }).getByTestId(`nav-badge-${label}`)
  if ((await element.count()) === 0) return 0
  return Number.parseInt((await element.textContent()) ?? '0', 10)
}

test.beforeAll(async () => {
  await resetFactors(accounts.admin)
  studentToken = await accessTokenFor(accounts.student, seedPassword())
  reporterToken = await accessTokenFor(REPORTER, seedPassword())
})

test.afterAll(async () => {
  if (postIds.length === 0) return
  await sql('DELETE FROM app.report WHERE target_id = ANY($1::uuid[])', [postIds])
  await sql('DELETE FROM app.post WHERE id = ANY($1::uuid[])', [postIds])
})

test('an Administrator views 7- and 30-day aggregates, exports them as CSV and sees the queue counts', async ({
  page,
}) => {
  test.slow()
  await signInAdministrator(page, accounts.admin, factor)
  await expect(page.getByRole('heading', { name: 'Administrator dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'Last 7 days' }).click()
  await expect(page).toHaveURL(/\/admin\?period=7$/)
  await expect(page.getByTestId('stat-posts-comments')).toBeVisible()
  const [postsBefore] = (await stat(page, 'posts-comments')).split(' / ').map(Number)
  const reportsBefore = Number(await stat(page, 'pending-reports'))

  // New activity today is counted on reload, and the pending report reaches the navigation badge.
  const created = await callApi(studentToken, 'POST', '/posts', { body: `Analytics check ${run}`, tags: [] })
  expect(created.status).toBe(201)
  const postId = (created.body as { id: string }).id
  postIds.push(postId)
  const filed = await callApi(reporterToken, 'POST', '/reports', {
    targetType: 'POST',
    targetId: postId,
    reason: 'SPAM',
  })
  expect(filed.status).toBe(201)

  await page.reload()
  await expect(page.getByTestId('stat-posts-comments')).toHaveText(new RegExp(`^${postsBefore! + 1} / `))
  await expect(page.getByTestId('stat-pending-reports')).toHaveText(String(reportsBefore + 1))
  await expect.poll(() => badge(page, 'moderation')).toBe(reportsBefore + 1)
  await expect(page.getByRole('link', { name: /^Review \d+ content reports?$/ })).toHaveAttribute(
    'href',
    '/admin/moderation',
  )

  // The CSV holds counts only: no names, emails or post text.
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export aggregate CSV' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^hilcoe-commons-aggregates-7d-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = await readFile((await download.path())!, 'utf8')
  const lines = csv.trimEnd().split('\r\n')
  expect(lines[0]).toBe('metric,window_days,utc_date,count')
  for (const line of lines.slice(1)) expect(line).toMatch(/^[a-z_]+,7,(\d{4}-\d{2}-\d{2})?,\d+$/)
  expect(lines).toContain(`posts,7,,${postsBefore! + 1}`)
  expect(lines).toContain(`pending_reports,7,,${reportsBefore + 1}`)
  expect(lines.filter((line) => line.startsWith('daily_posts,'))).toHaveLength(7)
  expect(csv).not.toContain('@')
  expect(csv).not.toContain(run)
  expect(csv).not.toContain('Selamawit')
})

test('a community member cannot open the Administrator dashboard', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(accounts.student)
  await page.getByLabel('Password').fill(seedPassword())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/home$/)
  const analytics = await callApi(studentToken, 'GET', '/admin/analytics')
  expect(analytics.status).toBe(403)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/login$/)
})
