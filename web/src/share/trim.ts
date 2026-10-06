import { followMarkers } from '../state/markers'

type Range = [number, number]

export type TrimInput<L = unknown> = {
  frames: number
  maxFrames: number
  markers: number[]
  padSlices: number[]
  padSpans: (Range | null)[]
  labels: Record<number, L>
  ownPads: boolean[]
}

export type Trim<L = unknown> = {
  start: number
  end: number
  markers: number[]
  padSlices: number[]
  padSpans: (Range | null)[]
  labels: Record<number, L>
  detached: { pad: number; range: Range }[]
}

type Used = { pad: number; range: Range; span: boolean }

const usedPads = ({ frames, markers, padSlices, padSpans, ownPads }: TrimInput): Used[] =>
  padSlices.flatMap((slice, pad): Used[] => {
    if (ownPads[pad]) return []
    const span = padSpans[pad]
    if (span) return [{ pad, range: span, span: true }]
    if (markers.length === 0) return slice === 0 ? [{ pad, range: [0, frames], span: false }] : []
    if (slice >= markers.length) return []
    return [{ pad, range: [markers[slice], markers[slice + 1] ?? frames], span: false }]
  })

const inside = (used: Used, start: number, end: number) =>
  used.range[0] >= start && (used.span ? used.range[1] <= end : used.range[0] < end)

const windowFrom = (start: number, { frames, maxFrames, markers }: TrimInput): Range => {
  const limit = Math.min(start + maxFrames, frames)
  if (limit === frames) return [start, frames]
  const boundary = markers.filter((m) => m > start && m <= limit).at(-1)
  return [start, boundary ?? limit]
}

export const trimSource = <L>(input: TrimInput<L>): Trim<L> => {
  const { frames, maxFrames, markers, padSlices, padSpans, labels } = input
  if (frames <= maxFrames) return { start: 0, end: frames, markers, padSlices, padSpans, labels, detached: [] }
  const used = usedPads(input)
  const starts = [...new Set([0, ...used.map((u) => u.range[0])])].sort((a, b) => a - b)
  const covered = (w: Range) => used.filter((u) => inside(u, ...w)).length
  const [start, end] = starts.map((s) => windowFrom(s, input)).reduce((best, w) => (covered(w) > covered(best) ? w : best))
  const kept = markers.filter((m) => m >= start && m < end).map((m) => m - start)
  const detached = used.filter((u) => !inside(u, start, end)).map(({ pad, range }) => ({ pad, range }))
  const detachedPads = new Set(detached.map((d) => d.pad))
  return {
    start,
    end,
    markers: kept,
    padSlices: followMarkers(markers.map((m) => m - start), kept, padSlices),
    padSpans: padSpans.map((span, pad) => (span && !detachedPads.has(pad) ? [span[0] - start, span[1] - start] : null)),
    labels: Object.fromEntries(
      Object.entries(labels)
        .map(([frame, label]) => [Number(frame) - start, label] as const)
        .filter(([frame]) => frame >= 0 && frame < end - start),
    ),
    detached,
  }
}

export type BanksTrimInput<L = unknown> = {
  bankPads: number
  sources: ({ frames: number; maxFrames: number } | null)[]
  banks: { markers: number[]; labels: Record<number, L> }[]
  padSlices: number[]
  padSpans: (Range | null)[]
  ownPads: boolean[]
}

export type BanksTrim<L = unknown> = {
  windows: (Range | null)[]
  banks: { markers: number[]; labels: Record<number, L> }[]
  padSlices: number[]
  padSpans: (Range | null)[]
  detached: { pad: number; range: Range }[]
}

export const trimBanks = <L>({ bankPads, sources, banks, padSlices, padSpans, ownPads }: BanksTrimInput<L>): BanksTrim<L> => {
  const slices = [...padSlices]
  const spans = [...padSpans]
  const detached: BanksTrim<L>['detached'] = []
  const trimmed = banks.map((bank, b) => {
    const source = sources[b]
    if (!source) return { bank, window: null }
    const base = b * bankPads
    const inBank = <T>(xs: T[]) => xs.slice(base, base + bankPads)
    const trim = trimSource({
      ...source,
      markers: bank.markers,
      labels: bank.labels,
      padSlices: inBank(padSlices),
      padSpans: inBank(padSpans),
      ownPads: inBank(ownPads),
    })
    slices.splice(base, trim.padSlices.length, ...trim.padSlices)
    spans.splice(base, trim.padSpans.length, ...trim.padSpans)
    detached.push(...trim.detached.map(({ pad, range }) => ({ pad: base + pad, range })))
    return { bank: { markers: trim.markers, labels: trim.labels }, window: [trim.start, trim.end] as Range }
  })
  return { windows: trimmed.map((t) => t.window), banks: trimmed.map((t) => t.bank), padSlices: slices, padSpans: spans, detached }
}
