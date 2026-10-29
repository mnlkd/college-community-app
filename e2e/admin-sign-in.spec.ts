import { expect, test } from '@playwright/test'
import { accounts, expectSignInPage, freshTotp, resetFactors, signInWithPassword } from './support'

test.describe('Sign In and Verify Authenticator Code (Administrator)', () => {
  test.beforeAll(async () => {
    await resetFactors(accounts.admin)
  })

  test('a signed-out visitor is sent to Administrator sign-in', async ({ page }) => {
    await page.goto('/admin')
    await expectSignInPage(page, true)
  })

  test('first sign-in enrolls an authenticator; later sign-ins ask for its code', async ({ page }) => {
    const used = { value: 0 }

    await page.goto('/admin/login')
    await signInWithPassword(page, accounts.admin)
    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible()

    // A password-only session cannot reach Administrator pages. Reloading starts a new enrollment.
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible()
    const secret = await page.getByTestId('totp-secret').inputValue()
    expect(secret).toMatch(/^[A-Z2-7]+=*$/)

    await page.getByLabel('Authenticator app code').fill('000000')
    await page.getByRole('button', { name: 'Verify and continue' }).click()
    await expect(page.getByRole('alert')).toContainText('That code is not correct.')

    await page.getByLabel('Authenticator app code').fill(await freshTotp(secret, used))
    await page.getByRole('button', { name: 'Verify and continue' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByTestId('shell-role')).toHaveText('Administrator')
    // The dashboard aggregates are served only to a session that passed the second factor.
    await expect(page.getByRole('heading', { name: 'Administrator dashboard' })).toBeVisible()
    await expect(page.getByTestId('stat-posts-comments')).toBeVisible()

    // Administrators cannot use member pages.
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
    await page.getByRole('link', { name: 'Go to Administrator pages' }).click()
    await expect(page).toHaveURL(/\/admin$/)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expectSignInPage(page, true)

    await signInWithPassword(page, accounts.admin)
    await expect(page.getByLabel('Authenticator app code')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Administrator sign in' })).toBeVisible()
    await page.getByLabel('Authenticator app code').fill(await freshTotp(secret, used))
    await page.getByRole('button', { name: 'Verify', exact: true }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByTestId('shell-role')).toHaveText('Administrator')
  })
})
