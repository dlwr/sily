const LOOKBACK_SECONDS = 0.03
const BODY_SECONDS = 0.05
const ROOM_SECONDS = 0.08

const rms = (mono: Float32Array, from: number, to: number) => {
  let sum = 0
  for (let i = Math.max(0, from); i < to; i++) sum += mono[i] * mono[i]
  return to > from ? Math.sqrt(sum / (to - from)) : 0
}

export const sliceQuality = (mono: Float32Array, start: number, end: number, sampleRate: number): number => {
  const before = rms(mono, start - Math.round(LOOKBACK_SECONDS * sampleRate), start)
  const body = rms(mono, start, Math.min(end, start + Math.round(BODY_SECONDS * sampleRate)))
  const isolation = body > 0 ? Math.max(0, 1 - before / body) : 0
  const room = Math.min(1, (end - start) / (ROOM_SECONDS * sampleRate))
  return isolation * room
}
