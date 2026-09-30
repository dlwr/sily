import { describe, expect, it } from 'vitest'
import type { PadEvent } from '../state/pattern'
import { generate, type GenerateInput, type PadInfo } from './generate'

const kit: PadInfo[] = [
  { pad: 0, category: 'kick', beats: 0.5 },
  { pad: 1, category: 'snare', beats: 0.5 },
  { pad: 2, category: 'closed_hat', beats: 0.2 },
  { pad: 3, category: 'open_hat', beats: 0.6 },
]

const input = (patch: Partial<GenerateInput> = {}): GenerateInput => ({
  pads: kit,
  existing: [],
  style: 'boom_bap',
  density: 0.5,
  looseness: 0.5,
  lengthBeats: 4,
  seed: 1,
  ...patch,
})

const on = (events: PadEvent[], pad: number) => events.filter((e) => e.pad === pad)
const manual = (beat: number, pad: number): PadEvent => ({ id: `m${pad}@${beat}`, beat, pad, velocity: 1, nudge: 0, pitch: 0 })

describe('generate', () => {
  it('returns the same pattern for the same seed', () => {
    expect(generate(input()).map(({ id, ...e }) => e)).toEqual(generate(input()).map(({ id, ...e }) => e))
  })

  it('returns different patterns for different seeds', () => {
    const a = generate(input({ seed: 1, density: 0.7 })).map((e) => `${e.pad}@${e.beat}`)
    const b = generate(input({ seed: 2, density: 0.7 })).map((e) => `${e.pad}@${e.beat}`)
    expect(a).not.toEqual(b)
  })

  it('marks every generated note as automatic', () => {
    expect(generate(input()).every((e) => e.auto)).toBe(true)
  })

  it('puts a four on the floor kick on every beat', () => {
    const kicks = on(generate(input({ style: 'four_on_floor', looseness: 0 })), 0).map((e) => e.beat)
    expect(kicks).toEqual(expect.arrayContaining([0, 1, 2, 3]))
  })

  it('lands the boom bap snare on beats two and four', () => {
    const snares = on(generate(input({ looseness: 0 })), 1).map((e) => e.beat)
    expect(snares).toEqual(expect.arrayContaining([1, 3]))
  })

  it('keeps manual notes as they are', () => {
    const mine = manual(0.37, 2)
    expect(generate(input({ existing: [mine] }))).toContainEqual(mine)
  })

  it('leaves pads that already have manual notes to the player', () => {
    const events = generate(input({ existing: [manual(0.37, 2)] }))
    expect(on(events, 2)).toHaveLength(1)
  })

  it('drops previous automatic notes', () => {
    const old = { ...manual(0.5, 0), auto: true }
    expect(generate(input({ existing: [old] }))).not.toContainEqual(old)
  })

  it('writes nothing for a part that has no pad', () => {
    const events = generate(input({ pads: kit.filter((p) => p.category !== 'kick') }))
    expect(on(events, 0)).toHaveLength(0)
  })

  it('writes more notes at high density', () => {
    const count = (density: number) =>
      [1, 2, 3, 4, 5].reduce((n, seed) => n + generate(input({ density, seed })).length, 0)
    expect(count(0.9)).toBeGreaterThan(count(0.1))
  })

  it('keeps every note on the grid when looseness is zero', () => {
    const events = generate(input({ style: 'dilla', looseness: 0 }))
    expect(events.every((e) => e.nudge === 0)).toBe(true)
  })

  it('pushes dilla notes off the grid when loose', () => {
    const events = generate(input({ style: 'dilla', looseness: 1 }))
    expect(events.some((e) => e.nudge !== 0)).toBe(true)
  })

  it('keeps every beat inside the loop', () => {
    const events = generate(input({ lengthBeats: 8, looseness: 1, density: 1 }))
    expect(events.every((e) => e.beat >= 0 && e.beat < 8)).toBe(true)
  })

  it('fills every bar of a longer loop', () => {
    const kicks = on(generate(input({ lengthBeats: 8 })), 0).map((e) => e.beat)
    expect([kicks.some((b) => b < 4), kicks.some((b) => b >= 4)]).toEqual([true, true])
  })

  it('places a long phrase once per its length from the bar start', () => {
    const pads: PadInfo[] = [...kit, { pad: 4, category: 'upper', beats: 3.5 }]
    expect(on(generate(input({ pads, lengthBeats: 8 })), 4).map((e) => e.beat)).toEqual([0, 4])
  })

  it('chops a short upper slice across the bar', () => {
    const pads: PadInfo[] = [...kit, { pad: 4, category: 'upper', beats: 0.4 }]
    const beats = on(generate(input({ pads, density: 0.8 })), 4).map((e) => e.beat)
    expect(beats.length).toBeGreaterThan(1)
  })
})
