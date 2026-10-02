import { describe, expect, it } from 'vitest'
import { beatGrid, phraseRanges, pickPhrases } from './phrases'

const SR = 1000
const BEAT = 500

describe('beatGrid', () => {
  it('lines the beats up with the onsets', () => {
    const onsets = [130, 630, 1130, 1380, 1630, 2130]
    expect(beatGrid({ onsets, kicks: [], frames: 4000, sampleRate: SR, bpm: 120 }).beat).toBeCloseTo(BEAT)
    expect(beatGrid({ onsets, kicks: [], frames: 4000, sampleRate: SR, bpm: 120 }).first % BEAT).toBe(130)
  })

  it('starts the bar where the kicks land', () => {
    const onsets = [130, 630, 1130, 1630, 2130, 2630, 3130, 3630]
    const grid = beatGrid({ onsets, kicks: [630, 2630], frames: 4000, sampleRate: SR, bpm: 120 })
    expect(grid.downbeat).toBe(630)
  })
})

describe('phraseRanges', () => {
  it('cuts whole bars and half bars from each downbeat', () => {
    const ranges = phraseRanges({ beat: BEAT, first: 0, downbeat: 0 }, 4000)
    expect(ranges).toEqual([
      [0, 2000],
      [0, 1000],
      [1000, 2000],
      [2000, 4000],
      [2000, 3000],
      [3000, 4000],
    ])
  })

  it('leaves out a bar that runs past the end', () => {
    expect(phraseRanges({ beat: BEAT, first: 0, downbeat: 500 }, 3000)).toEqual([
      [500, 2500],
      [500, 1500],
      [1500, 2500],
    ])
  })
})

describe('pickPhrases', () => {
  it('takes the most melodic phrases', () => {
    const picked = pickPhrases(
      [
        { range: [0, 1] as [number, number], upper: 0.2 },
        { range: [1, 2] as [number, number], upper: 0.9 },
        { range: [2, 3] as [number, number], upper: 0.6 },
      ],
      2,
    )
    expect(picked).toEqual([
      [1, 2],
      [2, 3],
    ])
  })

  it('skips a phrase that sounds the same as one already taken', () => {
    const picked = pickPhrases(
      [
        { range: [0, 1] as [number, number], upper: 0.9, embedding: [1, 0] },
        { range: [1, 2] as [number, number], upper: 0.85, embedding: [1, 0] },
        { range: [2, 3] as [number, number], upper: 0.5, embedding: [0, 1] },
      ],
      2,
    )
    expect(picked).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it('does not take two phrases that overlap', () => {
    const picked = pickPhrases(
      [
        { range: [0, 2000] as [number, number], upper: 0.9 },
        { range: [0, 1000] as [number, number], upper: 0.8 },
        { range: [2000, 3000] as [number, number], upper: 0.3 },
      ],
      2,
    )
    expect(picked).toEqual([
      [0, 2000],
      [2000, 3000],
    ])
  })
})
