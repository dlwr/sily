export type PadEvent = {
  id: string
  beat: number
  pad: number
  velocity: number
  nudge: number
  pitch: number
  auto?: boolean
  standIn?: boolean
}

const PITCH_RANGE = 24

let sequence = 0
const nextId = () => `e${++sequence}`

export const toggleStep = (events: PadEvent[], pad: number, beat: number, tolerance: number): PadEvent[] => {
  const onStep = (e: PadEvent) => e.pad === pad && Math.abs(e.beat - beat) < tolerance
  return events.some(onStep)
    ? events.filter((e) => !onStep(e))
    : [...events, { id: nextId(), beat, pad, velocity: 1, nudge: 0, pitch: 0 }]
}

export const recordHit = (events: PadEvent[], pad: number, beat: number, velocity: number, pitch = 0): PadEvent[] => [
  ...events,
  { id: nextId(), beat, pad, velocity, nudge: 0, pitch },
]

export const nudgeEvent = (events: PadEvent[], id: string, delta: number): PadEvent[] =>
  events.map((e) => (e.id === id ? { ...e, nudge: e.nudge + delta, auto: false } : e))

export const removeEvent = (events: PadEvent[], id: string): PadEvent[] => events.filter((e) => e.id !== id)

export const shiftPitch = (events: PadEvent[], id: string, delta: number): PadEvent[] =>
  events.map((e) =>
    e.id === id ? { ...e, pitch: Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, e.pitch + delta)), auto: false } : e,
  )

const MIN_VELOCITY = 0.05

export const changeVelocity = (events: PadEvent[], id: string, delta: number): PadEvent[] =>
  events.map((e) =>
    e.id === id
      ? { ...e, velocity: Math.round(Math.max(MIN_VELOCITY, Math.min(1, e.velocity + delta)) * 100) / 100, auto: false }
      : e,
  )
