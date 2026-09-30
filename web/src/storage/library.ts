import { all, get, newId, put, remove, type StoredAudio } from './db'

export { openStore } from './db'

export type NewSample = {
  name: string
  category: string
  sampleRate: number
  left: Float32Array
  right: Float32Array
  settings: Record<string, unknown>
}

export type SampleMeta = {
  id: string
  name: string
  category: string
  sampleRate: number
  frames: number
  createdAt: number
  settings: Record<string, unknown>
}

export const saveSample = async (sample: NewSample): Promise<string> => {
  const id = newId()
  await put<StoredAudio>('audio', { id, left: sample.left, right: sample.right, sampleRate: sample.sampleRate })
  await put<SampleMeta>('samples', {
    id,
    name: sample.name,
    category: sample.category,
    sampleRate: sample.sampleRate,
    frames: sample.left.length,
    createdAt: Date.now(),
    settings: sample.settings,
  })
  return id
}

export const listSamples = async (): Promise<SampleMeta[]> =>
  (await all<SampleMeta>('samples')).sort((a, b) => b.createdAt - a.createdAt)

export const loadSample = async (
  id: string,
): Promise<{ meta: SampleMeta; left: Float32Array; right: Float32Array } | null> => {
  const [meta, audio] = await Promise.all([get<SampleMeta>('samples', id), get<StoredAudio>('audio', id)])
  return meta && audio ? { meta, left: audio.left, right: audio.right } : null
}

export const deleteSample = async (id: string) => {
  await Promise.all([remove('samples', id), remove('audio', id)])
}
