import { describe, expect, it } from 'vitest'
import {
  filterSkillRows,
  mergeSkillRows,
  skillToggleBody,
  type DisabledSkillLike,
  type SkillEntryLike,
  type SkillRow,
} from '../src/client/skills-model.ts'

const enabled: SkillEntryLike[] = [
  { name: 'zeta', description: 'Zeta skill', modelInvocable: true, path: '/z/SKILL.md' },
  { name: 'alpha', description: 'Alpha skill', modelInvocable: false, whenToUse: 'alpha work' },
]

const disabled: DisabledSkillLike[] = [
  { name: 'zeta', description: 'Stale zeta', modelInvocable: true, disabledAt: 2 },
  { name: 'beta', description: 'Beta skill', modelInvocable: true, disabledAt: 3 },
]

describe('mergeSkillRows', () => {
  it('dedupes by name, lets the live catalog win, and sorts', () => {
    const rows = mergeSkillRows(enabled, disabled)
    expect(rows.map(row => row.name)).toEqual(['alpha', 'beta', 'zeta'])
    expect(rows.find(row => row.name === 'zeta')?.description).toBe('Zeta skill')
    expect(rows.find(row => row.name === 'beta')?.enabled).toBe(false)
  })

  it('returns sorted rows with enabled flags', () => {
    const rows = mergeSkillRows(enabled, [])
    expect(rows.map(row => [row.name, row.enabled])).toEqual([['alpha', true], ['zeta', true]])
  })
})

describe('filterSkillRows', () => {
  const rows: SkillRow[] = mergeSkillRows(enabled, disabled)

  it('matches name, description, and whenToUse case-insensitively', () => {
    expect(filterSkillRows(rows, 'ALPHA').map(row => row.name)).toEqual(['alpha'])
    expect(filterSkillRows(rows, 'beta skill').map(row => row.name)).toEqual(['beta'])
    expect(filterSkillRows(rows, 'alpha work').map(row => row.name)).toEqual(['alpha'])
  })

  it('returns everything for an empty query', () => {
    expect(filterSkillRows(rows, '  ').map(row => row.name)).toEqual(['alpha', 'beta', 'zeta'])
  })
})

describe('skillToggleBody', () => {
  const row: SkillRow = {
    name: 'alpha',
    description: 'Alpha',
    path: '/a/SKILL.md',
    whenToUse: 'alpha work',
    modelInvocable: true,
    enabled: true,
  }

  it('sends only the name when enabling', () => {
    expect(skillToggleBody(row, true)).toEqual({ name: 'alpha', enabled: true })
  })

  it('carries display metadata when disabling', () => {
    expect(skillToggleBody(row, false)).toEqual({
      name: 'alpha',
      enabled: false,
      description: 'Alpha',
      path: '/a/SKILL.md',
      whenToUse: 'alpha work',
      modelInvocable: true,
    })
  })
})
