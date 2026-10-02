import type { Category } from './categories'

export type Probe = {
  classes: Category[]
  mean: number[]
  scale: number[]
  weights: number[][]
  bias: number[]
}

export const probeScores = (probe: Probe, x: number[]): Partial<Record<Category, number>> => {
  const z = x.map((v, i) => (v - (probe.mean[i] ?? 0)) / (probe.scale[i] || 1))
  const logits = probe.weights.map((w, k) => w.reduce((sum, wi, i) => sum + wi * z[i], probe.bias[k]))
  const max = Math.max(...logits)
  const exp = logits.map((l) => Math.exp(l - max))
  const total = exp.reduce((a, b) => a + b, 0)
  return Object.fromEntries(probe.classes.map((c, k) => [c, exp[k] / total]))
}
