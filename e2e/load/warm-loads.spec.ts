import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedPassword, signInWithPassword } from '../support'

// NFR-4: with 10 concurrent active users, at least 95% of warm primary-page loads are usable
// within three seconds. Runs against the production builds (playwright.load.config.ts).

const USERS = Number(process.env.LOAD_USERS ?? 10)
const ROUNDS = 3
const LIMIT_MS = 3_000

/** The seeded community accounts; ten users reuse them in turn. */
const MEMBERS = [
  'selamawit.girma@hilcoeschool.com',
  'mahlet.tesfaye@hilcoeschool.com',
  'abel.tadesse@hilcoeschool.com',
  'nahom.getachew@hilcoeschool.com',
  'meseret.alemayehu@hilcoeschool.com',
  'yonas.bekele@example.com',
  'dawit.mekonnen@example.com',
  'hanan.abdulaziz@example.com',
]

const PRIMARY = [
  '/home',
  '/search?q=career',
  '/boards/opportunities',
  '/boards/activities',
  '/boards/mentorship',
  '/notifications',
]

/** Usable: the page heading is shown and nothing in the main column is still loading. */
async function usable(page: Page): Promise<void> {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 30_000 })
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/login')
  await signInWithPassword(page, email, seedPassword())
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })
  return page
}

test(`${USERS} concurrent members: 95% of warm primary-page loads are usable within 3 s`, async ({
  browser,
}) => {
  const pages: Page[] = []
  for (let index = 0; index < USERS; index += 1)
    pages.push(await signedIn(browser, MEMBERS[index % MEMBERS.length]!))

  // Warm-up: one visit to each page, so caches and server connections are ready.
  await Promise.all(
    pages.map(async (page) => {
      for (const path of PRIMARY) {
        await page.goto(path)
        await usable(page)
      }
    }),
  )

  let apiCalls = 0
  for (const page of pages)
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls += 1
    })
  const timings: { path: string; ms: number }[] = []
  await Promise.all(
    pages.map(async (page, user) => {
      for (let round = 0; round < ROUNDS; round += 1) {
        for (let offset = 0; offset < PRIMARY.length; offset += 1) {
          const path = PRIMARY[(user + offset) % PRIMARY.length]!
          const started = performance.now()
          await page.goto(path)
          await usable(page)
          timings.push({ path, ms: Math.round(performance.now() - started) })
        }
      }
    }),
  )

  const sorted = timings.map((timing) => timing.ms).sort((a, b) => a - b)
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!
  const within = sorted.filter((ms) => ms <= LIMIT_MS).length / sorted.length
  const worst = Object.fromEntries(
    PRIMARY.map((path) => [path, Math.max(...timings.filter((t) => t.path === path).map((t) => t.ms))]),
  )
  console.log(
    `${sorted.length} warm loads by ${USERS} users: median ${sorted[sorted.length >> 1]} ms, ` +
      `p95 ${p95} ms, ${(within * 100).toFixed(1)}% within ${LIMIT_MS} ms, ` +
      `${(apiCalls / sorted.length).toFixed(1)} API calls per load; worst ${JSON.stringify(worst)}`,
  )
  expect(within).toBeGreaterThanOrEqual(0.95)
  await Promise.all(pages.map((page) => page.context().close()))
})
