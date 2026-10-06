import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SampleMeta } from './library'

export type Audio = { left: Float32Array; right: Float32Array }

export type BundleSource = { name: string; sampleRate: number } & Audio

export type Bundle = {
  project: { name: string; state: Record<string, unknown> }
  sources: (BundleSource | null)[]
  samples: ({ meta: SampleMeta } & Audio)[]
}

type SourceMeta = { name: string; sampleRate: number; frames: number }

type Manifest = {
  format: 'sily'
  project: Bundle['project']
  samples: SampleMeta[]
} & ({ version: 1; source: SourceMeta | null } | { version: 2; sources: (SourceMeta | null)[] })

const MANIFEST = 'project.json'

const encode = ({ left, right }: Audio): Uint8Array => {
  const out = new Float32Array(left.length + right.length)
  out.set(left)
  out.set(right, left.length)
  return new Uint8Array(out.buffer)
}

const decode = (bytes: Uint8Array, frames: number): Audio => {
  const all = new Float32Array(bytes.slice().buffer)
  return { left: all.slice(0, frames), right: all.slice(frames, frames * 2) }
}

export const pack = (bundle: Bundle): Uint8Array => {
  const manifest: Manifest = {
    format: 'sily',
    version: 2,
    project: bundle.project,
    sources: bundle.sources.map((s) => s && { name: s.name, sampleRate: s.sampleRate, frames: s.left.length }),
    samples: bundle.samples.map((s) => s.meta),
  }
  const files: Record<string, Uint8Array> = { [MANIFEST]: strToU8(JSON.stringify(manifest)) }
  bundle.sources.forEach((s, i) => {
    if (s) files[`sources/${i}.f32`] = encode(s)
  })
  for (const s of bundle.samples) files[`samples/${s.meta.id}.f32`] = encode(s)
  return zipSync(files, { level: 6 })
}

export const unpack = (bytes: Uint8Array): Bundle => {
  const files = unzipSync(bytes)
  const manifest = JSON.parse(strFromU8(files[MANIFEST] ?? new Uint8Array())) as Manifest
  if (manifest.format !== 'sily') throw new Error('not a sily project')
  const source = (meta: SourceMeta | null, file: string): BundleSource | null =>
    meta && { name: meta.name, sampleRate: meta.sampleRate, ...decode(files[file], meta.frames) }
  return {
    project: manifest.project,
    sources:
      manifest.version === 1
        ? manifest.source
          ? [source(manifest.source, 'source.f32')]
          : []
        : manifest.sources.map((meta, i) => source(meta, `sources/${i}.f32`)),
    samples: manifest.samples.map((meta) => ({ meta, ...decode(files[`samples/${meta.id}.f32`], meta.frames) })),
  }
}

type PadRef = { sample?: { id: string } | null }

export const withFreshSampleIds = (bundle: Bundle, newId: () => string): Bundle => {
  const ids = new Map(bundle.samples.map((s) => [s.meta.id, newId()]))
  const pads = bundle.project.state.pads as PadRef[] | undefined
  return {
    ...bundle,
    project: {
      ...bundle.project,
      state: {
        ...bundle.project.state,
        pads: pads?.map((p) => (p.sample && ids.has(p.sample.id) ? { ...p, sample: { ...p.sample, id: ids.get(p.sample.id)! } } : p)),
      },
    },
    samples: bundle.samples.map((s) => ({ ...s, meta: { ...s.meta, id: ids.get(s.meta.id)! } })),
  }
}
