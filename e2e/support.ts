import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createClient, type User } from '@supabase/supabase-js'
import { expect, type Page, type Route } from '@playwright/test'
import pg from 'pg'

if (existsSync('server/.env')) process.loadEnvFile('server/.env')

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set (server/.env) for the end-to-end tests`)
  return value
}

export const seedPassword = (): string => env('SEED_PASSWORD')

export const accounts = {
  student: 'selamawit.girma@hilcoeschool.com',
  firstAdmin: 'henok.tsegaye@hilcoeschool.com',
  admin: 'marta.kebede@hilcoeschool.com',
}

export function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Removes every authenticator factor of the account, so the next sign-in enrolls again. */
export async function resetFactors(email: string): Promise<void> {
  const admin = adminClient().auth.admin
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find((candidate) => candidate.email === email)
    if (user) {
      const factors = await admin.mfa.listFactors({ userId: user.id })
      if (factors.error) throw factors.error
      for (const factor of factors.data.factors) {
        const removed = await admin.mfa.deleteFactor({ userId: user.id, id: factor.id })
        if (removed.error) throw removed.error
      }
      return
    }
    if (data.users.length < 200) throw new Error(`No auth user for ${email}; run npm run db:seed`)
  }
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error('Invalid base32 secret')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as produced by authenticator apps. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return value.toString().padStart(6, '0')
}

/** A code from a time step not used before, so a verifier that rejects reuse still accepts it. */
export async function freshTotp(secret: string, usedStep: { value: number }): Promise<string> {
  let step = Math.floor(Date.now() / 30_000)
  if (step <= usedStep.value) {
    await new Promise((resolve) => setTimeout(resolve, (usedStep.value + 1) * 30_000 - Date.now() + 500))
    step = Math.floor(Date.now() / 30_000)
  }
  usedStep.value = step
  return totp(secret)
}

export async function signInWithPassword(
  page: Page,
  email: string,
  password = seedPassword(),
): Promise<void> {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function expectSignInPage(page: Page, admin: boolean): Promise<void> {
  await expect(page).toHaveURL(admin ? /\/admin\/login$/ : /\/login$/)
  await expect(
    page.getByRole('heading', { name: admin ? 'Administrator sign in' : 'Member sign in' }),
  ).toBeVisible()
}

/** A unique address for a throwaway account. Supabase never emails it: the e2e routes below intercept every send. */
export function throwawayEmail(domain = 'hilcoeschool.com'): string {
  return `e2e.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

async function fulfilJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: cors,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Replaces the Supabase calls that would send an email (sign-up, password reset, email change)
 * with admin generateLink, which performs the same change without sending anything and returns
 * the 6-digit code. Verification itself still goes to Supabase.
 */
export async function interceptAuthEmails(page: Page) {
  const admin = adminClient().auth.admin
  const codes = new Map<string, string>()
  const remember = (email: string, otp: string | undefined) => {
    if (!otp) throw new Error(`generateLink returned no code for ${email}`)
    codes.set(email.toLowerCase(), otp)
  }

  await page.route(/\/auth\/v1\/signup(\?|$)/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = route.request().postDataJSON() as { email: string; password: string; data?: object }
    const { data, error } = await admin.generateLink({
      type: 'signup',
      email: body.email,
      password: body.password,
      options: { data: body.data },
    })
    if (error) throw error
    remember(body.email, data.properties.email_otp)
    await fulfilJson(route, data.user)
  })

  await page.route(/\/auth\/v1\/recover(\?|$)/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = route.request().postDataJSON() as { email: string }
    const { data, error } = await admin.generateLink({ type: 'recovery', email: body.email })
    if (error) throw error
    remember(body.email, data.properties.email_otp)
    await fulfilJson(route, {})
  })

  await page.route(/\/auth\/v1\/user(\?|$)/, async (route) => {
    const request = route.request()
    const body = request.method() === 'PUT' ? (request.postDataJSON() as { email?: string }) : {}
    if (!body.email) return route.fallback()
    const current = await userFor(request.headers()['authorization'])
    const { data, error } = await admin.generateLink({
      type: 'email_change_new',
      email: current.email ?? '',
      newEmail: body.email,
    })
    if (error) throw error
    remember(body.email, data.properties.email_otp)
    await fulfilJson(route, data.user)
  })

  return {
    codeFor(email: string): string {
      const code = codes.get(email.toLowerCase())
      if (!code) throw new Error(`No code was sent to ${email}`)
      return code
    },
  }
}

async function userFor(authorization: string | undefined): Promise<User> {
  const token = authorization?.replace(/^Bearer /, '') ?? ''
  const { data, error } = await adminClient().auth.getUser(token)
  if (error) throw error
  return data.user
}

/**
 * Removes a throwaway account through the app (so platform rows go too), falling back to
 * deleting only the Supabase user when the password no longer works.
 */
export async function removeThrowawayAccount(email: string, password: string): Promise<void> {
  const client = adminClient()
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.data.session) {
    const response = await fetch('http://localhost:4000/api/members/me', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${signedIn.data.session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: password }),
    })
    if (response.status === 204 || response.status === 401) return
  }
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find((candidate) => candidate.email === email.toLowerCase())
    if (user) {
      await client.auth.admin.deleteUser(user.id)
      return
    }
    if (data.users.length < 200) return
  }
}

/**
 * Marks the seeded sample notices of a member unread again and removes the notices other
 * end-to-end tests created for them (likes, comments, replies), so notification tests can re-run.
 */
export async function resetSeedNotices(email: string): Promise<void> {
  const client = new pg.Client({ connectionString: env('DATABASE_URL') })
  await client.connect()
  try {
    const member = '(SELECT id FROM app.member_account WHERE email = $1)'
    await client.query(
      `DELETE FROM app.notification WHERE event_key NOT LIKE 'seed:%' AND recipient_id = ${member}`,
      [email],
    )
    await client.query(
      `UPDATE app.notification SET unread = true
        WHERE event_key LIKE 'seed:%'
          AND recipient_id = ${member}`,
      [email],
    )
  } finally {
    await client.end()
  }
}

/** Runs one SQL statement against the dev database (for setup and cleanup only). */
export async function sql(text: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: env('DATABASE_URL') })
  await client.connect()
  try {
    await client.query(text, params)
  } finally {
    await client.end()
  }
}

export const API = 'http://localhost:4000/api'

/** Signs a Supabase user in without a browser and returns the access token. */
export async function accessTokenFor(email: string, password: string): Promise<string> {
  const { data, error } = await adminClient().auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session.access_token
}

/** Calls the API as the given user; returns the status and parsed body. */
export async function callApi(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null }
}

/**
 * Creates a confirmed Supabase user without sending email and completes registration through the
 * API, as the registration screens would. Returns the access token.
 */
export async function registerThrowawayMember(
  email: string,
  password: string,
  registration: Record<string, unknown>,
): Promise<{ token: string; status: number }> {
  const { error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const token = await accessTokenFor(email, password)
  const { status } = await callApi(token, 'POST', '/registrations', registration)
  return { token, status }
}

/** Deletes a Supabase user by email, if there is one. */
export async function deleteAuthUser(email: string): Promise<void> {
  const client = adminClient()
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const user = data.users.find((candidate) => candidate.email === email.toLowerCase())
    if (user) {
      await client.auth.admin.deleteUser(user.id)
      return
    }
    if (data.users.length < 200) return
  }
}

/**
 * Administrator sign-in on `page`: password, then the authenticator. The first sign-in after
 * resetFactors enrolls a factor and stores its secret in `state`.
 */
export async function signInAdministrator(
  page: Page,
  email: string,
  state: { secret: string | null; used: { value: number } },
  password = seedPassword(),
): Promise<void> {
  await page.goto('/admin/login')
  await signInWithPassword(page, email, password)
  await enrollOrVerify(page, state)
}

/** Completes the authenticator step shown after the password (enrolling when needed). */
export async function enrollOrVerify(
  page: Page,
  state: { secret: string | null; used: { value: number } },
): Promise<void> {
  const enroll = page.getByRole('heading', { name: 'Set up your authenticator' })
  const challenge = page.getByRole('button', { name: 'Verify', exact: true })
  await expect(enroll.or(challenge)).toBeVisible()
  if (await enroll.isVisible()) {
    state.secret = await page.getByTestId('totp-secret').inputValue()
    await page.getByLabel('Authenticator app code').fill(await freshTotp(state.secret, state.used))
    await page.getByRole('button', { name: 'Verify and continue' }).click()
  } else {
    if (!state.secret) throw new Error('No stored authenticator secret; reset the factors first')
    await page.getByLabel('Authenticator app code').fill(await freshTotp(state.secret, state.used))
    await challenge.click()
  }
  await expect(page).toHaveURL(/\/admin$/)
}
