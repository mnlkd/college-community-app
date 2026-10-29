import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import {
  expectSignInPage,
  interceptAuthEmails,
  removeThrowawayAccount,
  signInWithPassword,
  throwawayEmail,
} from './support'

// One throwaway Student goes through Register Account, Manage Profile and Account, Recover
// Forgotten Password, Request Alumni Status and account deletion. No email is sent: the
// sign-up, reset and email-change sends are replaced by admin generateLink (see support.ts).

test.describe.configure({ mode: 'serial' })

const account = {
  email: throwawayEmail(),
  password: 'first e2e password value',
  displayName: 'E2E Student',
}

/** Field labels include their hint text, so match from the start ("Password" is not "Confirm password"). */
async function fillPassword(page: Page, label: string, value: string) {
  await page.getByLabel(new RegExp(`^${label}`)).fill(value)
}

test.afterAll(async () => {
  await removeThrowawayAccount(account.email, account.password)
})

test('a Student registers with an institutional email and a 6-digit code', async ({ page }) => {
  const mail = await interceptAuthEmails(page)
  await page.goto('/login')
  await page.getByRole('link', { name: /Create an account/ }).click()
  await expect(page).toHaveURL(/\/register$/)
  await page.goto('/register/student')

  await page.getByLabel(/Institutional email/).fill(account.email)
  await page.getByLabel(/Display name/).fill(account.displayName)
  await fillPassword(page, 'Password', 'short')
  await fillPassword(page, 'Confirm password', 'short')
  await page.getByRole('button', { name: /Email verification/ }).click()
  await expect(page.getByText(/at least 15 characters/i)).toBeVisible()

  await fillPassword(page, 'Password', account.password)
  await fillPassword(page, 'Confirm password', account.password)
  await page.getByRole('button', { name: /Email verification/ }).click()
  await expect(page).toHaveURL(/\/register\/verify$/)

  await page.getByLabel(/6-digit code/).fill('000000')
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page.getByText(/That code is not correct or has expired/)).toBeVisible()

  await page.getByLabel(/6-digit code/).fill(mail.codeFor(account.email))
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page).toHaveURL(/\/register\/profile$/)

  // Leaving before the profile step and coming back still ends on the profile step.
  await page.goto('/home')
  await expect(page).toHaveURL(/\/register\/profile$/)

  await expect(page.getByTestId('registration-role')).toHaveText(/Student/)
  await page.getByLabel(/^Programme/).selectOption('SOFTWARE_ENGINEERING')
  await page.getByLabel(/Expected graduation year/).selectOption(String(new Date().getUTCFullYear() + 1))
  await page.getByRole('button', { name: 'Continue to Home' }).click()

  await expect(page).toHaveURL(/\/home$/)
  await expect(
    page.getByRole('banner').getByRole('link', { name: `${account.displayName}, your profile` }),
  ).toBeVisible()
})

test('the Student edits the profile and adds a picture', async ({ page }) => {
  await page.goto('/login')
  await signInWithPassword(page, account.email, account.password)
  await expect(page).toHaveURL(/\/home$/)
  await page.getByRole('banner').getByRole('link', { name: account.displayName }).click()
  await expect(page.getByRole('heading', { name: account.displayName })).toBeVisible()
  await page.getByRole('link', { name: 'Edit profile' }).click()

  const picture = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#6e56cf' },
  })
    .png()
    .toBuffer()
  await page.getByLabel('Profile picture').setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: picture,
  })
  await expect(page.getByRole('button', { name: 'Remove picture' })).toBeVisible()

  await page.getByLabel(/^Bio/).fill('  Interested in distributed systems.  ')
  await page.getByLabel(/^Display name/).fill('')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Required').first()).toBeVisible()

  account.displayName = 'E2E Student Edited'
  await page.getByLabel(/^Display name/).fill(account.displayName)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { name: account.displayName })).toBeVisible()
  await expect(page.getByText('Interested in distributed systems.', { exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByRole('img', { name: /profile picture/ })).toBeVisible()
})

test('the Student changes the password, then recovers it by email code', async ({ page }) => {
  const mail = await interceptAuthEmails(page)
  await page.goto('/login')
  await signInWithPassword(page, account.email, account.password)
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Change password' }).click()

  await fillPassword(page, 'Current password', 'not the current password')
  await fillPassword(page, 'New password', 'second e2e password value')
  await fillPassword(page, 'Confirm new password', 'second e2e password value')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('The current password is incorrect.')).toBeVisible()

  await fillPassword(page, 'Current password', account.password)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page).toHaveURL(/\/settings\/password\/done$/)
  account.password = 'second e2e password value'

  await page.goto('/profile')
  await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click()
  await expectSignInPage(page, false)

  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await page.getByLabel(/Account email/).fill(account.email)
  await page.getByRole('button', { name: 'Send reset code' }).click()
  const resetCode = page.getByLabel(/6-digit reset code/)
  await expect(resetCode).toBeVisible()
  await resetCode.fill(mail.codeFor(account.email))
  await page.getByRole('button', { name: 'Continue' }).click()
  await fillPassword(page, 'New password', 'third e2e password value')
  await fillPassword(page, 'Confirm password', 'third e2e password value')
  await page.getByRole('button', { name: 'Set new password' }).click()
  account.password = 'third e2e password value'
  await page.getByRole('link', { name: 'Return to member sign in' }).click()

  await signInWithPassword(page, account.email, account.password)
  await expect(page).toHaveURL(/\/home$/)
})

test('the Student moves to a personal email and requests Alumni status', async ({ page }) => {
  const mail = await interceptAuthEmails(page)
  await page.goto('/login')
  await signInWithPassword(page, account.email, account.password)
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Change email' }).click()

  const personal = throwawayEmail('example.com')
  await page.getByLabel(/^New email/).fill(personal)
  await fillPassword(page, 'Current password', account.password)
  await page.getByRole('button', { name: 'Send code to new email' }).click()
  const emailCode = page.getByLabel(/6-digit code/)
  await expect(emailCode).toBeVisible()
  await emailCode.fill(mail.codeFor(personal))
  await page.getByRole('button', { name: 'Confirm new email' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByText('Your account email was changed.')).toBeVisible()
  await expect(page.getByTestId('account-email')).toHaveText(personal)
  account.email = personal

  await page.getByRole('link', { name: 'Request Alumni status' }).click()
  await expect(page.getByText(/your role changes from Student to Verified Alumni/)).toBeVisible()
  await page.getByLabel(/Graduation year/).selectOption(String(new Date().getUTCFullYear()))
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByText(/Graduation request sent/)).toBeVisible()
  await expect(page.getByText(/waiting for an Administrator/)).toBeVisible()

  await page.getByRole('link', { name: 'Request Alumni status' }).click()
  await expect(page.getByText('Waiting for an Administrator')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send request' })).toHaveCount(0)
})

test('the member deletes the account', async ({ page }) => {
  await page.goto('/login')
  await signInWithPassword(page, account.email, account.password)
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Delete my account' }).click()

  await page.getByLabel(/Type DELETE to confirm/).fill('DELETE')
  await fillPassword(page, 'Current password', 'not the current password')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page.getByText('The password is not correct.')).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/delete$/)

  await fillPassword(page, 'Current password', account.password)
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expectSignInPage(page, false)
  await expect(page.getByText('Your account was deleted.')).toBeVisible()

  await signInWithPassword(page, account.email, account.password)
  await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.')
})
