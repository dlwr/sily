import { CATEGORIES, type Category } from '../classify/categories'
import wasmUrl from '../wasm/sily.wasm?url'
import { audibleTime } from '../state/timing'
import type { DspJob, Stereo } from './dsp.worker'
import { WorkerRpc } from './rpc'
import type { FromWorklet, ToWorklet } from './messages'
import { instantiate, withFloats, type SilyExports } from './wasm'
import workletUrl from './worklet.ts?worker&url'

export type Capture = { stop(): { left: Float32Array; right: Float32Array } }

export class Sily {
  onTick: (msg: Extract<FromWorklet, { type: 'tick' }>) => void = () => {}
  onRecorded: (msg: Extract<FromWorklet, { type: 'recorded' }>) => void = () => {}
  onFailure: () => void = () => {}
  private dsp = new WorkerRpc<DspJob, Stereo>(
    () => new Worker(new URL('./dsp.worker.ts', import.meta.url), { type: 'module' }),
  )

  private constructor(
    readonly ctx: AudioContext,
    private module: WebAssembly.Module,
    private node: AudioWorkletNode,
    private analysis: SilyExports,
    readonly analyser: AnalyserNode,
  ) {
    node.onprocessorerror = () => this.onFailure()
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
      if (e.data.type === 'tick') this.onTick(e.data)
      else this.onRecorded(e.data)
    }
  }

  static async create(): Promise<Sily> {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const [module, { default: model }] = await Promise.all([
      WebAssembly.compileStreaming(fetch(wasmUrl)),
      import('../classify/model.json'),
      ctx.audioWorklet.addModule(workletUrl),
    ])
    const node = new AudioWorkletNode(ctx, 'sily', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { module },
    })
    await ctx.resume()
    const analyser = ctx.createAnalyser()
    node.connect(analyser)
    analyser.connect(ctx.destination)
    const analysis = instantiate(module, () => performance.now() / 1000)
    const json = new TextEncoder().encode(JSON.stringify(model))
    const ptr = analysis.alloc(json.length)
    new Uint8Array(analysis.memory.buffer, ptr, json.length).set(json)
    analysis.classifier_load(ptr, json.length)
    analysis.dealloc(ptr, json.length)
    return new Sily(ctx, module, node, analysis, analyser)
  }

  get sampleRate() {
    return this.ctx.sampleRate
  }

  send(msg: ToWorklet, transfer: Transferable[] = []) {
    this.node.port.postMessage(msg, transfer)
  }

  async renderOffline(snapshot: ToWorklet[], seconds: number): Promise<{ left: Float32Array; right: Float32Array }> {
    const ctx = new OfflineAudioContext({
      numberOfChannels: 2,
      length: Math.ceil(seconds * this.sampleRate),
      sampleRate: this.sampleRate,
    })
    await ctx.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(ctx, 'sily', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { module: this.module, snapshot },
    })
    node.connect(ctx.destination)
    const out = await ctx.startRendering()
    return { left: out.getChannelData(0), right: out.getChannelData(1) }
  }

  audibleTime(timeStamp: number): number {
    return audibleTime(timeStamp, this.ctx.getOutputTimestamp(), {
      currentTime: this.ctx.currentTime,
      now: performance.now(),
      latency: this.ctx.baseLatency + (this.ctx.outputLatency || 0),
    })
  }

  async decode(file: Blob): Promise<{ left: Float32Array; right: Float32Array }> {
    const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer())
    const left = buffer.getChannelData(0)
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
    return { left: left.slice(), right: right.slice() }
  }

  onsets(mono: Float32Array, sensitivity: number, minGapSeconds: number): number[] {
    const w = this.analysis
    return withFloats(w, [mono], ([ptr]) => {
      const count = w.analyze_onsets(ptr, mono.length, this.sampleRate, sensitivity, minGapSeconds)
      return Array.from(new Uint32Array(w.memory.buffer, w.result_frames(), count))
    })
  }

  classify(mono: Float32Array): {
    category: Category
    confidence: number
    features: number[]
    scores: Partial<Record<Category, number>>
  } {
    const w = this.analysis
    return withFloats(w, [mono], ([ptr]) => {
      const index = w.classify_slice(ptr, mono.length, this.sampleRate)
      return {
        category: CATEGORIES[index] ?? 'perc',
        confidence: w.result_confidence(),
        features: Array.from(new Float32Array(w.memory.buffer, w.result_features(), w.result_features_len())),
        scores: Object.fromEntries(
          Array.from(new Float32Array(w.memory.buffer, w.result_scores(), CATEGORIES.length)).map((p, i) => [CATEGORIES[i], p]),
        ),
      }
    })
  }

  chroma(mono: Float32Array): number[] {
    const w = this.analysis
    return withFloats(w, [mono], ([ptr]) =>
      Array.from(new Float32Array(w.memory.buffer, w.analyze_chroma(ptr, mono.length, this.sampleRate), 12)),
    )
  }

  bpm(mono: Float32Array): number | null {
    const w = this.analysis
    const bpm = withFloats(w, [mono], ([ptr]) => w.analyze_bpm(ptr, mono.length, this.sampleRate))
    return bpm > 0 ? bpm : null
  }

  pitchShift(left: Float32Array, right: Float32Array, semitones: number): Promise<Stereo> {
    return this.runDsp('pitchShift', left, right, semitones)
  }

  stretch(left: Float32Array, right: Float32Array, lengthRatio: number): Promise<Stereo> {
    return this.runDsp('stretch', left, right, lengthRatio)
  }

  private runDsp(op: DspJob['op'], left: Float32Array, right: Float32Array, amount: number): Promise<Stereo> {
    const job: DspJob = { op, left: left.slice(), right: right.slice(), sampleRate: this.sampleRate, amount }
    return this.dsp.call(job, [job.left.buffer, job.right.buffer])
  }

  async inputs(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'audioinput')
  }

  async capture(deviceId: string | undefined): Promise<Capture> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    })
    return this.record(stream)
  }

  async captureDisplay(onEnded: () => void): Promise<Capture> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
    } as DisplayMediaStreamOptions)
    const [audio] = stream.getAudioTracks()
    if (!audio) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('no audio track')
    }
    audio.addEventListener('ended', onEnded)
    return this.record(stream)
  }

  private record(stream: MediaStream): Capture {
    const source = this.ctx.createMediaStreamSource(stream)
    const recorder = new AudioWorkletNode(this.ctx, 'sily-recorder', { numberOfOutputs: 0 })
    const chunks: { left: Float32Array; right: Float32Array }[] = []
    recorder.port.onmessage = (e) => chunks.push(e.data)
    source.connect(recorder)
    return {
      stop: () => {
        source.disconnect()
        recorder.port.onmessage = null
        stream.getTracks().forEach((t) => t.stop())
        const frames = chunks.reduce((n, c) => n + c.left.length, 0)
        const left = new Float32Array(frames)
        const right = new Float32Array(frames)
        let at = 0
        for (const c of chunks) {
          left.set(c.left, at)
          right.set(c.right, at)
          at += c.left.length
        }
        return { left, right }
      },
    }
  }
}

export const mixdown = (left: Float32Array, right: Float32Array): Float32Array => {
  const mono = new Float32Array(left.length)
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i] + right[i]) / 2
  return mono
}
