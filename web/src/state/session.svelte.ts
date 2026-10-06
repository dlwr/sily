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
import { pack, unpack, withFreshSampleIds, type Bundle, type BundleSource } from '../storage/bundle'
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
import { changeVelocity, nudgeEvent, padsPlayedBetween, recordHit, recordRepeat, removeEvent, shiftPitch, toggleStep, type PadEvent } from './pattern'
import { rateForBpm, rateToSemitones, SourceMap, type SourceSpeed } from './source'
import { History } from './history'
import { Bank, type Label, type Sample } from './bank.svelte'
import { BANK_PADS, BANKS, bankOf, extendToBanks, inBank, mapBankEvents, PADS, readBanks, withBank, type BankState } from './banks'
import { copyPattern, flattenSong, sectionAt, type Pattern } from './song'
import { followMarkers, minSliceSeconds } from './markers'
import { frameAt } from './timing'
import { uploadShare } from '../share/api'
import { MAX_SHARE_BYTES, MAX_SOURCE_SECONDS } from '../share/limits'
import { trimSource } from '../share/trim'
import { noteOff, noteOn, padForMidiNote, semitonesForMidiNote } from './midi'

export type { Label, Sample }

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
type Heard = { events: PadEvent[]; length: number }
type Span = [number, number] | null

type Doc = {
  events: PadEvent[]
  patterns: Pattern[]
  currentPattern: string
  song: string[]
  banks: { markers: number[]; labels: Record<number, Label> }[]
  padSlices: number[]
  padSpans: Span[]
  pads: PadSettings[]
}


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
const identity = () => Array.from({ length: PADS }, (_, i) => i % BANK_PADS)
const noSpans = (): Span[] => Array(PADS).fill(null)
const EXPORT_TAIL_SECONDS = 2
const SILENCE = 1e-4

export class Session {
  sily = $state<Sily | null>(null)
  banks = $state.raw<Bank[]>(Array.from({ length: BANKS }, (_, i) => new Bank(i)))
  focusedBank = $state(0)
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
  noteRepeat = $state(false)
  midiInputs = $state<string[]>([])
  beat = $state(0)
  auditionFrame = $state<number | null>(null)
  sensitivity = $state(0.5)
  capturing = $state<'device' | 'display' | null>(null)
  hits = $state<number[]>(Array(PADS).fill(0))
  message = $state('')
  padSlices = $state<number[]>(identity())
  padSpans = $state<Span[]>(noSpans())
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
  private midiHeld = new Map<number, number>()
  private lastSaved = ''
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private pendingSave: string | null = null
  private beforeGenerate: PadEvent[] | null = null
  private clap = new ClapClient((download) => (this.modelDownload = download))

  private lastTick = { frame: 0, time: 0 }
  private capture: Capture | null = null
  private unsentCorrections: { wav: ArrayBuffer; label: Category; split: Promise<Split> }[] = []
  private splits = new WeakMap<Sample, Promise<Split>>()
  private sent = new WeakMap<Sample, { wav: ArrayBuffer; label: Category }[]>()
  private sendingCorrections = false
  private tickBeat: number | null = null
  private heard: Heard | null = null
  private switchPending = false
  private labelingTimer: ReturnType<typeof setTimeout> | undefined
  private loadToken = 0
  private history = new History<Doc>()
  private playWhenBuilt = false
  private stretchVersion = 0
  private requested = new Set<string>()
  private inflight = new Set<Promise<unknown>>()
  private own = new Map<number, { id: string; left: Float32Array; right: Float32Array }>()
  private stretched = new Map<string, { pad: number; pitch: number; left: Float32Array; right: Float32Array }>()

  get bank(): Bank {
    return this.banks[this.focusedBank]
  }

  get bankBase() {
    return this.focusedBank * BANK_PADS
  }

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
      this.auditionFrame = t.auditionFrame === null ? null : this.bank.map.fromEngine(t.auditionFrame)
      if (t.auditionFrame !== null) this.lastTick = { frame: t.auditionFrame, time: t.time }
    }
    sily.onRecorded = (r) => {
      if (this.songMode) return
      this.checkpoint('record')
      this.adopt()
      this.events = recordHit(this.events, r.pad, r.beat, r.velocity, r.pitch)
      this.syncEvents()
    }
    sily.onRepeated = (r) => {
      this.hits[r.pad] = performance.now()
      if (!this.recording || this.songMode) return
      const events = recordRepeat(this.events, r.pad, r.beat, r.velocity, r.pitch, this.grid / 2)
      if (events === this.events) return
      this.checkpoint('record')
      this.adopt()
      this.events = events
      this.syncEvents()
    }
    sily.onFailure = () => (this.message = 'オーディオ処理が停止した。ページを再読み込みしてほしい')
    this.sily = sily
    this.connectMidi()
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
      banks: this.banks.map(({ markers, labels, sourceSpeed, sourceBpm, heldOut }): BankState => ({ markers, labels, sourceSpeed, sourceBpm, heldOut })),
      padSlices: this.padSlices,
      padSpans: this.padSpans,
      pads: this.pads,
      events: this.events,
      patterns: this.allPatterns(),
      currentPattern: this.currentPattern,
      song: this.song,
      muted: this.muted,
      soloed: this.soloed,
      bpm: this.bpm,
      bars: this.bars,
      metronome: this.metronome,
      grid: this.grid,
      strength: this.strength,
      swing: this.swing,
      style: this.style,
      density: this.density,
      looseness: this.looseness,
      masterFx: this.masterFx,
      key: this.key,
      keyAuto: this.keyAuto,
      autoShape: this.autoShape,
    })
  }

  private scheduleSave(json: string) {
    if (!this.projectId || json === this.lastSaved) return
    if (!this.banks.some((b) => b.sample) && !this.pads.some((p) => p.sample)) return
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
      for (const bank of this.banks) {
        if (!bank.sample || bank.sourceId) continue
        await navigator.storage?.persist?.()
        bank.sourceId = await saveSource(bank.sample.left, bank.sample.right, this.sampleRate)
      }
      await saveProject({
        id,
        name: this.projectName,
        version: 1,
        updatedAt: 0,
        sources: this.banks.map((b) => (b.sample && b.sourceId ? { id: b.sourceId, name: b.sample.name } : null)),
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
    this.banks.forEach((bank) => this.clearBank(bank))
    this.history = new History<Doc>()
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
    const { doc, sources } = loaded
    this.leaveShared()
    this.projectId = id
    writeLastProject(id)
    this.applyProject(doc.name, doc.state, sources)
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
    this.applyProject(bundle.project.name, bundle.project.state, bundle.sources)
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

  private applyProject(name: string, state: Record<string, unknown>, sources: (BundleSource | SourceAudio | null)[]) {
    if (!this.sily) return
    const st = state as ReturnType<Session['projectState']>
    const saved = readBanks(st)
    this.projectName = name
    this.banks.forEach((bank, b) => {
      const source = sources[b]
      if (source) {
        const left = resample(source.left, source.sampleRate, this.sampleRate)
        const right = resample(source.right, source.sampleRate, this.sampleRate)
        this.setSample(bank, source.name, left, right)
        bank.sourceId = 'id' in source && source.sampleRate === this.sampleRate ? source.id : null
      } else {
        this.clearBank(bank)
      }
      bank.markers = saved[b].markers
      bank.labels = saved[b].labels
      bank.sourceSpeed = saved[b].sourceSpeed
      bank.sourceBpm = saved[b].sourceBpm
      bank.heldOut = saved[b].heldOut
    })
    this.padSlices = extendToBanks(st.padSlices, (pad) => pad % BANK_PADS)
    this.padSpans = extendToBanks<Span>(st.padSpans, () => null)
    this.pads = extendToBanks<Partial<PadSettings>>(st.pads, freshPad).map((p) => ({
      ...freshPad(),
      ...p,
      pitchAuto: p.pitchAuto ?? p.pitch === 0,
      fxAuto: p.fxAuto ?? isFlat({ ...DEFAULT_FX, ...p.fx }),
    }))
    this.events = st.events ?? []
    this.bpm = st.bpm ?? this.bpm
    this.bars = st.bars ?? this.bars
    this.resetSong()
    this.patterns = st.patterns ?? []
    this.currentPattern = st.currentPattern ?? 'A'
    this.song = st.song ?? []
    this.muted = extendToBanks(st.muted, () => false)
    this.soloed = extendToBanks(st.soloed, () => false)
    this.metronome = st.metronome ?? this.metronome
    this.grid = st.grid ?? this.grid
    this.strength = st.strength ?? this.strength
    this.swing = st.swing ?? this.swing
    this.style = st.style ?? this.style
    this.density = st.density ?? this.density
    this.looseness = st.looseness ?? this.looseness
    this.masterFx = { ...DEFAULT_FX, ...st.masterFx }
    this.key = st.key ?? this.key
    this.keyAuto = st.keyAuto ?? true
    this.autoShape = st.autoShape ?? true
    this.history = new History<Doc>()
    this.syncOwn()
    this.banks.forEach((bank) => this.sendMarkers(bank))
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.sily.send({ type: 'fx', pad: null, fx: $state.snapshot(this.masterFx) })
    this.syncEvents()
    this.syncTransport()
    this.syncGroove()
    this.banks.forEach((bank) => {
      this.applySource(bank)
      this.classifySlices(bank)
    })
    this.lastSaved = JSON.stringify(this.projectState())
  }

  private async bundle(): Promise<Bundle> {
    await this.flushSave()
    const ids = [...new Set(this.pads.flatMap((p) => (p.sample ? [p.sample.id] : [])))]
    const samples = (await Promise.all(ids.map((id) => this.sharedSamples.get(id) ?? loadSample(id)))).flatMap((s) => (s ? [s] : []))
    return {
      project: { name: this.projectName, state: JSON.parse(JSON.stringify(this.projectState())) },
      sources: this.banks.map(({ sample }) => sample && { name: sample.name, sampleRate: this.sampleRate, left: sample.left, right: sample.right }),
      samples,
    }
  }

  async exportProject() {
    const bytes = pack(await this.bundle())
    download(new Blob([bytes.slice()], { type: 'application/zip' }), `${this.projectName}.sily`)
  }

  private async shareBundle(): Promise<Bundle> {
    const bundle = await this.bundle()
    const st = bundle.project.state as ReturnType<Session['projectState']>
    const padSlices = [...st.padSlices]
    const padSpans = [...st.padSpans]
    const pads = [...st.pads]
    const detached: Bundle['samples'] = []
    const banks = st.banks.map((saved, b) => {
      const source = bundle.sources[b] ?? null
      if (!source) return { saved, source }
      const base = b * BANK_PADS
      const trim = trimSource({
        frames: source.left.length,
        maxFrames: Math.floor(MAX_SOURCE_SECONDS * source.sampleRate),
        markers: saved.markers,
        padSlices: inBank(padSlices, b),
        padSpans: inBank(padSpans, b),
        labels: saved.labels,
        ownPads: inBank(pads, b).map((p) => !!p.sample),
      })
      padSlices.splice(base, trim.padSlices.length, ...trim.padSlices)
      padSpans.splice(base, trim.padSpans.length, ...trim.padSpans)
      for (const { pad, range } of trim.detached) {
        const audio = this.detachedAudio(this.banks[b], range)
        const meta: SampleMeta = {
          id: newId(),
          name: `${source.name} ${pad + 1}`,
          category: this.labelOf(base + pad)?.category ?? 'perc',
          sampleRate: this.sampleRate,
          frames: audio.left.length,
          createdAt: Date.now(),
          settings: {},
        }
        pads[base + pad] = { ...pads[base + pad], sample: { id: meta.id, name: meta.name, category: meta.category as Category } }
        detached.push({ meta, ...audio })
      }
      return {
        saved: { ...saved, markers: trim.markers, labels: trim.labels },
        source: { ...source, left: source.left.slice(trim.start, trim.end), right: source.right.slice(trim.start, trim.end) },
      }
    })
    return {
      project: { name: bundle.project.name, state: { ...st, banks: banks.map((b) => b.saved), padSlices, padSpans, pads } },
      sources: banks.map((b) => b.source),
      samples: [...bundle.samples, ...detached],
    }
  }

  private detachedAudio(bank: Bank, [start, end]: [number, number]): { left: Float32Array; right: Float32Array } {
    const engine = bank.engineSample ?? bank.sample!
    const [a, b] = [bank.map.toEngine(start), bank.map.toEngine(end)]
    const rate = bank.sourceSpeed.mode === 'tape' ? bank.sourceSpeed.rate : 1
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
      const sources = []
      for (const source of bundle.sources) {
        sources.push(source && { id: await saveSource(source.left, source.right, source.sampleRate), name: source.name })
      }
      const id = newId()
      await saveProject({ id, name: bundle.project.name, version: 1, updatedAt: 0, sources, state: bundle.project.state })
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

  private clearBank(bank: Bank) {
    bank.sample = null
    bank.sourceId = null
    bank.engineSample = null
    bank.loadedStretch = null
    bank.markers = []
    bank.labels = {}
    bank.sourceSpeed = { mode: 'tape', rate: 1 }
    bank.sourceBpm = null
    bank.heldOut = false
    bank.sourceToken++
    this.padSlices = withBank(this.padSlices, bank.index, inBank(identity(), bank.index))
    this.padSpans = withBank(this.padSpans, bank.index, inBank(noSpans(), bank.index))
    if (bank === this.bank) this.stopAudition()
    this.sily?.send({ type: 'load', source: bank.index, left: new Float32Array(0), right: new Float32Array(0) })
  }

  private leads(bank: Bank) {
    return this.banks.find((b) => b.sample) === bank
  }

  async loadFile(file: File) {
    if (!this.sily) return
    if (file.name.endsWith('.sily')) return this.importProject(file)
    const token = ++this.loadToken
    try {
      const { left, right } = await this.sily.decode(file)
      if (token !== this.loadToken) return
      this.setSample(this.bank, file.name, left, right)
      this.buildFromSource(this.bank)
    } catch {
      this.message = `${file.name} を読み込めなかった`
    }
  }

  private setSample(bank: Bank, name: string, left: Float32Array, right: Float32Array) {
    if (!this.sily) return
    const b = bank.index
    bank.sample = { name, left, right, mono: mixdown(left, right) }
    bank.sourceId = null
    if (this.keyAuto && this.leads(bank)) this.key = estimateKey(this.sily.chroma(bank.sample.mono))
    bank.sourceSpeed = { mode: 'tape', rate: 1 }
    bank.sourceBpm = null
    bank.heldOut = false
    bank.splitByHash = null
    bank.kitPending = false
    if (this.leads(bank)) this.playWhenBuilt = false
    this.loadEngineSample(bank, left, right, null)
    this.sily.send({ type: 'sourceRate', source: b, rate: 1 })
    this.adopt()
    this.history = new History<Doc>()
    bank.markers = []
    bank.labels = {}
    bank.features.clear()
    bank.embeddings.clear()
    this.padSlices = withBank(this.padSlices, b, inBank(identity(), b))
    this.padSpans = withBank(this.padSpans, b, inBank(noSpans(), b))
    this.pads.forEach((p, pad) => {
      if (bankOf(pad) === b && !p.sample) p.stretch = false
    })
    bank.sourceToken++
    const kept = (e: PadEvent) => bankOf(e.pad) !== b || !!this.pads[e.pad]?.sample
    this.events = this.events.filter(kept)
    this.patterns = this.patterns.map((p) => ({ ...p, events: p.events.filter(kept) }))
    this.invalidateStretched(this.padsOf(bank))
    this.syncEvents()
    this.message = ''
    this.classifySlices(bank)
  }

  private padsOf(bank: Bank): number[] {
    return Array.from({ length: BANK_PADS }, (_, i) => bank.index * BANK_PADS + i)
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
      this.setSample(this.bank, `capture-${new Date().toLocaleTimeString()}`, left, right)
      this.buildFromSource(this.bank)
    }
  }

  toggleAudition(from = 0) {
    if (this.auditionFrame === null) this.auditionFrom(from)
    else this.stopAudition()
  }

  auditionFrom(frame: number) {
    if (!this.sily || !this.bank.sample) return
    const engineFrame = this.bank.map.toEngine(frame)
    this.auditionFrame = frame
    this.lastTick = { frame: engineFrame, time: this.sily.ctx.currentTime }
    this.sily.send({ type: 'audition', source: this.bank.index, from: engineFrame })
  }

  stopAudition() {
    this.auditionFrame = null
    this.sily?.send({ type: 'audition', source: this.bank.index, from: null })
  }

  markAtKey(timeStamp: number) {
    if (!this.sily || this.auditionFrame === null) return
    const framesPerSecond = this.sampleRate * (this.bank.sourceSpeed.mode === 'tape' ? this.bank.sourceSpeed.rate : 1)
    const played = frameAt(this.lastTick, this.sily.ctx.currentTime, framesPerSecond)
    const engineFrame = frameAt(this.lastTick, this.sily.audibleTime(timeStamp), framesPerSecond, played)
    this.addMarker(this.bank.map.fromEngine(engineFrame))
  }

  addMarker(frame: number) {
    if (!this.bank.sample || this.bank.markers.includes(frame)) return
    this.checkpoint()
    this.setMarkers(this.bank, [...this.bank.markers, frame])
  }

  removeMarkerNear(frame: number, tolerance: number) {
    const nearest = this.bank.markers.reduce<number | null>(
      (best, m) => (Math.abs(m - frame) <= tolerance && (best === null || Math.abs(m - frame) < Math.abs(best - frame)) ? m : best),
      null,
    )
    if (nearest === null) return
    this.checkpoint()
    this.setMarkers(this.bank, this.bank.markers.filter((m) => m !== nearest))
  }

  moveMarker(from: number, to: number): number {
    if (from === to || this.bank.markers.includes(to)) return from
    this.checkpoint('move-marker')
    this.setMarkers(this.bank, this.bank.markers.map((m) => (m === from ? to : m)))
    return to
  }

  private setMarkers(bank: Bank, markers: number[], rebuildKit = false) {
    this.adopt()
    const len = bank.sample?.left.length ?? 0
    const before = bank.markers
    bank.markers = [...new Set(markers.map((m) => Math.max(0, Math.min(len - 1, Math.round(m)))))].sort((a, b) => a - b)
    this.padSlices = withBank(this.padSlices, bank.index, followMarkers(before, bank.markers, inBank(this.padSlices, bank.index)))
    bank.kitPending = rebuildKit && bank.markers.length > BANK_PADS
    this.sendMarkers(bank)
    this.invalidateStretched(this.padsOf(bank))
    this.classifySlices(bank)
  }

  labelOf(pad: number): Label | null {
    const own = this.pads[pad]?.sample
    if (own) return { category: own.category, confidence: 1, manual: true, scores: { [own.category]: 1 } }
    if (this.padSpans[pad]) return { category: 'upper', confidence: 1, manual: false, scores: { upper: 1 } }
    const bank = this.banks[bankOf(pad)]
    const start = this.sliceStart(bank, this.padSlices[pad])
    return start === null ? null : (bank.labels[start] ?? null)
  }

  setLabel(pad: number, category: Category) {
    if (this.padSpans[pad]) return
    this.labelSlice(this.banks[bankOf(pad)], this.padSlices[pad], category)
  }

  get sliceCount() {
    return this.bank.sample ? Math.max(1, this.bank.markers.length) : 0
  }

  sliceLabel(slice: number): Label | null {
    const start = this.sliceStart(this.bank, slice)
    return start === null ? null : (this.bank.labels[start] ?? null)
  }

  startLabeling() {
    if (this.sliceCount === 0 || !this.bank.sample) return
    const sample = this.bank.sample
    void this.splitOf(sample).then((split) => {
      if (this.bank.sample === sample) this.bank.splitByHash = split
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
    if (slice === null || slice === 0 || slice >= this.bank.markers.length) return
    this.checkpoint()
    this.setMarkers(this.bank, this.bank.markers.filter((_, i) => i !== slice))
    this.showLabelingSlice(slice - 1)
  }

  labelAndNext(category: Category) {
    if (this.labelingSlice === null) return
    const slice = this.labelingSlice
    this.labelSlice(this.bank, slice, category)
    if (slice + 1 < this.sliceCount) this.showLabelingSlice(slice + 1)
    else this.stopLabeling()
  }

  labelingRange(): [number, number] | null {
    const start = this.labelingSlice === null ? null : this.sliceStart(this.bank, this.labelingSlice)
    if (start === null || !this.bank.sample) return null
    return [start, this.bank.markers[this.labelingSlice! + 1] ?? this.bank.sample.left.length]
  }

  playSlice(slice: number) {
    const start = this.sliceStart(this.bank, slice)
    if (start === null || !this.bank.sample) return
    const end = this.bank.markers[slice + 1] ?? this.bank.sample.left.length
    const rate = this.bank.sourceSpeed.mode === 'tape' ? this.bank.sourceSpeed.rate : 1
    clearTimeout(this.labelingTimer)
    this.auditionFrom(start)
    this.labelingTimer = setTimeout(() => this.stopAudition(), Math.min(4000, ((end - start) / this.sampleRate / rate) * 1000))
  }

  private labelSlice(bank: Bank, slice: number, category: Category) {
    const start = this.sliceStart(bank, slice)
    if (start === null) return
    this.checkpoint()
    bank.labels[start] = { category, confidence: 1, manual: true, scores: { [category]: 1 } }
    this.autoChoke()
    this.shapePads()
    const features = bank.features.get(start)
    if (features) {
      const corrections = [...readCorrections(), { features, label: category }]
      writeCorrections(corrections)
      this.correctionCount = corrections.length
    }
    this.sendCorrection(bank, slice, category)
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

  private sendCorrection(bank: Bank, slice: number, label: Category) {
    const start = this.sliceStart(bank, slice)
    const sample = bank.sample
    if (start === null || !sample || this.correctionsRefused) return
    const end = bank.markers[slice + 1] ?? sample.left.length
    const wav = encodeWav24(sample.left.subarray(start, end), sample.right.subarray(start, end), this.sampleRate)
    this.sent.set(sample, [...(this.sent.get(sample) ?? []), { wav, label }])
    this.unsentCorrections.push({ wav, label, split: this.splitToSend(sample, bank.heldOut) })
    this.correctionsUnsent = this.unsentCorrections.length
    void this.flushCorrections()
  }

  setHeldOut(heldOut: boolean) {
    this.bank.heldOut = heldOut
    if (!this.bank.sample || this.correctionsRefused) return
    for (const { wav, label } of this.sent.get(this.bank.sample) ?? []) {
      this.unsentCorrections.push({ wav, label, split: this.splitToSend(this.bank.sample, heldOut) })
    }
    this.correctionsUnsent = this.unsentCorrections.length
    void this.flushCorrections()
  }

  private splitToSend(sample: Sample, heldOut: boolean): Promise<Split> {
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
    const bank = this.bank
    const b = bank.index
    const free = this.freePads(bank).filter((pad) => !this.padSpans[pad])
    const arranged = arrangePads(
      free.map((pad) => this.padSlices[pad]),
      (slice) => {
        const start = this.sliceStart(bank, slice)
        return start === null ? null : (bank.labels[start]?.category ?? null)
      },
    )
    const before = inBank(this.padSlices, b)
    const after = [...before]
    free.forEach((pad, i) => (after[pad - b * BANK_PADS] = arranged[i]))
    this.events = mapBankEvents(this.events, b, (local) => remapEvents(local, before, after))
    this.applyPadSlices(bank, after)
  }

  buildKit() {
    this.checkpoint()
    void this.applyKit(this.bank)
  }

  private applyKit(bank: Bank): Promise<void> {
    const sample = bank.sample
    if (!sample) return Promise.resolve()
    const count = Math.min(Math.max(1, bank.markers.length), MAX_CLASSIFIED)
    const candidates = Array.from({ length: count }, (_, slice): KitCandidate => {
      const start = this.sliceStart(bank, slice)!
      const end = bank.markers[slice + 1] ?? sample.left.length
      return {
        slice,
        scores: bank.labels[start]?.scores ?? {},
        quality: sliceQuality(sample.mono, start, end, this.sampleRate),
        embedding: bank.embeddings.get(`${start}:${end}`),
      }
    })
    const kit = buildKit(candidates)
    const b = bank.index
    const base = b * BANK_PADS
    const before = inBank(this.padSlices, b)
    const after = [...before]
    const free = this.freePads(bank).map((pad) => pad - base)
    this.padSpans = this.padSpans.map((span, pad) => (bankOf(pad) === b && free.includes(pad - base) ? null : span))
    const taken = new Set(before.filter((_, pad) => !free.includes(pad)))
    const picks = kit.filter((slice) => !taken.has(slice))
    free.forEach((pad, i) => (after[pad] = picks[i]))
    this.events = mapBankEvents(this.events, b, (local) => dropUnplacedEvents(local, before, after))
    this.applyPadSlices(bank, after)
    this.sendMarkers(bank)
    return this.placePhrases(bank)
  }

  private async placePhrases(bank: Bank) {
    const sample = bank.sample
    const sily = this.sily
    if (!sample || !sily) return
    const bpm = bank.sourceBpm ?? this.estimateSourceBpm(bank)
    if (!bpm) return
    const token = ++bank.phraseToken
    const kicks = Object.entries(bank.labels).flatMap(([start, l]) => (roleOf(l.category) === 'kick' ? [Number(start)] : []))
    const grid = beatGrid({ onsets: bank.markers, kicks, frames: sample.left.length, sampleRate: this.sampleRate, bpm })
    const candidates: PhraseCandidate[] = []
    try {
      for (const range of phraseRanges(grid, sample.left.length).slice(0, MAX_PHRASE_CANDIDATES)) {
        const key = `${range[0]}:${range[1]}`
        let embedding = bank.embeddings.get(key)
        if (!embedding) {
          embedding = await this.clap.embed(sample.mono.subarray(range[0], range[1]), this.sampleRate)
          if (token !== bank.phraseToken || sample !== bank.sample) return
          bank.embeddings.set(key, embedding)
        }
        const { features } = sily.classify(sample.mono.subarray(range[0], range[1]))
        candidates.push({ range, embedding, upper: probeScores(probe as Probe, [...embedding, ...features]).upper ?? 0 })
      }
    } catch (error) {
      console.error(error)
      return
    }
    const picked = pickPhrases(candidates, UPPER_PADS.length)
    const base = bank.index * BANK_PADS
    const free = this.freePads(bank)
    const placed = UPPER_PADS.filter((pad, i) => free.includes(base + pad) && picked[i]).map((pad) => base + pad)
    if (placed.length === 0) return
    this.padSpans = this.padSpans.map((span, pad) => (placed.includes(pad) ? picked[UPPER_PADS.indexOf(pad - base)] : span))
    this.sendMarkers(bank)
    this.autoChoke()
    this.shapePads()
    this.syncEvents()
    this.invalidateStretched(placed)
  }

  private freePads(bank: Bank): number[] {
    return this.padsOf(bank).filter((pad) => !this.pads[pad].sample)
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
    const name = p.sample?.name ?? `${this.banks[bankOf(pad)].sample?.name ?? 'sample'} ${pad + 1}`
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
    const sample = this.banks[bankOf(pad)].sample
    if (!range || !sample) return null
    return { left: sample.left.subarray(...range), right: sample.right.subarray(...range) }
  }

  assignSliceAt(frame: number) {
    const bank = this.bank
    const b = bank.index
    if (!bank.sample || bankOf(this.selectedPad) !== b) return
    if (this.pads[this.selectedPad].sample) this.clearPadSample(this.selectedPad)
    this.checkpoint()
    const slice = Math.max(0, bank.markers.findLastIndex((m) => m <= frame))
    const selected = this.selectedPad - b * BANK_PADS
    const before = inBank(this.padSlices, b)
    const after = [...before]
    const other = after.indexOf(slice)
    if (other >= 0) after[other] = after[selected]
    after[selected] = slice
    this.events = mapBankEvents(this.events, b, (local) => dropUnplacedEvents(local, before, after))
    this.applyPadSlices(bank, after)
  }

  private applyPadSlices(bank: Bank, after: number[]) {
    this.adopt()
    const b = bank.index
    const base = b * BANK_PADS
    const before = inBank(this.padSlices, b)
    const pads = inBank(this.pads, b)
    this.pads = withBank(this.pads, b, after.map((slice) => (before.includes(slice) ? pads[before.indexOf(slice)] : freshPad())))
    if (bankOf(this.selectedPad) === b) this.selectedPad = base + Math.max(0, after.indexOf(before[this.selectedPad - base]))
    this.padSlices = withBank(this.padSlices, b, after)
    this.autoChoke()
    this.shapePads()
    this.sily?.send({ type: 'padSlices', slices: [...this.padSlices] })
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.syncEvents()
    this.invalidateStretched(this.padsOf(bank))
  }

  clearMarkers() {
    this.checkpoint()
    this.setMarkers(this.bank, [])
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
      const bank = this.banks[bankOf(pad)]
      const start = this.padSpans[pad] ? null : this.sliceStart(bank, this.padSlices[pad])
      const features = start === null ? undefined : bank.features.get(start)
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
      banks: this.banks.map(({ markers, labels }) => ({ markers, labels })),
      padSlices: this.padSlices,
      padSpans: this.padSpans,
      pads: this.pads,
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
    this.banks.forEach((bank, b) => {
      bank.markers = doc.banks[b].markers
      bank.labels = doc.banks[b].labels
      bank.kitPending = false
    })
    this.padSlices = doc.padSlices
    this.padSpans = doc.padSpans
    this.pads = doc.pads
    this.syncOwn()
    this.banks.forEach((bank) => this.sendMarkers(bank))
    this.pads.forEach((_, pad) => this.sendPad(pad))
    this.syncEvents()
    this.invalidateStretched()
    this.banks.forEach((bank) => this.classifySlices(bank))
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

  generateCandidates(bank = this.bank) {
    if (!bank.sample || this.songMode) return
    const secondsPerFrame = 1 / this.sampleRate / bank.sourceSpeed.rate
    const pads: PadInfo[] = []
    for (const pad of this.padsOf(bank)) {
      const own = this.own.get(pad)
      const range = this.sliceRange(pad)
      const label = this.labelOf(pad)
      if ((!own && !range) || !label) continue
      const seconds = own ? own.left.length / this.sampleRate : (range![1] - range![0]) * secondsPerFrame
      pads.push({
        pad,
        category: label.category,
        beats: (seconds * this.bpm) / 60,
        scores: label.scores,
      })
    }
    if (!this.beforeGenerate) this.checkpoint()
    this.beforeGenerate ??= this.events
    const others = this.beforeGenerate.filter((e) => bankOf(e.pad) !== bank.index)
    const existing = this.beforeGenerate.filter((e) => bankOf(e.pad) === bank.index)
    const base = Math.floor(Math.random() * 1e9)
    this.candidates = candidateStyles(this.style, this.bpm, CANDIDATES).map((style, i) => ({
      style,
      events: [
        ...others,
        ...generate({
          pads,
          existing,
          style,
          density: this.density,
          looseness: this.looseness,
          lengthBeats: this.patternBeats,
          seed: base + i,
        }),
      ],
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

  private sliceStart(bank: Bank, slice: number): number | null {
    if (!bank.sample) return null
    if (bank.markers.length === 0) return slice === 0 ? 0 : null
    return bank.markers[slice] ?? null
  }

  private classifySlices(bank: Bank) {
    clearTimeout(bank.classifyTimer)
    bank.classifyTimer = setTimeout(() => this.classifyNow(bank), CLASSIFY_DELAY_MS)
  }

  private classifyNow(bank: Bank) {
    const sample = bank.sample
    if (!this.sily || !sample) return
    const count = Math.max(1, bank.markers.length)
    const labels: Record<number, Label> = {}
    for (let slice = 0; slice < Math.min(count, MAX_CLASSIFIED); slice++) {
      const start = this.sliceStart(bank, slice)!
      const end = bank.markers[slice + 1] ?? sample.left.length
      const previous = bank.labels[start]
      if (previous?.manual) {
        labels[start] = previous
        continue
      }
      const result = this.sily.classify(sample.mono.subarray(start, end))
      bank.features.set(start, result.features)
      labels[start] = { category: result.category, confidence: result.confidence, manual: false, scores: result.scores }
    }
    bank.labels = labels
    this.autoChoke()
    this.shapePads()
    this.refineWithClap(bank)
  }

  private async refineWithClap(bank: Bank) {
    const sample = bank.sample
    if (!sample) return
    const generation = ++bank.refineGeneration
    const targets = Array.from({ length: Math.min(Math.max(1, bank.markers.length), MAX_CLASSIFIED) }, (_, slice) => ({
      start: this.sliceStart(bank, slice)!,
      end: bank.markers[slice + 1] ?? sample.left.length,
    })).filter(({ start, end }) => end > start)
    bank.refining = true
    bank.refined = 0
    bank.refineTotal = targets.length
    try {
      for (const [i, { start, end }] of targets.entries()) {
        bank.refined = i
        const key = `${start}:${end}`
        let embedding = bank.embeddings.get(key)
        if (!embedding) {
          embedding = await this.clap.embed(sample.mono.subarray(start, end), this.sampleRate)
          if (generation !== bank.refineGeneration) return
          bank.embeddings.set(key, embedding)
        }
        const current = bank.labels[start]
        const features = bank.features.get(start)
        if (!current || current.manual || !features) continue
        const scores = probeScores(probe as Probe, [...embedding, ...features])
        const [category, confidence] = Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a)) as [Category, number]
        bank.labels[start] = { category, confidence, manual: false, scores }
      }
      this.autoChoke()
      this.shapePads()
    } catch (error) {
      console.error(error)
      this.message = '音を聞き分けるモデルを読み込めなかった'
    } finally {
      if (generation === bank.refineGeneration) {
        bank.refining = false
        if (bank.kitPending) {
          bank.kitPending = false
          void this.applyKit(bank).then(() => this.finishBuild(bank))
        }
      }
    }
  }

  setSourceSpeed(patch: Partial<SourceSpeed>) {
    this.bank.sourceSpeed = { ...this.bank.sourceSpeed, ...patch }
    this.applySource(this.bank)
  }

  matchBpm(mode: SourceSpeed['mode']) {
    const sourceBpm = this.bank.sourceBpm ?? this.estimateSourceBpm(this.bank)
    if (!sourceBpm) return
    this.setSourceSpeed({ mode, rate: rateForBpm(this.bpm, sourceBpm) })
  }

  detectOnsets() {
    if (!this.sily || !this.bank.sample) return
    this.checkpoint()
    this.sliceByOnsets(this.bank)
  }

  private buildFromSource(bank: Bank) {
    if (this.leads(bank)) this.detectBpm(bank)
    else this.estimateSourceBpm(bank)
    this.sliceByOnsets(bank)
    bank.kitPending = true
    if (this.leads(bank)) this.playWhenBuilt = true
  }

  scaleSourceBpm(factor: number) {
    const bank = this.bank
    if (!bank.sample || !bank.sourceBpm) return
    this.checkpoint()
    bank.sourceBpm = Math.round(bank.sourceBpm * factor * 10) / 10
    if (this.leads(bank)) {
      this.bpm = Math.round(bank.sourceBpm * bank.sourceSpeed.rate * 10) / 10
      this.syncTransport()
      this.playWhenBuilt = true
    }
    this.sliceByOnsets(bank)
    bank.kitPending = true
  }

  private finishBuild(bank: Bank) {
    if (!this.playWhenBuilt || !this.leads(bank)) return
    this.playWhenBuilt = false
    this.generateCandidates(bank)
    if (!this.playing && this.candidates.length > 0) this.togglePlaying()
  }

  private sliceByOnsets(bank: Bank) {
    if (!this.sily || !bank.sample) return
    const gap = minSliceSeconds(bank.sourceBpm ?? this.estimateSourceBpm(bank))
    this.setMarkers(bank, this.sily.onsets(bank.sample.mono, this.sensitivity, gap).slice(0, MAX_CLASSIFIED), true)
  }

  gridSlice(count: number) {
    const bank = this.bank
    if (!bank.sample) return
    this.checkpoint()
    const start = bank.markers[0] ?? 0
    const end = bank.sample.left.length
    this.setMarkers(
      bank,
      Array.from({ length: count }, (_, i) => start + ((end - start) * i) / count),
      true,
    )
  }

  detectBpm(bank = this.bank) {
    const sourceBpm = this.estimateSourceBpm(bank)
    if (!sourceBpm) return
    this.bpm = Math.round(sourceBpm * bank.sourceSpeed.rate * 10) / 10
    this.syncTransport()
  }

  private estimateSourceBpm(bank: Bank): number | null {
    if (!this.sily || !bank.sample) return null
    const bpm = this.sily.bpm(bank.sample.mono)
    if (!bpm) {
      this.message = 'BPM を推定できなかった'
      return null
    }
    bank.sourceBpm = Math.round(bpm * 10) / 10
    return bank.sourceBpm
  }

  sliceRange(pad: number): [number, number] | null {
    const bank = this.banks[bankOf(pad)]
    if (!bank?.sample) return null
    const span = this.padSpans[pad]
    if (span) return span
    const slice = this.padSlices[pad]
    const len = bank.sample.left.length
    if (bank.markers.length === 0) return slice === 0 ? [0, len] : null
    if (slice >= bank.markers.length) return null
    return [bank.markers[slice], bank.markers[slice + 1] ?? len]
  }

  padDown(pad: number, timeStamp: number, velocity = 1) {
    if (!this.sily) return
    this.selectedPad = pad
    this.hits[pad] = performance.now()
    this.sily.send({ type: 'trigger', pad, velocity, pitch: 0 })
    if (this.noteRepeat && this.playing) {
      this.sily.send({ type: 'hold', pad, velocity, pitch: 0, time: this.sily.audibleTime(timeStamp) })
    }
    if (this.recording && this.playing) {
      this.sily.send({ type: 'record', pad, velocity, pitch: 0, time: this.sily.audibleTime(timeStamp) })
    }
  }

  noteDown(note: number, timeStamp: number, velocity = 1) {
    if (!this.sily) return
    const pad = this.selectedPad
    this.hits[pad] = performance.now()
    this.sily.send({ type: 'note', slice: pad, semitones: note, velocity })
    if (this.recording && this.playing) {
      this.sily.send({ type: 'record', pad, velocity, pitch: note, time: this.sily.audibleTime(timeStamp) })
    }
  }

  padUp(pad: number) {
    this.sily?.send({ type: 'release', pad })
  }

  releasePads() {
    this.midiHeld.clear()
    this.sily?.send({ type: 'release', pad: null })
  }

  toggleNoteRepeat() {
    this.noteRepeat = !this.noteRepeat
    if (!this.noteRepeat) this.releasePads()
  }

  toggleKeyboardMode() {
    this.keyboardMode = !this.keyboardMode
    this.releasePads()
  }

  midiNoteDown(note: number, velocity: number, timeStamp: number) {
    if (this.labelingSlice !== null) return
    if (this.keyboardMode) return this.noteDown(semitonesForMidiNote(note), timeStamp, velocity)
    const local = padForMidiNote(note)
    if (local === undefined) return
    const pad = this.bankBase + local
    this.midiHeld.set(note, pad)
    this.padDown(pad, timeStamp, velocity)
  }

  midiNoteUp(note: number) {
    const pad = this.midiHeld.get(note)
    if (pad === undefined) return
    this.midiHeld.delete(note)
    this.padUp(pad)
  }

  private async connectMidi() {
    if (!navigator.requestMIDIAccess) return
    let access: MIDIAccess
    try {
      access = await navigator.requestMIDIAccess()
    } catch {
      return
    }
    const listen = () => {
      const names: string[] = []
      access.inputs.forEach((input) => {
        input.onmidimessage = (e) => {
          if (!e.data) return
          const hit = noteOn(e.data)
          if (hit) return this.midiNoteDown(hit.note, hit.velocity, e.timeStamp)
          const released = noteOff(e.data)
          if (released !== null) this.midiNoteUp(released)
        }
        if (input.state === 'connected') names.push(input.name ?? 'MIDI')
      })
      this.midiInputs = names
    }
    access.onstatechange = listen
    listen()
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
    const named = this.banks.find((b) => b.sample)?.sample
    if (!this.sily || !named) return
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight])
    const loopSeconds = (this.lengthBeats * 60) / this.bpm
    const { left, right } = await this.sily.renderOffline(this.snapshot(loops), loops * loopSeconds + EXPORT_TAIL_SECONDS)
    const frames = soundingLength([left, right], Math.round(loops * loopSeconds * this.sampleRate), SILENCE)
    const wav = encodeWav24(left.subarray(0, frames), right.subarray(0, frames), this.sampleRate)
    const name = named.name.replace(/\.[^.]+$/, '')
    download(new Blob([wav], { type: 'audio/wav' }), this.songMode ? `${name}-${this.bpm}bpm-song.wav` : `${name}-${this.bpm}bpm-${loops}x.wav`)
  }

  private snapshot(loops: number): ToWorklet[] {
    return [
      ...this.banks.flatMap((bank): ToWorklet[] =>
        bank.engineSample
          ? [
              { type: 'load', source: bank.index, left: bank.engineSample.left, right: bank.engineSample.right },
              { type: 'sourceRate', source: bank.index, rate: this.tapeRate(bank) },
              { type: 'markers', source: bank.index, frames: bank.markers.map((m) => bank.map.toEngine(m)) },
            ]
          : [],
      ),
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

  private tapeRate(bank: Bank) {
    return bank.sourceSpeed.mode === 'tape' ? bank.sourceSpeed.rate : 1
  }

  private async applySource(bank: Bank) {
    const sample = bank.sample
    if (!this.sily || !sample) return
    const { mode, rate } = bank.sourceSpeed
    const stretch = mode === 'stretch' && rate !== 1 ? rate : null
    const token = ++bank.sourceToken
    if (stretch !== bank.loadedStretch) {
      const out = stretch ? await this.track(this.sily.stretch(sample.left, sample.right, 1 / stretch)) : sample
      if (token !== bank.sourceToken || sample !== bank.sample) return
      if (bank === this.bank) this.stopAudition()
      this.loadEngineSample(bank, out.left, out.right, stretch)
      this.sendMarkers(bank)
    }
    this.sily.send({ type: 'sourceRate', source: bank.index, rate: this.tapeRate(bank) })
    this.invalidateStretched(this.padsOf(bank))
  }

  private track<T>(job: Promise<T>): Promise<T> {
    this.inflight.add(job)
    this.processing = this.inflight.size
    return job.finally(() => {
      this.inflight.delete(job)
      this.processing = this.inflight.size
    })
  }

  private loadEngineSample(bank: Bank, left: Float32Array, right: Float32Array, stretch: number | null) {
    bank.engineSample = { left, right }
    bank.loadedStretch = stretch
    bank.map = new SourceMap(bank.sample?.left.length ?? left.length, left.length)
    this.sily?.send({ type: 'load', source: bank.index, left: left.slice(), right: right.slice() })
  }

  private sendMarkers(bank: Bank) {
    this.sily?.send({ type: 'markers', source: bank.index, frames: bank.markers.map((m) => bank.map.toEngine(m)) })
    this.sily?.send({ type: 'padSlices', slices: [...this.padSlices] })
    this.sily?.send({ type: 'padSpans', spans: this.engineSpans() })
  }

  private engineSpans(): Span[] {
    return this.padSpans.map((span, pad) => {
      const { map } = this.banks[bankOf(pad)]
      return span ? [map.toEngine(span[0]), map.toEngine(span[1])] : null
    })
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
    if (!this.sily) return
    const sily = this.sily
    const version = this.stretchVersion
    this.pads.forEach((p, pad) => {
      const bank = this.banks[bankOf(pad)]
      const own = this.own.get(pad)
      const range = this.sliceRange(pad)
      const source = bank.engineSample
      if (!p.stretch || (!own && !(range && source))) return
      const pitches = new Set([p.pitch, ...this.allPatterns().flatMap((pattern) => pattern.events).filter((e) => e.pad === pad).map((e) => p.pitch + e.pitch)])
      const audio = own ?? {
        left: source!.left.subarray(...range!.map((f) => bank.map.toEngine(f))),
        right: source!.right.subarray(...range!.map((f) => bank.map.toEngine(f))),
      }
      const tapeSemitones = rateToSemitones(this.tapeRate(bank))
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
