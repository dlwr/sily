import { roleOf, type Category, type Role } from './categories'

export type KitCandidate = {
  slice: number
  scores: Partial<Record<Category, number>>
  quality?: number
  embedding?: number[]
}

export const UPPER_PADS = [13, 14, 15]

const SLOTS: Role[] = [
  'kick',
  'snare',
  'closed_hat',
  'open_hat',
  'snare',
  'perc',
  'perc',
  'open_hat',
  'perc',
  'kick',
  'snare',
  'closed_hat',
  'bass',
  'upper',
  'upper',
  'upper',
]

const SAME_SOUND = 0.85

export const novelty = (embedding: number[] | undefined, placed: number[][]): number => {
  if (!embedding || placed.length === 0) return 1
  const closest = Math.max(...placed.map((p) => p.reduce((sum, x, i) => sum + x * embedding[i], 0)))
  return 1 - 0.9 * Math.min(1, Math.max(0, (closest - SAME_SOUND) / (1 - SAME_SOUND)))
}

const roleScore = (c: KitCandidate, role: Role) =>
  (Object.entries(c.scores) as [Category, number][]).reduce((sum, [category, score]) => sum + (roleOf(category) === role ? score : 0), 0)

export const buildKit = (candidates: KitCandidate[]): number[] => {
  const remaining = [...candidates]
  const placed: number[][] = []
  const kit = SLOTS.map((role) => {
    if (remaining.length === 0) return null
    const fit = (c: KitCandidate) => roleScore(c, role) * (0.5 + 0.5 * (c.quality ?? 1)) * novelty(c.embedding, placed)
    const best = remaining.reduce((a, b) => (fit(b) > fit(a) ? b : a))
    remaining.splice(remaining.indexOf(best), 1)
    if (best.embedding) placed.push(best.embedding)
    return best.slice
  })
  let spare = Math.max(-1, ...candidates.map((c) => c.slice)) + 1
  return kit.map((slice) => slice ?? spare++)
}

export const dropUnplacedEvents = <E extends { pad: number }>(events: E[], before: number[], after: number[]): E[] =>
  events.flatMap((e) => {
    const pad = after.indexOf(before[e.pad])
    return pad < 0 ? [] : [{ ...e, pad }]
  })
