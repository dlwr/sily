import type { Category } from '../classify/categories'
import type { PadEvent } from '../state/pattern'

export type Style = 'boom_bap' | 'dilla' | 'breakbeat' | 'four_on_floor'
export type StyleChoice = Style | 'auto'
export type PadInfo = { pad: number; category: Category; beats: number; scores: Partial<Record<Category, number>> }
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

type Hit = { step: number; velocity: number; nudge: number; pitch: number }

type Lane = { probabilities: number[]; velocity: number; pitches?: number[] }

type Template = {
  lanes: Partial<Record<Part, Lane>>
  swing: number
  bassOnKick: boolean
  drift: Partial<Record<Part, { lean: number; spread: number }>>
}

const STEPS = 16
const STEP_BEATS = 0.25
const CERTAIN = 0.95
const LONG_SLICE_BEATS = 1
const PICKUP = 0.15
const ON_KICK = 0.7
const FILL_FLOOR = 0.12
const PARTS: Part[] = ['kick', 'snare', 'hat', 'open_hat', 'perc', 'bass', 'upper']
const MELODIC_PARTS: Part[] = ['bass', 'upper']
const GHOST_PARTS: Part[] = ['snare', 'perc']
const CORE_PARTS: Part[] = ['kick', 'snare', 'hat']
const PROTECTED_PARTS: Part[] = [...CORE_PARTS, 'bass', 'upper']

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
    bassOnKick: true,
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
    bassOnKick: true,
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
    bassOnKick: true,
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
    bassOnKick: false,
    drift: { hat: { lean: 0, spread: 0.008 } },
  },
}

const TEMPOS: Record<Style, { low: number; high: number; center: number }> = {
  boom_bap: { low: 80, high: 100, center: 90 },
  dilla: { low: 70, high: 98, center: 84 },
  breakbeat: { low: 100, high: 180, center: 130 },
  four_on_floor: { low: 112, high: 135, center: 124 },
}

export const candidateStyles = (choice: StyleChoice, bpm: number, count: number): Style[] => {
  if (choice !== 'auto') return Array(count).fill(choice)
  const styles = Object.keys(TEMPOS) as Style[]
  const outside = (style: Style) => Math.max(0, TEMPOS[style].low - bpm, bpm - TEMPOS[style].high)
  const fitting = styles
    .filter((style) => outside(style) === 0)
    .sort((a, b) => Math.abs(bpm - TEMPOS[a].center) - Math.abs(bpm - TEMPOS[b].center))
  const pool = fitting.length > 0 ? fitting : [styles.reduce((a, b) => (outside(b) < outside(a) ? b : a))]
  return Array.from({ length: count }, (_, i) => pool[i % pool.length])
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

  const chosen = new Map<Part, { info: PadInfo; standIn: boolean }>()
  for (const [part, candidates] of byPart) {
    chosen.set(part, { info: candidates[Math.floor(rand() * candidates.length)], standIn: false })
  }
  for (const part of CORE_PARTS) {
    if (chosen.has(part)) continue
    const taken = new Set([...chosen].filter(([p, c]) => PROTECTED_PARTS.includes(p) || c.standIn).map(([, c]) => c.info.pad))
    const pool = input.pads.filter((p) => !played.has(p.pad) && !taken.has(p.pad) && p.beats <= LONG_SLICE_BEATS)
    const score = (p: PadInfo) => PART_CATEGORIES[part].reduce((sum, c) => sum + (p.scores[c] ?? 0), 0)
    const best = pool.reduce<PadInfo | null>((a, b) => (a === null || score(b) > score(a) ? b : a), null)
    if (!best) continue
    for (const [p, c] of chosen) if (c.info.pad === best.pad) chosen.delete(p)
    chosen.set(part, { info: best, standIn: true })
  }

  const followsKick = (part: Part) => part === 'bass' && template.bassOnKick && chosen.has('kick')
  const rolled = PARTS.filter((part) => {
    const pick = chosen.get(part)
    const lane = template.lanes[part]
    if (!pick || !lane) return false
    if (!MELODIC_PARTS.includes(part) || pick.info.beats <= LONG_SLICE_BEATS) return true
    const every = Math.max(4, Math.ceil(pick.info.beats / 4) * 4)
    for (let beat = 0; beat < input.lengthBeats; beat += every) {
      events.push({ id: nextId(), beat, pad: pick.info.pad, velocity: lane.velocity, nudge: 0, pitch: 0, auto: true, standIn: pick.standIn })
    }
    return false
  })

  const hit = (part: Part, lane: Lane, step: number, p: number, pitch: number): Hit => ({
    step,
    velocity: Math.min(1, lane.velocity * (GHOST_PARTS.includes(part) && p < CERTAIN ? 0.45 + 0.5 * p : 1) * (step % 4 === 0 ? 1 : 0.85) * (0.9 + rand() * 0.1)),
    nudge: input.looseness === 0 ? 0 : swingShift(step) * input.looseness + nudgeFor(part),
    pitch,
  })

  const roll = (from: number, base?: Map<Part, Hit[]>) => {
    const bar = new Map<Part, Hit[]>()
    for (const part of rolled) {
      const lane = template.lanes[part]!
      const melodic = MELODIC_PARTS.includes(part)
      const pitchAt = (step: number) =>
        !melodic || step === 0 ? 0 : (base?.get(part)?.find((h) => h.step === step)?.pitch ?? pitchFor(lane))
      const hits: Hit[] = []
      if (followsKick(part)) {
        const kicks = bar.get('kick') ?? []
        for (const kick of kicks) {
          const pickup = kick.step - 1
          if (pickup >= from && !kicks.some((k) => k.step === pickup) && rand() < scaled(PICKUP, input.density)) hits.push(hit(part, lane, pickup, PICKUP, pitchAt(pickup)))
          if (kick.step === 0 || rand() < scaled(ON_KICK, input.density)) {
            hits.push({ ...hit(part, lane, kick.step, 1, pitchAt(kick.step)), nudge: kick.nudge })
          }
        }
      } else {
        for (let step = from; step < STEPS; step++) {
          const written = lane.probabilities[step]
          const p = base && GHOST_PARTS.includes(part) && written < CERTAIN ? Math.max(written * 1.5, FILL_FLOOR) : written
          if (rand() < scaled(p, input.density)) hits.push(hit(part, lane, step, p, pitchAt(step)))
        }
      }
      bar.set(part, hits)
    }
    const open = new Set((bar.get('open_hat') ?? []).map((h) => h.step))
    bar.set('hat', (bar.get('hat') ?? []).filter((h) => !open.has(h.step)))
    return bar
  }

  const base = roll(0)
  const fill = bars > 1 ? roll(STEPS / 2, base) : null
  for (let b = 0; b < bars; b++) {
    const last = fill && b === bars - 1
    for (const part of rolled) {
      const { info, standIn } = chosen.get(part)!
      const hits = last ? [...base.get(part)!.filter((h) => h.step < STEPS / 2), ...fill.get(part)!] : base.get(part)!
      for (const h of hits) {
        events.push({ id: nextId(), beat: b * 4 + h.step * STEP_BEATS, pad: info.pad, velocity: h.velocity, nudge: h.nudge, pitch: h.pitch, auto: true, standIn })
      }
    }
  }
  return [...manual, ...events]
}
