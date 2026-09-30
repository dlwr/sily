import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { SampleMeta } from './library'

export type Audio = { left: Float32Array; right: Float32Array }

export type Bundle = {
  project: { name: string; state: Record<string, unknown> }
  source: ({ name: string; sampleRate: number } & Audio) | null
  samples: ({ meta: SampleMeta } & Audio)[]
}

type Manifest = {
  format: 'sily'
  version: 1
  project: Bundle['project']
  source: { name: string; sampleRate: number; frames: number } | null
  samples: SampleMeta[]
}

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
    version: 1,
    project: bundle.project,
    source: bundle.source && { name: bundle.source.name, sampleRate: bundle.source.sampleRate, frames: bundle.source.left.length },
    samples: bundle.samples.map((s) => s.meta),
  }
  const files: Record<string, Uint8Array> = { [MANIFEST]: strToU8(JSON.stringify(manifest)) }
  if (bundle.source) files['source.f32'] = encode(bundle.source)
  for (const s of bundle.samples) files[`samples/${s.meta.id}.f32`] = encode(s)
  return zipSync(files, { level: 6 })
}

export const unpack = (bytes: Uint8Array): Bundle => {
  const files = unzipSync(bytes)
  const manifest = JSON.parse(strFromU8(files[MANIFEST] ?? new Uint8Array())) as Manifest
  if (manifest.format !== 'sily') throw new Error('not a sily project')
  return {
    project: manifest.project,
    source: manifest.source && {
      name: manifest.source.name,
      sampleRate: manifest.source.sampleRate,
      ...decode(files['source.f32'], manifest.source.frames),
    },
    samples: manifest.samples.map((meta) => ({ meta, ...decode(files[`samples/${meta.id}.f32`], meta.frames) })),
  }
}
