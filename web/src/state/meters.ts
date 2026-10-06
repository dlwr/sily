const FALL = 0.85
const FLOOR_DB = -48

export const fallMeters = (previous: number[], peaks: Float32Array): number[] =>
  Array.from(peaks, (peak, i) => Math.max(peak, (previous[i] ?? 0) * FALL))

export const meterHeight = (peak: number): number => {
  if (peak <= 0) return 0
  const db = 20 * Math.log10(peak)
  return Math.min(1, Math.max(0, 1 - db / FLOOR_DB))
}
