import { expect, test } from '@playwright/test'
import { accounts, expectSignInPage, signInWithPassword } from './support'

test.describe('Sign In and Sign Out (member)', () => {
  test('a signed-out visitor is sent to member sign-in', async ({ page }) => {
    await page.goto('/home')
    await expectSignInPage(page, false)
  })

  test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
    await page.goto('/login')
    await signInWithPassword(page, accounts.student, 'not-the-right-password-at-all')
    await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('a Student signs in, sees the home feed and signs out', async ({ page }) => {
    await page.goto('/login')
    await signInWithPassword(page, accounts.student)
    await expect(page).toHaveURL(/\/home$/)
    const profile = page.getByRole('banner').getByRole('link', { name: /your profile$/ })
    await expect(profile).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()

    await page.reload()
    await expect(profile).toBeVisible()

    // Sign-out lives on the member's own profile page.
    await profile.click()
    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click()
    await expectSignInPage(page, false)
    await page.goto('/home')
    await expectSignInPage(page, false)
  })

  test('an Administrator account is refused on member sign-in', async ({ page }) => {
    await page.goto('/login')
    await signInWithPassword(page, accounts.firstAdmin)
    await expect(page.getByRole('alert')).toHaveText(
      'Administrator accounts sign in on the Administrator sign-in page.',
    )
    await page.goto('/home')
    await expectSignInPage(page, false)
  })

  test('a member account is refused on Administrator sign-in', async ({ page }) => {
    await page.goto('/admin/login')
    await signInWithPassword(page, accounts.student)
    await expect(page.getByRole('alert')).toContainText('This page is for Administrators.')
    await page.goto('/admin')
    await expectSignInPage(page, true)
  })
})
