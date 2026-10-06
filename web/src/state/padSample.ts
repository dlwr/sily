import type { Category } from '../classify/categories'

export type LibrarySample = { id: string; name: string; category: Category }

export type SliceSample = { bank: number; range: [number, number]; name: string; category: Category }

export type PadSample = LibrarySample | SliceSample

export const isSlice = (sample: PadSample): sample is SliceSample => 'bank' in sample

export const sampleKey = (sample: PadSample, source: { rate: number; stretch: number | null }): string =>
  isSlice(sample) ? `${sample.bank}:${sample.range.join('-')}:${source.rate}:${source.stretch}` : sample.id

export const slicesOf = (pads: { sample: PadSample | null }[], bank: number): number[] =>
  pads.flatMap((p, pad) => (p.sample && isSlice(p.sample) && p.sample.bank === bank ? [pad] : []))
