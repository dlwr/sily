import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteSample, importSample, listSamples, loadSample, openStore, saveSample, type NewSample } from './library'

const sample = (name: string, value = 0.5): NewSample => ({
  name,
  category: 'kick',
  sampleRate: 44100,
  left: new Float32Array([value, value]),
  right: new Float32Array([value, -value]),
  settings: { pitch: 2 },
})

beforeEach(async () => {
  indexedDB = new IDBFactory()
  await openStore()
})

describe('sample library', () => {
  it('lists saved samples newest first', async () => {
    await saveSample(sample('a'))
    await new Promise((r) => setTimeout(r, 5))
    await saveSample(sample('b'))
    await new Promise((r) => setTimeout(r, 5))
    await saveSample(sample('c'))
    expect((await listSamples()).map((s) => s.name)).toEqual(['c', 'b', 'a'])
  })

  it('returns the audio of a saved sample', async () => {
    const id = await saveSample(sample('a', 0.25))
    const loaded = await loadSample(id)
    expect([Array.from(loaded!.left), Array.from(loaded!.right)]).toEqual([
      [0.25, 0.25],
      [0.25, -0.25],
    ])
  })

  it('keeps the pad settings with the sample', async () => {
    const id = await saveSample(sample('a'))
    expect((await loadSample(id))!.meta.settings).toEqual({ pitch: 2 })
  })

  it('forgets a deleted sample', async () => {
    const id = await saveSample(sample('a'))
    await deleteSample(id)
    expect([await listSamples(), await loadSample(id)]).toEqual([[], null])
  })
  it('imports a sample under its original id', async () => {
    const meta = { id: 'fixed', name: 'x', category: 'kick', sampleRate: 44100, frames: 1, createdAt: 5, settings: {} }
    await importSample({ meta, left: new Float32Array([0.5]), right: new Float32Array([0.5]) })
    expect((await loadSample('fixed'))!.meta.name).toBe('x')
  })
})
