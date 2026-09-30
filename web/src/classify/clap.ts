import type { Category } from './categories'

export type LabelEmbeddings = Partial<Record<Category, number[][]>>

const SHARPNESS = 30

export const resample = (audio: Float32Array, from: number, to: number): Float32Array => {
  if (from === to) return audio.slice()
  const out = new Float32Array(Math.round((audio.length * to) / from))
  const step = from / to
  for (let i = 0; i < out.length; i++) {
    const pos = i * step
    const j = Math.floor(pos)
    const a = audio[j] ?? 0
    const b = audio[j + 1] ?? a
    out[i] = a + (b - a) * (pos - j)
  }
  return out
}

export const pickLabel = (embedding: number[], labels: LabelEmbeddings): { category: Category; confidence: number } => {
  const norm = Math.hypot(...embedding) || 1
  const scores = (Object.entries(labels) as [Category, number[][]][]).map(([category, prompts]) => ({
    category,
    score: Math.max(...prompts.map((p) => p.reduce((s, x, i) => s + (x * embedding[i]) / norm, 0))),
  }))
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a))
  const total = scores.reduce((sum, s) => sum + Math.exp((s.score - best.score) * SHARPNESS), 0)
  return { category: best.category, confidence: 1 / total }
}
