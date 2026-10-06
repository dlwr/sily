import { mixdown, Sily, type Capture } from '../audio/client'
import { isSilent } from '../audio/level'
import type { ToWorklet } from '../audio/messages'
import { arrangePads, remapEvents, roleOf, type Category } from '../classify/categories'
import { buildKit, dropUnplacedEvents, UPPER_PADS, type KitCandidate } from '../classify/kit'
import { beatGrid, phraseRanges, pickPhrases, type PhraseCandidate } from '../classify/phrases'
import { sliceQuality } from '../classify/quality'
import { ClapClient, type ModelDownload } from '../classify/clapClient'
import { resample } from '../classify/clap'
import { probeScores, type Probe } from '../classify/probe'
import probe from '../classify/probe.json'
import { DEFAULT_FX, isFlat, type FxSettings } from '../fx/fx'
import { newId } from '../storage/db'
import { pack, unpack, withFreshSampleIds, type Bundle } from '../storage/bundle'
import { deleteSample, importSample, listSamples, loadSample, saveSample, type SampleMeta } from '../storage/library'
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  saveSource,
  type ProjectDoc,
  type SourceAudio,
} from '../storage/projects'
import { untrack } from 'svelte'
import { candidateStyles, generate, type PadInfo, type Style, type StyleChoice } from '../generate/generate'
import { autoFx, autoPitch, estimateKey, type Key } from '../shape/shape'
import { encodeWav24, soundingLength } from '../export/wav'
import { uploadCorrection } from '../corrections/upload'
import { sha256Hex } from '../corrections/hash'
import { chooseSplit, splitFor, type Split } from '../corrections/split'
import { changeVelocity, nudgeEvent, padsPlayedBetween, recordHit, removeEvent, shiftPitch, toggleStep, type PadEvent } from './pattern'
import { rateForBpm, rateToSemitones, SourceMap, type SourceSpeed } from './source'
import { History } from './history'
import { copyPattern, flattenSong, sectionAt, type Pattern } from './song'
import { followMarkers, minSliceSeconds } from './markers'
import { frameAt } from './timing'
import { uploadShare } from '../share/api'
import { MAX_SHARE_BYTES, MAX_SOURCE_SECONDS } from '../share/limits'
import { trimSource } from '../share/trim'

export type PadSettings = {
  pitch: number
  gain: number
  stretch: boolean
  reverse: boolean
  choke: number
  chokeAuto: boolean
  fx: FxSettings
  sample: { id: string; name: string; category: Category } | null
  pitchAuto: boolean
  fxAuto: boolean
}
export type Label = {
  category: Category
  confidence: number
  manual: boolean
  scores: Partial<Record<Category, number>>
}
type Heard = { events: PadEvent[]; length: number }
type Span = [number, number] | null

type Doc = {
  events: PadEvent[]
  patterns: Pattern[]
  currentPattern: string
  song: string[]
  markers: number[]
  padSlices: number[]
  padSpans: Span[]
  pads: PadSettings[]
  labels: Record<number, Label>
}

export type Sample = { name: string; left: Float32Array; right: Float32Array; mono: Float32Array }

const PADS = 16
const LAST_PROJECT_KEY = 'sily.project'
const SAVE_DELAY_MS = 800
const freshPad = (): PadSettings => ({
  pitch: 0,
  gain: 1,
  stretch: false,
  reverse: false,
  choke: 0,
  chokeAuto: true,
  fx: { ...DEFAULT_FX },
  sample: null,
  pitchAuto: true,
  fxAuto: true,
})
const CORRECTIONS_KEY = 'sily.corrections'
const CORRECTIONS_REFUSED_KEY = 'sily.corrections.refused'
const CLASSIFY_DELAY_MS = 150
const MAX_CLASSIFIED = 128
const PITCHEDNESS = 11
const PITCH_HZ = 108
const HAT_CHOKE = 1
const CANDIDATES = 4
const MAX_PHRASE_CANDIDATES = 32
const identity = () => Array.from({ length: PADS }, (_, i) => i)
const noSpans = (): Span[] => Array(PADS).fill(null)
const EXPORT_TAIL_SECONDS = 2
const SILENCE = 1e-4

export class Session {
  sily = $state<Sily | null>(null)
  sample = $state.raw<Sample | null>(null)
  markers = $state<number[]>([])
  pads = $state<PadSettings[]>(
    Array.from({ length: PADS }, () => ({ pitch: 0, gain: 1, stretch: false, reverse: false, choke: 0, chokeAuto: true, fx: { ...DEFAULT_FX }, sample: null, pitchAuto: true, fxAuto: true })),
  )
  selectedPad = $state(0)
  labelingSlice = $state<number | null>(null)
  patterns = $state<Pattern[]>([])
  currentPattern = $state('A')
  song = $state<string[]>([])
  songMode = $state(false)
  muted = $state<boolean[]>(Array(PADS).fill(false))
  soloed = $state<boolean[]>(Array(PADS).fill(false))
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
  heldOut = $state(false)
  splitByHash = $state<Split | null>(null)
  padSlices = $state<number[]>(identity())
  padSpans = $state<Span[]>(noSpans())
  labels = $state<Record<number, Label>>({})
  correctionCount = $state(readCorrections().length)
  correctionLogin = $state(false)
  correctionsRefused = $state(readRefused())
  correctionsSent = $state(0)
  correctionsUnsent = $state(0)
  style = $state<StyleChoice>('auto')
  density = $state(0.5)
  looseness = $state(0.5)
  candidates = $state<{ style: Style; events: PadEvent[] }[]>([])
  previewing = $state<number | null>(null)
  refining = $state(false)
  refined = $state(0)
  refineTotal = $state(0)
  modelDownload = $state<ModelDownload | null>(null)
  processing = $state(0)
  masterFx = $state<FxSettings>({ ...DEFAULT_FX })
  library = $state<SampleMeta[]>([])
  key = $state<Key>({ root: 0, minor: true })
  keyAuto = $state(true)
  autoShape = $state(true)
  projectId = $state<string | null>(null)
  projectName = $state('無題')
  projects = $state<ProjectDoc[]>([])
  shared = $state<{ id: string; name: string } | null>(null)
  sharing = $state(false)
  shareLogin = $state(false)
  private sharedBundle: Bundle | null = null
  private sharedSamples = new Map<string, { meta: SampleMeta; left: Float32Array; right: Float32Array }>()
  private sourceId: string | null = null
  private lastSaved = ''
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private pendingSave: string | null = null
  private beforeGenerate: PadEvent[] | null = null
  private clap = new ClapClient((download) => (this.modelDownload = download))
  private refineGeneration = 0
  private phraseToken = 0

  private lastTick = { frame: 0, time: 0 }
  private capture: Capture | null = null
  private map = new SourceMap(1, 1)
  private engineSample: { left: Float32Array; right: Float32Array } | null = null
  private loadedStretch: number | null = null
  private features = new Map<number, number[]>()
  private embeddings = new Map<string, number[]>()
  private unsentCorrections: { wav: ArrayBuffer; label: Category; split: Promise<Split> }[] = []
  private splits = new WeakMap<Sample, Promise<Split>>()
  private sent = new WeakMap<Sample, { wav: ArrayBuffer; label: Category }[]>()
  private sendingCorrections = false
  private tickBeat: number | null = null
  private heard: Heard | null = null
  private switchPending = false
  private labelingTimer: ReturnType<typeof setTimeout> | undefined
  private classifyTimer: ReturnType<typeof setTimeout> | undefined
  private sourceToken = 0
  private loadToken = 0
  private history = new History<Doc>()
  private kitPending = false
  private playWhenBuilt = false
  private stretchVersion = 0
  private requested = new Set<string>()
  private inflight = new Set<Promise<unknown>>()
  private own = new Map<number, { id: string; left: Float32Array; right: Float32Array }>()
  private stretched = new Map<string, { pad: number; pitch: number; left: Float32Array; right: Float32Array }>()

  get patternBeats() {
    return this.bars * 4
  }

  get lengthBeats() {
    return this.songMode ? flattenSong(this.allPatterns(), this.song).lengthBeats : this.patternBeats
  }

  allPatterns(): Pattern[] {
    const current = { name: this.currentPattern, bars: this.bars, events: this.events }
    return [...this.patterns.filter((p) => p.name !== current.name), current].sort((a, b) => a.name.localeCompare(b.name))
  }

  songPosition(): { index: number; beat: number } {
    return this.songMode ? sectionAt(this.allPatterns(), this.song, this.beat) : { index: -1, beat: this.beat }
  }

  selectPattern(name: string) {
    if (name === this.currentPattern) return
    this.checkpoint()
    this.adopt()
    const before = this.heardNow()
    this.patterns = this.allPatterns()
    const next = this.patterns.find((p) => p.name === name) ?? { name, bars: this.bars, events: [] }
    this.currentPattern = name
    this.events = next.events
    this.bars = next.bars
    if (this.songMode) return
    if (this.playing) {
      this.queueEvents(before, this.lengthBeats)
    } else {
      this.syncTransport()
      this.syncEvents()
    }
  }

  copyPatternTo(name: string) {
    if (name === this.currentPattern) return
    const copy = copyPattern({ name: this.currentPattern, bars: this.bars, events: this.events }, name)
    this.patterns = [...this.allPatterns().filter((p) => p.name !== name), copy]
    this.selectPattern(name)
  }

  hasPattern(name: string) {
    return this.allPatterns().some((p) => p.name === name && (p.events.length > 0 || p.name === this.currentPattern))
  }

  addToSong(name: string) {
    this.checkpoint()
    this.song = [...this.song, name]
    if (this.songMode) this.syncSong()
  }

  removeFromSong(index: number) {
    this.checkpoint()
    this.song = this.song.filter((_, i) => i !== index)
    if (this.song.length === 0) this.setSongMode(false)
    else if (this.songMode) this.syncSong()
  }

  setSongMode(on: boolean) {
    if (on && this.song.length === 0) return
    this.adopt()
    this.playing = false
    this.recording = false
    this.songMode = on
    this.syncSong()
  }

  toggleMute(pad: number) {
    this.muted[pad] = !this.muted[pad]
    this.syncEvents()
  }

  toggleSolo(pad: number) {
    this.soloed[pad] = !this.soloed[pad]
    this.syncEvents()
  }

  audible(pad: number) {
    return this.soloed.some(Boolean) ? this.soloed[pad] : !this.muted[pad]
  }

  private syncSong() {
    this.syncTransport()
    this.syncEvents()
  }

  private flashPlayed(from: number, to: number) {
    const now = performance.now()
    const flash = ({ events, length }: Heard, a: number, b: number) => {
      for (const pad of padsPlayedBetween(events, a, b, length)) this.hits[pad] = now
    }
    if (this.switchPending && to < from) {
      flash(this.heard ?? this.heardNow(), from, this.heard?.length ?? this.lengthBeats)
      this.heard = null
      this.switchPending = false
      flash(this.heardNow(), -1e-9, to)
    } else {
      flash(this.heard ?? this.heardNow(), from, to)
    }
  }

  private playbackEvents(): PadEvent[] {
    const events = this.songMode ? flattenSong(this.allPatterns(), this.song).events : this.events
    return events.filter((e) => this.audible(e.pad))
  }

  get sampleRate() {
    return this.sily?.sampleRate ?? 44100
  }

  async start(shared?: { id: string; bytes: Uint8Array }) {
    if (this.sily) return
    const sily = await Sily.create()
    sily.onTick = (t) => {
      if (this.playing) this.flashPlayed(this.tickBeat ?? -1e-9, t.beat)
      this.tickBeat = this.playing ? t.beat : null
      this.beat = t.beat
      this.auditionFrame = t.auditionFrame === null ? null : this.map.fromEngine(t.auditionFrame)
      if (t.auditionFrame !== null) this.lastTick = { frame: t.auditionFrame, time: t.time }
    }
    sily.onRecorded = (r) => {
      if (this.songMode) return
      this.checkpoint('record')
      this.adopt()
      this.events = recordHit(this.events, r.pad, r.beat, r.velocity, r.pitch)
      this.syncEvents()
    }
    sily.onFailure = () => (this.message = 'オーディオ処理が停止した。ページを再読み込みしてほしい')
    this.sily = sily
    this.refreshLibrary()
    this.syncTransport()
    this.syncGroove()
    await this.refreshProjects()
    const last = readLastProject()
    if (shared) await this.openShared(shared.id, shared.bytes)
    else if (last && this.projects.some((p) => p.id === last)) await this.openProject(last)
    else await this.newProject()
    $effect.root(() => {
      $effect(() => {
        const json = JSON.stringify(this.projectState())
        untrack(() => this.scheduleSave(json))
      })
    })
  }

  private projectState() {
    return $state.snapshot({
      name: this.projectName,
      markers: this.markers,
      padSlices: this.padSlices,
      padSpans: this.padSpans,
      pads: this.pads,
      events: this.events,
      patterns: this.allPatterns(),
      currentPattern: this.currentPattern,
      song: this.song,
      muted: this.muted,
      soloed: this.soloed,
      labels: this.labels,
      bpm: this.bpm,
      bars: this.bars,
      metronome: this.metronome,
      grid: this.grid,
      strength: this.strength,
      swing: this.swing,
      style: this.style,
      density: this.density,
      looseness: this.looseness,
      sourceSpeed: this.sourceSpeed,
      sourceBpm: this.sourceBpm,
      heldOut: this.heldOut,
      masterFx: this.masterFx,
      key: this.key,
      keyAuto: this.keyAuto,
      autoShape: this.autoShape,
    })
  }

  private scheduleSave(json: string) {
    if (!this.projectId || json === this.lastSaved) return
    if (!this.sample && !this.pads.some((p) => p.sample)) return
    this.pendingSave = json
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS)
  }

  private async flushSave() {
    clearTimeout(this.saveTimer)
    const json = this.pendingSave
    const id = this.projectId
    this.pendingSave = null
    if (!json || !id) return
    try {
      if (this.sample && !this.sourceId) {
        await navigator.storage?.persist?.()
        this.sourceId = await saveSource(this.sample.left, this.sample.right, this.sampleRate)
      }
      await saveProject({
        id,
        name: this.projectName,
        version: 1,
        updatedAt: 0,
        sourceId: this.sourceId,
        sourceName: this.sample?.name ?? null,
        state: JSON.parse(json),
      })
      this.lastSaved = json
      await this.refreshProjects()
    } catch {
      this.message = 'プロジェクトを保存できなかった'
    }
  }

  async refreshProjects() {
    try {
      this.projects = await listProjects()
    } catch {
      this.projects = []
    }
  }

  async newProject() {
    await this.flushSave()
    this.leaveShared()
    this.projectId = newId()
    this.projectName = `無題 ${new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    writeLastProject(this.projectId)
    this.clearSource()
    this.pads = Array.from({ length: PADS }, freshPad)
    this.events = []
    this.resetSong()
    this.masterFx = { ...DEFAULT_FX }
    this.syncOwn()
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.sily?.send({ type: 'fx', pad: null, fx: $state.snapshot(this.masterFx) })
    this.syncEvents()
    this.lastSaved = ''
  }

  async openProject(id: string) {
    if (!this.sily) return
    await this.flushSave()
    const loaded = await loadProject(id)
    if (!loaded) return
    const { doc, source } = loaded
    this.leaveShared()
    this.projectId = id
    writeLastProject(id)
    this.applyProject(doc.name, doc.state, source, doc.sourceName, doc.sourceId)
  }

  async openShared(id: string, bytes: Uint8Array) {
    if (!this.sily) return
    let bundle: Bundle
    try {
      bundle = unpack(bytes)
    } catch {
      this.message = '共有されたプロジェクトを読み込めなかった'
      return
    }
    await this.flushSave()
    this.projectId = null
    this.sharedBundle = bundle
    this.shared = { id, name: bundle.project.name }
    this.sharedSamples = new Map(bundle.samples.map((s) => [s.meta.id, s]))
    this.applyProject(bundle.project.name, bundle.project.state, bundle.source, bundle.source?.name ?? null, null)
    if (this.events.length > 0 || this.song.length > 0) this.togglePlaying()
  }

  async saveShared() {
    const bundle = this.sharedBundle
    if (!bundle) return
    if (this.playing) this.togglePlaying()
    await this.importBundle(withFreshSampleIds(bundle, newId))
  }

  private leaveShared() {
    if (!this.shared) return
    this.shared = null
    this.sharedBundle = null
    this.sharedSamples.clear()
    history.replaceState(null, '', '/')
  }

  private applyProject(name: string, state: Record<string, unknown>, source: SourceAudio | null, sourceName: string | null, sourceId: string | null) {
    if (!this.sily) return
    const st = state as ReturnType<Session['projectState']>
    this.projectName = name
    if (source) {
      const left = resample(source.left, source.sampleRate, this.sampleRate)
      const right = resample(source.right, source.sampleRate, this.sampleRate)
      this.setSample(sourceName ?? 'source', left, right)
      this.sourceId = source.sampleRate === this.sampleRate ? sourceId : null
    } else {
      this.clearSource()
    }
    this.markers = st.markers ?? []
    this.labels = st.labels ?? {}
    this.padSlices = st.padSlices ?? identity()
    this.padSpans = st.padSpans ?? noSpans()
    this.pads = (st.pads ?? []).map((p: Partial<PadSettings>) => ({
      ...freshPad(),
      ...p,
      pitchAuto: p.pitchAuto ?? p.pitch === 0,
      fxAuto: p.fxAuto ?? isFlat({ ...DEFAULT_FX, ...p.fx }),
    }))
    while (this.pads.length < PADS) this.pads.push(freshPad())
    this.events = st.events ?? []
    this.bpm = st.bpm ?? this.bpm
    this.bars = st.bars ?? this.bars
    this.resetSong()
    this.patterns = st.patterns ?? []
    this.currentPattern = st.currentPattern ?? 'A'
    this.song = st.song ?? []
    this.muted = st.muted ?? Array(PADS).fill(false)
    this.soloed = st.soloed ?? Array(PADS).fill(false)
    this.metronome = st.metronome ?? this.metronome
    this.grid = st.grid ?? this.grid
    this.strength = st.strength ?? this.strength
    this.swing = st.swing ?? this.swing
    this.style = st.style ?? this.style
    this.density = st.density ?? this.density
    this.looseness = st.looseness ?? this.looseness
    this.sourceSpeed = st.sourceSpeed ?? { mode: 'tape', rate: 1 }
    this.sourceBpm = st.sourceBpm ?? null
    this.heldOut = st.heldOut ?? false
    this.masterFx = { ...DEFAULT_FX, ...st.masterFx }
    this.key = st.key ?? this.key
    this.keyAuto = st.keyAuto ?? true
    this.autoShape = st.autoShape ?? true
    this.history = new History<Doc>()
    this.syncOwn()
    this.sendMarkers()
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.sily.send({ type: 'fx', pad: null, fx: $state.snapshot(this.masterFx) })
    this.syncEvents()
    this.syncTransport()
    this.syncGroove()
    this.applySource()
    this.classifySlices()
    this.lastSaved = JSON.stringify(this.projectState())
  }

  private async bundle(): Promise<Bundle> {
    await this.flushSave()
    const ids = [...new Set(this.pads.flatMap((p) => (p.sample ? [p.sample.id] : [])))]
    const samples = (await Promise.all(ids.map((id) => this.sharedSamples.get(id) ?? loadSample(id)))).flatMap((s) => (s ? [s] : []))
    return {
      project: { name: this.projectName, state: JSON.parse(JSON.stringify(this.projectState())) },
      source: this.sample && {
        name: this.sample.name,
        sampleRate: this.sampleRate,
        left: this.sample.left,
        right: this.sample.right,
      },
      samples,
    }
  }

  async exportProject() {
    const bytes = pack(await this.bundle())
    download(new Blob([bytes.slice()], { type: 'application/zip' }), `${this.projectName}.sily`)
  }

  private async shareBundle(): Promise<Bundle> {
    const bundle = await this.bundle()
    const source = bundle.source
    if (!source) return bundle
    const st = bundle.project.state as ReturnType<Session['projectState']>
    const trim = trimSource({
      frames: source.left.length,
      maxFrames: Math.floor(MAX_SOURCE_SECONDS * source.sampleRate),
      markers: st.markers,
      padSlices: st.padSlices,
      padSpans: st.padSpans,
      labels: st.labels,
      ownPads: st.pads.map((p) => !!p.sample),
    })
    const detached = trim.detached.map(({ pad, range }) => {
      const audio = this.detachedAudio(range)
      const category = this.labelOf(pad)?.category ?? 'perc'
      const meta: SampleMeta = {
        id: newId(),
        name: `${source.name} ${pad + 1}`,
        category,
        sampleRate: this.sampleRate,
        frames: audio.left.length,
        createdAt: Date.now(),
        settings: {},
      }
      return { pad, sample: { meta, ...audio } }
    })
    const pads = st.pads.map((p, pad) => {
      const d = detached.find((x) => x.pad === pad)
      return d ? { ...p, sample: { id: d.sample.meta.id, name: d.sample.meta.name, category: d.sample.meta.category as Category } } : p
    })
    return {
      project: {
        name: bundle.project.name,
        state: { ...st, markers: trim.markers, padSlices: trim.padSlices, padSpans: trim.padSpans, labels: trim.labels, pads },
      },
      source: { ...source, left: source.left.slice(trim.start, trim.end), right: source.right.slice(trim.start, trim.end) },
      samples: [...bundle.samples, ...detached.map((d) => d.sample)],
    }
  }

  private detachedAudio([start, end]: [number, number]): { left: Float32Array; right: Float32Array } {
    const engine = this.engineSample ?? this.sample!
    const [a, b] = [this.map.toEngine(start), this.map.toEngine(end)]
    const rate = this.sourceSpeed.mode === 'tape' ? this.sourceSpeed.rate : 1
    return {
      left: resample(engine.left.subarray(a, b), this.sampleRate * rate, this.sampleRate),
      right: resample(engine.right.subarray(a, b), this.sampleRate * rate, this.sampleRate),
    }
  }

  async shareProject() {
    if (this.sharing) return
    this.sharing = true
    try {
      const bytes = pack(await this.shareBundle())
      if (bytes.byteLength > MAX_SHARE_BYTES) {
        this.message = `共有するには大きすぎる（${(bytes.byteLength / 1e6).toFixed(0)} MB。上限は ${MAX_SHARE_BYTES / 1024 / 1024} MB）`
        return
      }
      const result = await uploadShare(bytes)
      this.shareLogin = result === 'login'
      if (typeof result === 'object') {
        const url = new URL(result.url, location.origin).href
        const copied = await navigator.clipboard?.writeText(url).then(
          () => true,
          () => false,
        )
        this.message = copied ? `共有リンクをコピーした: ${url}` : `共有リンク: ${url}`
        return
      }
      this.message = {
        login: '共有するにはログインが要る',
        daily: '共有は1日3つまで',
        total: '共有は20個まで。「共有したもの」から消すと増やせる',
        large: '共有するには大きすぎる',
        failed: '共有できなかった',
      }[result]
    } finally {
      this.sharing = false
    }
  }

  async importProject(file: File) {
    try {
      await this.importBundle(withFreshSampleIds(unpack(new Uint8Array(await file.arrayBuffer())), newId))
    } catch {
      this.message = `${file.name} をプロジェクトとして読み込めなかった`
    }
  }

  private async importBundle(bundle: Bundle) {
    try {
      for (const sample of bundle.samples) await importSample(sample)
      const source = bundle.source
      const sourceId = source ? await saveSource(source.left, source.right, source.sampleRate) : null
      const id = newId()
      await saveProject({
        id,
        name: bundle.project.name,
        version: 1,
        updatedAt: 0,
        sourceId,
        sourceName: source?.name ?? null,
        state: bundle.project.state,
      })
      await this.refreshProjects()
      await this.refreshLibrary()
      await this.openProject(id)
    } catch {
      this.message = `「${bundle.project.name}」を保存できなかった`
    }
  }

  async removeProject(id: string) {
    await deleteProject(id)
    if (id === this.projectId) {
      this.projectId = null
      await this.newProject()
    }
    await this.refreshProjects()
  }

  private clearSource() {
    this.sample = null
    this.sourceId = null
    this.engineSample = null
    this.loadedStretch = null
    this.markers = []
    this.labels = {}
    this.padSlices = identity()
    this.padSpans = noSpans()
    this.stopAudition()
    this.sily?.send({ type: 'load', left: new Float32Array(0), right: new Float32Array(0) })
    this.history = new History<Doc>()
  }

  async loadFile(file: File) {
    if (!this.sily) return
    if (file.name.endsWith('.sily')) return this.importProject(file)
    const token = ++this.loadToken
    try {
      const { left, right } = await this.sily.decode(file)
      if (token !== this.loadToken) return
      this.setSample(file.name, left, right)
      this.buildFromSource()
    } catch {
      this.message = `${file.name} を読み込めなかった`
    }
  }

  setSample(name: string, left: Float32Array, right: Float32Array) {
    if (!this.sily) return
    this.sample = { name, left, right, mono: mixdown(left, right) }
    this.sourceId = null
    if (this.keyAuto) this.key = estimateKey(this.sily.chroma(this.sample.mono))
    this.sourceSpeed = { mode: 'tape', rate: 1 }
    this.sourceBpm = null
    this.heldOut = false
    this.splitByHash = null
    this.kitPending = false
    this.playWhenBuilt = false
    this.loadEngineSample(left, right, null)
    this.sily.send({ type: 'sourceRate', rate: 1 })
    this.adopt()
    this.history = new History<Doc>()
    this.markers = []
    this.labels = {}
    this.features.clear()
    this.embeddings.clear()
    this.padSlices = identity()
    this.padSpans = noSpans()
    this.pads.forEach((p) => {
      if (!p.sample) p.stretch = false
    })
    this.stretched.clear()
    this.requested.clear()
    this.stretchVersion++
    this.sourceToken++
    this.events = this.events.filter((e) => this.pads[e.pad]?.sample)
    this.fillStretched()
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
    const display = this.capturing === 'display'
    this.capture = null
    this.capturing = null
    if (left.length > 0 && isSilent([left, right])) {
      this.message = display
        ? '録れた音が無音だった。音を出しているアプリやタブが共有の対象に入っているか確かめてほしい（Chrome のタブで流しているなら、そのタブを選んで「タブの音声も共有」をオンにする）'
        : '録れた音が無音だった。入力デバイスに音が来ているか確かめてほしい'
      return
    }
    if (left.length > 0) {
      this.setSample(`capture-${new Date().toLocaleTimeString()}`, left, right)
      this.buildFromSource()
    }
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
    const own = this.pads[pad]?.sample
    if (own) return { category: own.category, confidence: 1, manual: true, scores: { [own.category]: 1 } }
    if (this.padSpans[pad]) return { category: 'upper', confidence: 1, manual: false, scores: { upper: 1 } }
    const start = this.sliceStart(this.padSlices[pad])
    return start === null ? null : (this.labels[start] ?? null)
  }

  setLabel(pad: number, category: Category) {
    if (this.padSpans[pad]) return
    this.labelSlice(this.padSlices[pad], category)
  }

  get sliceCount() {
    return this.sample ? Math.max(1, this.markers.length) : 0
  }

  sliceLabel(slice: number): Label | null {
    const start = this.sliceStart(slice)
    return start === null ? null : (this.labels[start] ?? null)
  }

  startLabeling() {
    if (this.sliceCount === 0 || !this.sample) return
    const sample = this.sample
    void this.splitOf(sample).then((split) => {
      if (this.sample === sample) this.splitByHash = split
    })
    this.showLabelingSlice(0)
  }

  stopLabeling() {
    clearTimeout(this.labelingTimer)
    this.stopAudition()
    this.labelingSlice = null
  }

  showLabelingSlice(slice: number) {
    if (slice < 0 || slice >= this.sliceCount) return
    this.labelingSlice = slice
    this.playSlice(slice)
  }

  mergeLabelingSlice() {
    const slice = this.labelingSlice
    if (slice === null || slice === 0 || slice >= this.markers.length) return
    this.checkpoint()
    this.setMarkers(this.markers.filter((_, i) => i !== slice))
    this.showLabelingSlice(slice - 1)
  }

  labelAndNext(category: Category) {
    if (this.labelingSlice === null) return
    const slice = this.labelingSlice
    this.labelSlice(slice, category)
    if (slice + 1 < this.sliceCount) this.showLabelingSlice(slice + 1)
    else this.stopLabeling()
  }

  labelingRange(): [number, number] | null {
    const start = this.labelingSlice === null ? null : this.sliceStart(this.labelingSlice)
    if (start === null || !this.sample) return null
    return [start, this.markers[this.labelingSlice! + 1] ?? this.sample.left.length]
  }

  playSlice(slice: number) {
    const start = this.sliceStart(slice)
    if (start === null || !this.sample) return
    const end = this.markers[slice + 1] ?? this.sample.left.length
    const rate = this.sourceSpeed.mode === 'tape' ? this.sourceSpeed.rate : 1
    clearTimeout(this.labelingTimer)
    this.auditionFrom(start)
    this.labelingTimer = setTimeout(() => this.stopAudition(), Math.min(4000, ((end - start) / this.sampleRate / rate) * 1000))
  }

  labelSlice(slice: number, category: Category) {
    const start = this.sliceStart(slice)
    if (start === null) return
    this.checkpoint()
    this.labels[start] = { category, confidence: 1, manual: true, scores: { [category]: 1 } }
    this.autoChoke()
    this.shapePads()
    const features = this.features.get(start)
    if (features) {
      const corrections = [...readCorrections(), { features, label: category }]
      writeCorrections(corrections)
      this.correctionCount = corrections.length
    }
    this.sendCorrection(slice, category)
  }

  async flushCorrections() {
    if (this.sendingCorrections) return
    this.sendingCorrections = true
    while (this.unsentCorrections.length > 0) {
      const { wav, label, split } = this.unsentCorrections[0]
      const result = await uploadCorrection(wav, label, await split)
      if (result === 'login') {
        this.correctionLogin = true
        break
      }
      if (result === 'refused') {
        this.refuseCorrections()
        break
      }
      this.unsentCorrections.shift()
      this.correctionsUnsent = this.unsentCorrections.length
      if (result === 'saved') {
        this.correctionLogin = false
        this.correctionsSent++
      } else this.message = '直したラベルを送れなかった'
    }
    this.sendingCorrections = false
  }

  private refuseCorrections() {
    this.correctionsRefused = true
    this.correctionLogin = false
    this.unsentCorrections = []
    this.correctionsUnsent = 0
    writeRefused()
  }

  private sendCorrection(slice: number, label: Category) {
    const start = this.sliceStart(slice)
    if (start === null || !this.sample || this.correctionsRefused) return
    const end = this.markers[slice + 1] ?? this.sample.left.length
    const wav = encodeWav24(this.sample.left.subarray(start, end), this.sample.right.subarray(start, end), this.sampleRate)
    this.sent.set(this.sample, [...(this.sent.get(this.sample) ?? []), { wav, label }])
    this.unsentCorrections.push({ wav, label, split: this.splitToSend(this.sample) })
    this.correctionsUnsent = this.unsentCorrections.length
    void this.flushCorrections()
  }

  setHeldOut(heldOut: boolean) {
    this.heldOut = heldOut
    if (!this.sample || this.correctionsRefused) return
    for (const { wav, label } of this.sent.get(this.sample) ?? []) {
      this.unsentCorrections.push({ wav, label, split: this.splitToSend(this.sample) })
    }
    this.correctionsUnsent = this.unsentCorrections.length
    void this.flushCorrections()
  }

  private splitToSend(sample: Sample): Promise<Split> {
    const heldOut = this.heldOut
    return this.splitOf(sample).then((byHash) => chooseSplit(byHash, heldOut))
  }

  private splitOf(sample: Sample): Promise<Split> {
    let split = this.splits.get(sample)
    if (!split) {
      const left = sample.left
      split = sha256Hex(left.buffer.slice(left.byteOffset, left.byteOffset + left.byteLength) as ArrayBuffer).then(splitFor)
      this.splits.set(sample, split)
    }
    return split
  }

  exportCorrections() {
    download(new Blob([JSON.stringify(readCorrections())], { type: 'application/json' }), 'sily-corrections.json')
  }

  arrangePads() {
    this.checkpoint()
    const free = this.freePads().filter((pad) => !this.padSpans[pad])
    const arranged = arrangePads(
      free.map((pad) => this.padSlices[pad]),
      (slice) => {
        const start = this.sliceStart(slice)
        return start === null ? null : (this.labels[start]?.category ?? null)
      },
    )
    const after = [...this.padSlices]
    free.forEach((pad, i) => (after[pad] = arranged[i]))
    this.events = remapEvents(this.events, this.padSlices, after)
    this.applyPadSlices(after)
  }

  buildKit() {
    this.checkpoint()
    void this.applyKit()
  }

  private applyKit(): Promise<void> {
    const sample = this.sample
    if (!sample) return Promise.resolve()
    const count = Math.min(Math.max(1, this.markers.length), MAX_CLASSIFIED)
    const candidates = Array.from({ length: count }, (_, slice): KitCandidate => {
      const start = this.sliceStart(slice)!
      const end = this.markers[slice + 1] ?? sample.left.length
      return {
        slice,
        scores: this.labels[start]?.scores ?? {},
        quality: sliceQuality(sample.mono, start, end, this.sampleRate),
        embedding: this.embeddings.get(`${start}:${end}`),
      }
    })
    const kit = buildKit(candidates)
    const after = [...this.padSlices]
    const free = this.freePads()
    this.padSpans = this.padSpans.map((span, pad) => (free.includes(pad) ? null : span))
    const taken = new Set(this.padSlices.filter((_, pad) => !free.includes(pad)))
    const picks = kit.filter((slice) => !taken.has(slice))
    free.forEach((pad, i) => (after[pad] = picks[i]))
    this.events = dropUnplacedEvents(this.events, this.padSlices, after)
    this.applyPadSlices(after)
    this.sendMarkers()
    return this.placePhrases()
  }

  private async placePhrases() {
    const sample = this.sample
    const sily = this.sily
    if (!sample || !sily) return
    const bpm = this.sourceBpm ?? this.estimateSourceBpm()
    if (!bpm) return
    const token = ++this.phraseToken
    const kicks = Object.entries(this.labels).flatMap(([start, l]) => (roleOf(l.category) === 'kick' ? [Number(start)] : []))
    const grid = beatGrid({ onsets: this.markers, kicks, frames: sample.left.length, sampleRate: this.sampleRate, bpm })
    const candidates: PhraseCandidate[] = []
    try {
      for (const range of phraseRanges(grid, sample.left.length).slice(0, MAX_PHRASE_CANDIDATES)) {
        const key = `${range[0]}:${range[1]}`
        let embedding = this.embeddings.get(key)
        if (!embedding) {
          embedding = await this.clap.embed(sample.mono.subarray(range[0], range[1]), this.sampleRate)
          if (token !== this.phraseToken || sample !== this.sample) return
          this.embeddings.set(key, embedding)
        }
        const { features } = sily.classify(sample.mono.subarray(range[0], range[1]))
        candidates.push({ range, embedding, upper: probeScores(probe as Probe, [...embedding, ...features]).upper ?? 0 })
      }
    } catch (error) {
      console.error(error)
      return
    }
    const picked = pickPhrases(candidates, UPPER_PADS.length)
    const free = this.freePads()
    const placed = UPPER_PADS.filter((pad, i) => free.includes(pad) && picked[i])
    if (placed.length === 0) return
    this.padSpans = this.padSpans.map((span, pad) => (placed.includes(pad) ? picked[UPPER_PADS.indexOf(pad)] : span))
    this.sendMarkers()
    this.autoChoke()
    this.shapePads()
    this.syncEvents()
    this.invalidateStretched(placed)
  }

  private freePads(): number[] {
    return this.pads.flatMap((p, pad) => (p.sample ? [] : [pad]))
  }

  hasSound(pad: number): boolean {
    return this.pads[pad]?.sample !== null || this.sliceRange(pad) !== null
  }

  async refreshLibrary() {
    try {
      this.library = await listSamples()
    } catch {
      this.library = []
    }
  }

  async savePadToLibrary(pad: number) {
    const audio = this.padAudio(pad)
    if (!audio) return
    const p = this.pads[pad]
    const category = this.labelOf(pad)?.category ?? 'perc'
    const name = p.sample?.name ?? `${this.sample?.name ?? 'sample'} ${pad + 1}`
    try {
      await navigator.storage?.persist?.()
      await saveSample({
        name,
        category,
        sampleRate: this.sampleRate,
        left: audio.left.slice(),
        right: audio.right.slice(),
        settings: $state.snapshot({ pitch: p.pitch, gain: p.gain, reverse: p.reverse, stretch: p.stretch, fx: p.fx }),
      })
      this.message = `「${name}」をライブラリに保存した`
    } catch {
      this.message = 'ライブラリに保存できなかった'
    }
    await this.refreshLibrary()
  }

  async loadLibrarySample(id: string, pad: number) {
    const loaded = await loadSample(id)
    if (!loaded || !this.sily) return
    this.checkpoint()
    const left = resample(loaded.left, loaded.meta.sampleRate, this.sampleRate)
    const right = resample(loaded.right, loaded.meta.sampleRate, this.sampleRate)
    const settings = loaded.meta.settings as Partial<PadSettings>
    const category = loaded.meta.category as Category
    Object.assign(this.pads[pad], settings, { sample: { id, name: loaded.meta.name, category } })
    this.own.set(pad, { id, left, right })
    this.sily.send({ type: 'padSample', pad, left: left.slice(), right: right.slice() })
    this.sendPad(pad)
    this.autoChoke()
    this.invalidateStretched([pad])
  }

  clearPadSample(pad: number) {
    if (!this.pads[pad].sample) return
    this.checkpoint()
    this.pads[pad].sample = null
    this.own.delete(pad)
    this.sily?.send({ type: 'padSample', pad, left: null, right: null })
    this.autoChoke()
    this.invalidateStretched([pad])
  }

  async deleteLibrarySample(id: string) {
    await deleteSample(id)
    await this.refreshLibrary()
  }

  private padAudio(pad: number): { left: Float32Array; right: Float32Array } | null {
    const own = this.own.get(pad)
    if (own) return own
    const range = this.sliceRange(pad)
    if (!range || !this.sample) return null
    return { left: this.sample.left.subarray(...range), right: this.sample.right.subarray(...range) }
  }

  assignSliceAt(frame: number) {
    if (!this.sample) return
    if (this.pads[this.selectedPad].sample) this.clearPadSample(this.selectedPad)
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
    const fresh = freshPad
    this.pads = after.map((slice) => (before.includes(slice) ? this.pads[before.indexOf(slice)] : fresh()))
    this.selectedPad = Math.max(0, after.indexOf(before[this.selectedPad]))
    this.padSlices = after
    this.autoChoke()
    this.shapePads()
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

  setKey(key: Key) {
    this.key = key
    this.keyAuto = false
    this.shapePads()
  }

  setAutoShape(on: boolean) {
    this.autoShape = on
    this.shapePads()
  }

  resetPadShape(pad: number) {
    this.checkpoint()
    this.pads[pad].pitchAuto = true
    this.pads[pad].fxAuto = true
    this.shapePads()
  }

  private shapePads() {
    let pitchChanged = false
    this.pads.forEach((p, pad) => {
      if (p.sample) return
      const label = this.labelOf(pad)
      const start = this.padSpans[pad] ? null : this.sliceStart(this.padSlices[pad])
      const features = start === null ? undefined : this.features.get(start)
      let changed = false
      if (p.pitchAuto) {
        const pitch =
          this.autoShape && label && features
            ? autoPitch(label.category, features[PITCH_HZ], features[PITCHEDNESS], this.key)
            : 0
        if (pitch !== p.pitch) {
          p.pitch = pitch
          changed = pitchChanged = true
        }
      }
      if (p.fxAuto) {
        const fx = (this.autoShape && label && autoFx(label.category)) || DEFAULT_FX
        if (JSON.stringify(fx) !== JSON.stringify(p.fx)) {
          p.fx = { ...fx }
          changed = true
        }
      }
      if (changed) this.sendPad(pad)
    })
    if (pitchChanged) this.fillStretched()
  }

  private sendPad(pad: number) {
    const p = this.pads[pad]
    this.sily?.send({ type: 'pad', pad, pitch: p.pitch, gain: p.gain, reverse: p.reverse, choke: p.choke })
    this.sily?.send({ type: 'fx', pad, fx: $state.snapshot(p.fx) })
  }

  setPadFx(pad: number, patch: Partial<FxSettings>) {
    this.checkpoint(`fx:${pad}:${Object.keys(patch).join()}`)
    this.pads[pad].fx = { ...this.pads[pad].fx, ...patch }
    this.pads[pad].fxAuto = false
    this.sendPad(pad)
  }

  setMasterFx(patch: Partial<FxSettings>) {
    this.masterFx = { ...this.masterFx, ...patch }
    this.sily?.send({ type: 'fx', pad: null, fx: $state.snapshot(this.masterFx) })
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
      patterns: this.allPatterns(),
      currentPattern: this.currentPattern,
      song: this.song,
      markers: this.markers,
      padSlices: this.padSlices,
      padSpans: this.padSpans,
      pads: this.pads,
      labels: this.labels,
    }) as Doc
  }

  private restore(doc: Doc) {
    this.adopt()
    this.events = doc.events
    this.patterns = doc.patterns
    this.currentPattern = doc.currentPattern
    this.song = doc.song
    this.bars = doc.patterns.find((p) => p.name === doc.currentPattern)?.bars ?? this.bars
    if (this.song.length === 0) this.songMode = false
    this.syncTransport()
    this.markers = doc.markers
    this.padSlices = doc.padSlices
    this.padSpans = doc.padSpans
    this.pads = doc.pads
    this.labels = doc.labels
    this.kitPending = false
    this.syncOwn()
    this.sendMarkers()
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.syncEvents()
    this.invalidateStretched()
    this.classifySlices()
  }

  private syncOwn() {
    this.pads.forEach((p, pad) => {
      const current = this.own.get(pad)
      if (current && current.id !== p.sample?.id) {
        this.own.delete(pad)
        this.sily?.send({ type: 'padSample', pad, left: null, right: null })
      }
      if (p.sample && !this.own.has(pad)) {
        const id = p.sample.id
        const shared = this.sharedSamples.get(id)
        ;(shared ? Promise.resolve(shared) : loadSample(id)).then((loaded) => {
          if (!loaded || this.pads[pad].sample?.id !== id) return
          const left = resample(loaded.left, loaded.meta.sampleRate, this.sampleRate)
          const right = resample(loaded.right, loaded.meta.sampleRate, this.sampleRate)
          this.own.set(pad, { id, left, right })
          this.sily?.send({ type: 'padSample', pad, left: left.slice(), right: right.slice() })
          this.invalidateStretched([pad])
        })
      }
    })
  }

  generateCandidates() {
    if (!this.sample || this.songMode) return
    const secondsPerFrame = 1 / this.sampleRate / this.sourceSpeed.rate
    const pads: PadInfo[] = []
    this.padSlices.forEach((_, pad) => {
      const own = this.own.get(pad)
      const range = this.sliceRange(pad)
      const label = this.labelOf(pad)
      if ((!own && !range) || !label) return
      const seconds = own ? own.left.length / this.sampleRate : (range![1] - range![0]) * secondsPerFrame
      pads.push({
        pad,
        category: label.category,
        beats: (seconds * this.bpm) / 60,
        scores: label.scores,
      })
    })
    if (!this.beforeGenerate) this.checkpoint()
    this.beforeGenerate ??= this.events
    const base = Math.floor(Math.random() * 1e9)
    this.candidates = candidateStyles(this.style, this.bpm, CANDIDATES).map((style, i) => ({
      style,
      events: generate({
        pads,
        existing: this.beforeGenerate!,
        style,
        density: this.density,
        looseness: this.looseness,
        lengthBeats: this.patternBeats,
        seed: base + i,
      }),
    }))
    this.preview(0)
  }

  preview(index: number) {
    const candidate = this.candidates[index]
    if (!candidate) return
    this.previewing = index
    const before = this.heardNow()
    this.events = candidate.events
    this.queueEvents(before)
  }

  adopt() {
    this.candidates = []
    this.previewing = null
    this.beforeGenerate = null
  }

  revert() {
    if (this.beforeGenerate) {
      const before = this.heardNow()
      this.events = this.beforeGenerate
      this.queueEvents(before)
    }
    this.adopt()
  }

  private queueEvents(before: Heard, lengthBeats?: number) {
    if (this.playing) this.heard ??= before
    this.switchPending = this.playing
    this.sily?.send({ type: 'queueEvents', events: this.engineEvents(), lengthBeats })
    this.fillStretched()
  }

  private heardNow(): Heard {
    return { events: this.playbackEvents(), length: this.lengthBeats }
  }

  private resetSong() {
    this.patterns = []
    this.currentPattern = 'A'
    this.song = []
    this.songMode = false
    this.muted = Array(PADS).fill(false)
    this.soloed = Array(PADS).fill(false)
  }

  private engineEvents() {
    return this.playbackEvents().map(({ beat, pad, velocity, nudge, pitch }) => ({ beat, pad, velocity, nudge, pitch }))
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
    this.autoChoke()
    this.shapePads()
    this.refineWithClap()
  }

  private async refineWithClap() {
    const sample = this.sample
    if (!sample) return
    const generation = ++this.refineGeneration
    const targets = Array.from({ length: Math.min(Math.max(1, this.markers.length), MAX_CLASSIFIED) }, (_, slice) => ({
      start: this.sliceStart(slice)!,
      end: this.markers[slice + 1] ?? sample.left.length,
    })).filter(({ start, end }) => end > start)
    this.refining = true
    this.refined = 0
    this.refineTotal = targets.length
    try {
      for (const [i, { start, end }] of targets.entries()) {
        this.refined = i
        const key = `${start}:${end}`
        let embedding = this.embeddings.get(key)
        if (!embedding) {
          embedding = await this.clap.embed(sample.mono.subarray(start, end), this.sampleRate)
          if (generation !== this.refineGeneration) return
          this.embeddings.set(key, embedding)
        }
        const current = this.labels[start]
        const features = this.features.get(start)
        if (!current || current.manual || !features) continue
        const scores = probeScores(probe as Probe, [...embedding, ...features])
        const [category, confidence] = Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a)) as [Category, number]
        this.labels[start] = { category, confidence, manual: false, scores }
      }
      this.autoChoke()
      this.shapePads()
    } catch (error) {
      console.error(error)
      this.message = '音を聞き分けるモデルを読み込めなかった'
    } finally {
      if (generation === this.refineGeneration) {
        this.refining = false
        if (this.kitPending) {
          this.kitPending = false
          void this.applyKit().then(() => this.finishBuild())
        }
      }
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
    this.sliceByOnsets()
  }

  private buildFromSource() {
    this.detectBpm()
    this.sliceByOnsets()
    this.kitPending = true
    this.playWhenBuilt = true
  }

  scaleSourceBpm(factor: number) {
    if (!this.sample || !this.sourceBpm) return
    this.checkpoint()
    this.sourceBpm = Math.round(this.sourceBpm * factor * 10) / 10
    this.bpm = Math.round(this.sourceBpm * this.sourceSpeed.rate * 10) / 10
    this.syncTransport()
    this.sliceByOnsets()
    this.kitPending = true
    this.playWhenBuilt = true
  }

  private finishBuild() {
    if (!this.playWhenBuilt) return
    this.playWhenBuilt = false
    this.generateCandidates()
    if (!this.playing && this.candidates.length > 0) this.togglePlaying()
  }

  private sliceByOnsets() {
    if (!this.sily || !this.sample) return
    const gap = minSliceSeconds(this.sourceBpm ?? this.estimateSourceBpm())
    this.setMarkers(this.sily.onsets(this.sample.mono, this.sensitivity, gap).slice(0, MAX_CLASSIFIED), true)
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
    const span = this.padSpans[pad]
    if (span) return span
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
    if ('pitch' in patch && !('pitchAuto' in patch)) this.pads[pad].pitchAuto = false
    this.sendPad(pad)
    if ('chokeAuto' in patch) this.autoChoke()
    if ('stretch' in patch || 'reverse' in patch) this.invalidateStretched([pad])
    else if ('pitch' in patch) this.fillStretched()
  }

  togglePlaying() {
    this.playing = !this.playing
    this.heard = null
    this.switchPending = false
    if (!this.playing) this.recording = false
    this.syncTransport()
  }

  toggleRecording() {
    if (this.songMode) {
      this.message = '曲モードでは録音できない。パターンに戻して録る'
      return
    }
    this.recording = !this.recording
    if (this.recording && !this.playing) {
      this.playing = true
      this.syncTransport()
    }
  }

  setTransport(patch: Partial<{ bpm: number; bars: number; metronome: boolean }>) {
    Object.assign(this, patch)
    if (this.songMode && patch.bars !== undefined) this.syncSong()
    else this.syncTransport()
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
    const name = this.sample.name.replace(/\.[^.]+$/, '')
    download(new Blob([wav], { type: 'audio/wav' }), this.songMode ? `${name}-${this.bpm}bpm-song.wav` : `${name}-${this.bpm}bpm-${loops}x.wav`)
  }

  private snapshot(loops: number): ToWorklet[] {
    const { left, right } = this.engineSample!
    return [
      { type: 'load', left, right },
      { type: 'sourceRate', rate: this.sourceSpeed.mode === 'tape' ? this.sourceSpeed.rate : 1 },
      { type: 'markers', frames: this.markers.map((m) => this.map.toEngine(m)) },
      { type: 'padSlices', slices: [...this.padSlices] },
      { type: 'padSpans', spans: this.engineSpans() },
      ...this.pads.map((p, pad): ToWorklet => ({ type: 'pad', pad, pitch: p.pitch, gain: p.gain, reverse: p.reverse, choke: p.choke })),
      ...this.pads.map((p, pad): ToWorklet => ({ type: 'fx', pad, fx: $state.snapshot(p.fx) })),
      ...[...this.own].map(([pad, a]): ToWorklet => ({ type: 'padSample', pad, left: a.left, right: a.right })),
      { type: 'fx', pad: null, fx: $state.snapshot(this.masterFx) },
      ...[...this.stretched.values()].map((b): ToWorklet => ({ type: 'stretched', ...b })),
      { type: 'groove', grid: this.grid, strength: this.strength, swing: this.swing },
      { type: 'events', events: this.engineEvents() },
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
    this.sily?.send({ type: 'padSpans', spans: this.engineSpans() })
  }

  private engineSpans(): Span[] {
    return this.padSpans.map((span) => (span ? [this.map.toEngine(span[0]), this.map.toEngine(span[1])] : null))
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
      const own = this.own.get(pad)
      const range = this.sliceRange(pad)
      if (!p.stretch || (!own && !range)) return
      const pitches = new Set([p.pitch, ...this.allPatterns().flatMap((pattern) => pattern.events).filter((e) => e.pad === pad).map((e) => p.pitch + e.pitch)])
      const audio = own ?? {
        left: source.left.subarray(...range!.map((f) => this.map.toEngine(f))),
        right: source.right.subarray(...range!.map((f) => this.map.toEngine(f))),
      }
      const shift = own ? 0 : tapeSemitones
      const reverse = p.reverse
      for (const pitch of pitches) {
        const key = `${pad}:${Math.round(pitch * 100)}`
        if (this.stretched.has(key) || this.requested.has(key)) continue
        this.requested.add(key)
        this.track(sily.pitchShift(audio.left, audio.right, pitch + shift))
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
    this.heard = null
    this.switchPending = false
    this.sily?.send({
      type: 'events',
      events: this.engineEvents(),
    })
    this.fillStretched()
  }
}

type Correction = { features: number[]; label: Category }

function readRefused(): boolean {
  try {
    return localStorage.getItem(CORRECTIONS_REFUSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeRefused() {
  try {
    localStorage.setItem(CORRECTIONS_REFUSED_KEY, '1')
  } catch {
    return
  }
}

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

function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

function writeLastProject(id: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id)
  } catch {
    return
  }
}
