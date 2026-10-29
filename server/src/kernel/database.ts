import { Prisma } from '../generated/prisma/client.js'

/** True for a unique-constraint violation (Prisma P2002), e.g. from a concurrent insert. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
