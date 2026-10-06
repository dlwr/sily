import { describe, expect, it } from 'vitest'
import { trimSource, type TrimInput } from './trim'

const input = (over: Partial<TrimInput> = {}): TrimInput => ({
  frames: 1000,
  maxFrames: 300,
  markers: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
  padSlices: [0, 1, 2],
  padSpans: [null, null, null],
  labels: {},
  ownPads: [false, false, false],
  ...over,
})

describe('trimSource', () => {
  it('keeps a source that already fits', () => {
    const trim = trimSource(input({ frames: 250, markers: [0, 100, 200] }))
    expect([trim.start, trim.end]).toEqual([0, 250])
  })

  it('leaves the markers of a source that already fits', () => {
    expect(trimSource(input({ frames: 250, markers: [0, 100, 200] })).markers).toEqual([0, 100, 200])
  })

  it('places the window where the most pads are', () => {
    const trim = trimSource(input({ padSlices: [1, 6, 7, 8], padSpans: [null, null, null, null], ownPads: [false, false, false, false] }))
    expect([trim.start, trim.end]).toEqual([600, 900])
  })

  it('ends the window on a slice boundary', () => {
    expect(trimSource(input({ markers: [0, 120, 250, 380], padSlices: [0, 1] })).end).toBe(250)
  })

  it('shifts the markers inside the window to its start', () => {
    expect(trimSource(input({ padSlices: [4, 5] })).markers).toEqual([0, 100, 200])
  })

  it('points pads at their slice in the trimmed source', () => {
    expect(trimSource(input({ padSlices: [5, 4, 6] })).padSlices).toEqual([1, 0, 2])
  })

  it('detaches pads whose slice lies outside the window', () => {
    expect(trimSource(input({ padSlices: [1, 2, 8] })).detached).toEqual([{ pad: 2, range: [800, 900] }])
  })

  it('shifts phrase spans inside the window', () => {
    const trim = trimSource(input({ padSlices: [4, 5, 0], padSpans: [null, null, [450, 650]] }))
    expect(trim.padSpans).toEqual([null, null, [50, 250]])
  })

  it('detaches phrase spans that run past the window', () => {
    const trim = trimSource(input({ padSlices: [4, 5, 0], padSpans: [null, null, [450, 750]] }))
    expect(trim.detached).toEqual([{ pad: 2, range: [450, 750] }])
  })

  it('clears the span of a detached pad', () => {
    const trim = trimSource(input({ padSlices: [4, 5, 0], padSpans: [null, null, [450, 750]] }))
    expect(trim.padSpans[2]).toBeNull()
  })

  it('keeps the labels of slices inside the window at their new start', () => {
    const trim = trimSource(input({ padSlices: [4, 5], labels: { 400: 'kick', 500: 'snare', 800: 'hat' } }))
    expect(trim.labels).toEqual({ 0: 'kick', 100: 'snare' })
  })

  it('ignores pads that play their own sample', () => {
    const trim = trimSource(input({ padSlices: [1, 8, 9], ownPads: [false, true, true] }))
    expect(trim.detached).toEqual([])
  })

  it('cuts a source without markers to the longest allowed length', () => {
    const trim = trimSource(input({ markers: [], padSlices: [0, 1, 2] }))
    expect([trim.start, trim.end]).toEqual([0, 300])
  })

  it('cuts inside a slice longer than the window', () => {
    const trim = trimSource(input({ markers: [0, 800], padSlices: [0, 1] }))
    expect([trim.start, trim.end]).toEqual([0, 300])
  })
})
