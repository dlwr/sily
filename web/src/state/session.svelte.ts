import { mixdown, Sily, type Capture } from '../audio/client'
import type { ToWorklet } from '../audio/messages'
import { arrangePads, remapEvents, type Category } from '../classify/categories'
import { buildKit, dropUnplacedEvents } from '../classify/kit'
import { ClapClient } from '../classify/clapClient'
import { generate, type PadInfo, type Style } from '../generate/generate'
import { encodeWav24, soundingLength } from '../export/wav'
import { changeVelocity, nudgeEvent, recordHit, removeEvent, shiftPitch, toggleStep, type PadEvent } from './pattern'
import { rateForBpm, rateToSemitones, SourceMap, type SourceSpeed } from './source'
import { History } from './history'
import { followMarkers } from './markers'
import { frameAt } from './timing'

export type PadSettings = {
  pitch: number
  gain: number
  stretch: boolean
  reverse: boolean
  choke: number
  chokeAuto: boolean
}
export type Label = {
  category: Category
  confidence: number
  manual: boolean
  scores: Partial<Record<Category, number>>
}
type Doc = {
  events: PadEvent[]
  markers: number[]
  padSlices: number[]
  pads: PadSettings[]
  labels: Record<number, Label>
}

export type Sample = { name: string; left: Float32Array; right: Float32Array; mono: Float32Array }

const PADS = 16
const CORRECTIONS_KEY = 'sily.corrections'
const CLASSIFY_DELAY_MS = 150
const MAX_CLASSIFIED = 128
const HAT_CHOKE = 1
const CANDIDATES = 4
const CLAP_MAX_SECONDS = 10
const UPPER_KINDS: Category[] = ['keys', 'vocal', 'melody', 'fx']
const identity = () => Array.from({ length: PADS }, (_, i) => i)
const EXPORT_TAIL_SECONDS = 2
const SILENCE = 1e-4

export class Session {
  sily = $state<Sily | null>(null)
  sample = $state.raw<Sample | null>(null)
  markers = $state<number[]>([])
  pads = $state<PadSettings[]>(
    Array.from({ length: PADS }, () => ({ pitch: 0, gain: 1, stretch: false, reverse: false, choke: 0, chokeAuto: true })),
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
  padSlices = $state<number[]>(identity())
  labels = $state<Record<number, Label>>({})
  correctionCount = $state(readCorrections().length)
  style = $state<Style>('boom_bap')
  density = $state(0.5)
  looseness = $state(0.5)
  candidates = $state<PadEvent[][]>([])
  previewing = $state<number | null>(null)
  refining = $state(false)
  processing = $state(0)
  private beforeGenerate: PadEvent[] | null = null
  private clap = new ClapClient()
  private refineGeneration = 0

  private lastTick = { frame: 0, time: 0 }
  private capture: Capture | null = null
  private map = new SourceMap(1, 1)
  private engineSample: { left: Float32Array; right: Float32Array } | null = null
  private loadedStretch: number | null = null
  private features = new Map<number, number[]>()
  private classifyTimer: ReturnType<typeof setTimeout> | undefined
  private sourceToken = 0
  private loadToken = 0
  private history = new History<Doc>()
  private kitPending = false
  private stretchVersion = 0
  private requested = new Set<string>()
  private inflight = new Set<Promise<unknown>>()
  private stretched = new Map<string, { pad: number; pitch: number; left: Float32Array; right: Float32Array }>()

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
      this.checkpoint('record')
      this.adopt()
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
    const token = ++this.loadToken
    try {
      const { left, right } = await this.sily.decode(file)
      if (token === this.loadToken) this.setSample(file.name, left, right)
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
    this.adopt()
    this.history = new History<Doc>()
    this.markers = []
    this.labels = {}
    this.features.clear()
    this.padSlices = identity()
    this.pads.forEach((p) => (p.stretch = false))
    this.stretched.clear()
    this.requested.clear()
    this.stretchVersion++
    this.sourceToken++
    this.events = []
    this.syncEvents()
    this.message = ''
    this.classifySlices()
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
    this.checkpoint()
    this.setMarkers([...this.markers, frame])
  }

  removeMarkerNear(frame: number, tolerance: number) {
    const nearest = this.markers.reduce<number | null>(
      (best, m) => (Math.abs(m - frame) <= tolerance && (best === null || Math.abs(m - frame) < Math.abs(best - frame)) ? m : best),
      null,
    )
    if (nearest === null) return
    this.checkpoint()
    this.setMarkers(this.markers.filter((m) => m !== nearest))
  }

  moveMarker(from: number, to: number): number {
    if (from === to || this.markers.includes(to)) return from
    this.checkpoint('move-marker')
    this.setMarkers(this.markers.map((m) => (m === from ? to : m)))
    return to
  }

  setMarkers(markers: number[], rebuildKit = false) {
    this.adopt()
    const len = this.sample?.left.length ?? 0
    const before = this.markers
    this.markers = [...new Set(markers.map((m) => Math.max(0, Math.min(len - 1, Math.round(m)))))].sort((a, b) => a - b)
    this.padSlices = followMarkers(before, this.markers, this.padSlices)
    this.kitPending = rebuildKit && this.markers.length > PADS
    this.sendMarkers()
    this.invalidateStretched()
    this.classifySlices()
  }

  labelOf(pad: number): Label | null {
    const start = this.sliceStart(this.padSlices[pad])
    return start === null ? null : (this.labels[start] ?? null)
  }

  setLabel(pad: number, category: Category) {
    const start = this.sliceStart(this.padSlices[pad])
    if (start === null) return
    this.checkpoint()
    this.labels[start] = { category, confidence: 1, manual: true, scores: { [category]: 1 } }
    this.autoChoke()
    const features = this.features.get(start)
    if (features) {
      const corrections = [...readCorrections(), { features, label: category }]
      writeCorrections(corrections)
      this.correctionCount = corrections.length
    }
  }

  exportCorrections() {
    download(new Blob([JSON.stringify(readCorrections())], { type: 'application/json' }), 'sily-corrections.json')
  }

  arrangePads() {
    this.checkpoint()
    const after = arrangePads(this.padSlices, (slice) => {
      const start = this.sliceStart(slice)
      return start === null ? null : (this.labels[start]?.category ?? null)
    })
    this.events = remapEvents(this.events, this.padSlices, after)
    this.applyPadSlices(after)
  }

  buildKit() {
    this.checkpoint()
    this.applyKit()
  }

  private applyKit() {
    const count = Math.min(Math.max(1, this.markers.length), MAX_CLASSIFIED)
    const candidates = Array.from({ length: count }, (_, slice) => {
      const start = this.sliceStart(slice)
      return { slice, scores: (start !== null && this.labels[start]?.scores) || {} }
    })
    const after = buildKit(candidates)
    this.events = dropUnplacedEvents(this.events, this.padSlices, after)
    this.applyPadSlices(after)
  }

  assignSliceAt(frame: number) {
    if (!this.sample) return
    this.checkpoint()
    const slice = Math.max(0, this.markers.findLastIndex((m) => m <= frame))
    const after = [...this.padSlices]
    const other = after.indexOf(slice)
    if (other >= 0) after[other] = after[this.selectedPad]
    after[this.selectedPad] = slice
    this.events = dropUnplacedEvents(this.events, this.padSlices, after)
    this.applyPadSlices(after)
  }

  private applyPadSlices(after: number[]) {
    this.adopt()
    const before = this.padSlices
    const fresh = (): PadSettings => ({ pitch: 0, gain: 1, stretch: false, reverse: false, choke: 0, chokeAuto: true })
    this.pads = after.map((slice) => (before.includes(slice) ? this.pads[before.indexOf(slice)] : fresh()))
    this.selectedPad = Math.max(0, after.indexOf(before[this.selectedPad]))
    this.padSlices = after
    this.autoChoke()
    this.sily?.send({ type: 'padSlices', slices: [...after] })
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.syncEvents()
    this.invalidateStretched()
  }

  clearMarkers() {
    this.checkpoint()
    this.setMarkers([])
  }

  undo() {
    const previous = this.history.undo(this.doc())
    if (previous) this.restore(previous)
  }

  redo() {
    const next = this.history.redo(this.doc())
    if (next) this.restore(next)
  }

  private sendPad(pad: number) {
    const p = this.pads[pad]
    this.sily?.send({ type: 'pad', pad, pitch: p.pitch, gain: p.gain, reverse: p.reverse, choke: p.choke })
  }

  private autoChoke() {
    this.pads.forEach((p, pad) => {
      if (!p.chokeAuto) return
      const category = this.labelOf(pad)?.category
      const choke = category === 'closed_hat' || category === 'open_hat' ? HAT_CHOKE : 0
      if (choke === p.choke) return
      p.choke = choke
      this.sendPad(pad)
    })
  }

  private checkpoint(key?: string) {
    this.history.record(this.doc(), key)
  }

  private doc(): Doc {
    return $state.snapshot({
      events: this.events,
      markers: this.markers,
      padSlices: this.padSlices,
      pads: this.pads,
      labels: this.labels,
    }) as Doc
  }

  private restore(doc: Doc) {
    this.adopt()
    this.events = doc.events
    this.markers = doc.markers
    this.padSlices = doc.padSlices
    this.pads = doc.pads
    this.labels = doc.labels
    this.kitPending = false
    this.sendMarkers()
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.syncEvents()
    this.invalidateStretched()
    this.classifySlices()
  }

  generateCandidates() {
    if (!this.sample) return
    const secondsPerFrame = 1 / this.sampleRate / this.sourceSpeed.rate
    const pads: PadInfo[] = []
    this.padSlices.forEach((_, pad) => {
      const range = this.sliceRange(pad)
      const label = this.labelOf(pad)
      if (!range || !label) return
      pads.push({
        pad,
        category: label.category,
        beats: ((range[1] - range[0]) * secondsPerFrame * this.bpm) / 60,
        scores: label.scores,
      })
    })
    if (!this.beforeGenerate) this.checkpoint()
    this.beforeGenerate ??= this.events
    const base = Math.floor(Math.random() * 1e9)
    this.candidates = Array.from({ length: CANDIDATES }, (_, i) =>
      generate({
        pads,
        existing: this.beforeGenerate!,
        style: this.style,
        density: this.density,
        looseness: this.looseness,
        lengthBeats: this.lengthBeats,
        seed: base + i,
      }),
    )
    this.preview(0)
  }

  preview(index: number) {
    const candidate = this.candidates[index]
    if (!candidate) return
    this.previewing = index
    this.events = candidate
    this.queueEvents()
  }

  adopt() {
    this.candidates = []
    this.previewing = null
    this.beforeGenerate = null
  }

  revert() {
    if (this.beforeGenerate) {
      this.events = this.beforeGenerate
      this.queueEvents()
    }
    this.adopt()
  }

  private queueEvents() {
    this.sily?.send({ type: 'queueEvents', events: this.engineEvents() })
    this.fillStretched()
  }

  private engineEvents() {
    return this.events.map(({ beat, pad, velocity, nudge, pitch }) => ({ beat, pad, velocity, nudge, pitch }))
  }

  private sliceStart(slice: number): number | null {
    if (!this.sample) return null
    if (this.markers.length === 0) return slice === 0 ? 0 : null
    return this.markers[slice] ?? null
  }

  private classifySlices() {
    clearTimeout(this.classifyTimer)
    this.classifyTimer = setTimeout(() => this.classifyNow(), CLASSIFY_DELAY_MS)
  }

  private classifyNow() {
    if (!this.sily || !this.sample) return
    const count = Math.max(1, this.markers.length)
    const labels: Record<number, Label> = {}
    for (let slice = 0; slice < Math.min(count, MAX_CLASSIFIED); slice++) {
      const start = this.sliceStart(slice)!
      const end = this.markers[slice + 1] ?? this.sample.left.length
      const previous = this.labels[start]
      if (previous?.manual) {
        labels[start] = previous
        continue
      }
      const result = this.sily.classify(this.sample.mono.subarray(start, end))
      this.features.set(start, result.features)
      labels[start] = { category: result.category, confidence: result.confidence, manual: false, scores: result.scores }
    }
    this.labels = labels
    if (this.kitPending) {
      this.kitPending = false
      this.applyKit()
    }
    this.autoChoke()
    this.refineUpper()
  }

  private async refineUpper() {
    const sample = this.sample
    if (!sample) return
    const generation = ++this.refineGeneration
    const markers = [...this.markers]
    const targets = Object.entries(this.labels)
      .filter(([, l]) => !l.manual && l.category === 'upper')
      .map(([start]) => {
        const from = Number(start)
        const next = markers[markers.indexOf(from) + 1] ?? sample.left.length
        return { start: from, end: Math.min(next, from + CLAP_MAX_SECONDS * this.sampleRate) }
      })
      .filter(({ start, end }) => end > start)
    this.refining = targets.length > 0
    if (targets.length === 0) return
    try {
      for (const { start, end } of targets) {
        const result = await this.clap.classify(sample.mono.slice(start, end), this.sampleRate, UPPER_KINDS)
        if (generation !== this.refineGeneration) return
        const current = this.labels[start]
        if (current && !current.manual) this.labels[start] = { ...current, ...result }
      }
    } catch (error) {
      console.error(error)
      this.message = 'うわもの判定のモデルを読み込めなかった'
    } finally {
      if (generation === this.refineGeneration) this.refining = false
    }
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
    this.checkpoint()
    this.setMarkers(this.sily.onsets(this.sample.mono, this.sensitivity).slice(0, MAX_CLASSIFIED), true)
  }

  gridSlice(count: number) {
    if (!this.sample) return
    this.checkpoint()
    const start = this.markers[0] ?? 0
    const end = this.sample.left.length
    this.setMarkers(
      Array.from({ length: count }, (_, i) => start + ((end - start) * i) / count),
      true,
    )
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
    const slice = this.padSlices[pad]
    const len = this.sample.left.length
    if (this.markers.length === 0) return slice === 0 ? [0, len] : null
    if (slice >= this.markers.length) return null
    return [this.markers[slice], this.markers[slice + 1] ?? len]
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
    this.checkpoint(`pad:${pad}:${Object.keys(patch).join()}`)
    Object.assign(this.pads[pad], patch)
    this.sendPad(pad)
    if ('chokeAuto' in patch) this.autoChoke()
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
    this.checkpoint()
    this.adopt()
    this.events = toggleStep(this.events, pad, beat, this.grid / 2)
    this.syncEvents()
  }

  nudge(id: string, delta: number) {
    this.checkpoint(`nudge:${id}`)
    this.adopt()
    this.events = nudgeEvent(this.events, id, delta)
    this.syncEvents()
  }

  shiftPitch(id: string, delta: number) {
    this.checkpoint(`pitch:${id}`)
    this.adopt()
    this.events = shiftPitch(this.events, id, delta)
    this.syncEvents()
  }

  changeVelocity(id: string, delta: number) {
    this.checkpoint(`velocity:${id}`)
    this.adopt()
    this.events = changeVelocity(this.events, id, delta)
    this.syncEvents()
  }

  remove(id: string) {
    this.checkpoint()
    this.adopt()
    this.events = removeEvent(this.events, id)
    this.syncEvents()
  }

  clearPattern() {
    this.checkpoint()
    this.adopt()
    this.events = []
    this.syncEvents()
  }

  async exportWav(loops: number) {
    if (!this.sily || !this.sample) return
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight])
    const loopSeconds = (this.lengthBeats * 60) / this.bpm
    const { left, right } = await this.sily.renderOffline(this.snapshot(loops), loops * loopSeconds + EXPORT_TAIL_SECONDS)
    const frames = soundingLength([left, right], Math.round(loops * loopSeconds * this.sampleRate), SILENCE)
    const wav = encodeWav24(left.subarray(0, frames), right.subarray(0, frames), this.sampleRate)
    download(new Blob([wav], { type: 'audio/wav' }), `${this.sample.name.replace(/\.[^.]+$/, '')}-${this.bpm}bpm-${loops}x.wav`)
  }

  private snapshot(loops: number): ToWorklet[] {
    const { left, right } = this.engineSample!
    return [
      { type: 'load', left, right },
      { type: 'sourceRate', rate: this.sourceSpeed.mode === 'tape' ? this.sourceSpeed.rate : 1 },
      { type: 'markers', frames: this.markers.map((m) => this.map.toEngine(m)) },
      { type: 'padSlices', slices: [...this.padSlices] },
      ...this.pads.map((p, pad): ToWorklet => ({ type: 'pad', pad, pitch: p.pitch, gain: p.gain, reverse: p.reverse, choke: p.choke })),
      ...[...this.stretched.values()].map((b): ToWorklet => ({ type: 'stretched', ...b })),
      { type: 'groove', grid: this.grid, strength: this.strength, swing: this.swing },
      { type: 'events', events: this.events.map(({ beat, pad, velocity, nudge, pitch }) => ({ beat, pad, velocity, nudge, pitch })) },
      { type: 'playLimit', beats: loops * this.lengthBeats },
      { type: 'transport', bpm: this.bpm, playing: true, metronome: false, lengthBeats: this.lengthBeats },
    ]
  }

  private async applySource() {
    if (!this.sily || !this.sample) return
    const { mode, rate } = this.sourceSpeed
    const stretch = mode === 'stretch' && rate !== 1 ? rate : null
    const token = ++this.sourceToken
    if (stretch !== this.loadedStretch) {
      const sample = this.sample
      const out = stretch ? await this.track(this.sily.stretch(sample.left, sample.right, 1 / stretch)) : sample
      if (token !== this.sourceToken || sample !== this.sample) return
      this.stopAudition()
      this.loadEngineSample(out.left, out.right, stretch)
      this.sendMarkers()
    }
    this.sily.send({ type: 'sourceRate', rate: mode === 'tape' ? rate : 1 })
    this.invalidateStretched()
  }

  private track<T>(job: Promise<T>): Promise<T> {
    this.inflight.add(job)
    this.processing = this.inflight.size
    return job.finally(() => {
      this.inflight.delete(job)
      this.processing = this.inflight.size
    })
  }

  private loadEngineSample(left: Float32Array, right: Float32Array, stretch: number | null) {
    this.engineSample = { left, right }
    this.loadedStretch = stretch
    this.map = new SourceMap(this.sample?.left.length ?? left.length, left.length)
    this.sily?.send({ type: 'load', left: left.slice(), right: right.slice() })
  }

  private sendMarkers() {
    this.sily?.send({ type: 'markers', frames: this.markers.map((m) => this.map.toEngine(m)) })
    this.sily?.send({ type: 'padSlices', slices: [...this.padSlices] })
  }

  private invalidateStretched(only?: number[]) {
    this.stretchVersion++
    for (const pad of only ?? this.pads.keys()) {
      this.sily?.send({ type: 'clearStretched', pad })
      for (const key of [...this.stretched.keys()]) if (key.startsWith(`${pad}:`)) this.stretched.delete(key)
    }
    this.requested.clear()
    this.fillStretched()
  }

  private fillStretched() {
    if (!this.sily || !this.engineSample) return
    const sily = this.sily
    const source = this.engineSample
    const version = this.stretchVersion
    const tapeSemitones = this.sourceSpeed.mode === 'tape' ? rateToSemitones(this.sourceSpeed.rate) : 0
    this.pads.forEach((p, pad) => {
      const range = this.sliceRange(pad)
      if (!p.stretch || !range) return
      const pitches = new Set([p.pitch, ...this.events.filter((e) => e.pad === pad).map((e) => p.pitch + e.pitch)])
      const [s, e] = range.map((f) => this.map.toEngine(f))
      const reverse = p.reverse
      for (const pitch of pitches) {
        const key = `${pad}:${Math.round(pitch * 100)}`
        if (this.stretched.has(key) || this.requested.has(key)) continue
        this.requested.add(key)
        this.track(sily.pitchShift(source.left.subarray(s, e), source.right.subarray(s, e), pitch + tapeSemitones))
          .then((shifted) => {
            if (version !== this.stretchVersion) return
            if (reverse) {
              shifted.left.reverse()
              shifted.right.reverse()
            }
            this.stretched.set(key, { pad, pitch, left: shifted.left, right: shifted.right })
            sily.send({ type: 'stretched', pad, pitch, left: shifted.left.slice(), right: shifted.right.slice() })
          })
          .catch(() => (this.message = '長さを保つ処理に失敗した'))
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
      events: this.engineEvents(),
    })
    this.fillStretched()
  }
}

type Correction = { features: number[]; label: Category }

function readCorrections(): Correction[] {
  try {
    return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) ?? '[]')
  } catch {
    return []
  }
}

function writeCorrections(corrections: Correction[]) {
  try {
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(corrections))
  } catch {
    return
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
