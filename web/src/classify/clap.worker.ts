import { AutoProcessor, ClapAudioModelWithProjection, env, type Processor } from '@huggingface/transformers'

const MODEL = 'Xenova/clap-htsat-unfused'

env.allowLocalModels = false
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1

let loading: Promise<[Processor, ClapAudioModelWithProjection]> | null = null

const load = () =>
  (loading ??= Promise.all([
    AutoProcessor.from_pretrained(MODEL),
    ClapAudioModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' }),
  ]))

self.onmessage = async (e: MessageEvent<{ id: number; audio: Float32Array }>) => {
  try {
    const [processor, model] = await load()
    const { audio_embeds } = await model(await processor(e.data.audio))
    self.postMessage({ id: e.data.id, embedding: Array.from(audio_embeds.data as Float32Array) })
  } catch (error) {
    self.postMessage({ id: e.data.id, error: String(error) })
  }
}
