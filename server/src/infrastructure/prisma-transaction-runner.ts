import type { TransactionRunner, Tx } from '../kernel/index.js'
import type { PrismaClient } from '../generated/prisma/client.js'

/** TransactionRunner over Prisma interactive transactions: commits on return, rolls back on throw. */
export class PrismaTransactionRunner implements TransactionRunner {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: { maxWaitMs?: number; timeoutMs?: number } = {},
  ) {}

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx), {
      maxWait: this.options.maxWaitMs ?? 5_000,
      timeout: this.options.timeoutMs ?? 15_000,
    })
  }
}
