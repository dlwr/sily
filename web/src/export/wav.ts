const FULL_SCALE = 8388607

export const encodeWav24 = (left: Float32Array, right: Float32Array, sampleRate: number): ArrayBuffer => {
  const frames = Math.min(left.length, right.length)
  const dataBytes = frames * 2 * 3
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 2, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2 * 3, true)
  v.setUint16(32, 2 * 3, true)
  v.setUint16(34, 24, true)
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  let at = 44
  for (let i = 0; i < frames; i++) {
    for (const ch of [left, right]) {
      const s = Math.round(Math.max(-1, Math.min(1, ch[i])) * FULL_SCALE)
      v.setUint8(at, s & 0xff)
      v.setUint8(at + 1, (s >> 8) & 0xff)
      v.setUint8(at + 2, (s >> 16) & 0xff)
      at += 3
    }
  }
  return buf
}

export const soundingLength = (channels: Float32Array[], minimum: number, threshold: number): number => {
  const frames = Math.min(...channels.map((c) => c.length))
  for (let i = frames - 1; i >= minimum; i--) {
    if (channels.some((c) => Math.abs(c[i]) > threshold)) return i + 1
  }
  return Math.min(minimum, frames)
}
