import { describe, expect, it } from 'vitest'
import { sliceQuality } from './quality'

const SR = 1000
const hit = (frames: number, at: number, before = 0) =>
  Float32Array.from({ length: frames }, (_, i) => (i < at ? before * Math.sin(i) : Math.exp(-(i - at) / 100) * Math.sin(i)))

describe('sliceQuality', () => {
  it('rates a hit out of silence highly', () => {
    expect(sliceQuality(hit(1000, 200), 200, 1000, SR)).toBeGreaterThan(0.8)
  })

  it('rates a hit over a loud sound that was already ringing lower', () => {
    expect(sliceQuality(hit(1000, 200, 0.8), 200, 1000, SR)).toBeLessThan(0.5)
  })

  it('rates a slice too short to hold the hit lower', () => {
    expect(sliceQuality(hit(1000, 200), 200, 220, SR)).toBeLessThan(0.5)
  })
})
