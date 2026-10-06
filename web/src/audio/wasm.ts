export type SilyExports = {
  memory: WebAssembly.Memory
  alloc(bytes: number): number
  dealloc(ptr: number, bytes: number): void
  engine_init(sampleRate: number, maxBlock: number): void
  engine_load(source: number, left: number, right: number, frames: number): void
  engine_set_markers(source: number, ptr: number, len: number): void
  engine_set_pad(pad: number, pitch: number, gain: number, reverse: number): void
  engine_set_pad_stretched(pad: number, pitch: number, left: number, right: number, frames: number): void
  engine_clear_pad_stretched(pad: number): void
  engine_set_source_rate(source: number, rate: number): void
  engine_set_pad_mix(pad: number, pan: number, reverbSend: number, delaySend: number): void
  engine_set_reverb(size: number, damping: number, level: number): void
  engine_set_delay(feedback: number, toneHz: number, pingPong: number, beats: number, level: number): void
  engine_trigger(pad: number, velocity: number, pitch: number): void
  engine_trigger_note(slice: number, semitones: number, velocity: number): void
  engine_hold(pad: number, velocity: number, pitch: number, time: number): void
  engine_release(pad: number): void
  engine_release_all(): void
  engine_repeat_count(): number
  engine_repeat_pad(i: number): number
  engine_repeat_velocity(i: number): number
  engine_repeat_pitch(i: number): number
  engine_repeat_beat(i: number): number
  engine_audition(source: number, fromFrame: number): void
  engine_audition_frame(): number
  engine_set_bpm(bpm: number): void
  engine_set_playing(playing: number): void
  engine_set_metronome(on: number): void
  engine_set_play_limit(beats: number): void
  engine_set_pattern_length(beats: number): void
  engine_set_groove(grid: number, strength: number, swing: number): void
  engine_clear_events(): void
  engine_add_event(beat: number, pad: number, velocity: number, nudge: number, pitch: number): void
  engine_beat(): number
  engine_beat_at_time(time: number): number
  engine_process(frames: number, time: number): void
  engine_output(channel: number): number
  analyze_onsets(mono: number, frames: number, sampleRate: number, sensitivity: number, minGapSeconds: number): number
  result_frames(): number
  analyze_bpm(mono: number, frames: number, sampleRate: number): number
  pitch_shift(left: number, right: number, frames: number, sampleRate: number, semitones: number): number
  stretch(left: number, right: number, frames: number, sampleRate: number, ratio: number): number
  result_audio(channel: number): number
  engine_set_pad_slice(pad: number, slice: number): void
  engine_set_pad_span(pad: number, start: number, end: number): void
  engine_set_choke_group(pad: number, group: number): void
  engine_set_pad_sample(pad: number, left: number, right: number, frames: number): void
  engine_set_pad_fx(pad: number, hp: number, lp: number, low: number, mid: number, midHz: number, high: number, drive: number, ceiling: number): void
  engine_set_master_fx(hp: number, lp: number, low: number, mid: number, midHz: number, high: number, drive: number, ceiling: number): void
  engine_queue_clear(): void
  engine_queue_add(beat: number, pad: number, velocity: number, nudge: number, pitch: number): void
  engine_queue_commit(): void
  engine_queue_commit_pattern(lengthBeats: number): void
  engine_queue_replace(): void
  classifier_load(json: number, len: number): number
  classify_slice(mono: number, frames: number, sampleRate: number): number
  result_confidence(): number
  result_features(): number
  result_features_len(): number
  result_scores(): number
  analyze_chroma(mono: number, frames: number, sampleRate: number): number
}

export const instantiate = (module: WebAssembly.Module, now: () => number): SilyExports => {
  let memory: WebAssembly.Memory | undefined
  const view = () => new DataView(memory!.buffer)
  const wasi = {
    clock_time_get: (_id: number, _precision: bigint, out: number) => {
      view().setBigUint64(out, BigInt(Math.round(now() * 1e6)), true)
      return 0
    },
    random_get: (ptr: number, len: number) => {
      const bytes = new Uint8Array(memory!.buffer, ptr, len)
      for (let i = 0; i < len; i++) bytes[i] = (Math.random() * 256) | 0
      return 0
    },
    environ_sizes_get: (count: number, size: number) => {
      view().setUint32(count, 0, true)
      view().setUint32(size, 0, true)
      return 0
    },
    environ_get: () => 0,
    fd_write: (_fd: number, _iovs: number, _len: number, written: number) => {
      view().setUint32(written, 0, true)
      return 0
    },
    proc_exit: (code: number) => {
      throw new Error(`wasm exited with ${code}`)
    },
  }
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi })
  const exports = instance.exports as unknown as SilyExports
  memory = exports.memory
  return exports
}

export const withFloats = <T>(wasm: SilyExports, arrays: Float32Array[], run: (ptrs: number[]) => T): T => {
  const ptrs = arrays.map((a) => {
    const ptr = wasm.alloc(a.length * 4)
    new Float32Array(wasm.memory.buffer, ptr, a.length).set(a)
    return ptr
  })
  try {
    return run(ptrs)
  } finally {
    ptrs.forEach((p, i) => wasm.dealloc(p, arrays[i].length * 4))
  }
}

export const withU32 = <T>(wasm: SilyExports, values: ArrayLike<number>, run: (ptr: number) => T): T => {
  const ptr = wasm.alloc(values.length * 4)
  new Uint32Array(wasm.memory.buffer, ptr, values.length).set(values)
  try {
    return run(ptr)
  } finally {
    wasm.dealloc(ptr, values.length * 4)
  }
}
