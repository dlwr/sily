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
