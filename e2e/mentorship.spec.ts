import { expect, test, type Browser, type Page } from '@playwright/test'
import { accessTokenFor, callApi, seedPassword, signInWithPassword, sql } from './support'

// Use cases: Request Mentorship, Respond to Mentorship Request, View Mentor Contacts,
// End Mentorship and Manage Mentor Availability, against the seeded mentor Dawit Mekonnen.
const mentor = { email: 'dawit.mekonnen@example.com', name: 'Dawit Mekonnen' }
const mahlet = { email: 'mahlet.tesfaye@hilcoeschool.com', name: 'Mahlet Tesfaye' }
const abel = { email: 'abel.tadesse@hilcoeschool.com', name: 'Abel Tadesse' }
const nahom = { email: 'nahom.getachew@hilcoeschool.com', name: 'Nahom Getachew' }

const mentorId = `(SELECT id FROM app.member_account WHERE email = '${mentor.email}')`

/** Removes every mentorship with Dawit and their notices, and restores his seeded settings. */
async function resetMentor(): Promise<void> {
  await sql(
    `DELETE FROM app.notification
      WHERE target_type = 'MENTORSHIP' AND event_key NOT LIKE 'seed:%'
        AND target_id IN (SELECT id FROM app.mentorship WHERE mentor_id = ${mentorId})`,
  )
  await sql(`DELETE FROM app.mentorship WHERE mentor_id = ${mentorId}`)
  await sql(`UPDATE app.mentor_profile SET available = true, capacity = 2 WHERE member_id = ${mentorId}`)
}

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await signInWithPassword(page, email)
  await expect(page).toHaveURL(/\/home$/)
  return page
}

test.describe('Mentorship', () => {
  test.beforeEach(resetMentor)
  test.afterAll(resetMentor)

  test('a Student requests a mentor, who accepts; the Student sees contacts and ends it', async ({
    browser,
  }) => {
    const student = await signedIn(browser, mahlet.email)
    await student
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Boards', exact: true })
      .click()
    await expect(student).toHaveURL(/\/boards\/opportunities$/)
    await student.getByRole('link', { name: 'Mentorship', exact: true }).click()
    await expect(student).toHaveURL(/\/boards\/mentorship$/)
    const card = student.getByRole('article', { name: mentor.name })
    await expect(card.getByRole('img', { name: '0 of 2 places filled' })).toBeVisible()
    await card.click()
    await expect(student.getByRole('heading', { name: 'Mentor', exact: true })).toBeVisible()
    await student.getByRole('link', { name: 'Request mentorship' }).click()

    await student.getByLabel('Topic').selectOption('Team leadership')
    await student.getByLabel('Your note').fill('I am leading my senior project team and want advice.')
    await student.getByRole('button', { name: 'Send request' }).click()
    await expect(student).toHaveURL(/\/boards\/mentorship\/mentors\/[^/]+$/)
    await expect(student.getByRole('status')).toContainText('Request sent.')
    await expect(student.getByText('Request pending')).toBeVisible()

    const mentorPage = await signedIn(browser, mentor.email)
    await mentorPage
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My Requests', exact: true })
      .click()
    const request = mentorPage.getByRole('article', { name: `Mentorship with ${mahlet.name}` })
    await expect(request.getByText('Team leadership')).toBeVisible()
    await request.getByRole('button', { name: 'Accept' }).click()
    await expect(mentorPage.getByRole('status')).toContainText('Request accepted.')

    // The mentor page now shows the contacts where the request button was.
    await student.reload()
    await expect(student.getByRole('region', { name: 'Mentor contacts' })).toContainText('+251 911 000 000')
    await expect(student.getByRole('link', { name: 'Request mentorship' })).toHaveCount(0)
    await student.getByRole('button', { name: 'End mentorship' }).click()
    await student.getByRole('button', { name: 'Confirm end' }).click()
    await expect(student.getByRole('status')).toContainText('Mentorship ended.')
    await expect(student.getByRole('link', { name: 'Request mentorship' })).toBeVisible()

    await mentorPage.goto('/boards/mentorship/my-requests?tab=history')
    await expect(
      mentorPage
        .getByRole('article', { name: `Mentorship with ${mahlet.name}` })
        .getByText('Ended', { exact: true }),
    ).toBeVisible()
  })

  test('a full mentor takes no new requests and cannot lower capacity below active mentees', async ({
    browser,
  }) => {
    const mentorToken = await accessTokenFor(mentor.email, seedPassword())
    const dawitId = await accountIdOf(mentorToken)
    for (const each of [mahlet, abel]) {
      const token = await accessTokenFor(each.email, seedPassword())
      const created = await callApi(token, 'POST', `/mentors/${dawitId}/mentorships`, {
        topic: 'Career advice',
        note: 'Could you help me plan my first role?',
      })
      expect(created.status).toBe(201)
      const accepted = await callApi(
        mentorToken,
        'POST',
        `/mentorships/${(created.body as { id: string }).id}/acceptance`,
      )
      expect(accepted.status).toBe(200)
    }

    const student = await signedIn(browser, nahom.email)
    await student.goto('/boards/mentorship')
    const card = student.getByRole('article', { name: mentor.name })
    await expect(card.getByRole('img', { name: '2 of 2 places filled' })).toBeVisible()

    const mentorPage = await signedIn(browser, mentor.email)
    await mentorPage.goto('/boards/mentorship/availability')
    const capacity = mentorPage.getByLabel('Maximum active mentees')
    await expect(capacity).toHaveValue('2')
    await capacity.fill('1')
    await mentorPage.getByRole('button', { name: 'Save availability' }).click()
    await expect(mentorPage.getByText('Capacity cannot be lower than your 2 active mentees.')).toBeVisible()

    await capacity.fill('3')
    await mentorPage.getByRole('button', { name: 'Save availability' }).click()
    await expect(mentorPage.getByRole('status')).toContainText('Availability saved.')
    await student.reload()
    await expect(card.getByRole('img', { name: '2 of 3 places filled' })).toBeVisible()
  })
})

/** The signed-in member's account id. */
async function accountIdOf(token: string): Promise<string> {
  const response = await callApi(token, 'GET', '/accounts/me')
  expect(response.status).toBe(200)
  return (response.body as { accountId: string }).accountId
}
