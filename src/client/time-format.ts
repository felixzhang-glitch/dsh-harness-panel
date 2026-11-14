/**
 * Locale mapping for the primitives' structured relative-time bucket. The
 * bucketing itself stays in `relativeTime` so every surface naming the same
 * moment agrees; the words live in this plugin's dictionaries.
 *
 * @module dsh-harness-panel/client/time-format
 */

import type { HarnessPanelLocaleKey } from './locales.ts'

/** Relative-time bucket units, mirroring the primitives' RelativeTimeUnit. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeBucket {
  readonly unit: RelativeTimeUnit
  readonly n: number
}

/** Dictionary key per bucket unit. */
const UNIT_KEY: Record<RelativeTimeUnit, HarnessPanelLocaleKey> = {
  now: 'timeNow',
  minutes: 'timeMinutes',
  hours: 'timeHours',
  days: 'timeDays',
  months: 'timeMonths',
  years: 'timeYears',
}

/**
 * Resolve one bucket to its dictionary key and magnitude. Unknown units fall
 * back to 'now' so a future bucket never renders a raw key.
 *
 * @param bucket - structured relative time from the primitives.
 * @returns the locale key and the {n} fill value.
 */
export function relativeTimeLabel(bucket: RelativeBucket): { readonly key: HarnessPanelLocaleKey; readonly n: number } {
  return { key: UNIT_KEY[bucket.unit] ?? 'timeNow', n: bucket.n }
}
