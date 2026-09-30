import type { Category } from './categories'
import { pickLabel, resample, type LabelEmbeddings } from './clap'
import labels from './clap-labels.json'

const CLAP_RATE = 48000

type Pending = { resolve: (embedding: number[]) => void; reject: (error: Error) => void }

export class ClapClient {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private next = 0

  async classify(mono: Float32Array, sampleRate: number, among: Category[]): Promise<{ category: Category; confidence: number }> {
    const embedding = await this.embed(resample(mono, sampleRate, CLAP_RATE))
    const candidates = Object.fromEntries(
      Object.entries(labels as LabelEmbeddings).filter(([category]) => among.includes(category as Category)),
    )
    return pickLabel(embedding, candidates)
  }

  private embed(audio: Float32Array): Promise<number[]> {
    const worker = (this.worker ??= this.spawn())
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ id, audio }, [audio.buffer])
    })
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./clap.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; embedding?: number[]; error?: string }>) => {
      const pending = this.pending.get(e.data.id)
      this.pending.delete(e.data.id)
      if (e.data.embedding) pending?.resolve(e.data.embedding)
      else pending?.reject(new Error(e.data.error))
    }
    return worker
  }
}
