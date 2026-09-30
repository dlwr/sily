import { describe, expect, it } from 'vitest'
import { nudgeEvent, recordHit, removeEvent, toggleStep, type PadEvent } from './pattern'

const at = (beat: number, pad = 0, id = `${pad}@${beat}`): PadEvent => ({ id, beat, pad, velocity: 1, nudge: 0 })

describe('toggleStep', () => {
  it('adds an event on an empty step', () => {
    const next = toggleStep([], 2, 1.25, 0.125)
    expect(next.map((e) => [e.pad, e.beat])).toEqual([[2, 1.25]])
  })

  it('removes an event that sits on the step', () => {
    expect(toggleStep([at(1.26, 2)], 2, 1.25, 0.125)).toEqual([])
  })

  it('keeps events of other pads on the same step', () => {
    expect(toggleStep([at(1.25, 3)], 2, 1.25, 0.125)).toHaveLength(2)
  })
})

describe('recordHit', () => {
  it('keeps the unquantized beat', () => {
    expect(recordHit([], 5, 0.4137, 0.8)[0]).toMatchObject({ pad: 5, beat: 0.4137, velocity: 0.8, nudge: 0 })
  })

  it('gives each hit a distinct id', () => {
    const events = recordHit(recordHit([], 5, 0.5, 1), 5, 0.5, 1)
    expect(new Set(events.map((e) => e.id)).size).toBe(2)
  })
})

describe('nudgeEvent', () => {
  it('adds to the nudge of the matching event only', () => {
    const next = nudgeEvent([at(1, 0, 'a'), at(2, 0, 'b')], 'b', -0.03)
    expect(next.map((e) => e.nudge)).toEqual([0, -0.03])
  })
})

describe('removeEvent', () => {
  it('drops the matching event', () => {
    expect(removeEvent([at(1, 0, 'a'), at(2, 0, 'b')], 'a').map((e) => e.id)).toEqual(['b'])
  })
})
