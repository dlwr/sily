export const CLAP_RATE = 48000
export const MAX_CLIP_SECONDS = 4

export const resample = (audio: Float32Array, from: number, to: number): Float32Array => {
  if (from === to) return audio.slice()
  const out = new Float32Array(Math.round((audio.length * to) / from))
  const step = from / to
  for (let i = 0; i < out.length; i++) {
    const pos = i * step
    const j = Math.floor(pos)
    const a = audio[j] ?? 0
    const b = audio[j + 1] ?? a
    out[i] = a + (b - a) * (pos - j)
  }
  return out
}

export const clipForClap = (mono: Float32Array, sampleRate: number): Float32Array =>
  resample(mono.subarray(0, sampleRate * MAX_CLIP_SECONDS), sampleRate, CLAP_RATE)

export const normalize = (v: number[]): number[] => {
  const norm = Math.hypot(...v)
  return norm === 0 ? v : v.map((x) => x / norm)
}
