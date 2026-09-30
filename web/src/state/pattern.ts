export type PadEvent = { id: string; beat: number; pad: number; velocity: number; nudge: number }

let sequence = 0
const nextId = () => `e${++sequence}`

export const toggleStep = (events: PadEvent[], pad: number, beat: number, tolerance: number): PadEvent[] => {
  const onStep = (e: PadEvent) => e.pad === pad && Math.abs(e.beat - beat) < tolerance
  return events.some(onStep)
    ? events.filter((e) => !onStep(e))
    : [...events, { id: nextId(), beat, pad, velocity: 1, nudge: 0 }]
}

export const recordHit = (events: PadEvent[], pad: number, beat: number, velocity: number): PadEvent[] => [
  ...events,
  { id: nextId(), beat, pad, velocity, nudge: 0 },
]

export const nudgeEvent = (events: PadEvent[], id: string, delta: number): PadEvent[] =>
  events.map((e) => (e.id === id ? { ...e, nudge: e.nudge + delta } : e))

export const removeEvent = (events: PadEvent[], id: string): PadEvent[] => events.filter((e) => e.id !== id)
