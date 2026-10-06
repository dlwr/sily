import { describe, expect, it } from 'vitest'
import { changeVelocity, nudgeEvent, padsPlayedBetween, recordHit, recordRepeat, removeEvent, shiftPitch, toggleStep, type PadEvent } from './pattern'

const at = (beat: number, pad = 0, id = `${pad}@${beat}`): PadEvent => ({ id, beat, pad, velocity: 1, nudge: 0, pitch: 0 })

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

describe('recordRepeat', () => {
  it('adds a repeat on an empty step', () => {
    expect(recordRepeat([], 2, 0.5, 0.7, 0, 0.125)[0]).toMatchObject({ pad: 2, beat: 0.5, velocity: 0.7 })
  })

  it('leaves a step the pad already plays', () => {
    const events = [at(0.52, 2)]
    expect(recordRepeat(events, 2, 0.5, 1, 0, 0.125)).toBe(events)
  })

  it('adds a repeat beside another pad on the same step', () => {
    expect(recordRepeat([at(0.5, 3)], 2, 0.5, 1, 0, 0.125)).toHaveLength(2)
  })
})

describe('recordHit', () => {
  it('keeps the unquantized beat', () => {
    expect(recordHit([], 5, 0.4137, 0.8)[0]).toMatchObject({ pad: 5, beat: 0.4137, velocity: 0.8, nudge: 0 })
  })

  it('keeps the pitch of a keyboard hit', () => {
    expect(recordHit([], 5, 0.5, 1, 7)[0].pitch).toBe(7)
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

describe('shiftPitch', () => {
  it('moves only the matching event', () => {
    const next = shiftPitch([at(1, 0, 'a'), at(2, 0, 'b')], 'a', 2)
    expect(next.map((e) => e.pitch)).toEqual([2, 0])
  })

  it('stays within two octaves', () => {
    expect(shiftPitch([{ ...at(1, 0, 'a'), pitch: 23 }], 'a', 5)[0].pitch).toBe(24)
  })
})

describe('editing generated notes', () => {
  it('claims a generated note once it is nudged', () => {
    expect(nudgeEvent([{ ...at(1, 0, 'a'), auto: true }], 'a', 0.01)[0].auto).toBe(false)
  })

  it('claims a generated note once its pitch changes', () => {
    expect(shiftPitch([{ ...at(1, 0, 'a'), auto: true }], 'a', 1)[0].auto).toBe(false)
  })
})

describe('changeVelocity', () => {
  it('changes only the matching event', () => {
    const next = changeVelocity([at(1, 0, 'a'), at(2, 0, 'b')], 'a', -0.25)
    expect(next.map((e) => e.velocity)).toEqual([0.75, 1])
  })

  it('stays audible and never exceeds full', () => {
    const quiet = changeVelocity([{ ...at(1, 0, 'a'), velocity: 0.1 }], 'a', -1)[0].velocity
    const loud = changeVelocity([at(1, 0, 'a')], 'a', 1)[0].velocity
    expect([quiet, loud]).toEqual([0.05, 1])
  })

  it('claims a generated note', () => {
    expect(changeVelocity([{ ...at(1, 0, 'a'), auto: true }], 'a', -0.1)[0].auto).toBe(false)
  })
})

describe('padsPlayedBetween', () => {
  const ev = (pad: number, beat: number, nudge = 0) => ({ id: `${pad}-${beat}`, beat, pad, velocity: 1, nudge, pitch: 0 })
  const events = [ev(0, 0), ev(1, 1), ev(2, 2.5), ev(3, 3.9)]

  it('returns the pads whose notes fall after from and up to to', () => {
    expect(padsPlayedBetween(events, 0.5, 2.5, 4)).toEqual([1, 2])
  })

  it('wraps around the end of the loop', () => {
    expect(padsPlayedBetween(events, 3.5, 0.2, 4)).toEqual([0, 3])
  })

  it('places a note by its nudge', () => {
    expect(padsPlayedBetween([ev(5, 1, 0.3)], 1.1, 1.4, 4)).toEqual([5])
  })

  it('returns nothing when the beat has not moved', () => {
    expect(padsPlayedBetween(events, 1, 1, 4)).toEqual([])
  })
})
