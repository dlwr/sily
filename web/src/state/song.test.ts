import { describe, expect, it } from 'vitest'
import type { PadEvent } from './pattern'
import { copyPattern, flattenSong, sectionAt, type Pattern } from './song'

const ev = (id: string, beat: number, pad = 0): PadEvent => ({ id, beat, pad, velocity: 1, nudge: 0, pitch: 0 })
const patterns: Pattern[] = [
  { name: 'A', bars: 1, events: [ev('a1', 0), ev('a2', 2)] },
  { name: 'B', bars: 2, events: [ev('b1', 1)] },
  { name: 'C', bars: 1, events: [ev('c1', 3)] },
]

describe('flattenSong', () => {
  it('adds up the lengths of the sections', () => {
    expect(flattenSong(patterns, ['A', 'B', 'C', 'A']).lengthBeats).toBe(20)
  })

  it('shifts each section by the length of the ones before it', () => {
    expect(flattenSong(patterns, ['A', 'B', 'C']).events.map((e) => e.beat)).toEqual([0, 2, 5, 15])
  })

  it('repeats a section that appears twice', () => {
    expect(flattenSong(patterns, ['C', 'A', 'C']).events.map((e) => e.beat)).toEqual([3, 4, 6, 11])
  })

  it('skips names that have no pattern', () => {
    expect(flattenSong(patterns, ['A', 'Z', 'C']).lengthBeats).toBe(8)
  })
})

describe('sectionAt', () => {
  it('finds the section a beat falls in', () => {
    expect(sectionAt(patterns, ['A', 'B', 'C'], 9)).toEqual({ index: 1, beat: 5 })
  })

  it('finds the last section', () => {
    expect(sectionAt(patterns, ['A', 'B', 'C'], 13.5)).toEqual({ index: 2, beat: 1.5 })
  })

  it('finds the first section at the start', () => {
    expect(sectionAt(patterns, ['A', 'B', 'C'], 0)).toEqual({ index: 0, beat: 0 })
  })
})

describe('copyPattern', () => {
  it('copies the notes under the new name', () => {
    expect(copyPattern(patterns[0], 'D').events.map((e) => e.beat)).toEqual([0, 2])
  })

  it('gives the copied notes their own ids', () => {
    const ids = copyPattern(patterns[0], 'D').events.map((e) => e.id)
    expect(ids.some((id) => id === 'a1' || id === 'a2')).toBe(false)
  })
})
