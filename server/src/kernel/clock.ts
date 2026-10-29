/** Source of the current time, injectable so time limits can be tested. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
