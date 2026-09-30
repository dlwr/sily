import { describe, expect, it } from 'vitest'
import type { Category } from './categories'
import { buildKit, dropUnplacedEvents, type KitCandidate } from './kit'

const slice = (index: number, scores: Partial<Record<Category, number>>): KitCandidate => ({ slice: index, scores })

describe('buildKit', () => {
  it('puts the most kick-like slice on pad 1', () => {
    const kit = buildKit([slice(0, { snare: 0.8 }), slice(1, { kick: 0.4 }), slice(2, { kick: 0.9 })])
    expect(kit[0]).toBe(2)
  })

  it('puts the most snare-like slice on pad 2', () => {
    const kit = buildKit([slice(0, { snare: 0.3 }), slice(1, { kick: 0.9 }), slice(2, { snare: 0.7 }), slice(3, { closed_hat: 0.8 })])
    expect(kit[1]).toBe(2)
  })

  it('uses each slice only once', () => {
    const kit = buildKit([slice(0, { kick: 0.9, snare: 0.8 }), slice(1, { kick: 0.1 }), slice(2, { hat: 0 } as never)])
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

describe('dropUnplacedEvents', () => {
  it('drops notes whose slice left the pads', () => {
    const events = [{ pad: 0 }, { pad: 1 }, { pad: 2 }]
    expect(dropUnplacedEvents(events, [0, 1, 2], [5, 1, 0]).map((e) => e.pad)).toEqual([2, 1])
  })
})
