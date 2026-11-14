import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

/** Placeholder names one template carries, sorted. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1] as string).sort()
}

describe('panel dictionaries', () => {
  it('keeps the zh and en key sets identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('keeps every entry a non-empty string', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(typeof value, `zh.${key}`).toBe('string')
      expect(value.length, `zh.${key}`).toBeGreaterThan(0)
    }
    for (const [key, value] of Object.entries(en)) {
      expect(typeof value, `en.${key}`).toBe('string')
      expect(value.length, `en.${key}`).toBeGreaterThan(0)
    }
  })

  it('keeps the placeholder sets identical per key', () => {
    for (const key of Object.keys(zh)) {
      expect(placeholders(en[key as keyof typeof en]), `en.${key}`)
        .toEqual(placeholders(zh[key as keyof typeof zh]))
    }
  })
})
