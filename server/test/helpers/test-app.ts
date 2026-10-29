import type { Express } from 'express'
import { createApp } from '../../src/infrastructure/app.js'
import {
  createContainer,
  type Container,
  type ContainerOverrides,
} from '../../src/infrastructure/container.js'
import { FakeAuthProvider, FakeInventory, FakeStorage } from './fakes.js'
import { FakeClock } from './fake-clock.js'
import { JwksServer } from './jwks-server.js'
import { testConfig } from './test-env.js'

export interface TestApp {
  app: Express
  container: Container
  clock: FakeClock
  jwks: JwksServer
  authProvider: FakeAuthProvider
  storage: FakeStorage
  inventory: FakeInventory
  close(): Promise<void>
}

/**
 * The real application against the test schema, with a fake clock, a local JWKS issuer and
 * in-memory Supabase Auth and Storage.
 */
export async function startTestApp(
  overrides: Pick<ContainerOverrides, 'rateLimitRules'> = {},
): Promise<TestApp> {
  const jwks = new JwksServer()
  await jwks.start()
  const clock = new FakeClock(new Date())
  const authProvider = new FakeAuthProvider()
  const storage = new FakeStorage()
  const inventory = new FakeInventory(storage, authProvider)
  const container = createContainer(testConfig({ SUPABASE_URL: jwks.url }), {
    clock,
    authProvider,
    sessions: authProvider,
    storage,
    inventory,
    ...overrides,
  })
  return {
    app: createApp(container),
    container,
    clock,
    jwks,
    authProvider,
    storage,
    inventory,
    async close() {
      await container.prisma.$disconnect()
      await jwks.stop()
    },
  }
}
