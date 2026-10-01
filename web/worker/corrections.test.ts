import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/corrections/hash'
import { handleCorrections, type CorrectionStore } from './corrections'

const memoryStore = () => {
  const saved: { id: string; label: string; bytes: number }[] = []
  const store: CorrectionStore = {
    async save(id, label, audio) {
      saved.push({ id, label, bytes: audio.byteLength })
    },
  }
  return { store, saved }
}

const audio = new Uint8Array([1, 2, 3, 4]).buffer
const put = async (label: string, body: ArrayBuffer = audio, id?: string) =>
  new Request(`https://sily.test/api/corrections/${id ?? (await sha256Hex(body))}?label=${label}`, { method: 'PUT', body })

describe('handleCorrections', () => {
  it('saves the audio under its hash with the label', async () => {
    const { store, saved } = memoryStore()
    const res = await handleCorrections(await put('snare'), store)
    expect(res.status).toBe(204)
    expect(saved).toEqual([{ id: await sha256Hex(audio), label: 'snare', bytes: 4 }])
  })

  it('rejects a label that is not a category', async () => {
    const { store, saved } = memoryStore()
    const res = await handleCorrections(await put('banana'), store)
    expect(res.status).toBe(400)
    expect(saved).toEqual([])
  })

  it('rejects audio that does not match the id', async () => {
    const { store, saved } = memoryStore()
    const res = await handleCorrections(await put('kick', audio, 'a'.repeat(64)), store)
    expect(res.status).toBe(400)
    expect(saved).toEqual([])
  })

  it('rejects empty audio', async () => {
    const { store } = memoryStore()
    const res = await handleCorrections(await put('kick', new ArrayBuffer(0)), store)
    expect(res.status).toBe(400)
  })

  it('answers a session check', async () => {
    const { store } = memoryStore()
    const res = await handleCorrections(new Request('https://sily.test/api/corrections/session'), store)
    expect(res.status).toBe(204)
  })

  it('answers unknown paths with 404', async () => {
    const { store } = memoryStore()
    const res = await handleCorrections(new Request('https://sily.test/api/other'), store)
    expect(res.status).toBe(404)
  })
})
