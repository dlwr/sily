import { describe, expect, it } from 'vitest'
import { audibleTime, frameAt } from './timing'

describe('audibleTime', () => {
  const clock = { currentTime: 5, now: 2000, latency: 0.1 }

  it('shifts the output timestamp by the time since it was taken', () => {
    expect(audibleTime(1500, { contextTime: 2, performanceTime: 1000 }, { ...clock, currentTime: 2.6 })).toBeCloseTo(2.5)
  })

  it('ignores an output timestamp that lands outside the recent past', () => {
    expect(audibleTime(1500, { contextTime: 1, performanceTime: 100 }, clock)).toBeCloseTo(4.4)
  })

  it('falls back to the render clock minus latency when the output timestamp is empty', () => {
    expect(audibleTime(1500, { contextTime: 0, performanceTime: 0 }, clock)).toBeCloseTo(4.4)
  })
})

describe('frameAt', () => {
  it('extrapolates the audition frame to the given moment', () => {
    expect(frameAt({ frame: 44100, time: 10 }, 9.5, 44100)).toBe(22050)
  })

  it('never goes past the given limit', () => {
    expect(frameAt({ frame: 44100, time: 10 }, 11, 44100, 50000)).toBe(50000)
  })

  it('never goes below zero', () => {
    expect(frameAt({ frame: 100, time: 10 }, 9, 44100)).toBe(0)
  })
})
