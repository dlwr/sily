import type { Category } from '../classify/categories'
import { presetsFor, type FxSettings } from '../fx/fx'

export type Key = { root: number; minor: boolean }

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]

const MIN_PITCHEDNESS = 0.6
const KEY_RANGE = 6
const REGISTER_RANGE = 3
const WINDOW = 7

const TUNED_TO_KEY: Category[] = ['bass', 'keys', 'melody', 'vocal', 'upper']
const KEY_REGISTER: Partial<Record<Category, number>> = { kick: 55, tom: 130 }
const REGISTER: Partial<Record<Category, number>> = { snare: 200, rim: 450 }

const AUTO_PRESET: Partial<Record<Category, string>> = {
  kick: 'キックを締める',
  snare: 'スネアを抜けさせる',
  clap: 'スネアを抜けさせる',
  rim: 'スネアを抜けさせる',
  closed_hat: 'ハットを明るく',
  open_hat: 'ハットを明るく',
  cymbal: 'ハットを明るく',
  perc: 'パーカッションを前に',
  tom: 'パーカッションを前に',
  bass: 'ベースを太く',
  keys: 'うわものを馴染ませる',
  melody: 'うわものを馴染ませる',
  vocal: 'うわものを馴染ませる',
  upper: 'うわものを馴染ませる',
}

const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440)
const round = (semitones: number) => Math.round(semitones * 100) / 100

const correlation = (a: number[], b: number[]) => {
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db || 1)
}

export const estimateKey = (chroma: number[]): Key => {
  let best: Key = { root: 0, minor: false }
  let bestScore = -Infinity
  for (let root = 0; root < 12; root++) {
    const rotated = chroma.map((_, i) => chroma[(i + root) % 12])
    for (const minor of [false, true]) {
      const score = correlation(rotated, minor ? MINOR_PROFILE : MAJOR_PROFILE)
      if (score > bestScore) {
        bestScore = score
        best = { root, minor }
      }
    }
  }
  return best
}

const nearestNote = (midi: number, classes: number[], within: [number, number]) => {
  let best: number | null = null
  for (let n = Math.floor(within[0]); n <= Math.ceil(within[1]); n++) {
    if (n < within[0] || n > within[1] || !classes.includes(((n % 12) + 12) % 12)) continue
    if (best === null || Math.abs(n - midi) < Math.abs(best - midi)) best = n
  }
  return best
}

export const autoPitch = (category: Category, hz: number, pitchedness: number, key: Key): number => {
  if (hz <= 0 || pitchedness < MIN_PITCHEDNESS) return 0
  const midi = midiOf(hz)
  if (TUNED_TO_KEY.includes(category)) {
    const scale = (key.minor ? MINOR_SCALE : MAJOR_SCALE).map((d) => (d + key.root) % 12)
    const note = nearestNote(midi, scale, [midi - KEY_RANGE, midi + KEY_RANGE])
    return note === null ? 0 : round(note - midi)
  }
  const keyRegister = KEY_REGISTER[category]
  if (keyRegister !== undefined) {
    const center = midiOf(keyRegister)
    const note = nearestNote(midi, [key.root, (key.root + 7) % 12], [center - WINDOW, center + WINDOW])
    return note === null || Math.abs(note - midi) > KEY_RANGE ? 0 : round(note - midi)
  }
  const register = REGISTER[category]
  if (register !== undefined) {
    return round(Math.max(-REGISTER_RANGE, Math.min(REGISTER_RANGE, midiOf(register) - midi)))
  }
  return 0
}

export const autoFx = (category: Category): FxSettings | null => {
  const name = AUTO_PRESET[category]
  return presetsFor(category).find((p) => p.name === name)?.settings ?? null
}
