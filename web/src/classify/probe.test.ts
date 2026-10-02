import { describe, expect, it } from 'vitest'
import { probeScores, type Probe } from './probe'

const probe: Probe = {
  classes: ['kick', 'snare'],
  mean: [1, 0],
  scale: [2, 1],
  weights: [
    [1, 0],
    [0, 1],
  ],
  bias: [0, 0],
}

describe('probeScores', () => {
  it('favours the class whose weights match the standardized input', () => {
    const scores = probeScores(probe, [5, 0])
    expect(scores.kick).toBeGreaterThan(scores.snare!)
  })

  it('standardizes each input before weighing it', () => {
    const scores = probeScores(probe, [1, 1])
    expect(scores.snare).toBeGreaterThan(scores.kick!)
  })

  it('gives probabilities that sum to one', () => {
    const scores = probeScores(probe, [3, 2])
    expect(scores.kick! + scores.snare!).toBeCloseTo(1)
  })
})
