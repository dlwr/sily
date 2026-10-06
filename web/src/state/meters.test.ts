import { describe, expect, it } from 'vitest'
import { fallMeters, meterHeight } from './meters'

describe('fallMeters', () => {
  it('jumps up to a louder peak', () => {
    expect(fallMeters([0.2], Float32Array.from([0.8]))[0]).toBeCloseTo(0.8)
  })

  it('falls back slowly from a peak', () => {
    const [level] = fallMeters([0.8], Float32Array.from([0]))
    expect(level).toBeGreaterThan(0.5)
  })

  it('falls below the peak when the sound stops', () => {
    const [level] = fallMeters([0.8], Float32Array.from([0]))
    expect(level).toBeLessThan(0.8)
  })

  it('starts from silence when there was nothing before', () => {
    const [first, second] = fallMeters([], Float32Array.from([0.3, 0]))
    expect([first.toFixed(3), second]).toEqual(['0.300', 0])
  })
})

describe('meterHeight', () => {
  it('fills the meter at full scale', () => {
    expect(meterHeight(1)).toBe(1)
  })

  it('shows nothing for silence', () => {
    expect(meterHeight(0)).toBe(0)
  })

  it('puts -24 dB halfway up', () => {
    expect(meterHeight(10 ** (-24 / 20))).toBeCloseTo(0.5)
  })
})
