import { describe, expect, it } from 'vitest'
import { autoFx, autoMix, autoPitch, estimateKey, type Key } from './shape'

const C_MINOR: Key = { root: 0, minor: true }
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
const oneHot = (classes: number[], weights: number[]) => {
  const c = Array(12).fill(0.01)
  classes.forEach((pc, i) => (c[pc] += weights[i]))
  return c
}

describe('estimateKey', () => {
  it('hears a C major profile as C major', () => {
    expect(estimateKey(oneHot([0, 4, 7, 2, 5, 9, 11], [1, 0.8, 0.9, 0.4, 0.5, 0.4, 0.3]))).toEqual({ root: 0, minor: false })
  })

  it('hears an A minor profile as A minor', () => {
    expect(estimateKey(oneHot([9, 0, 4, 2, 5, 7, 11], [1, 0.8, 0.9, 0.4, 0.5, 0.4, 0.3]))).toEqual({ root: 9, minor: true })
  })

  it('hears an F sharp minor profile as F sharp minor', () => {
    expect(estimateKey(oneHot([6, 9, 1, 8, 11, 2, 4], [1, 0.8, 0.9, 0.4, 0.5, 0.4, 0.3]))).toEqual({ root: 6, minor: true })
  })
})

describe('autoPitch', () => {
  it('snaps a bass note to the nearest note of the key', () => {
    expect(autoPitch('bass', hz(40.4), 0.95, C_MINOR)).toBeCloseTo(0.6, 1)
  })

  it('leaves a bass note that is already in key alone', () => {
    expect(autoPitch('bass', hz(36), 0.95, C_MINOR)).toBeCloseTo(0, 5)
  })

  it('tunes a kick to the root or fifth near the kick register', () => {
    expect(autoPitch('kick', 70, 0.9, C_MINOR)).toBeCloseTo(36 - (69 + 12 * Math.log2(70 / 440)), 2)
  })

  it('does not drag a kick further than six semitones', () => {
    expect(autoPitch('kick', 180, 0.9, C_MINOR)).toBe(0)
  })

  it('moves a snare toward its register by at most three semitones', () => {
    expect(autoPitch('snare', 120, 0.8, C_MINOR)).toBe(3)
  })

  it('leaves hats alone', () => {
    expect(autoPitch('closed_hat', 3000, 0.9, C_MINOR)).toBe(0)
  })

  it('leaves sounds without a clear pitch alone', () => {
    expect(autoPitch('bass', 55, 0.3, C_MINOR)).toBe(0)
  })
})

describe('autoFx', () => {
  it('gives kicks a kick preset', () => {
    expect(autoFx('kick')?.highpass_hz).toBeGreaterThan(0)
  })

  it('gives hats a brightening preset', () => {
    expect(autoFx('closed_hat')?.high_db).toBeGreaterThan(0)
  })

  it('leaves effects sounds alone', () => {
    expect(autoFx('fx')).toBeNull()
  })
})

describe('autoMix', () => {
  it('sends a snare a little to the reverb', () => {
    expect(autoMix('snare').sends.reverb).toBeGreaterThan(0)
  })

  it('keeps the kick dry', () => {
    expect(autoMix('kick').sends).toEqual({ reverb: 0, delay: 0 })
  })

  it('sends upper parts to the delay as well', () => {
    expect(autoMix('upper').sends.delay).toBeGreaterThan(0)
  })

  it('compresses the kick', () => {
    expect(autoMix('kick').comp).toBeGreaterThan(0)
  })

  it('never sends more than a fifth of a pad', () => {
    const all = ['kick', 'snare', 'clap', 'rim', 'closed_hat', 'open_hat', 'tom', 'cymbal', 'perc', 'bass', 'keys', 'vocal', 'melody', 'fx', 'upper'] as const
    expect(all.every((c) => autoMix(c).sends.reverb <= 0.2 && autoMix(c).sends.delay <= 0.2)).toBe(true)
  })
})
