import type { PadEvent } from './pattern'

export type Pattern = { name: string; bars: number; events: PadEvent[] }

export const PATTERN_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

let sequence = 0

const beatsOf = (pattern: Pattern) => pattern.bars * 4

const sections = (patterns: Pattern[], order: string[]) =>
  order.map((name) => patterns.find((p) => p.name === name)).filter((p): p is Pattern => p !== undefined)

export const flattenSong = (patterns: Pattern[], order: string[]): { events: PadEvent[]; lengthBeats: number } => {
  let offset = 0
  const events: PadEvent[] = []
  for (const pattern of sections(patterns, order)) {
    for (const e of pattern.events) events.push({ ...e, id: `${e.id}@${offset}`, beat: e.beat + offset })
    offset += beatsOf(pattern)
  }
  return { events, lengthBeats: offset }
}

export const sectionAt = (patterns: Pattern[], order: string[], beat: number): { index: number; beat: number } => {
  let offset = 0
  const list = sections(patterns, order)
  for (const [index, pattern] of list.entries()) {
    if (beat < offset + beatsOf(pattern) || index === list.length - 1) return { index, beat: beat - offset }
    offset += beatsOf(pattern)
  }
  return { index: 0, beat }
}

export const copyPattern = (pattern: Pattern, name: string): Pattern => ({
  name,
  bars: pattern.bars,
  events: pattern.events.map((e) => ({ ...e, id: `c${++sequence}` })),
})
