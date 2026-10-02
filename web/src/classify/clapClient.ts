import { WorkerRpc } from '../audio/rpc'
import { clipForClap, normalize } from './clap'

export class ClapClient {
  private rpc = new WorkerRpc<{ audio: Float32Array }, number[]>(
    () => new Worker(new URL('./clap.worker.ts', import.meta.url), { type: 'module' }),
  )

  async embed(mono: Float32Array, sampleRate: number): Promise<number[]> {
    const audio = clipForClap(mono, sampleRate)
    return normalize(await this.rpc.call({ audio }, [audio.buffer]))
  }
}
