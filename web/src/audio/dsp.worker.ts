import wasmUrl from '../wasm/sily.wasm?url'
import { instantiate, withFloats } from './wasm'

export type DspJob = {
  op: 'stretch' | 'pitchShift'
  left: Float32Array
  right: Float32Array
  sampleRate: number
  amount: number
}

export type Stereo = { left: Float32Array; right: Float32Array }

const ready = WebAssembly.compileStreaming(fetch(wasmUrl)).then((m) => instantiate(m, () => performance.now() / 1000))

self.onmessage = async (e: MessageEvent<{ id: number; payload: DspJob }>) => {
  const { id, payload: job } = e.data
  try {
    const w = await ready
    const result = withFloats(w, [job.left, job.right], ([l, r]) => {
      const frames =
        job.op === 'stretch'
          ? w.stretch(l, r, job.left.length, job.sampleRate, job.amount)
          : w.pitch_shift(l, r, job.left.length, job.sampleRate, job.amount)
      return {
        left: new Float32Array(w.memory.buffer, w.result_audio(0), frames).slice(),
        right: new Float32Array(w.memory.buffer, w.result_audio(1), frames).slice(),
      }
    })
    self.postMessage({ id, result }, { transfer: [result.left.buffer, result.right.buffer] })
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  }
}
