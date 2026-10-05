import { describe, expect, it } from 'vitest'
import type { PadEvent } from '../state/pattern'
import { candidateStyles, generate, type GenerateInput, type PadInfo } from './generate'

const kit: PadInfo[] = [
  { pad: 0, category: 'kick', beats: 0.5, scores: { kick: 0.9 } },
  { pad: 1, category: 'snare', beats: 0.5, scores: { snare: 0.9 } },
  { pad: 2, category: 'closed_hat', beats: 0.2, scores: { closed_hat: 0.9 } },
  { pad: 3, category: 'open_hat', beats: 0.6, scores: { open_hat: 0.9 } },
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

  it('writes nothing for an optional part that has no pad', () => {
    const events = generate(input({ pads: kit.filter((p) => p.category !== 'open_hat') }))
    expect(on(events, 3)).toHaveLength(0)
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
    const pads: PadInfo[] = [...kit, { pad: 4, category: 'upper', beats: 3.5, scores: {} }]
    expect(on(generate(input({ pads, lengthBeats: 8 })), 4).map((e) => e.beat)).toEqual([0, 4])
  })

  it('chops a short upper slice across the bar', () => {
    const pads: PadInfo[] = [...kit, { pad: 4, category: 'upper', beats: 0.4, scores: {} }]
    const beats = on(generate(input({ pads, density: 0.8 })), 4).map((e) => e.beat)
    expect(beats.length).toBeGreaterThan(1)
  })

  describe('groove', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const bass: PadInfo = { pad: 4, category: 'bass', beats: 0.4, scores: { bass: 0.9 } }
    const key = (e: PadEvent, offset = 0) => `${e.pad}@${e.beat - offset}:${e.velocity}:${e.nudge}:${e.pitch}`
    const within = (events: PadEvent[], from: number, to: number, offset = 0) =>
      events.filter((e) => e.beat >= from && e.beat < to).map((e) => key(e, offset)).sort()

    it('repeats the first bar until the last one', () => {
      const repeated = seeds.map((seed) => {
        const events = generate(input({ seed, lengthBeats: 16, density: 0.7 }))
        return [4, 8].every((start) => JSON.stringify(within(events, start, start + 4, start)) === JSON.stringify(within(events, 0, 4)))
      })
      expect(repeated.every(Boolean)).toBe(true)
    })

    it('keeps the front half of the last bar and varies only its back half', () => {
      const kept = seeds.map((seed) => {
        const events = generate(input({ seed, lengthBeats: 8, density: 0.7 }))
        return JSON.stringify(within(events, 4, 6, 4)) === JSON.stringify(within(events, 0, 2))
      })
      const varied = seeds.some((seed) => {
        const events = generate(input({ seed, lengthBeats: 8, density: 0.7 }))
        return JSON.stringify(within(events, 6, 8, 4)) !== JSON.stringify(within(events, 2, 4))
      })
      expect([kept.every(Boolean), varied]).toEqual([true, true])
    })

    it('plays ghost snares well under the backbeat', () => {
      const snares = seeds.flatMap((seed) => on(generate(input({ seed, density: 1, looseness: 0 })), 1))
      const ghosts = snares.filter((e) => e.beat !== 1 && e.beat !== 3)
      expect(ghosts.length > 0 && ghosts.every((e) => e.velocity < 0.6)).toBe(true)
    })

    it('keeps the backbeat loud', () => {
      const snares = seeds.flatMap((seed) => on(generate(input({ seed, looseness: 0 })), 1))
      expect(snares.filter((e) => e.beat === 1 || e.beat === 3).every((e) => e.velocity > 0.8)).toBe(true)
    })

    it('locks a short bass to the kick', () => {
      const offKick = seeds.flatMap((seed) => {
        const events = generate(input({ seed, pads: [...kit, bass], density: 0.8, looseness: 0 }))
        const kicks = on(events, 0).map((e) => e.beat)
        return on(events, 4).filter((e) => !kicks.includes(e.beat) && !kicks.includes(e.beat + 0.25))
      })
      expect(offKick).toEqual([])
    })

    it('keeps the four on the floor bass off the kick', () => {
      const onKick = seeds.flatMap((seed) => {
        const events = generate(input({ seed, style: 'four_on_floor', pads: [...kit, bass], density: 0.8, looseness: 0 }))
        const kicks = on(events, 0).map((e) => e.beat)
        return on(events, 4).filter((e) => kicks.includes(e.beat))
      })
      expect(onKick).toEqual([])
    })

    it('never plays two bass notes at once', () => {
      const doubled = seeds.some((seed) => {
        const beats = on(generate(input({ seed, style: 'breakbeat', pads: [...kit, bass], density: 1 })), 4).map((e) => e.beat)
        return new Set(beats).size !== beats.length
      })
      expect(doubled).toBe(false)
    })

    it('keeps an uncertain kick at full strength', () => {
      const kicks = seeds.flatMap((seed) => on(generate(input({ seed, density: 1, looseness: 0 })), 0))
      expect(kicks.filter((e) => e.beat === 2.5).every((e) => e.velocity > 0.75)).toBe(true)
    })

    it('starts the bass on the root', () => {
      const first = seeds.map((seed) => on(generate(input({ seed, pads: [...kit, bass] })), 4).find((e) => e.beat === 0)?.pitch)
      expect(first.every((pitch) => pitch === 0)).toBe(true)
    })

    it('chokes the closed hat where the open hat plays', () => {
      const clashes = seeds.flatMap((seed) => {
        const events = generate(input({ seed, style: 'four_on_floor', density: 1, looseness: 0 }))
        const open = on(events, 3).map((e) => e.beat)
        return on(events, 2).filter((e) => open.includes(e.beat))
      })
      expect(clashes).toEqual([])
    })
  })

  it('puts the trap snare on beat three only', () => {
    const snares = on(generate(input({ style: 'trap', looseness: 0 })), 1).map((e) => e.beat)
    expect([snares.includes(2), snares.includes(1), snares.includes(3)]).toEqual([true, false, false])
  })

  it('rolls trap hats faster than sixteenths', () => {
    const hats = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) => on(generate(input({ seed, style: 'trap', density: 1, looseness: 0 })), 2))
    expect(hats.some((e) => !Number.isInteger(e.beat * 4))).toBe(true)
  })

  it('plays the drum and bass two step', () => {
    const events = generate(input({ style: 'drum_and_bass', looseness: 0 }))
    expect([on(events, 0).map((e) => e.beat), on(events, 1).map((e) => e.beat)]).toEqual([
      expect.arrayContaining([0, 2.5]),
      expect.arrayContaining([1, 3]),
    ])
  })

  it('plays the dembow snare ahead of beats two and four', () => {
    const snares = on(generate(input({ style: 'dembow', looseness: 0 })), 1).map((e) => e.beat)
    expect(snares).toEqual(expect.arrayContaining([0.75, 1.5, 2.75, 3.5]))
  })

  it('skips the second kick of the uk garage two step', () => {
    const kicks = on(generate(input({ style: 'uk_garage', looseness: 0 })), 0).map((e) => e.beat)
    expect([kicks.includes(0), kicks.includes(2.5), kicks.includes(1)]).toEqual([true, true, false])
  })

  it('swings uk garage harder than boom bap', () => {
    const offbeat = (style: 'uk_garage' | 'boom_bap') =>
      Math.max(...on(generate(input({ style, density: 1, looseness: 1 })), 2).filter((e) => e.beat % 0.5 === 0.25).map((e) => e.nudge))
    expect(offbeat('uk_garage')).toBeGreaterThan(offbeat('boom_bap'))
  })

  it('bounces the jersey club kick at the end of the bar', () => {
    const kicks = on(generate(input({ style: 'jersey_club', looseness: 0 })), 0).map((e) => e.beat)
    expect(kicks).toEqual(expect.arrayContaining([0, 1, 2, 2.75, 3.5]))
  })

  describe('stand-ins for missing core parts', () => {
    const tom: PadInfo = { pad: 5, category: 'tom', beats: 0.4, scores: { tom: 0.5, kick: 0.4 } }
    const shaker: PadInfo = { pad: 6, category: 'perc', beats: 0.2, scores: { perc: 0.6, kick: 0.05, closed_hat: 0.3 } }
    const noKick = [...kit.filter((p) => p.category !== 'kick'), tom, shaker]

    it('plays the kick part on the closest remaining sound', () => {
      expect(on(generate(input({ pads: noKick, looseness: 0 })), 5).map((e) => e.beat)).toContain(0)
    })

    it('flags stand-in notes', () => {
      const notes = on(generate(input({ pads: noKick, density: 1 })), 5)
      expect(notes.length > 0 && notes.every((e) => e.standIn)).toBe(true)
    })

    it('never takes the only pad of another core part', () => {
      const snareLikeKick: PadInfo = { pad: 1, category: 'snare', beats: 0.5, scores: { snare: 0.5, kick: 0.45 } }
      const pads = [snareLikeKick, kit[2], shaker]
      const events = generate(input({ pads, looseness: 0 }))
      expect([on(events, 6).some((e) => e.beat === 0), on(events, 1).some((e) => e.beat === 0)]).toEqual([true, false])
    })

    it('borrows a spare pad of a doubled part', () => {
      const snares: PadInfo[] = [
        { pad: 1, category: 'snare', beats: 0.5, scores: { snare: 0.9 } },
        { pad: 7, category: 'snare', beats: 0.3, scores: { snare: 0.6, closed_hat: 0.3 } },
        { pad: 8, category: 'snare', beats: 0.3, scores: { snare: 0.7, closed_hat: 0.1 } },
      ]
      const events = generate(input({ pads: [kit[0], ...snares], density: 1 }))
      expect(events.filter((e) => e.standIn).length).toBeGreaterThan(0)
    })

    it('leaves pads with manual notes alone', () => {
      const events = generate(input({ pads: noKick, existing: [manual(0.5, 5)] }))
      expect(on(events, 5)).toHaveLength(1)
    })
  })
})

describe('candidateStyles', () => {
  it('uses the chosen style for every candidate', () => {
    expect(candidateStyles('dilla', 128, 4)).toEqual(['dilla', 'dilla', 'dilla', 'dilla'])
  })

  it('leads with four on the floor at house tempo', () => {
    expect(candidateStyles('auto', 124, 4)[0]).toBe('four_on_floor')
  })

  it('spreads hip hop tempos over boom bap and dilla', () => {
    expect(new Set(candidateStyles('auto', 88, 4))).toEqual(new Set(['boom_bap', 'dilla']))
  })

  it('leaves four on the floor out of hip hop tempos', () => {
    expect(candidateStyles('auto', 88, 4)).not.toContain('four_on_floor')
  })

  it('leads with trap at trap tempo', () => {
    expect(candidateStyles('auto', 145, 4)[0]).toBe('trap')
  })

  it('leads with dembow at reggaeton tempo', () => {
    expect(candidateStyles('auto', 96, 4)[0]).toBe('dembow')
  })

  it('leads with uk garage at garage tempo', () => {
    expect(candidateStyles('auto', 132, 4)[0]).toBe('uk_garage')
  })

  it('leads with jersey club at club tempo', () => {
    expect(candidateStyles('auto', 140, 4)[0]).toBe('jersey_club')
  })

  it('leads with drum and bass at jungle tempo', () => {
    expect(candidateStyles('auto', 174, 4)[0]).toBe('drum_and_bass')
  })

  it('falls back to the nearest style outside every range', () => {
    expect(candidateStyles('auto', 60, 2)).toEqual(['dilla', 'dilla'])
  })
})
