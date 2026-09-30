import { describe, expect, it } from 'vitest'
import { encodeWav24, soundingLength } from './wav'

const view = (buf: ArrayBuffer) => new DataView(buf)
const text = (buf: ArrayBuffer, at: number) => String.fromCharCode(...new Uint8Array(buf, at, 4))
const int24 = (v: DataView, at: number) => (v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16))

describe('encodeWav24', () => {
  const left = new Float32Array([0, 1, -1])
  const right = new Float32Array([0.5, 2, -0.5])
  const wav = encodeWav24(left, right, 48000)

  it('writes a RIFF WAVE header', () => {
    expect([text(wav, 0), text(wav, 8), text(wav, 12), text(wav, 36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
  })

  it('declares 2 channels of 24-bit audio at the given rate', () => {
    const v = view(wav)
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([2, 48000, 24])
  })

  it('sizes the data chunk for 3 bytes per sample', () => {
    expect(view(wav).getUint32(40, true)).toBe(3 * 2 * 3)
  })

  it('interleaves channels', () => {
    expect(int24(view(wav), 47)).toBe(Math.round(0.5 * 8388607))
  })

  it('clamps samples beyond full scale', () => {
    expect(int24(view(wav), 44 + 6 * 1 + 3)).toBe(8388607)
  })

  it('reaches the negative extreme', () => {
    expect(int24(view(wav), 44 + 6 * 2)).toBe(-8388607)
  })
})

describe('soundingLength', () => {
  it('drops silence after the last audible sample', () => {
    const l = new Float32Array([0.5, 0.2, 0, 0, 0])
    expect(soundingLength([l, l], 2, 1e-4)).toBe(2)
  })

  it('never cuts below the minimum length', () => {
    const l = new Float32Array([0.5, 0, 0, 0, 0])
    expect(soundingLength([l, l], 3, 1e-4)).toBe(3)
  })

  it('keeps sound on either channel', () => {
    const l = new Float32Array([0, 0, 0, 0])
    const r = new Float32Array([0, 0, 0.3, 0])
    expect(soundingLength([l, r], 1, 1e-4)).toBe(3)
  })
})
