import { describe, expect, it } from 'vitest'
import { relativeTimeLabel } from '../src/client/time-format.ts'

describe('relativeTimeLabel', () => {
  it('maps every bucket unit to its dictionary key', () => {
    expect(relativeTimeLabel({ unit: 'now', n: 0 })).toEqual({ key: 'timeNow', n: 0 })
    expect(relativeTimeLabel({ unit: 'minutes', n: 5 })).toEqual({ key: 'timeMinutes', n: 5 })
    expect(relativeTimeLabel({ unit: 'hours', n: 3 })).toEqual({ key: 'timeHours', n: 3 })
    expect(relativeTimeLabel({ unit: 'days', n: 2 })).toEqual({ key: 'timeDays', n: 2 })
    expect(relativeTimeLabel({ unit: 'months', n: 4 })).toEqual({ key: 'timeMonths', n: 4 })
    expect(relativeTimeLabel({ unit: 'years', n: 1 })).toEqual({ key: 'timeYears', n: 1 })
  })

  it('falls back to now for an unknown unit', () => {
    expect(relativeTimeLabel({ unit: 'fortnights' as never, n: 2 })).toEqual({ key: 'timeNow', n: 2 })
  })
})
