import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createContainer } from './container.js'

const config = loadConfig()
const container = createContainer(config)
const app = createApp(container)

const server = app.listen(config.port, () => {
  container.logger.info({ port: config.port }, 'server listening')
})
const stopCleanup = container.cleanup.schedule()

let stopping = false
function shutdown(signal: string): void {
  if (stopping) return
  stopping = true
  container.logger.info({ signal }, 'shutting down')
  stopCleanup()
  server.close(() => {
    void container.prisma.$disconnect().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
