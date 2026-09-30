import { describe, expect, it } from 'vitest'
import { pack, unpack, type Bundle } from './bundle'

const bundle: Bundle = {
  project: { name: 'beat', state: { bpm: 92, markers: [0, 100] } },
  source: { name: 'break.wav', sampleRate: 44100, left: new Float32Array([0.1, -0.2]), right: new Float32Array([0.3, -0.4]) },
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
    const source = unpack(pack(bundle)).source!
    expect([source.name, source.sampleRate, Array.from(source.left), Array.from(source.right)]).toEqual([
      'break.wav',
      44100,
      Array.from(bundle.source!.left),
      Array.from(bundle.source!.right),
    ])
  })

  it('round-trips library samples', () => {
    const [s] = unpack(pack(bundle)).samples
    expect([s.meta, Array.from(s.right)]).toEqual([bundle.samples[0].meta, [0.5, 0, -0.5]])
  })

  it('keeps an empty source empty', () => {
    expect(unpack(pack({ ...bundle, source: null })).source).toBeNull()
  })

  it('rejects files that are not sily projects', () => {
    expect(() => unpack(new Uint8Array([1, 2, 3]))).toThrow()
  })
})
