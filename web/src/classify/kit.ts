import type { Category } from './categories'

export type KitCandidate = { slice: number; scores: Partial<Record<Category, number>> }

const UPPER: Category[] = ['keys', 'melody', 'vocal', 'upper']

const SLOTS: Category[][] = [
  ['kick'],
  ['snare', 'clap'],
  ['closed_hat'],
  ['open_hat', 'cymbal'],
  ['clap', 'snare'],
  ['rim', 'perc'],
  ['tom'],
  ['cymbal', 'open_hat'],
  ['perc', 'rim', 'tom'],
  ['kick'],
  ['snare', 'clap'],
  ['closed_hat', 'perc'],
  ['bass'],
  UPPER,
  UPPER,
  ['fx', 'perc', ...UPPER],
]

export const buildKit = (candidates: KitCandidate[]): number[] => {
  const remaining = [...candidates]
  const placed = SLOTS.map((categories) => {
    if (remaining.length === 0) return null
    const fit = (c: KitCandidate) => categories.reduce((sum, category) => sum + (c.scores[category] ?? 0), 0)
    const best = remaining.reduce((a, b) => (fit(b) > fit(a) ? b : a))
    remaining.splice(remaining.indexOf(best), 1)
    return best.slice
  })
  let spare = Math.max(-1, ...candidates.map((c) => c.slice)) + 1
  return placed.map((slice) => slice ?? spare++)
}

export const dropUnplacedEvents = <E extends { pad: number }>(events: E[], before: number[], after: number[]): E[] =>
  events.flatMap((e) => {
    const pad = after.indexOf(before[e.pad])
    return pad < 0 ? [] : [{ ...e, pad }]
  })
