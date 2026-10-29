import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashEmail } from '../../src/identity/index.js'
import { resetDatabase } from '../helpers/database.js'
import { api, createMember, NOW } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  await resetDatabase(t.container.prisma)
})

async function signUp(email: string, options: { emailConfirmed?: boolean } = {}) {
  const user = t.authProvider.addUser(email, options)
  return { user, client: api(t, await t.jwks.sign({ sub: user.id })) }
}

const student = {
  kind: 'STUDENT_OR_STAFF',
  displayName: '  Selam Girma ',
  programme: 'SOFTWARE_ENGINEERING',
  graduationYear: 2028,
}
const staff = {
  kind: 'STUDENT_OR_STAFF',
  displayName: 'Dawit Bekele',
  studyOrExpertise: 'Software Engineering Department',
  currentPosition: 'Lecturer',
}
const alumni = {
  kind: 'ALUMNI',
  displayName: 'Hanan Ahmed',
  programme: 'COMPUTER_SCIENCE',
  graduationYear: 2019,
  identifyingContext: 'Batch of 2019, final project on mobile payments.',
}

describe('POST /api/registrations', () => {
  it('registers an institutional email that is not on the Staff list as a Student', async () => {
    const { user, client } = await signUp('Selam.Girma@HiLCoESchool.com')
    const response = await client.post('/api/registrations', student)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      email: 'selam.girma@hilcoeschool.com',
      displayName: 'Selam Girma',
      role: 'STUDENT',
      alumniStatus: null,
      state: 'ACTIVE',
      profile: { programme: 'SOFTWARE_ENGINEERING', graduationYear: 2028, pictureUrl: null },
    })
    expect(t.authProvider.users.get(user.id)?.accountKind).toBe('MEMBER')
    const me = await client.get('/api/accounts/me')
    expect(me.body.role).toBe('STUDENT')
  })

  it('gives STAFF to an institutional email on the active Staff list, in any letter case', async () => {
    await t.container.prisma.staffEmailEntry.create({ data: { email: 'dawit.bekele@hilcoeschool.com' } })
    const { client } = await signUp('DAWIT.Bekele@hilcoeschool.com')
    const status = await client.get('/api/registrations/me')
    expect(status.body).toEqual({
      registered: false,
      email: 'dawit.bekele@hilcoeschool.com',
      institutional: true,
      staffListed: true,
    })
    const response = await client.post('/api/registrations', staff)
    expect(response.status).toBe(201)
    expect(response.body.role).toBe('STAFF')
    expect(response.body.profile).toMatchObject({ studyOrExpertise: staff.studyOrExpertise, programme: null })
  })

  it('ignores a removed (inactive) Staff list entry', async () => {
    await t.container.prisma.staffEmailEntry.create({
      data: { email: 'old.staff@hilcoeschool.com', active: false },
    })
    const { client } = await signUp('old.staff@hilcoeschool.com')
    const response = await client.post('/api/registrations', student)
    expect(response.body.role).toBe('STUDENT')
  })

  it('gives SELF_REPORTED status and a PENDING review on the Alumni path, never VERIFIED (NFR-2)', async () => {
    const { client } = await signUp('hanan.ahmed@gmail.com')
    const response = await client.post('/api/registrations', alumni)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    const reviews = await t.container.prisma.alumniReview.findMany()
    expect(reviews).toEqual([
      expect.objectContaining({
        memberId: response.body.id,
        registrationPath: 'PERSONAL_EMAIL',
        claimedFullName: 'Hanan Ahmed',
        identifyingContext: alumni.identifyingContext,
        decision: 'PENDING',
      }),
    ])
    const actor = await client.get('/api/accounts/me')
    expect(actor.body.alumniStatus).toBe('SELF_REPORTED')
  })

  it('records the institutional path when an Alumni registers with a college email', async () => {
    const { client } = await signUp('former@hilcoeschool.com')
    await client.post('/api/registrations', alumni).expect(201)
    const review = await t.container.prisma.alumniReview.findFirstOrThrow()
    expect(review.registrationPath).toBe('INSTITUTIONAL_EMAIL')
  })

  it('refuses a personal email on the Student and Staff path', async () => {
    const { client } = await signUp('someone@gmail.com')
    const response = await client.post('/api/registrations', student)
    expect(response.status).toBe(422)
    expect(response.body.error.fields).toHaveProperty('email')
  })

  it('refuses an unconfirmed email', async () => {
    const { client } = await signUp('new@hilcoeschool.com', { emailConfirmed: false })
    const response = await client.post('/api/registrations', student)
    expect(response.status).toBe(403)
  })

  it('applies the role rules: Student expected year, Alumni past year, Staff details', async () => {
    const a = await signUp('a@hilcoeschool.com')
    const tooLate = await a.client.post('/api/registrations', { ...student, graduationYear: 2034 })
    expect(tooLate.status).toBe(422)
    expect(tooLate.body.error.fields).toHaveProperty('graduationYear')

    const b = await signUp('b@gmail.com')
    const future = await b.client.post('/api/registrations', { ...alumni, graduationYear: 2027 })
    expect(future.body.error.fields).toHaveProperty('graduationYear')
    const early = await b.client.post('/api/registrations', { ...alumni, graduationYear: 1996 })
    expect(early.body.error.fields).toHaveProperty('graduationYear')

    await t.container.prisma.staffEmailEntry.create({ data: { email: 'c@hilcoeschool.com' } })
    const c = await signUp('c@hilcoeschool.com')
    const missing = await c.client.post('/api/registrations', { ...staff, currentPosition: ' ' })
    expect(missing.body.error.fields).toEqual({ currentPosition: 'Required' })
    expect(await t.container.prisma.memberAccount.count()).toBe(0)
    // A refused attempt leaves no sign-in hint, so the client still offers to finish registering.
    expect(t.authProvider.users.get(a.user.id)?.accountKind).toBeNull()
  })

  it('rejects over-long text instead of truncating it', async () => {
    const { client } = await signUp('long@gmail.com')
    const response = await client.post('/api/registrations', {
      ...alumni,
      identifyingContext: 'x'.repeat(1001),
    })
    expect(response.status).toBe(422)
    expect(response.body.error.fields).toHaveProperty('identifyingContext')
  })

  it('refuses a duplicate email in any letter case', async () => {
    await createMember(t, { email: 'taken@hilcoeschool.com' })
    const { client } = await signUp('TAKEN@HilcoeSchool.com')
    const response = await client.post('/api/registrations', student)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('DUPLICATE')
  })

  it('refuses a second registration of the same Supabase user', async () => {
    const { client } = await signUp('once@hilcoeschool.com')
    await client.post('/api/registrations', student).expect(201)
    const again = await client.post('/api/registrations', student)
    expect(again.status).toBe(409)
    const status = await client.get('/api/registrations/me')
    expect(status.body.registered).toBe(true)
  })

  it('refuses an email whose HMAC is blocked', async () => {
    const secret = t.container.config.emailHashSecret
    await t.container.prisma.blockedEmailHash.create({
      data: { emailHmac: hashEmail('fake.person@gmail.com', secret) },
    })
    const { client } = await signUp('Fake.Person@Gmail.com')
    const response = await client.post('/api/registrations', alumni)
    expect(response.status).toBe(403)
    expect(await t.container.prisma.memberAccount.count()).toBe(0)
  })

  it('refuses an Administrator email', async () => {
    await t.container.prisma.administratorAccount.create({
      data: { authUserId: randomUUID(), email: 'admin@hilcoeschool.com' },
    })
    const { client } = await signUp('admin@hilcoeschool.com')
    const response = await client.post('/api/registrations', student)
    expect(response.status).toBe(403)
  })

  it('needs a valid token', async () => {
    const response = await request(t.app).post('/api/registrations').send(student)
    expect(response.status).toBe(401)
  })

  it('limits registration attempts', async () => {
    const { client } = await signUp('limit@gmail.com')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client.post('/api/registrations', { ...alumni, displayName: ' ' }).expect(422)
    }
    const limited = await client.post('/api/registrations', alumni)
    expect(limited.status).toBe(429)
  })
})
