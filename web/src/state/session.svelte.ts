import { mixdown, Sily, type Capture } from '../audio/client'
import { nudgeEvent, recordHit, removeEvent, toggleStep, type PadEvent } from './pattern'
import { frameAt } from './timing'

export type PadSettings = { pitch: number; gain: number; stretch: boolean }
export type Sample = { name: string; left: Float32Array; right: Float32Array; mono: Float32Array }

const PADS = 16

export class Session {
  sily = $state<Sily | null>(null)
  sample = $state.raw<Sample | null>(null)
  markers = $state<number[]>([])
  pads = $state<PadSettings[]>(Array.from({ length: PADS }, () => ({ pitch: 0, gain: 1, stretch: false })))
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

  private lastTick = { frame: 0, time: 0 }
  private capture: Capture | null = null

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
      this.auditionFrame = t.auditionFrame
      if (t.auditionFrame !== null) this.lastTick = { frame: t.auditionFrame, time: t.time }
    }
    sily.onRecorded = (r) => {
      this.events = recordHit(this.events, r.pad, r.beat, r.velocity)
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
    this.sily.send({ type: 'load', left: left.slice(), right: right.slice() })
    this.markers = []
    this.pads.forEach((p) => (p.stretch = false))
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
    if (!this.sily || !this.sample) return
    const next = this.auditionFrame === null ? from : null
    this.auditionFrame = next
    if (next !== null) this.lastTick = { frame: next, time: this.sily.ctx.currentTime }
    this.sily.send({ type: 'audition', from: next })
  }

  auditionFrom(frame: number) {
    if (!this.sily || !this.sample) return
    this.auditionFrame = frame
    this.lastTick = { frame, time: this.sily.ctx.currentTime }
    this.sily.send({ type: 'audition', from: frame })
  }

  markAtKey(timeStamp: number) {
    if (!this.sily || this.auditionFrame === null) return
    const played = frameAt(this.lastTick, this.sily.ctx.currentTime, this.sampleRate)
    this.addMarker(frameAt(this.lastTick, this.sily.audibleTime(timeStamp), this.sampleRate, played))
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
    this.sily?.send({ type: 'markers', frames: [...this.markers] })
    this.refreshStretched()
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
    if (!this.sily || !this.sample) return
    const bpm = this.sily.bpm(this.sample.mono)
    if (bpm) {
      this.bpm = Math.round(bpm * 10) / 10
      this.syncTransport()
    } else {
      this.message = 'BPM を推定できなかった'
    }
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
    this.sily.send({ type: 'trigger', pad, velocity })
    if (this.recording && this.playing) {
      this.sily.send({ type: 'record', pad, velocity, time: this.sily.audibleTime(timeStamp) })
    }
  }

  noteDown(note: number) {
    if (!this.sily) return
    this.hits[this.selectedPad] = performance.now()
    this.sily.send({ type: 'note', slice: this.selectedPad, semitones: note, velocity: 1 })
  }

  setPad(pad: number, patch: Partial<PadSettings>) {
    Object.assign(this.pads[pad], patch)
    const p = this.pads[pad]
    this.sily?.send({ type: 'pad', pad, pitch: p.pitch, gain: p.gain })
    if ('stretch' in patch || ('pitch' in patch && p.stretch)) this.refreshStretched([pad])
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

  remove(id: string) {
    this.events = removeEvent(this.events, id)
    this.syncEvents()
  }

  clearPattern() {
    this.events = []
    this.syncEvents()
  }

  private refreshStretched(only?: number[]) {
    if (!this.sily || !this.sample) return
    for (const pad of only ?? this.pads.keys()) {
      const p = this.pads[pad]
      const range = this.sliceRange(pad)
      if (!p.stretch || !range) {
        if (only || p.stretch) this.sily.send({ type: 'stretched', pad, left: null, right: null })
        continue
      }
      const [s, e] = range
      const shifted = this.sily.pitchShift(this.sample.left.subarray(s, e), this.sample.right.subarray(s, e), p.pitch)
      this.sily.send({ type: 'stretched', pad, left: shifted.left, right: shifted.right }, [
        shifted.left.buffer,
        shifted.right.buffer,
      ])
    }
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
      events: this.events.map(({ beat, pad, velocity, nudge }) => ({ beat, pad, velocity, nudge })),
    })
  }
}
