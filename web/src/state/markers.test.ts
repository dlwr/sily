import { describe, expect, it } from 'vitest'
import { followMarkers, minSliceSeconds } from './markers'

const identity = (n = 4) => Array.from({ length: n }, (_, i) => i)

describe('followMarkers', () => {
  it('keeps pads on their slices when a marker is added before them', () => {
    expect(followMarkers([0, 100, 200], [0, 50, 100, 200], [2, 1, 0, 3])).toEqual([3, 2, 0, 1])
  })

  it('hands a moved slice back to the pad that held it', () => {
    expect(followMarkers([0, 100, 200], [0, 120, 200], [2, 1, 0, 3])).toEqual([2, 1, 0, 3])
  })

  it('empties a pad whose slice was removed', () => {
    const after = followMarkers([0, 100, 200], [0, 200], [0, 1, 2, 3])
    expect([after[0], after[1] >= 2, after[2]]).toEqual([0, true, 1])
  })

  it('keeps every pad pointing at a different slice', () => {
    const after = followMarkers([0, 100, 200], [0, 200], identity())
    expect(new Set(after).size).toBe(4)
  })

  it('treats a sample without markers as one slice from the start', () => {
    expect(followMarkers([], [0, 100], identity()).slice(0, 2)).toEqual([0, 1])
  })

  it('offers new slices to pads that had none', () => {
    expect(followMarkers([0], [0, 100, 200], identity()).slice(0, 3)).toEqual([0, 1, 2])
  })
})

describe('minSliceSeconds', () => {
  it('keeps slices a little under a sixteenth note long at the source tempo', () => {
    expect(minSliceSeconds(120)).toBeCloseTo(0.1)
  })

  it('allows longer slices for a slower source', () => {
    expect(minSliceSeconds(60)).toBeCloseTo(0.2)
  })

  it('falls back to a short gap when the tempo is unknown', () => {
    expect(minSliceSeconds(null)).toBe(0.05)
  })
})
