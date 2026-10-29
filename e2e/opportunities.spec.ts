import { expect, test, type Browser, type Page } from '@playwright/test'
import { signInWithPassword, sql } from './support'

// Use cases: Post Opportunity, Browse Opportunities, Edit Opportunity, Close Opportunity and
// Save Item, with the seeded Verified Alumnus Yonas Bekele and the Student Mahlet Tesfaye.
const author = { email: 'yonas.bekele@example.com', name: 'Yonas Bekele' }
const student = { email: 'mahlet.tesfaye@hilcoeschool.com' }
const TITLE = 'E2E Data Engineering Intern'

const authorId = `(SELECT id FROM app.member_account WHERE email = '${author.email}')`

/** Removes listings this spec created and any saves of them. */
async function resetListings(): Promise<void> {
  const created = `SELECT id FROM app.opportunity WHERE author_id = ${authorId} AND title LIKE 'E2E %'`
  await sql(`DELETE FROM app.saved_item WHERE target_type = 'OPPORTUNITY' AND target_id IN (${created})`)
  await sql(`DELETE FROM app.opportunity WHERE id IN (${created})`)
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await signInWithPassword(page, email)
  await expect(page).toHaveURL(/\/home$/)
  return page
}

test.describe('Opportunities', () => {
  test.beforeEach(resetListings)
  test.afterAll(resetListings)

  test('an Alumnus posts, edits and closes a listing that a Student finds and saves', async ({ browser }) => {
    const alumnus = await signedIn(browser, author.email)
    await alumnus
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Boards', exact: true })
      .click()
    await expect(alumnus).toHaveURL(/\/boards\/opportunities$/)
    await alumnus.getByRole('link', { name: 'Post an opportunity' }).click()

    await alumnus.getByLabel(/Role title/).fill(TITLE)
    await alumnus.getByLabel(/Organisation/).fill('Ethio Telecom')
    await alumnus.getByLabel(/Employment type/).selectOption('INTERNSHIP')
    await alumnus.getByLabel(/Work arrangement/).selectOption('HYBRID')
    await alumnus.getByLabel(/^Location/).fill('Addis Ababa')
    await alumnus.getByLabel(/Description/).fill('Build #dataplatform pipelines with the analytics team.')
    await alumnus.getByLabel(/How to apply/).fill('Email talent@ethiotelecom.example with your CV.')
    await alumnus.getByRole('button', { name: 'Publish listing' }).click()
    await expect(alumnus).toHaveURL(/\/boards\/opportunities\/listings\/[^/]+$/)
    await expect(alumnus.getByRole('heading', { name: TITLE })).toBeVisible()
    const listingUrl = alumnus.url()

    // A Student finds it by tag on the board and saves it.
    const reader = await signedIn(browser, student.email)
    await reader.goto('/boards/opportunities')
    await reader.getByRole('searchbox', { name: 'Search opportunities' }).fill('#dataplatform')
    await reader.getByRole('searchbox', { name: 'Search opportunities' }).press('Enter')
    const card = reader.getByRole('article', { name: TITLE })
    await expect(card).toBeVisible()
    await expect(reader.getByRole('link', { name: 'Post an opportunity' })).toHaveCount(0)
    await card.getByRole('link', { name: TITLE }).click()
    await expect(reader.getByText('Email talent@ethiotelecom.example with your CV.')).toBeVisible()
    await reader.getByRole('button', { name: 'Save listing' }).click()
    await expect(reader.getByRole('button', { name: 'Remove listing from saved items' })).toBeVisible()

    // The author edits the listing.
    await alumnus.getByRole('link', { name: 'Edit listing' }).click()
    await alumnus.getByLabel(/^Location/).fill('Addis Ababa, Bole')
    await alumnus.getByRole('button', { name: 'Save changes' }).click()
    await expect(alumnus).toHaveURL(listingUrl)
    await expect(alumnus.getByText('Addis Ababa, Bole')).toBeVisible()

    // Closing leaves only the title, type and status, for everyone.
    await alumnus.getByRole('button', { name: 'Close listing' }).click()
    await alumnus.getByRole('button', { name: 'Close permanently' }).click()
    await expect(alumnus.getByRole('status')).toContainText('Listing closed')
    await expect(alumnus.getByText('Ethio Telecom')).toHaveCount(0)

    await reader.goto('/saved')
    const saved = reader.getByRole('article', { name: TITLE })
    await expect(saved.getByText('Closed', { exact: true })).toBeVisible()
    await expect(saved.getByText('Ethio Telecom')).toHaveCount(0)
    await reader.goto('/boards/opportunities?tag=dataplatform')
    await expect(reader.getByRole('article', { name: TITLE })).toHaveCount(0)
  })
})
