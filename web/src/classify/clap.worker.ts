import { AutoProcessor, ClapAudioModelWithProjection, env, type ProgressInfo, type Processor } from '@huggingface/transformers'

const MODEL = 'Xenova/clap-htsat-unfused'

env.allowLocalModels = false
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1

let loading: Promise<[Processor, ClapAudioModelWithProjection]> | null = null

const progress_callback = (info: ProgressInfo) => {
  if (info.status === 'progress_total') self.postMessage({ event: { loaded: info.loaded, total: info.total } })
}

const loadModel = async () => {
  if ('gpu' in navigator) {
    try {
      return await ClapAudioModelWithProjection.from_pretrained(MODEL, { dtype: 'fp16', device: 'webgpu', progress_callback })
    } catch (error) {
      console.warn('CLAP on WebGPU failed, falling back to WASM', error)
    }
  }
  return ClapAudioModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', progress_callback })
}

const load = () => (loading ??= Promise.all([AutoProcessor.from_pretrained(MODEL), loadModel()]))

self.onmessage = async (e: MessageEvent<{ id: number; payload: { audio: Float32Array } }>) => {
  try {
    const [processor, model] = await load()
    const { audio_embeds } = await model(await processor(e.data.payload.audio))
    self.postMessage({ id: e.data.id, result: Array.from(audio_embeds.data as Float32Array) })
  } catch (error) {
    self.postMessage({ id: e.data.id, error: String(error) })
  }
}
