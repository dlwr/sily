import { novelty } from './kit'

export type BeatGrid = { beat: number; first: number; downbeat: number }
export type Range = [number, number]
export type PhraseCandidate = { range: Range; upper: number; embedding?: number[] }

const TOLERANCE_SECONDS = 0.03
const BEATS_PER_BAR = 4

const offBeat = (frame: number, offset: number, beat: number) => {
  const d = (((frame - offset) % beat) + beat) % beat
  return Math.min(d, beat - d)
}

export const beatGrid = (input: { onsets: number[]; kicks: number[]; frames: number; sampleRate: number; bpm: number }): BeatGrid => {
  const beat = (input.sampleRate * 60) / input.bpm
  const tolerance = TOLERANCE_SECONDS * input.sampleRate
  const near = (frames: number[], offset: number, period: number) => frames.filter((f) => offBeat(f, offset, period) < tolerance).length
  const first = input.onsets
    .map((o) => o % beat)
    .reduce((best, offset) => (near(input.onsets, offset, beat) > near(input.onsets, best, beat) ? offset : best), 0)
  const bar = beat * BEATS_PER_BAR
  const phase = [0, 1, 2, 3].reduce((best, j) => (near(input.kicks, first + j * beat, bar) > near(input.kicks, first + best * beat, bar) ? j : best), 0)
  return { beat, first, downbeat: first + phase * beat }
}

export const phraseRanges = (grid: BeatGrid, frames: number): Range[] => {
  const bar = grid.beat * BEATS_PER_BAR
  const half = bar / 2
  const ranges: Range[] = []
  for (let start = grid.downbeat % bar; start + bar <= frames; start += bar) {
    ranges.push([start, start + bar], [start, start + half], [start + half, start + bar])
  }
  return ranges.map(([a, b]) => [Math.round(a), Math.round(b)])
}

const overlaps = (a: Range, b: Range) => a[0] < b[1] && b[0] < a[1]

export const pickPhrases = (candidates: PhraseCandidate[], count: number): Range[] => {
  const remaining = [...candidates]
  const picked: PhraseCandidate[] = []
  while (picked.length < count) {
    const open = remaining.filter((c) => !picked.some((p) => overlaps(p.range, c.range)))
    if (open.length === 0) break
    const placed = picked.flatMap((p) => (p.embedding ? [p.embedding] : []))
    const fit = (c: PhraseCandidate) => c.upper * novelty(c.embedding, placed)
    const best = open.reduce((a, b) => (fit(b) > fit(a) ? b : a))
    remaining.splice(remaining.indexOf(best), 1)
    picked.push(best)
  }
  return picked.map((p) => p.range)
}
