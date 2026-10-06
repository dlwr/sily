import { describe, expect, it } from 'vitest'
import { readBanks, type BankState } from './banks'

const label = { category: 'kick' as const, confidence: 1, manual: true, scores: { kick: 1 } }

describe('readBanks', () => {
  it('reads each bank as saved', () => {
    const banks: BankState[] = [
      { markers: [0, 10], labels: { 0: label }, sourceSpeed: { mode: 'tape', rate: 1.1 }, sourceBpm: 90, heldOut: true },
      { markers: [5], labels: {}, sourceSpeed: { mode: 'stretch', rate: 0.9 }, sourceBpm: null, heldOut: false },
    ]
    expect(readBanks({ banks })).toEqual(banks)
  })

  it('reads a project saved with a single source as one bank', () => {
    const state = { markers: [0, 10], labels: { 0: label }, sourceSpeed: { mode: 'stretch' as const, rate: 1.2 }, sourceBpm: 88, heldOut: true }
    expect(readBanks(state)).toEqual([state])
  })

  it('fills what a bank does not say with the defaults', () => {
    expect(readBanks({ banks: [{ markers: [3] }] })).toEqual([
      { markers: [3], labels: {}, sourceSpeed: { mode: 'tape', rate: 1 }, sourceBpm: null, heldOut: false },
    ])
  })

  it('starts an empty project with one empty bank', () => {
    expect(readBanks({})).toEqual([{ markers: [], labels: {}, sourceSpeed: { mode: 'tape', rate: 1 }, sourceBpm: null, heldOut: false }])
  })
})
