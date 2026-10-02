const starts = (markers: number[]) => (markers.length === 0 ? [0] : markers)

export const followMarkers = (before: number[], after: number[], padSlices: number[]): number[] => {
  const oldStarts = starts(before)
  const newStarts = starts(after)
  const kept = padSlices.map((slice) => {
    const start = oldStarts[slice]
    const index = start === undefined ? -1 : newStarts.indexOf(start)
    return index < 0 ? null : index
  })
  const free = newStarts.map((_, i) => i).filter((i) => !kept.includes(i))
  let spare = newStarts.length
  return kept.map((slice) => slice ?? free.shift() ?? spare++)
}

const SIXTEENTHS_PER_BEAT = 4
const SLACK = 0.8
const UNKNOWN_TEMPO_SECONDS = 0.05

export const minSliceSeconds = (bpm: number | null): number =>
  bpm ? (SLACK * 60) / bpm / SIXTEENTHS_PER_BEAT : UNKNOWN_TEMPO_SECONDS
