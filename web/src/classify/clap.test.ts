import { describe, expect, it } from 'vitest'
import { CLAP_RATE, clipForClap, MAX_CLIP_SECONDS, normalize, resample } from './clap'

describe('resample', () => {
  it('keeps the signal at the same rate', () => {
    expect(Array.from(resample(new Float32Array([0, 1, 2]), 48000, 48000))).toEqual([0, 1, 2])
  })

  it('doubles the length when doubling the rate', () => {
    expect(resample(new Float32Array(100), 24000, 48000).length).toBe(200)
  })

  it('interpolates between samples', () => {
    expect(resample(new Float32Array([0, 1]), 24000, 48000)[1]).toBeCloseTo(0.5)
  })
})

describe('clipForClap', () => {
  it('brings the slice to the rate CLAP expects', () => {
    expect(clipForClap(new Float32Array(44100), 44100).length).toBe(CLAP_RATE)
  })

  it('keeps only the head of a long slice', () => {
    expect(clipForClap(new Float32Array(44100 * 20), 44100).length).toBe(CLAP_RATE * MAX_CLIP_SECONDS)
  })
})

describe('normalize', () => {
  it('scales the embedding to unit length', () => {
    expect(normalize([3, 4])).toEqual([0.6, 0.8])
  })

  it('leaves a zero embedding alone', () => {
    expect(normalize([0, 0])).toEqual([0, 0])
  })
})
