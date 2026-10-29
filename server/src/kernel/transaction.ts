import type { Prisma } from '../generated/prisma/client.js'

/** The current transaction, passed to every operation taking part in one change. */
export type Tx = Prisma.TransactionClient

/** Runs a unit of work in one PostgreSQL transaction (ODD Table 5). */
export interface TransactionRunner {
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>
}
