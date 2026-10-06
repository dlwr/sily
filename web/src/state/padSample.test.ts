import { describe, expect, it } from 'vitest'
import { isSlice, sampleKey, slicesOf, type PadSample } from './padSample'

const library: PadSample = { id: 's1', name: 'kick', category: 'kick' }
const slice = (bank: number, range: [number, number] = [100, 200]): PadSample => ({ bank, range, name: 'break.wav A3', category: 'snare' })

describe('isSlice', () => {
  it('tells a slice of a bank from a library sample', () => {
    expect([isSlice(slice(0)), isSlice(library)]).toEqual([true, false])
  })
})

describe('sampleKey', () => {
  it('keys a library sample by its id', () => {
    expect(sampleKey(library, { rate: 1, stretch: null })).toBe('s1')
  })

  it('changes the key of a slice when its source plays at another speed', () => {
    const a = sampleKey(slice(0), { rate: 1, stretch: null })
    const b = sampleKey(slice(0), { rate: 1.1, stretch: null })
    expect(a).not.toBe(b)
  })

  it('changes the key of a slice when its source is stretched', () => {
    const a = sampleKey(slice(0), { rate: 1, stretch: null })
    const b = sampleKey(slice(0), { rate: 1, stretch: 0.9 })
    expect(a).not.toBe(b)
  })
})

describe('slicesOf', () => {
  it('finds the pads that play a slice of the bank', () => {
    const pads = [{ sample: slice(0) }, { sample: library }, { sample: null }, { sample: slice(1) }, { sample: slice(0, [0, 50]) }]
    expect(slicesOf(pads, 0)).toEqual([0, 4])
  })
})
