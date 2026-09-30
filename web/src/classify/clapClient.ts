import { WorkerRpc } from '../audio/rpc'
import type { Category } from './categories'
import { pickLabel, resample, type LabelEmbeddings } from './clap'
import labels from './clap-labels.json'

const CLAP_RATE = 48000

export class ClapClient {
  private rpc = new WorkerRpc<{ audio: Float32Array }, number[]>(
    () => new Worker(new URL('./clap.worker.ts', import.meta.url), { type: 'module' }),
  )

  async classify(mono: Float32Array, sampleRate: number, among: Category[]): Promise<{ category: Category; confidence: number }> {
    const audio = resample(mono, sampleRate, CLAP_RATE)
    const embedding = await this.rpc.call({ audio }, [audio.buffer])
    const candidates = Object.fromEntries(
      Object.entries(labels as LabelEmbeddings).filter(([category]) => among.includes(category as Category)),
    )
    return pickLabel(embedding, candidates)
  }
}
