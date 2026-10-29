import { expect, test, type Browser, type Page } from '@playwright/test'
import { accounts, signInWithPassword } from './support'

// A 1x1 PNG; the server re-encodes it with Sharp.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const alumnus = 'yonas.bekele@example.com'
const selfReported = 'hanan.abdulaziz@example.com'

async function memberPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await signInWithPassword(page, email)
  await expect(page).toHaveURL(/\/home$/)
  return page
}

test.describe('Publishing and Boards', () => {
  test('a Student posts with an image and tags; others like, save and reply; the author edits, finds and archives it', async ({
    browser,
  }) => {
    const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const tag = `e2e-${run}`
    const body = `Study group for databases ${run}`

    // Create Post (UC-PUB-01) with an image, alt text and a tag.
    const author = await memberPage(browser, accounts.student)
    await author.getByRole('link', { name: 'Write a post' }).click()
    await expect(author).toHaveURL(/\/posts\/new$/)
    await author.getByLabel(/^Post/).fill(body)
    const tags = author.getByRole('textbox', { name: /^Tags/ })
    await tags.fill(`#${tag.toUpperCase()}`)
    await tags.press('Enter')
    await expect(author.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveCount(1)
    await author.getByTestId('post-image-input').setInputFiles({
      name: 'whiteboard.png',
      mimeType: 'image/png',
      buffer: PIXEL,
    })
    await author.getByLabel('Image 1 description (alt text)').fill(`Whiteboard ${run}`)
    await author.getByRole('button', { name: 'Publish' }).click()
    await expect(author).toHaveURL(/\/posts\/[0-9a-f-]{36}$/)
    const postUrl = new URL(author.url()).pathname

    const article = author.getByRole('article', { name: 'Post by Selamawit Girma' })
    await expect(article.getByText(body)).toBeVisible()
    await expect(article.getByRole('img', { name: `Whiteboard ${run}` })).toBeVisible()
    await expect(article.getByRole('link', { name: `#${tag}` })).toBeVisible()

    // Comment (UC-PUB-02).
    await author.getByLabel('Add a comment').fill(`Who is in? ${run}`)
    await author.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(author.getByText(`Who is in? ${run}`)).toBeVisible()

    // Another member likes, saves and replies.
    const other = await memberPage(browser, alumnus)
    await other.goto(postUrl)
    const otherArticle = other.getByRole('article', { name: 'Post by Selamawit Girma' })
    await otherArticle.getByRole('button', { name: 'Like post' }).click()
    await expect(otherArticle.getByRole('button', { name: 'Unlike post' })).toBeVisible()
    await expect(otherArticle.getByTestId('like-count')).toHaveText('1')
    await otherArticle.getByRole('button', { name: 'Save post' }).click()
    await expect(otherArticle.getByRole('button', { name: 'Remove from saved items' })).toBeVisible()
    await other.getByRole('button', { name: 'Reply', exact: true }).first().click()
    await other.getByLabel('Reply to Selamawit Girma').fill(`Count me in ${run}`)
    await other
      .locator('form')
      .filter({ has: other.getByLabel('Reply to Selamawit Girma') })
      .getByRole('button', { name: 'Reply', exact: true })
      .click()
    await expect(other.getByText(`Count me in ${run}`)).toBeVisible()

    await other.goto('/home')
    await other
      .getByRole('navigation', { name: 'Feeds' })
      .getByRole('link', { name: 'My saved items' })
      .click()
    await expect(other.getByRole('heading', { name: 'Saved items' })).toBeVisible()
    await expect(other.getByRole('article').filter({ hasText: body })).toHaveCount(1)

    // Search by tag finds it.
    await author.goto('/search')
    await author.getByRole('searchbox').fill(`#${tag}`)
    await author.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(author).toHaveURL(new RegExp(`tag=${tag}`))
    await expect(author.getByRole('article').filter({ hasText: body })).toHaveCount(1)

    // Edit Post (UC-PUB-03).
    await author.goto(postUrl)
    await expect(author.getByText('1 like', { exact: true })).toBeVisible()
    await author.getByRole('link', { name: 'Edit', exact: true }).click()
    await author.getByLabel(/^Post/).fill(`${body} (Thursdays)`)
    await author.getByRole('button', { name: 'Save changes' }).click()
    await expect(author).toHaveURL(new RegExp(`${postUrl}$`))
    await expect(article.getByText(`${body} (Thursdays)`)).toBeVisible()
    await expect(article.getByText('· edited')).toBeVisible()

    // Delete Post (UC-PUB-04) archives it: text and image go, comments and tags stay read-only.
    await author.getByRole('link', { name: 'Delete', exact: true }).click()
    await author.getByRole('button', { name: 'Delete post' }).click()
    await expect(author.getByRole('heading', { name: 'Archived discussion' })).toBeVisible()
    await expect(article.getByText(`${body} (Thursdays)`)).toHaveCount(0)
    await expect(author.getByRole('img', { name: `Whiteboard ${run}` })).toHaveCount(0)
    await expect(author.getByText(`Who is in? ${run}`)).toBeVisible()
    await expect(author.getByText(`Count me in ${run}`)).toBeVisible()
    await expect(author.getByLabel('Add a comment')).toHaveCount(0)

    // The saver keeps the archived item and can still remove it.
    await other.reload()
    const saved = other.getByRole('region', { name: 'Saved item' }).filter({ hasText: tag })
    await expect(saved).toHaveCount(1)
    await saved.getByRole('button', { name: 'Remove saved item' }).click()
    await expect(saved).toHaveCount(0)

    await author.context().close()
    await other.context().close()
  })

  test('a Self-Reported Alumnus can read the feed but is told why posting is unavailable', async ({
    page,
  }) => {
    await page.goto('/login')
    await signInWithPassword(page, selfReported)
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByText(/once your Alumni status is verified/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Write a post' })).toHaveCount(0)
  })
})
