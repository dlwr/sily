import { describe, expect, it } from 'vitest'
import { arrangePads, remapEvents, roleOf } from './categories'

describe('arrangePads', () => {
  it('puts kicks first, then snares, then hats like an MPC kit', () => {
    const slices = ['closed_hat', 'snare', 'kick', 'bass'] as const
    expect(arrangePads([0, 1, 2, 3], (s) => slices[s])).toEqual([2, 1, 0, 3])
  })

  it('keeps the original order within a category', () => {
    const slices = ['kick', 'snare', 'kick', 'kick'] as const
    expect(arrangePads([0, 1, 2, 3], (s) => slices[s])).toEqual([0, 2, 3, 1])
  })

  it('leaves unlabelled slices at the end', () => {
    const slices = [null, 'kick', 'snare'] as const
    expect(arrangePads([0, 1, 2], (s) => slices[s])).toEqual([1, 2, 0])
  })
})

describe('remapEvents', () => {
  it('moves events to the pad that now holds their slice', () => {
    const events = [{ pad: 0 }, { pad: 1 }, { pad: 2 }]
    expect(remapEvents(events, [0, 1, 2], [2, 0, 1]).map((e) => e.pad)).toEqual([1, 2, 0])
  })

  it('leaves events on pads outside the mapping alone', () => {
    expect(remapEvents([{ pad: 9 }], [0, 1], [1, 0])[0].pad).toBe(9)
  })
})

describe('roleOf', () => {
  it('keeps a role as it is', () => {
    expect(roleOf('kick')).toBe('kick')
  })

  it('folds clap and rim into snare', () => {
    expect([roleOf('clap'), roleOf('rim')]).toEqual(['snare', 'snare'])
  })

  it('folds cymbal into open hat', () => {
    expect(roleOf('cymbal')).toBe('open_hat')
  })

  it('folds tom into perc', () => {
    expect(roleOf('tom')).toBe('perc')
  })

  it('folds the upper kinds into upper', () => {
    expect(['keys', 'vocal', 'melody', 'fx'].map((c) => roleOf(c as never))).toEqual(['upper', 'upper', 'upper', 'upper'])
  })
})
