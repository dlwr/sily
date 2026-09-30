import { describe, expect, it } from 'vitest'
import { pickLabel, resample } from './clap'

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

describe('pickLabel', () => {
  const labels = { bass: [[1, 0, 0]], keys: [[0, 1, 0]], fx: [[0, 0, 1]] }

  it('picks the closest label embedding', () => {
    expect(pickLabel([0.1, 0.9, 0.2], labels).category).toBe('keys')
  })

  it('uses the best prompt of each label', () => {
    expect(pickLabel([0.6, 0.1, 0.5], { ...labels, fx: [[0, 0, 1], [0.8, 0, 0.6]] }).category).toBe('fx')
  })

  it('reports a confidence between zero and one', () => {
    const { confidence } = pickLabel([0.1, 0.9, 0.2], labels)
    expect(confidence > 0 && confidence <= 1).toBe(true)
  })
})
