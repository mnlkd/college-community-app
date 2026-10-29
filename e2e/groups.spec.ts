import { expect, test, type Browser, type Page } from '@playwright/test'
import { signInWithPassword, sql } from './support'

// Use cases: Create Group, Request to Join Group, Respond to Join Request, View Coordination
// Details, Transfer Group Ownership, Leave Group and Close Group, with the seeded Students
// Mahlet Tesfaye (owner) and Nahom Getachew.
const owner = { email: 'mahlet.tesfaye@hilcoeschool.com', name: 'Mahlet Tesfaye' }
const joiner = { email: 'nahom.getachew@hilcoeschool.com', name: 'Nahom Getachew' }
const TITLE = 'E2E Database study group'
const PLACE = 'Library group room 4, Tuesdays 16:00'

/** Removes groups this spec created with their memberships, transfers, saves and notices. */
async function resetGroups(): Promise<void> {
  const created = `SELECT id FROM app."group" WHERE title LIKE 'E2E %'`
  await sql(`DELETE FROM app.notification WHERE target_type = 'GROUP' AND target_id IN (${created})`)
  await sql(`DELETE FROM app.saved_item WHERE target_type = 'GROUP' AND target_id IN (${created})`)
  await sql(`DELETE FROM app.group_transfer WHERE group_id IN (${created})`)
  await sql(`DELETE FROM app.group_membership WHERE group_id IN (${created})`)
  await sql(`DELETE FROM app."group" WHERE id IN (${created})`)
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await signInWithPassword(page, email)
  await expect(page).toHaveURL(/\/home$/)
  return page
}

test.describe('Groups', () => {
  test.beforeEach(resetGroups)
  test.afterAll(resetGroups)

  test('a Student creates a group, approves a request, hands over ownership and leaves', async ({
    browser,
  }) => {
    // Two sign-ins and a dozen round trips through the hosted database exceed the default budget.
    test.slow()
    const ownerPage = await signedIn(browser, owner.email)
    await ownerPage.goto('/boards/activities')
    await ownerPage.getByRole('link', { name: 'New group' }).click()
    await ownerPage.getByLabel(/^Name/).fill(TITLE)
    await ownerPage.getByLabel(/^Description/).fill('Revision for the #databases exam.')
    await ownerPage.getByLabel(/Maximum members/).fill('3')
    await ownerPage.getByLabel(/Coordination details/).fill(PLACE)
    await ownerPage.getByRole('button', { name: 'Create group' }).click()
    await expect(ownerPage).toHaveURL(/\/boards\/activities\/groups\/[^/]+$/)
    await expect(ownerPage.getByRole('status')).toContainText('Group created.')
    await expect(ownerPage.getByRole('region', { name: 'Private coordination' })).toContainText(PLACE)
    const groupUrl = ownerPage.url()

    // Another Student finds it, sees no coordination details and asks to join.
    const joinerPage = await signedIn(browser, joiner.email)
    await joinerPage.goto('/boards/activities?tag=databases')
    const card = joinerPage.getByRole('article', { name: TITLE })
    await expect(card.getByRole('img', { name: '1 of 3 places filled' })).toBeVisible()
    await card.getByRole('link', { name: TITLE }).click()
    await expect(joinerPage.getByText(PLACE)).toHaveCount(0)
    await joinerPage.getByRole('button', { name: 'Request to join' }).click()
    await expect(joinerPage.getByRole('status')).toContainText('Request sent.')
    await expect(joinerPage.getByRole('button', { name: 'Withdraw request' })).toBeVisible()

    // The owner approves it from Manage group.
    await ownerPage.reload()
    await ownerPage.getByRole('link', { name: 'Manage group' }).click()
    const request = ownerPage.getByRole('listitem', { name: `Request from ${joiner.name}` })
    await request.getByRole('button', { name: 'Approve' }).click()
    await expect(ownerPage.getByRole('region', { name: 'Join requests' }).getByRole('status')).toContainText(
      `${joiner.name} is now a member`,
    )

    await joinerPage.reload()
    await expect(joinerPage.getByRole('region', { name: 'Private coordination' })).toContainText(PLACE)

    // Ownership passes only with the recipient's consent; the former owner stays a member.
    const ownership = ownerPage.getByRole('region', { name: 'Ownership' })
    await ownership.getByLabel('New owner').selectOption({ label: joiner.name })
    await ownership.getByRole('button', { name: 'Offer ownership' }).click()
    await expect(ownership.getByRole('status')).toContainText(`Ownership offered to ${joiner.name}`)

    await joinerPage.reload()
    const offer = joinerPage.getByRole('region', { name: 'Ownership offer' })
    await offer.getByRole('button', { name: 'Accept ownership' }).click()
    await expect(joinerPage.getByRole('status')).toContainText('You now own this group.')
    await expect(joinerPage.getByRole('link', { name: 'Manage group' })).toBeVisible()

    await ownerPage.goto(groupUrl)
    await ownerPage.getByRole('button', { name: 'Leave group' }).click()
    await ownerPage.getByRole('button', { name: 'Confirm leave' }).click()
    await expect(ownerPage.getByRole('status')).toContainText('You left the group.')
    await expect(ownerPage.getByText(PLACE)).toHaveCount(0)

    // The new owner closes the group; it leaves the board.
    await joinerPage.getByRole('link', { name: 'Manage group' }).click()
    const close = joinerPage.getByRole('region', { name: 'Close group' })
    await close.getByRole('button', { name: 'Close group' }).click()
    await close.getByRole('button', { name: 'Close permanently' }).click()
    await expect(joinerPage).toHaveURL(groupUrl)
    await expect(joinerPage.getByRole('status')).toContainText('Group closed.')
    await joinerPage.goto('/boards/activities?tag=databases')
    await expect(joinerPage.getByRole('article', { name: TITLE })).toHaveCount(0)
  })
})
