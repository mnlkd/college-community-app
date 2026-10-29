import type { FieldErrors } from '@hilcoe/shared'
import type { z } from 'zod'
import { ValidationError } from './errors.js'

/** Parses input with a shared Zod schema; any failure becomes a ValidationError naming each field. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const fields: FieldErrors = {}
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.') || '_'
    fields[path] ??= issue.message
  }
  throw new ValidationError(fields)
}
