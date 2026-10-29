import { createContainer, loadConfig } from '../src/infrastructure/index.js'

// Runs the daily CleanupJob once (the server also runs it at start-up and every 24 hours).
const container = createContainer(loadConfig())
try {
  const summary = await container.cleanup.run()
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = summary.failedSteps.length > 0 ? 1 : 0
} finally {
  await container.prisma.$disconnect()
}
