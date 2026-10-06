import type { Category } from '../classify/categories'
import type { Split } from '../corrections/split'
import { SourceMap, type SourceSpeed } from './source'

export type Label = {
  category: Category
  confidence: number
  manual: boolean
  scores: Partial<Record<Category, number>>
}

export type Sample = { name: string; left: Float32Array; right: Float32Array; mono: Float32Array }

export class Bank {
  constructor(readonly index: number) {}

  sample = $state.raw<Sample | null>(null)
  markers = $state<number[]>([])
  labels = $state<Record<number, Label>>({})
  sourceSpeed = $state<SourceSpeed>({ mode: 'tape', rate: 1 })
  sourceBpm = $state<number | null>(null)
  heldOut = $state(false)
  splitByHash = $state<Split | null>(null)
  refining = $state(false)
  refined = $state(0)
  refineTotal = $state(0)
  sourceId: string | null = null
  map = new SourceMap(1, 1)
  engineSample: { left: Float32Array; right: Float32Array } | null = null
  loadedStretch: number | null = null
  features = new Map<number, number[]>()
  embeddings = new Map<string, number[]>()
  kitPending = false
  refineGeneration = 0
  phraseToken = 0
  sourceToken = 0
  classifyTimer: ReturnType<typeof setTimeout> | undefined
}
