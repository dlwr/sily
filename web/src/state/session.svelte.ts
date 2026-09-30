import { mixdown, Sily, type Capture } from '../audio/client'
import { nudgeEvent, recordHit, removeEvent, shiftPitch, toggleStep, type PadEvent } from './pattern'
import { rateForBpm, rateToSemitones, SourceMap, type SourceSpeed } from './source'
import { frameAt } from './timing'

export type PadSettings = { pitch: number; gain: number; stretch: boolean; reverse: boolean }
export type Sample = { name: string; left: Float32Array; right: Float32Array; mono: Float32Array }

const PADS = 16

export class Session {
  sily = $state<Sily | null>(null)
  sample = $state.raw<Sample | null>(null)
  markers = $state<number[]>([])
  pads = $state<PadSettings[]>(
    Array.from({ length: PADS }, () => ({ pitch: 0, gain: 1, stretch: false, reverse: false })),
  )
  selectedPad = $state(0)
  events = $state<PadEvent[]>([])
  bpm = $state(90)
  bars = $state(1)
  playing = $state(false)
  recording = $state(false)
  metronome = $state(true)
  grid = $state(0.25)
  strength = $state(0)
  swing = $state(0.5)
  keyboardMode = $state(false)
  beat = $state(0)
  auditionFrame = $state<number | null>(null)
  sensitivity = $state(0.5)
  capturing = $state<'device' | 'display' | null>(null)
  hits = $state<number[]>(Array(PADS).fill(0))
  message = $state('')
  sourceSpeed = $state<SourceSpeed>({ mode: 'tape', rate: 1 })
  sourceBpm = $state<number | null>(null)

  private lastTick = { frame: 0, time: 0 }
  private capture: Capture | null = null
  private map = new SourceMap(1, 1)
  private engineSample: { left: Float32Array; right: Float32Array } | null = null
  private loadedStretch: number | null = null
  private stretchedSent = new Set<string>()

  get lengthBeats() {
    return this.bars * 4
  }

  get sampleRate() {
    return this.sily?.sampleRate ?? 44100
  }

  async start() {
    if (this.sily) return
    const sily = await Sily.create()
    sily.onTick = (t) => {
      this.beat = t.beat
      this.auditionFrame = t.auditionFrame === null ? null : this.map.fromEngine(t.auditionFrame)
      if (t.auditionFrame !== null) this.lastTick = { frame: t.auditionFrame, time: t.time }
    }
    sily.onRecorded = (r) => {
      this.events = recordHit(this.events, r.pad, r.beat, r.velocity, r.pitch)
      this.syncEvents()
    }
    sily.onFailure = () => (this.message = 'オーディオ処理が停止した。ページを再読み込みしてほしい')
    this.sily = sily
    this.syncTransport()
    this.syncGroove()
  }

  async loadFile(file: File) {
    if (!this.sily) return
    try {
      const { left, right } = await this.sily.decode(file)
      this.setSample(file.name, left, right)
    } catch {
      this.message = `${file.name} を読み込めなかった`
    }
  }

  setSample(name: string, left: Float32Array, right: Float32Array) {
    if (!this.sily) return
    this.sample = { name, left, right, mono: mixdown(left, right) }
    this.sourceSpeed = { mode: 'tape', rate: 1 }
    this.sourceBpm = null
    this.loadEngineSample(left, right, null)
    this.sily.send({ type: 'sourceRate', rate: 1 })
    this.markers = []
    this.pads.forEach((p) => (p.stretch = false))
    this.stretchedSent.clear()
    this.events = []
    this.syncEvents()
    this.message = ''
  }

  async toggleCapture(source: { device: string | undefined } | 'display') {
    if (!this.sily) return
    if (this.capture) {
      this.finishCapture()
      return
    }
    try {
      this.capture =
        source === 'display'
          ? await this.sily.captureDisplay(() => this.finishCapture())
          : await this.sily.capture(source.device)
      this.capturing = source === 'display' ? 'display' : 'device'
      this.message = ''
    } catch {
      this.message =
        source === 'display'
          ? '音声を取れなかった。共有ダイアログで「タブの音声」か「システム音声」を有効にしてほしい'
          : '入力デバイスを開けなかった'
    }
  }

  private finishCapture() {
    if (!this.capture) return
    const { left, right } = this.capture.stop()
    this.capture = null
    this.capturing = null
    if (left.length > 0) this.setSample(`capture-${new Date().toLocaleTimeString()}`, left, right)
  }

  toggleAudition(from = 0) {
    if (this.auditionFrame === null) this.auditionFrom(from)
    else this.stopAudition()
  }

  auditionFrom(frame: number) {
    if (!this.sily || !this.sample) return
    const engineFrame = this.map.toEngine(frame)
    this.auditionFrame = frame
    this.lastTick = { frame: engineFrame, time: this.sily.ctx.currentTime }
    this.sily.send({ type: 'audition', from: engineFrame })
  }

  stopAudition() {
    this.auditionFrame = null
    this.sily?.send({ type: 'audition', from: null })
  }

  markAtKey(timeStamp: number) {
    if (!this.sily || this.auditionFrame === null) return
    const framesPerSecond = this.sampleRate * (this.sourceSpeed.mode === 'tape' ? this.sourceSpeed.rate : 1)
    const played = frameAt(this.lastTick, this.sily.ctx.currentTime, framesPerSecond)
    const engineFrame = frameAt(this.lastTick, this.sily.audibleTime(timeStamp), framesPerSecond, played)
    this.addMarker(this.map.fromEngine(engineFrame))
  }

  addMarker(frame: number) {
    if (!this.sample || this.markers.includes(frame)) return
    this.setMarkers([...this.markers, frame])
  }

  removeMarkerNear(frame: number, tolerance: number) {
    const nearest = this.markers.reduce<number | null>(
      (best, m) => (Math.abs(m - frame) <= tolerance && (best === null || Math.abs(m - frame) < Math.abs(best - frame)) ? m : best),
      null,
    )
    if (nearest !== null) this.setMarkers(this.markers.filter((m) => m !== nearest))
  }

  moveMarker(from: number, to: number) {
    this.setMarkers(this.markers.map((m) => (m === from ? to : m)))
  }

  setMarkers(markers: number[]) {
    const len = this.sample?.left.length ?? 0
    this.markers = [...new Set(markers.map((m) => Math.max(0, Math.min(len - 1, Math.round(m)))))].sort((a, b) => a - b)
    this.sendMarkers()
    this.invalidateStretched()
  }

  setSourceSpeed(patch: Partial<SourceSpeed>) {
    this.sourceSpeed = { ...this.sourceSpeed, ...patch }
    this.applySource()
  }

  matchBpm(mode: SourceSpeed['mode']) {
    const sourceBpm = this.sourceBpm ?? this.estimateSourceBpm()
    if (!sourceBpm) return
    this.setSourceSpeed({ mode, rate: rateForBpm(this.bpm, sourceBpm) })
  }

  detectOnsets() {
    if (!this.sily || !this.sample) return
    this.setMarkers(this.sily.onsets(this.sample.mono, this.sensitivity).slice(0, 64))
  }

  gridSlice(count: number) {
    if (!this.sample) return
    const start = this.markers[0] ?? 0
    const end = this.sample.left.length
    this.setMarkers(Array.from({ length: count }, (_, i) => start + ((end - start) * i) / count))
  }

  detectBpm() {
    const sourceBpm = this.estimateSourceBpm()
    if (!sourceBpm) return
    this.bpm = Math.round(sourceBpm * this.sourceSpeed.rate * 10) / 10
    this.syncTransport()
  }

  private estimateSourceBpm(): number | null {
    if (!this.sily || !this.sample) return null
    const bpm = this.sily.bpm(this.sample.mono)
    if (!bpm) {
      this.message = 'BPM を推定できなかった'
      return null
    }
    this.sourceBpm = Math.round(bpm * 10) / 10
    return this.sourceBpm
  }

  sliceRange(pad: number): [number, number] | null {
    if (!this.sample) return null
    const len = this.sample.left.length
    if (this.markers.length === 0) return pad === 0 ? [0, len] : null
    if (pad >= this.markers.length) return null
    return [this.markers[pad], this.markers[pad + 1] ?? len]
  }

  padDown(pad: number, timeStamp: number, velocity = 1) {
    if (!this.sily) return
    this.selectedPad = pad
    this.hits[pad] = performance.now()
    this.sily.send({ type: 'trigger', pad, velocity, pitch: 0 })
    if (this.recording && this.playing) {
      this.sily.send({ type: 'record', pad, velocity, pitch: 0, time: this.sily.audibleTime(timeStamp) })
    }
  }

  noteDown(note: number, timeStamp: number) {
    if (!this.sily) return
    const pad = this.selectedPad
    this.hits[pad] = performance.now()
    this.sily.send({ type: 'note', slice: pad, semitones: note, velocity: 1 })
    if (this.recording && this.playing) {
      this.sily.send({ type: 'record', pad, velocity: 1, pitch: note, time: this.sily.audibleTime(timeStamp) })
    }
  }

  setPad(pad: number, patch: Partial<PadSettings>) {
    Object.assign(this.pads[pad], patch)
    const p = this.pads[pad]
    this.sily?.send({ type: 'pad', pad, pitch: p.pitch, gain: p.gain, reverse: p.reverse })
    if ('stretch' in patch || 'reverse' in patch) this.invalidateStretched([pad])
    else if ('pitch' in patch) this.fillStretched()
  }

  togglePlaying() {
    this.playing = !this.playing
    if (!this.playing) this.recording = false
    this.syncTransport()
  }

  toggleRecording() {
    this.recording = !this.recording
    if (this.recording && !this.playing) {
      this.playing = true
      this.syncTransport()
    }
  }

  setTransport(patch: Partial<{ bpm: number; bars: number; metronome: boolean }>) {
    Object.assign(this, patch)
    this.syncTransport()
  }

  setGroove(patch: Partial<{ grid: number; strength: number; swing: number }>) {
    Object.assign(this, patch)
    this.syncGroove()
  }

  toggleStepAt(pad: number, beat: number) {
    this.events = toggleStep(this.events, pad, beat, this.grid / 2)
    this.syncEvents()
  }

  nudge(id: string, delta: number) {
    this.events = nudgeEvent(this.events, id, delta)
    this.syncEvents()
  }

  shiftPitch(id: string, delta: number) {
    this.events = shiftPitch(this.events, id, delta)
    this.syncEvents()
  }

  remove(id: string) {
    this.events = removeEvent(this.events, id)
    this.syncEvents()
  }

  clearPattern() {
    this.events = []
    this.syncEvents()
  }

  private applySource() {
    if (!this.sily || !this.sample) return
    const { mode, rate } = this.sourceSpeed
    const stretch = mode === 'stretch' && rate !== 1 ? rate : null
    if (stretch !== this.loadedStretch) {
      const { left, right } = this.sample
      const out = stretch ? this.sily.stretch(left, right, 1 / stretch) : { left, right }
      this.stopAudition()
      this.loadEngineSample(out.left, out.right, stretch)
      this.sendMarkers()
    }
    this.sily.send({ type: 'sourceRate', rate: mode === 'tape' ? rate : 1 })
    this.invalidateStretched()
  }

  private loadEngineSample(left: Float32Array, right: Float32Array, stretch: number | null) {
    this.engineSample = { left, right }
    this.loadedStretch = stretch
    this.map = new SourceMap(this.sample?.left.length ?? left.length, left.length)
    this.sily?.send({ type: 'load', left: left.slice(), right: right.slice() })
  }

  private sendMarkers() {
    this.sily?.send({ type: 'markers', frames: this.markers.map((m) => this.map.toEngine(m)) })
  }

  private invalidateStretched(only?: number[]) {
    for (const pad of only ?? this.pads.keys()) {
      this.sily?.send({ type: 'clearStretched', pad })
      for (const key of [...this.stretchedSent]) if (key.startsWith(`${pad}:`)) this.stretchedSent.delete(key)
    }
    this.fillStretched()
  }

  private fillStretched() {
    if (!this.sily || !this.engineSample) return
    const tapeSemitones = this.sourceSpeed.mode === 'tape' ? rateToSemitones(this.sourceSpeed.rate) : 0
    this.pads.forEach((p, pad) => {
      const range = this.sliceRange(pad)
      if (!p.stretch || !range) return
      const pitches = new Set([p.pitch, ...this.events.filter((e) => e.pad === pad).map((e) => p.pitch + e.pitch)])
      const [s, e] = range.map((f) => this.map.toEngine(f))
      for (const pitch of pitches) {
        const key = `${pad}:${Math.round(pitch * 100)}`
        if (this.stretchedSent.has(key)) continue
        this.stretchedSent.add(key)
        const { left, right } = this.engineSample!
        const shifted = this.sily!.pitchShift(left.subarray(s, e), right.subarray(s, e), pitch + tapeSemitones)
        if (p.reverse) {
          shifted.left.reverse()
          shifted.right.reverse()
        }
        this.sily!.send({ type: 'stretched', pad, pitch, left: shifted.left, right: shifted.right }, [
          shifted.left.buffer,
          shifted.right.buffer,
        ])
      }
    })
  }

  private syncTransport() {
    this.sily?.send({
      type: 'transport',
      bpm: this.bpm,
      playing: this.playing,
      metronome: this.metronome,
      lengthBeats: this.lengthBeats,
    })
  }

  private syncGroove() {
    this.sily?.send({ type: 'groove', grid: this.grid, strength: this.strength, swing: this.swing })
  }

  private syncEvents() {
    this.sily?.send({
      type: 'events',
      events: this.events.map(({ beat, pad, velocity, nudge, pitch }) => ({ beat, pad, velocity, nudge, pitch })),
    })
    this.fillStretched()
  }
}
