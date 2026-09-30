import { describe, expect, it } from 'vitest'
import { History } from './history'

describe('History', () => {
  it('undoes back to the state before the last change', () => {
    const h = new History<number>()
    h.record(1)
    h.record(2)
    expect(h.undo(3)).toBe(2)
  })

  it('undoes several steps in order', () => {
    const h = new History<number>()
    h.record(1)
    h.record(2)
    h.record(3)
    expect([h.undo(4), h.undo(3), h.undo(2)]).toEqual([3, 2, 1])
  })

  it('returns nothing when there is nothing to undo', () => {
    expect(new History<number>().undo(1)).toBeUndefined()
  })

  it('redoes what was undone', () => {
    const h = new History<number>()
    h.record(1)
    const before = h.undo(2)
    expect([before, h.redo(1)]).toEqual([1, 2])
  })

  it('forgets redo once a new change is recorded', () => {
    const h = new History<number>()
    h.record(1)
    h.undo(2)
    h.record(5)
    expect(h.redo(6)).toBeUndefined()
  })

  it('merges changes with the same key in quick succession', () => {
    let now = 0
    const h = new History<number>(100, () => now)
    h.record(1, 'drag')
    now = 50
    h.record(2, 'drag')
    now = 80
    h.record(3, 'drag')
    expect([h.undo(4), h.undo(1)]).toEqual([1, undefined])
  })

  it('keeps changes apart once the pause is long enough', () => {
    let now = 0
    const h = new History<number>(100, () => now)
    h.record(1, 'drag')
    now = 500
    h.record(2, 'drag')
    expect([h.undo(3), h.undo(2)]).toEqual([2, 1])
  })

  it('drops the oldest steps beyond the limit', () => {
    const h = new History<number>(100, () => 0, 3)
    for (let i = 1; i <= 5; i++) h.record(i)
    expect([h.undo(6), h.undo(5), h.undo(4), h.undo(3)]).toEqual([5, 4, 3, undefined])
  })
})
