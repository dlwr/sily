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

  constructor(options: { processorOptions: { module: WebAssembly.Module; snapshot?: ToWorklet[] } }) {
    super()
    this.wasm = instantiate(options.processorOptions.module, () => currentTime)
    this.wasm.engine_init(sampleRate, MAX_BLOCK)
    options.processorOptions.snapshot?.forEach((msg) => this.handle(msg))
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.handle(e.data)
  }

  private handle(msg: ToWorklet) {
    const w = this.wasm
    switch (msg.type) {
      case 'load':
        withFloats(w, [msg.left, msg.right], ([l, r]) => w.engine_load(msg.source, l, r, msg.left.length))
        break
      case 'markers':
        withU32(w, msg.frames, (ptr) => w.engine_set_markers(msg.source, ptr, msg.frames.length))
        break
      case 'fx': {
        const f = msg.fx
        const args = [f.highpass_hz, f.lowpass_hz, f.low_db, f.mid_db, f.mid_hz, f.high_db, f.drive_db, f.ceiling_db] as const
        if (msg.pad === null) w.engine_set_master_fx(...args)
        else w.engine_set_pad_fx(msg.pad, ...args)
        break
      }
      case 'padSample':
        if (msg.left && msg.right) {
          const frames = msg.left.length
          withFloats(w, [msg.left, msg.right], ([l, r]) => w.engine_set_pad_sample(msg.pad, l, r, frames))
        } else {
          w.engine_set_pad_sample(msg.pad, 0, 0, 0)
        }
        break
      case 'padSlices':
        msg.slices.forEach((slice, pad) => w.engine_set_pad_slice(pad, slice))
        break
      case 'padSpans':
        msg.spans.forEach((span, pad) => w.engine_set_pad_span(pad, span?.[0] ?? 0, span?.[1] ?? 0))
        break
      case 'pad':
        w.engine_set_pad(msg.pad, msg.pitch, msg.gain, msg.reverse ? 1 : 0)
        w.engine_set_choke_group(msg.pad, msg.choke)
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
        w.engine_set_source_rate(msg.source, msg.rate)
        break
      case 'padMix':
        w.engine_set_pad_mix(msg.pad, msg.pan, msg.reverb, msg.delay)
        break
      case 'comp':
        if (msg.pad === null) w.engine_set_glue(msg.amount)
        else w.engine_set_pad_comp(msg.pad, msg.amount)
        break
      case 'reverb':
        w.engine_set_reverb(msg.size, msg.damping, msg.level)
        break
      case 'delay':
        w.engine_set_delay(msg.feedback, msg.toneHz, msg.pingPong ? 1 : 0, msg.beats, msg.level)
        break
      case 'trigger':
        w.engine_trigger(msg.pad, msg.velocity, msg.pitch)
        break
      case 'note':
        w.engine_trigger_note(msg.slice, msg.semitones, msg.velocity)
        break
      case 'hold':
        w.engine_hold(msg.pad, msg.velocity, msg.pitch, msg.time)
        break
      case 'release':
        if (msg.pad === null) w.engine_release_all()
        else w.engine_release(msg.pad)
        break
      case 'audition':
        w.engine_audition(msg.source, msg.from ?? -1)
        break
      case 'transport':
        w.engine_set_bpm(msg.bpm)
        w.engine_set_pattern_length(msg.lengthBeats)
        w.engine_set_metronome(msg.metronome ? 1 : 0)
        w.engine_set_playing(msg.playing ? 1 : 0)
        break
      case 'playLimit':
        w.engine_set_play_limit(msg.beats ?? -1)
        break
      case 'groove':
        w.engine_set_groove(msg.grid, msg.strength, msg.swing)
        break
      case 'events':
        w.engine_queue_clear()
        for (const e of msg.events) w.engine_queue_add(e.beat, e.pad, e.velocity, e.nudge, e.pitch)
        w.engine_queue_replace()
        break
      case 'queueEvents':
        w.engine_queue_clear()
        for (const e of msg.events) w.engine_queue_add(e.beat, e.pad, e.velocity, e.nudge, e.pitch)
        if (msg.lengthBeats === undefined) w.engine_queue_commit()
        else w.engine_queue_commit_pattern(msg.lengthBeats)
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
    for (let i = 0, n = w.engine_repeat_count(); i < n; i++) {
      this.post({
        type: 'repeated',
        pad: w.engine_repeat_pad(i),
        velocity: w.engine_repeat_velocity(i),
        pitch: w.engine_repeat_pitch(i),
        beat: w.engine_repeat_beat(i),
      })
    }
    for (let ch = 0; ch < out.length; ch++) {
      out[ch].set(new Float32Array(w.memory.buffer, w.engine_output(Math.min(ch, 1)), frames))
    }
    if (++this.blocks % TICK_EVERY === 0) {
      const frame = w.engine_audition_frame()
      const meters = new Float32Array(w.memory.buffer, w.engine_meters(), w.engine_meter_count()).slice()
      w.engine_reset_meters()
      this.post({
        type: 'tick',
        beat: w.engine_beat(),
        auditionFrame: frame < 0 ? null : frame,
        time: currentTime + frames / sampleRate,
        meters,
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
