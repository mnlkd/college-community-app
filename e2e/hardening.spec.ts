import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { accounts, resetFactors, seedPassword, signInAdministrator, signInWithPassword } from './support'

// Release hardening (Batch 6): WCAG 2.1 AA checks on the core pages and keyboard operation
// (NFR-3) and narrow-screen layout (NFR-3). The NFR-4 load check is e2e/load (npm run e2e:load).

test.describe.configure({ mode: 'serial' })

const factor = { secret: null as string | null, used: { value: 0 } }

const SIGNED_OUT_PAGES = [
  '/login',
  '/admin/login',
  '/register',
  '/register/student',
  '/register/alumni',
  '/recover',
]
const MEMBER_PAGES = [
  '/home',
  '/home/trending',
  '/search?q=career',
  '/saved',
  '/posts/new',
  '/boards/opportunities',
  '/boards/activities',
  '/boards/mentorship',
  '/boards/mentorship/my-requests',
  '/notifications',
  '/reports',
  '/profile',
  '/settings',
]
const ADMIN_PAGES = [
  '/admin',
  '/admin/users',
  '/admin/users?tab=reviews',
  '/admin/moderation',
  '/admin/audit',
  '/admin/staff-emails',
  '/admin/administrators',
  '/admin/settings',
]

/** Waits until the page's main heading is shown and nothing in the main column is still loading. */
async function usable(page: Page): Promise<void> {
  await expect(page.locator('h1').first()).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

async function expectAccessible(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await usable(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const found = results.violations.map(
    (violation) =>
      `${path}: ${violation.id} (${violation.impact}) ${violation.help}\n    ` +
      violation.nodes
        .slice(0, 4)
        .map(
          (node) =>
            `${node.html.slice(0, 160)}\n      ${node.failureSummary?.split('\n').slice(-1)[0] ?? ''}`,
        )
        .join('\n    '),
  )
  expect.soft(found, found.join('\n')).toEqual([])
}

async function expectNoSideScroll(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await usable(page)
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth')
  expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0)
}

async function memberPage(browser: Browser, email: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(viewport ? { viewport } : {})
  const page = await context.newPage()
  await page.goto('/login')
  await signInWithPassword(page, email, seedPassword())
  await expect(page).toHaveURL(/\/home$/)
  return page
}

test.beforeAll(async () => {
  await resetFactors(accounts.firstAdmin)
})

test('signed-out pages meet WCAG 2.1 AA checks', async ({ page }) => {
  for (const path of SIGNED_OUT_PAGES) await expectAccessible(page, path)
})

test('member pages meet WCAG 2.1 AA checks and work from the keyboard', async ({ browser }) => {
  test.slow()
  const page = await memberPage(browser, accounts.student)
  for (const path of MEMBER_PAGES) await expectAccessible(page, path)

  // The skip link is the first stop and moves focus to the page content.
  await page.goto('/home')
  await usable(page)
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await page.context().close()
})

test('Administrator pages meet WCAG 2.1 AA checks', async ({ page }) => {
  test.slow()
  await signInAdministrator(page, accounts.firstAdmin, factor)
  for (const path of ADMIN_PAGES) await expectAccessible(page, path)
})

test('core pages fit a 375 px screen and the navigation opens from the top bar', async ({ browser }) => {
  test.slow()
  const page = await memberPage(browser, accounts.student, { width: 375, height: 812 })
  for (const path of MEMBER_PAGES) await expectNoSideScroll(page, path)

  await page.goto('/home')
  await usable(page)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation' })
  await drawer.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page
    .getByRole('banner')
    .getByRole('link', { name: /^Notifications/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await page.context().close()

  const admin = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const adminPage = await admin.newPage()
  await signInAdministrator(adminPage, accounts.firstAdmin, factor)
  for (const path of ADMIN_PAGES) await expectNoSideScroll(adminPage, path)
  await admin.close()
})
