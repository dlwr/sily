import { WorkerRpc } from '../audio/rpc'
import { clipForClap, normalize } from './clap'

export type ModelDownload = { loaded: number; total: number }

export class ClapClient {
  private rpc: WorkerRpc<{ audio: Float32Array }, number[], ModelDownload>

  constructor(onDownload: (download: ModelDownload) => void = () => {}) {
    this.rpc = new WorkerRpc(() => new Worker(new URL('./clap.worker.ts', import.meta.url), { type: 'module' }), onDownload)
  }

  async embed(mono: Float32Array, sampleRate: number): Promise<number[]> {
    const audio = clipForClap(mono, sampleRate)
    return normalize(await this.rpc.call({ audio }, [audio.buffer]))
  }
}
