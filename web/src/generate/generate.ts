import type { Category } from '../classify/categories'
import type { PadEvent } from '../state/pattern'

export type Style = 'boom_bap' | 'dilla' | 'breakbeat' | 'four_on_floor'
export type PadInfo = { pad: number; category: Category; beats: number }
export type GenerateInput = {
  pads: PadInfo[]
  existing: PadEvent[]
  style: Style
  density: number
  looseness: number
  lengthBeats: number
  seed: number
}

type Part = 'kick' | 'snare' | 'hat' | 'open_hat' | 'perc' | 'bass' | 'upper'

type Lane = { probabilities: number[]; velocity: number; pitches?: number[] }

type Template = {
  lanes: Partial<Record<Part, Lane>>
  swing: number
  drift: Partial<Record<Part, { lean: number; spread: number }>>
}

const STEPS = 16
const STEP_BEATS = 0.25
const CERTAIN = 0.95
const LONG_SLICE_BEATS = 1

const PART_CATEGORIES: Record<Part, Category[]> = {
  kick: ['kick'],
  snare: ['snare', 'clap', 'rim'],
  hat: ['closed_hat', 'cymbal'],
  open_hat: ['open_hat'],
  perc: ['perc', 'tom', 'rim'],
  bass: ['bass'],
  upper: ['keys', 'melody', 'vocal', 'upper', 'fx'],
}

const STAB = [0.9, 0, 0, 0.35, 0, 0, 0.5, 0, 0, 0, 0.55, 0, 0.3, 0, 0, 0.2]

const TEMPLATES: Record<Style, Template> = {
  boom_bap: {
    lanes: {
      kick: { probabilities: [1, 0, 0, 0, 0, 0, 0, 0.35, 0, 0, 0.85, 0, 0, 0.25, 0, 0], velocity: 1 },
      snare: { probabilities: [0, 0, 0, 0, 1, 0, 0, 0.12, 0, 0, 0, 0, 1, 0, 0, 0.15], velocity: 0.95 },
      hat: { probabilities: [0.9, 0.1, 0.9, 0.2, 0.9, 0.1, 0.9, 0.2, 0.9, 0.1, 0.9, 0.2, 0.9, 0.1, 0.9, 0.3], velocity: 0.6 },
      open_hat: { probabilities: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.25, 0], velocity: 0.6 },
      perc: { probabilities: [0, 0, 0, 0.15, 0, 0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0, 0], velocity: 0.6 },
      bass: { probabilities: [1, 0, 0, 0, 0, 0, 0, 0.3, 0, 0, 0.7, 0, 0, 0.2, 0, 0], velocity: 0.9, pitches: [0, 0, 0, 5, 7, -2] },
      upper: { probabilities: STAB, velocity: 0.8, pitches: [0, 0, 3, 5, -2] },
    },
    swing: 0.58,
    drift: { hat: { lean: 0, spread: 0.01 } },
  },
  dilla: {
    lanes: {
      kick: { probabilities: [1, 0, 0, 0.2, 0, 0, 0.3, 0.45, 0, 0, 0.8, 0.2, 0, 0.35, 0, 0], velocity: 1 },
      snare: { probabilities: [0, 0, 0, 0, 1, 0, 0, 0.15, 0, 0.1, 0, 0, 1, 0, 0.1, 0.2], velocity: 0.9 },
      hat: { probabilities: [0.9, 0.3, 0.8, 0.3, 0.9, 0.3, 0.8, 0.3, 0.9, 0.3, 0.8, 0.3, 0.9, 0.3, 0.8, 0.4], velocity: 0.55 },
      open_hat: { probabilities: [0, 0, 0, 0, 0, 0, 0.15, 0, 0, 0, 0, 0, 0, 0, 0.2, 0], velocity: 0.55 },
      perc: { probabilities: [0, 0, 0.1, 0, 0, 0.15, 0, 0, 0, 0, 0.1, 0, 0, 0.15, 0, 0], velocity: 0.55 },
      bass: { probabilities: [1, 0, 0, 0.2, 0, 0, 0.3, 0.4, 0, 0, 0.7, 0, 0, 0.3, 0, 0], velocity: 0.9, pitches: [0, 0, -2, 3, 5, 7] },
      upper: { probabilities: STAB, velocity: 0.8, pitches: [0, 0, -2, 3, 5, 7, 10] },
    },
    swing: 0.62,
    drift: {
      kick: { lean: 0, spread: 0.06 },
      snare: { lean: 0.025, spread: 0.01 },
      hat: { lean: 0, spread: 0.025 },
      bass: { lean: 0, spread: 0.05 },
      upper: { lean: 0.01, spread: 0.03 },
    },
  },
  breakbeat: {
    lanes: {
      kick: { probabilities: [1, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.9, 0.6, 0, 0, 0, 0], velocity: 1 },
      snare: { probabilities: [0, 0, 0, 0, 1, 0, 0, 0.6, 0, 0.6, 0, 0, 1, 0, 0, 0.5], velocity: 0.9 },
      hat: { probabilities: [0.95, 0.4, 0.95, 0.4, 0.95, 0.4, 0.95, 0.4, 0.95, 0.4, 0.95, 0.4, 0.95, 0.4, 0.95, 0.4], velocity: 0.55 },
      open_hat: { probabilities: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0], velocity: 0.6 },
      perc: { probabilities: [0, 0.1, 0, 0.1, 0, 0.1, 0, 0.1, 0, 0.1, 0, 0.1, 0, 0.1, 0, 0.1], velocity: 0.5 },
      bass: { probabilities: [1, 0, 0.3, 0, 0, 0, 0, 0.2, 0, 0, 0.8, 0.3, 0, 0, 0, 0], velocity: 0.9, pitches: [0, 0, 5, 7] },
      upper: { probabilities: STAB, velocity: 0.8, pitches: [0, 0, 5, 7, 12] },
    },
    swing: 0.54,
    drift: { snare: { lean: 0, spread: 0.01 }, hat: { lean: 0, spread: 0.01 } },
  },
  four_on_floor: {
    lanes: {
      kick: { probabilities: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0.1], velocity: 1 },
      snare: { probabilities: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], velocity: 0.85 },
      hat: { probabilities: [0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4, 0.3, 0.4], velocity: 0.5 },
      open_hat: { probabilities: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0], velocity: 0.65 },
      perc: { probabilities: [0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2, 0, 0, 0, 0.2], velocity: 0.5 },
      bass: { probabilities: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0], velocity: 0.85, pitches: [0, 0, 0, 12, 7] },
      upper: { probabilities: STAB, velocity: 0.75, pitches: [0, 0, 5, 7] },
    },
    swing: 0.5,
    drift: { hat: { lean: 0, spread: 0.008 } },
  },
}

let sequence = 0
const nextId = () => `g${++sequence}`

const random = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const scaled = (p: number, density: number) => (p >= CERTAIN ? 1 : Math.min(1, p * density * 2))

const partOf = (category: Category): Part | null =>
  (Object.keys(PART_CATEGORIES) as Part[]).find((part) => PART_CATEGORIES[part].includes(category)) ?? null

export const generate = (input: GenerateInput): PadEvent[] => {
  const rand = random(input.seed)
  const template = TEMPLATES[input.style]
  const manual = input.existing.filter((e) => !e.auto)
  const played = new Set(manual.map((e) => e.pad))
  const byPart = new Map<Part, PadInfo[]>()
  for (const info of input.pads) {
    const part = partOf(info.category)
    if (!part || played.has(info.pad)) continue
    byPart.set(part, [...(byPart.get(part) ?? []), info])
  }
  const events: PadEvent[] = []
  const bars = Math.max(1, Math.round(input.lengthBeats / 4))
  const swingShift = (step: number) => (step % 2 === 1 ? (template.swing - 0.5) * 2 * STEP_BEATS : 0)
  const nudgeFor = (part: Part) => {
    const drift = template.drift[part]
    if (!drift || input.looseness === 0) return 0
    return (drift.lean + (rand() * 2 - 1) * drift.spread) * input.looseness
  }
  const pitchFor = (lane: Lane) => (lane.pitches ? lane.pitches[Math.floor(rand() * lane.pitches.length)] : 0)

  for (const [part, candidates] of byPart) {
    const lane = template.lanes[part]
    if (!lane) continue
    const info = candidates[Math.floor(rand() * candidates.length)]
    const melodic = part === 'bass' || part === 'upper'
    if (melodic && info.beats > LONG_SLICE_BEATS) {
      const every = Math.max(4, Math.ceil(info.beats / 4) * 4)
      for (let beat = 0; beat < input.lengthBeats; beat += every) {
        events.push({ id: nextId(), beat, pad: info.pad, velocity: lane.velocity, nudge: 0, pitch: 0, auto: true })
      }
      continue
    }
    for (let bar = 0; bar < bars; bar++) {
      lane.probabilities.forEach((p, step) => {
        if (rand() >= scaled(p, input.density)) return
        const beat = bar * 4 + step * STEP_BEATS
        const accent = step % 4 === 0 ? 1 : 0.85
        events.push({
          id: nextId(),
          beat,
          pad: info.pad,
          velocity: Math.min(1, lane.velocity * accent * (0.9 + rand() * 0.1)),
          nudge: input.looseness === 0 ? 0 : swingShift(step) * input.looseness + nudgeFor(part),
          pitch: melodic ? pitchFor(lane) : 0,
          auto: true,
        })
      })
    }
  }
  return [...manual, ...events]
}
