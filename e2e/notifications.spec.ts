import { expect, test } from '@playwright/test'
import { accounts, resetSeedNotices, signInWithPassword } from './support'

test.describe('Notifications', () => {
  test.beforeEach(async () => {
    await resetSeedNotices(accounts.student)
  })

  test('a Student sees unread notices, marks one read and then all', async ({ page }) => {
    await page.goto('/login')
    await signInWithPassword(page, accounts.student)
    await expect(page).toHaveURL(/\/home$/)

    const badge = page.getByTestId('notification-badge')
    await expect(badge).toHaveText('4')
    await page
      .getByRole('banner')
      .getByRole('link', { name: /^Notifications/ })
      .click()

    const list = page.getByRole('list', { name: 'Notifications' })
    await expect(list.getByRole('listitem')).toHaveCount(4)
    await expect(list.getByText(/commented on your post/)).toBeVisible()
    await expect(list.getByText(/Yonas Bekele/)).toBeVisible()

    await list
      .getByRole('button', { name: /as read/ })
      .first()
      .click()
    await expect(list.getByRole('button', { name: /as read/ })).toHaveCount(3)
    await expect(badge).toHaveText(/^3/)

    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(list.getByRole('button', { name: /as read/ })).toHaveCount(0)
    await expect(badge).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
  })
})
