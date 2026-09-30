import { describe, expect, it } from 'vitest'
import { DEFAULT_FX, isFlat, presetsFor } from './fx'

describe('presetsFor', () => {
  it('offers kick presets for a kick', () => {
    expect(presetsFor('kick').some((p) => p.name.includes('キック'))).toBe(true)
  })

  it('does not offer kick presets for a hat', () => {
    expect(presetsFor('closed_hat').some((p) => p.name.includes('キック'))).toBe(false)
  })

  it('always offers the reset preset first', () => {
    expect(presetsFor('fx')[0].settings).toEqual(DEFAULT_FX)
  })

  it('fills every field of a preset', () => {
    for (const p of presetsFor('kick')) expect(Object.keys(p.settings).sort()).toEqual(Object.keys(DEFAULT_FX).sort())
  })
})

describe('isFlat', () => {
  it('is true for the defaults', () => {
    expect(isFlat(DEFAULT_FX)).toBe(true)
  })

  it('is false once anything is boosted', () => {
    expect(isFlat({ ...DEFAULT_FX, high_db: 2 })).toBe(false)
  })
})
