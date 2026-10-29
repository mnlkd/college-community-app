import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  accounts,
  adminClient,
  callApi,
  deleteAuthUser,
  enrollOrVerify,
  registerThrowawayMember,
  removeThrowawayAccount,
  resetFactors,
  signInAdministrator,
  sql,
  throwawayEmail,
} from './support'

// Administrator identity controls (Batch 1b): Review Alumni Affiliation, Confirm Graduation,
// Maintain Staff Email List, disable and restore, delete a confirmed-fake account, and accepting
// an Administrator invitation. Members are created through the Supabase admin API and the
// registration endpoint, so no email is sent. No real invitation is sent either: the invited user
// comes from admin generateLink (type invite), and the API side of Create Administrator is covered
// by the server integration tests.

test.describe.configure({ mode: 'serial' })

const password = 'throwaway e2e password value'
const year = new Date().getUTCFullYear()
const suffix = Date.now().toString(36)
const alumni = { email: throwawayEmail('example.com'), name: `E2E Alumni ${suffix}` }
const student = { email: throwawayEmail(), name: `E2E Graduate ${suffix}` }
const target = { email: throwawayEmail(), name: `E2E Target ${suffix}` }
const fake = { email: throwawayEmail(), name: `E2E Fake ${suffix}` }
const staffEmail = throwawayEmail()
const invited = throwawayEmail()
const factor = { secret: null as string | null, used: { value: 0 } }

let page: Page

async function openManage(name: string) {
  await page.goto('/admin/users')
  await page.getByLabel('Search by name or email').fill(name)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('link', { name: `Manage ${name}` }).click()
  await expect(page.getByRole('heading', { name: 'Manage account' })).toBeVisible()
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  await resetFactors(accounts.firstAdmin)
  const registered = await Promise.all([
    registerThrowawayMember(alumni.email, password, {
      kind: 'ALUMNI',
      displayName: alumni.name,
      programme: 'SOFTWARE_ENGINEERING',
      graduationYear: year - 3,
      identifyingContext: 'E2E final project',
    }),
    registerThrowawayMember(student.email, password, {
      kind: 'STUDENT_OR_STAFF',
      displayName: student.name,
      programme: 'COMPUTER_SCIENCE',
      graduationYear: year + 1,
    }),
    registerThrowawayMember(target.email, password, {
      kind: 'STUDENT_OR_STAFF',
      displayName: target.name,
      programme: 'COMPUTER_SCIENCE',
      graduationYear: year + 1,
    }),
    registerThrowawayMember(fake.email, password, {
      kind: 'STUDENT_OR_STAFF',
      displayName: fake.name,
      programme: 'COMPUTER_SCIENCE',
      graduationYear: year + 1,
    }),
  ])
  expect(registered.map((result) => result.status)).toEqual([201, 201, 201, 201])
  const graduation = await callApi(registered[1]!.token, 'POST', '/members/me/graduation-requests', {
    programme: 'COMPUTER_SCIENCE',
    graduationYear: year,
  })
  expect(graduation.status).toBe(201)

  page = await browser.newPage()
  await signInAdministrator(page, accounts.firstAdmin, factor)
})

test.afterAll(async () => {
  await page?.close()
  for (const member of [alumni, student, target]) await removeThrowawayAccount(member.email, password)
  await deleteAuthUser(fake.email)
  await sql('DELETE FROM app.staff_email_entry WHERE email = $1', [staffEmail])
  await sql('DELETE FROM app.administrator_account WHERE email = $1', [invited])
  await deleteAuthUser(invited)
})

test('an Administrator verifies a self-reported Alumni', async () => {
  await page.getByRole('navigation', { name: 'Administrator' }).getByRole('link', { name: 'Users' }).click()
  await page.getByRole('link', { name: 'Self-report reviews' }).click()
  await page.getByRole('button', { name: `Review ${alumni.name}` }).click()
  const dialog = page.getByRole('dialog', { name: `Review ${alumni.name}` })
  await expect(dialog).toContainText('E2E final project')

  await dialog.getByRole('button', { name: 'Move to Verified' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByLabel(/^Private reason/).fill('Matched the registrar graduation list.')
  await dialog.getByRole('button', { name: 'Move to Verified' }).click()
  await expect(page.getByText(`${alumni.name} is now Verified Alumni.`)).toBeVisible()
  await expect(page.getByRole('button', { name: `Review ${alumni.name}` })).toHaveCount(0)
})

test('an Administrator confirms a graduation request', async () => {
  await page.goto('/admin/users?tab=graduation')
  await page.getByRole('button', { name: `Decide ${student.name}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Private reason/).fill('Completion confirmed with the registrar.')
  await dialog.getByRole('button', { name: 'Confirm graduation' }).click()
  await expect(page.getByText(`Graduation confirmed. ${student.name} is now Verified Alumni.`)).toBeVisible()

  await openManage(student.name)
  await expect(page.getByRole('definition').filter({ hasText: 'Alumni · Verified' })).toBeVisible()
})

test('an Administrator adds and removes a Staff email', async () => {
  await page.goto('/admin/staff-emails')
  const field = page.getByRole('textbox', { name: /^Staff email/ })
  await field.fill('someone@gmail.com')
  await page.getByRole('button', { name: 'Add Staff email' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await field.fill(staffEmail.toUpperCase())
  await page.getByRole('button', { name: 'Add Staff email' }).click()
  await expect(page.getByText(`${staffEmail} was added to the Staff list.`)).toBeVisible()
  await page.getByLabel('Search Staff emails').fill(staffEmail)
  await page.getByRole('search').getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: `Remove ${staffEmail}` }).click()
  await expect(page.getByText(`${staffEmail} was removed from the Staff list.`)).toBeVisible()
  await expect(page.getByRole('button', { name: `Remove ${staffEmail}` })).toHaveCount(0)
})

test('an Administrator disables and restores an account', async () => {
  await openManage(target.name)
  await page.getByLabel(/^Private disable reason/).fill('Suspected impersonation under investigation.')
  await page.getByRole('button', { name: 'Disable account' }).click()
  await expect(page.getByRole('heading', { name: 'Restore account' })).toBeVisible()
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible()

  const signedIn = await adminClient().auth.signInWithPassword({ email: target.email, password })
  expect(signedIn.error?.code).toBe('user_banned')

  await page.getByLabel(/^Private restore reason/).fill('Legitimate claimant confirmed in person.')
  await page.getByRole('button', { name: 'Restore account' }).click()
  await expect(page.getByRole('heading', { name: 'Disable account' })).toBeVisible()
  await expect(page.getByText('Active', { exact: true })).toBeVisible()
})

test('a confirmed-fake account is deleted and its email cannot register again', async () => {
  await openManage(fake.name)
  await page.getByLabel(/^Private deletion reason/).fill('Impersonation confirmed by the registrar.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Delete account' }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByText(`${fake.name}’s account was deleted.`)).toBeVisible()

  const again = await registerThrowawayMember(fake.email, password, {
    kind: 'STUDENT_OR_STAFF',
    displayName: fake.name,
    programme: 'COMPUTER_SCIENCE',
    graduationYear: year + 1,
  })
  expect(again.status).toBe(403)
})

test('an invited Administrator accepts the invitation and enrolls an authenticator', async ({ browser }) => {
  // The same steps Create Administrator performs, without sending the invitation email.
  const admin = adminClient().auth.admin
  const { data, error } = await admin.generateLink({ type: 'invite', email: invited })
  if (error) throw error
  const code = data.properties.email_otp
  await admin.updateUserById(data.user.id, { app_metadata: { account_kind: 'ADMIN' } })
  await sql(
    `INSERT INTO app.administrator_account (id, auth_user_id, email, created_by_admin_id)
     VALUES (gen_random_uuid(), $1, $2, (SELECT id FROM app.administrator_account WHERE email = $3))`,
    [data.user.id, invited, accounts.firstAdmin],
  )

  const context = await browser.newContext()
  const invitee = await context.newPage()
  try {
    await invitee.goto('/admin/invite')
    await invitee.getByLabel(/^Email/).fill(invited)
    await invitee.getByLabel(/6-digit code/).fill('000000')
    await invitee.getByRole('button', { name: 'Continue' }).click()
    await expect(invitee.getByRole('alert')).toBeVisible()

    await invitee.getByLabel(/6-digit code/).fill(code)
    await invitee.getByRole('button', { name: 'Continue' }).click()
    await invitee.getByLabel(/^New password/).fill(password)
    await invitee.getByLabel(/^Confirm password/).fill(password)
    await invitee.getByRole('button', { name: 'Set password and continue' }).click()
    await expect(invitee).toHaveURL(/\/admin\/login$/)
    await enrollOrVerify(invitee, { secret: null, used: { value: 0 } })
    await expect(invitee.getByTestId('shell-role')).toHaveText('Administrator')
  } finally {
    await context.close()
  }

  await page.goto('/admin/administrators')
  await expect(page.getByText(invited)).toBeVisible()
})
