import { describe, expect, it } from 'vitest'
import { bankForSource, bankOf, extendToBanks, inBank, mapBankEvents, PADS, padName, readBanks, withBank, type BankState } from './banks'

const label = { category: 'kick' as const, confidence: 1, manual: true, scores: { kick: 1 } }

describe('readBanks', () => {
  it('reads each bank as saved', () => {
    const banks: BankState[] = [
      { markers: [0, 10], labels: { 0: label }, sourceSpeed: { mode: 'tape', rate: 1.1 }, sourceBpm: 90, heldOut: true },
      { markers: [5], labels: {}, sourceSpeed: { mode: 'stretch', rate: 0.9 }, sourceBpm: null, heldOut: false },
    ]
    expect(readBanks({ banks }).slice(0, 2)).toEqual(banks)
  })

  it('leaves the banks a project did not save empty', () => {
    expect(readBanks({ banks: [{ markers: [3] }] }).slice(1).map((b) => b.markers)).toEqual([[], [], []])
  })

  it('reads a project saved with a single source as one bank', () => {
    const state = { markers: [0, 10], labels: { 0: label }, sourceSpeed: { mode: 'stretch' as const, rate: 1.2 }, sourceBpm: 88, heldOut: true }
    expect(readBanks(state)[0]).toEqual(state)
  })

  it('fills what a bank does not say with the defaults', () => {
    expect(readBanks({ banks: [{ markers: [3] }] })[0]).toEqual({
      markers: [3],
      labels: {},
      sourceSpeed: { mode: 'tape', rate: 1 },
      sourceBpm: null,
      heldOut: false,
    })
  })

  it('starts an empty project with every bank empty', () => {
    expect(readBanks({}).map((b) => b.markers)).toEqual([[], [], [], []])
  })
})

describe('bankOf', () => {
  it('counts sixteen pads to a bank', () => {
    expect([0, 15, 16, 63].map(bankOf)).toEqual([0, 0, 1, 3])
  })
})

describe('inBank and withBank', () => {
  const all = Array.from({ length: PADS }, (_, i) => i)

  it('takes the sixteen pads of a bank', () => {
    expect(inBank(all, 1)).toEqual(Array.from({ length: 16 }, (_, i) => 16 + i))
  })

  it('replaces only the pads of a bank', () => {
    const replaced = withBank(all, 2, Array(16).fill(-1))
    expect([replaced[31], replaced[32], replaced[47], replaced[48]]).toEqual([31, -1, -1, 48])
  })
})

describe('mapBankEvents', () => {
  const event = (pad: number, beat = 0) => ({ pad, beat })

  it('hands the bank its events with pads counted from its first pad', () => {
    const seen: number[] = []
    mapBankEvents([event(1), event(17), event(18)], 1, (local) => (seen.push(...local.map((e) => e.pad)), local))
    expect(seen).toEqual([1, 2])
  })

  it('puts the changed events back on the bank', () => {
    const events = mapBankEvents([event(17)], 1, (local) => local.map((e) => ({ ...e, pad: 5 })))
    expect(events.map((e) => e.pad)).toEqual([21])
  })

  it('leaves the events of other banks alone', () => {
    const events = mapBankEvents([event(1, 0.5), event(17), event(40, 2)], 1, () => [])
    expect(events).toEqual([event(1, 0.5), event(40, 2)])
  })
})

describe('extendToBanks', () => {
  it('extends a sixteen-pad save to every bank', () => {
    const slices = extendToBanks(Array.from({ length: 16 }, (_, i) => 15 - i), (pad) => pad % 16)
    expect([slices.length, slices[0], slices[15], slices[16], slices[63]]).toEqual([64, 15, 0, 0, 15])
  })

  it('keeps what a full save says', () => {
    expect(extendToBanks(Array(64).fill(null), () => [0, 1])).toEqual(Array(64).fill(null))
  })

  it('fills a missing save', () => {
    expect(extendToBanks(undefined, () => false)).toEqual(Array(64).fill(false))
  })
})


describe('padName', () => {
  it('names a pad by its bank letter and its number in the bank', () => {
    expect([0, 15, 16, 63].map(padName)).toEqual(['A1', 'A16', 'B1', 'D16'])
  })
})

describe('bankForSource', () => {
  const banks = (...filled: boolean[]) => filled.map((f) => ({ sample: f ? {} : null }))

  it('fills the focused bank when it is empty', () => {
    expect(bankForSource(banks(true, false, false, false), 1)).toBe(1)
  })

  it('takes the first empty bank when the focused one has a source', () => {
    expect(bankForSource(banks(true, false, true, false), 2)).toBe(1)
  })

  it('replaces the focused bank when every bank has a source', () => {
    expect(bankForSource(banks(true, true, true, true), 2)).toBe(2)
  })
})
