import { describe, expect, it } from 'vitest'
import type { Category } from './categories'
import { buildKit, dropUnplacedEvents, novelty, type KitCandidate } from './kit'

const slice = (index: number, scores: Partial<Record<Category, number>>, extra: Partial<KitCandidate> = {}): KitCandidate => ({
  slice: index,
  scores,
  ...extra,
})

describe('buildKit', () => {
  it('puts the most kick-like slice on pad 1', () => {
    const kit = buildKit([slice(0, { snare: 0.8 }), slice(1, { kick: 0.4 }), slice(2, { kick: 0.9 })])
    expect(kit[0]).toBe(2)
  })

  it('puts the most snare-like slice on pad 2', () => {
    const kit = buildKit([slice(0, { snare: 0.3 }), slice(1, { kick: 0.9 }), slice(2, { snare: 0.7 }), slice(3, { closed_hat: 0.8 })])
    expect(kit[1]).toBe(2)
  })

  it('counts a clap towards the snare pad', () => {
    const kit = buildKit([slice(0, { kick: 0.9 }), slice(1, { clap: 0.9 }), slice(2, { closed_hat: 0.9 })])
    expect(kit[1]).toBe(1)
  })

  it('prefers a cleanly cut slice over a muddy one that sounds as much like the part', () => {
    const kit = buildKit([slice(0, { kick: 0.8 }, { quality: 0.2 }), slice(1, { kick: 0.8 }, { quality: 0.9 })])
    expect(kit[0]).toBe(1)
  })

  it('reaches for a different sound than one already on the pads', () => {
    const kick = [1, 0, 0]
    const kit = buildKit([
      slice(0, { kick: 0.9 }, { embedding: kick }),
      slice(1, { kick: 0.85 }, { embedding: kick }),
      slice(2, { kick: 0.7 }, { embedding: [0.6, 0.8, 0] }),
      ...Array.from({ length: 8 }, (_, i) => slice(3 + i, { snare: 0.5, closed_hat: 0.5, open_hat: 0.5, perc: 0.5 }, { embedding: [0, 0, 1] })),
    ])
    expect(kit[9]).toBe(2)
  })

  it('uses each slice only once', () => {
    const kit = buildKit([slice(0, { kick: 0.9, snare: 0.8 }), slice(1, { kick: 0.1 }), slice(2, {})])
    const placed = kit.filter((s) => s < 3)
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('fills all sixteen pads when there are enough slices', () => {
    const many = Array.from({ length: 40 }, (_, i) => slice(i, { perc: (i % 7) / 7 }))
    const kit = buildKit(many)
    expect([kit.length, kit.every((s) => s < 40), new Set(kit).size]).toEqual([16, true, 16])
  })

  it('picks from beyond the first sixteen slices', () => {
    const many = Array.from({ length: 30 }, (_, i) => slice(i, i === 25 ? { kick: 0.99 } : { perc: 0.2 }))
    expect(buildKit(many)[0]).toBe(25)
  })

  it('leaves pads empty when there are fewer slices than pads', () => {
    const kit = buildKit([slice(0, { kick: 0.9 }), slice(1, { snare: 0.9 }), slice(2, { closed_hat: 0.9 })])
    expect([kit.length, new Set(kit).size, kit.filter((s) => s < 3).length]).toEqual([16, 16, 3])
  })

  it('keeps a lone slice reachable even if nothing fits its slot', () => {
    const kit = buildKit([slice(0, { fx: 0.9 })])
    expect(kit).toContain(0)
  })
})

describe('novelty', () => {
  it('is full for a sound unlike anything placed', () => {
    expect(novelty([1, 0], [[0, 1]])).toBe(1)
  })

  it('drops for a sound nearly the same as one placed', () => {
    expect(novelty([1, 0], [[1, 0]])).toBeLessThan(0.2)
  })

  it('is full when nothing has been placed or the sound has no embedding', () => {
    expect([novelty([1, 0], []), novelty(undefined, [[1, 0]])]).toEqual([1, 1])
  })
})

describe('dropUnplacedEvents', () => {
  it('drops notes whose slice left the pads', () => {
    const events = [{ pad: 0 }, { pad: 1 }, { pad: 2 }]
    expect(dropUnplacedEvents(events, [0, 1, 2], [5, 1, 0]).map((e) => e.pad)).toEqual([2, 1])
  })
})
