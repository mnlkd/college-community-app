import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  accessTokenFor,
  accounts,
  callApi,
  removeThrowawayAccount,
  resetFactors,
  seedPassword,
  signInAdministrator,
  signInWithPassword,
  sql,
  throwawayEmail,
  registerThrowawayMember,
} from './support'

// Moderation and audit (Batch 5): Report Content (UC-23), Moderate Reported Content (UC-24) and the
// audit log (NFR-7). A throwaway Student writes two posts; the seeded Student reports both; the
// first upheld violation gives a warning and the second a 14-day restriction.

test.describe.configure({ mode: 'serial' })

const password = 'throwaway e2e password value'
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const offender = { email: throwawayEmail(), name: `E2E Offender ${run}` }
const factor = { secret: null as string | null, used: { value: 0 } }
const postIds: string[] = []
let offenderToken = ''
let reporterToken = ''

async function memberPage(browser: Browser, email: string, secret = seedPassword()): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await signInWithPassword(page, email, secret)
  await expect(page).toHaveURL(/\/home$/)
  return page
}

async function createPost(body: string): Promise<string> {
  const created = await callApi(offenderToken, 'POST', '/posts', { body, tags: [] })
  expect(created.status).toBe(201)
  const id = (created.body as { id: string }).id
  postIds.push(id)
  return id
}

async function pendingReportOn(targetId: string): Promise<string> {
  const mine = await callApi(reporterToken, 'GET', '/reports/mine')
  const items = (mine.body as { items: { id: string; targetId: string; state: string }[] }).items
  const report = items.find((item) => item.targetId === targetId && item.state === 'PENDING')
  if (!report) throw new Error('The report was not found in the reporter history')
  return report.id
}

async function decide(admin: Page, reportId: string, action: string, reason: string) {
  await admin.goto(`/admin/moderation/${reportId}`)
  await expect(admin.getByRole('heading', { name: `Review post by ${offender.name}` })).toBeVisible()
  await admin.getByLabel(/Decision reason/).fill(reason)
  await admin.getByRole('button', { name: action }).click()
  await admin.getByRole('dialog').getByRole('button', { name: action }).click()
  await expect(admin).toHaveURL(/\/admin\/moderation$/)
}

test.beforeAll(async () => {
  await resetFactors(accounts.firstAdmin)
  const registered = await registerThrowawayMember(offender.email, password, {
    kind: 'STUDENT_OR_STAFF',
    displayName: offender.name,
    programme: 'COMPUTER_SCIENCE',
    graduationYear: new Date().getUTCFullYear() + 1,
  })
  expect(registered.status).toBe(201)
  offenderToken = registered.token
  reporterToken = await accessTokenFor(accounts.student, seedPassword())
})

test.afterAll(async () => {
  if (postIds.length > 0) {
    // Evidence rows cascade; audit records keep their outcome with the report reference removed.
    await sql('DELETE FROM app.report WHERE target_id = ANY($1::uuid[])', [postIds])
  }
  await removeThrowawayAccount(offender.email, password)
})

test('a member reports a post; upholding warns, a second upheld violation restricts, and both are audited', async ({
  browser,
}) => {
  test.slow()
  const first = await createPost(`Buy followers cheap ${run}`)
  const second = await createPost(`Second advert ${run}`)

  // Report Content (UC-23) through the screens.
  const reporter = await memberPage(browser, accounts.student)
  await reporter.goto(`/posts/${first}`)
  await reporter.getByRole('link', { name: 'Report this post' }).click()
  await expect(reporter.getByRole('heading', { name: 'Report this post' })).toBeVisible()
  await expect(reporter.getByText(`Buy followers cheap ${run}`)).toBeVisible()
  await reporter.getByLabel(/Community guideline/).selectOption('SPAM')
  await reporter.getByLabel(/Additional context/).fill('Advertising in the feed.')
  await reporter.getByRole('button', { name: 'Submit report' }).click()
  await expect(reporter.getByText('Thank you. An Administrator will review it.')).toBeVisible()
  await reporter.getByRole('link', { name: 'View my report history' }).click()
  await expect(reporter.getByRole('heading', { name: 'My report history' })).toBeVisible()
  await expect(reporter.getByText('Advertising in the feed.').first()).toBeVisible()

  // A second pending report on the same post is refused.
  await reporter.goto(`/posts/${first}`)
  await reporter.getByRole('link', { name: 'Report this post' }).click()
  await reporter.getByLabel(/Community guideline/).selectOption('HARASSMENT')
  await reporter.getByRole('button', { name: 'Submit report' }).click()
  await expect(reporter.getByText('You already have a pending report about this item.')).toBeVisible()

  // Moderate Reported Content (UC-24): the first upheld violation is a warning.
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  await signInAdministrator(admin, accounts.firstAdmin, factor)
  await admin.getByRole('link', { name: 'Moderation' }).click()
  await expect(admin.getByRole('heading', { name: 'Moderation' })).toBeVisible()
  const firstReport = await pendingReportOn(first)
  await admin.goto(`/admin/moderation/${firstReport}`)
  await expect(admin.getByText(`Buy followers cheap ${run}`).first()).toBeVisible()
  await decide(admin, firstReport, 'Hide content and issue warning', `E2E spam ${run}`)
  await expect(admin.getByText('Content hidden and a private warning issued.')).toBeVisible()

  // The post is hidden from the community; the author sees the warning on Home.
  await reporter.goto(`/posts/${first}`)
  await expect(reporter.getByRole('heading', { name: 'Post unavailable' })).toBeVisible()
  const author = await memberPage(browser, offender.email, password)
  const warning = author.getByRole('region', { name: 'Moderation warning' })
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Dismiss warning' }).click()
  await expect(warning).toHaveCount(0)

  // A second distinct upheld violation restricts posting for 14 days.
  const filed = await callApi(reporterToken, 'POST', '/reports', {
    targetType: 'POST',
    targetId: second,
    reason: 'SPAM',
  })
  expect(filed.status).toBe(201)
  const secondReport = await pendingReportOn(second)
  await decide(admin, secondReport, 'Hide content and restrict posting', `E2E repeat ${run}`)
  await expect(admin.getByText(/posting and commenting restricted until/)).toBeVisible()

  await author.reload()
  const restriction = author.getByRole('region', { name: 'Posting restriction' })
  await expect(restriction).toContainText('Posting and commenting restricted until')
  await expect(author.getByRole('link', { name: 'Write a post' })).toHaveCount(0)
  await author.goto('/settings')
  await expect(author.getByRole('list', { name: 'Consequences' }).getByRole('listitem')).toHaveCount(2)

  // The reporter's history shows the outcome.
  await reporter.goto('/reports')
  await expect(reporter.getByText(/upheld your report/).first()).toBeVisible()

  // Both decisions are in the audit log, newest first, with their outcomes.
  await admin.getByRole('link', { name: 'Audit log' }).first().click()
  await admin.getByLabel('Action').selectOption('REPORT_DECIDED')
  await admin.getByRole('button', { name: 'Apply filters' }).click()
  const records = admin.getByRole('list', { name: 'Audit records' }).getByRole('listitem')
  await expect(records.filter({ hasText: `E2E repeat ${run}` })).toContainText('Upheld · restriction')
  await expect(records.filter({ hasText: `E2E spam ${run}` })).toContainText('Upheld · warning')

  await Promise.all([reporter.context().close(), author.context().close(), adminContext.close()])
})
