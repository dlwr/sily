import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { pack, unpack, withFreshSampleIds, type Bundle } from './bundle'

const bundle: Bundle = {
  project: { name: 'beat', state: { bpm: 92, markers: [0, 100] } },
  sources: [
    { name: 'break.wav', sampleRate: 44100, left: new Float32Array([0.1, -0.2]), right: new Float32Array([0.3, -0.4]) },
    null,
    { name: 'bass.wav', sampleRate: 48000, left: new Float32Array([0.5]), right: new Float32Array([-0.5]) },
  ],
  samples: [
    {
      meta: { id: 's1', name: 'kick', category: 'kick', sampleRate: 48000, frames: 3, createdAt: 1, settings: { pitch: 2 } },
      left: new Float32Array([1, 0, -1]),
      right: new Float32Array([0.5, 0, -0.5]),
    },
  ],
}

describe('bundle', () => {
  it('round-trips the project state', () => {
    expect(unpack(pack(bundle)).project).toEqual(bundle.project)
  })

  it('round-trips the source audio', () => {
    const source = unpack(pack(bundle)).sources[0]!
    expect([source.name, source.sampleRate, Array.from(source.left), Array.from(source.right)]).toEqual([
      'break.wav',
      44100,
      Array.from(bundle.sources[0]!.left),
      Array.from(bundle.sources[0]!.right),
    ])
  })

  it('keeps each source in its bank', () => {
    expect(unpack(pack(bundle)).sources.map((s) => s?.name ?? null)).toEqual(['break.wav', null, 'bass.wav'])
  })

  it('reads a project packed with a single source', () => {
    const manifest = {
      format: 'sily',
      version: 1,
      project: { name: 'old', state: {} },
      source: { name: 'old.wav', sampleRate: 44100, frames: 1 },
      samples: [],
    }
    const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(manifest)), 'source.f32': new Uint8Array(new Float32Array([0.25, -0.25]).buffer) })
    const [source] = unpack(bytes).sources
    expect([source?.name, Array.from(source!.left), Array.from(source!.right)]).toEqual(['old.wav', [0.25], [-0.25]])
  })

  it('reads a single-source project without audio as having no sources', () => {
    const manifest = { format: 'sily', version: 1, project: { name: 'old', state: {} }, source: null, samples: [] }
    expect(unpack(zipSync({ 'project.json': strToU8(JSON.stringify(manifest)) })).sources).toEqual([])
  })

  it('round-trips library samples', () => {
    const [s] = unpack(pack(bundle)).samples
    expect([s.meta, Array.from(s.right)]).toEqual([bundle.samples[0].meta, [0.5, 0, -0.5]])
  })

  it('keeps a project without sources empty', () => {
    expect(unpack(pack({ ...bundle, sources: [] })).sources).toEqual([])
  })

  it('rejects files that are not sily projects', () => {
    expect(() => unpack(new Uint8Array([1, 2, 3]))).toThrow()
  })
})

describe('withFreshSampleIds', () => {
  const ids = () => {
    let n = 0
    return () => `new${++n}`
  }
  const withPad = { ...bundle, project: { name: 'beat', state: { pads: [{ sample: { id: 's1', name: 'kick', category: 'kick' } }, { sample: null }] } } }

  it('gives each sample a new id', () => {
    expect(withFreshSampleIds(withPad, ids()).samples[0].meta.id).toBe('new1')
  })

  it('points the pads at the new ids', () => {
    const pads = withFreshSampleIds(withPad, ids()).project.state.pads as { sample: { id: string } | null }[]
    expect(pads.map((p) => p.sample?.id ?? null)).toEqual(['new1', null])
  })
})
