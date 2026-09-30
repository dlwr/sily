import type { FromWorklet, ToWorklet } from './messages'
import { instantiate, withFloats, withU32, type SilyExports } from './wasm'

declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}
declare function registerProcessor(name: string, ctor: unknown): void

const MAX_BLOCK = 4096
const TICK_EVERY = 8

class SilyProcessor extends AudioWorkletProcessor {
  private wasm: SilyExports
  private blocks = 0

  constructor(options: { processorOptions: { module: WebAssembly.Module } }) {
    super()
    this.wasm = instantiate(options.processorOptions.module, () => currentTime)
    this.wasm.engine_init(sampleRate, MAX_BLOCK)
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.handle(e.data)
  }

  private handle(msg: ToWorklet) {
    const w = this.wasm
    switch (msg.type) {
      case 'load':
        withFloats(w, [msg.left, msg.right], ([l, r]) => w.engine_load(l, r, msg.left.length))
        break
      case 'markers':
        withU32(w, msg.frames, (ptr) => w.engine_set_markers(ptr, msg.frames.length))
        break
      case 'pad':
        w.engine_set_pad(msg.pad, msg.pitch, msg.gain, msg.reverse ? 1 : 0)
        break
      case 'stretched': {
        const frames = msg.left.length
        withFloats(w, [msg.left, msg.right], ([l, r]) => w.engine_set_pad_stretched(msg.pad, msg.pitch, l, r, frames))
        break
      }
      case 'clearStretched':
        w.engine_clear_pad_stretched(msg.pad)
        break
      case 'sourceRate':
        w.engine_set_source_rate(msg.rate)
        break
      case 'trigger':
        w.engine_trigger(msg.pad, msg.velocity, msg.pitch)
        break
      case 'note':
        w.engine_trigger_note(msg.slice, msg.semitones, msg.velocity)
        break
      case 'audition':
        w.engine_audition(msg.from ?? -1)
        break
      case 'transport':
        w.engine_set_bpm(msg.bpm)
        w.engine_set_pattern_length(msg.lengthBeats)
        w.engine_set_metronome(msg.metronome ? 1 : 0)
        w.engine_set_playing(msg.playing ? 1 : 0)
        break
      case 'groove':
        w.engine_set_groove(msg.grid, msg.strength, msg.swing)
        break
      case 'events':
        w.engine_clear_events()
        for (const e of msg.events) w.engine_add_event(e.beat, e.pad, e.velocity, e.nudge, e.pitch)
        break
      case 'record':
        this.post({
          type: 'recorded',
          pad: msg.pad,
          velocity: msg.velocity,
          pitch: msg.pitch,
          beat: w.engine_beat_at_time(msg.time),
        })
        break
    }
  }

  private post(msg: FromWorklet) {
    this.port.postMessage(msg)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]
    const frames = out[0].length
    const w = this.wasm
    w.engine_process(frames, currentTime)
    for (let ch = 0; ch < out.length; ch++) {
      out[ch].set(new Float32Array(w.memory.buffer, w.engine_output(Math.min(ch, 1)), frames))
    }
    if (++this.blocks % TICK_EVERY === 0) {
      const frame = w.engine_audition_frame()
      this.post({
        type: 'tick',
        beat: w.engine_beat(),
        auditionFrame: frame < 0 ? null : frame,
        time: currentTime + frames / sampleRate,
      })
    }
    return true
  }
}

registerProcessor('sily', SilyProcessor)

class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]) {
    const input = inputs[0]
    if (input.length > 0) {
      const left = input[0].slice()
      const right = (input[1] ?? input[0]).slice()
      this.port.postMessage({ left, right }, [left.buffer, right.buffer])
    }
    return true
  }
}

registerProcessor('sily-recorder', RecorderProcessor)
