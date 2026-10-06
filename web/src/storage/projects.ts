import { all, get, newId, put, remove, type StoredAudio } from './db'

export type ProjectDoc = {
  id: string
  name: string
  version: number
  updatedAt: number
  sources: SourceRef[]
  state: Record<string, unknown>
}

type SourceRef = { id: string; name: string } | null

type LegacyDoc = { sources?: SourceRef[]; sourceId?: string | null; sourceName?: string | null }

export type SourceAudio = { id: string; name: string; left: Float32Array; right: Float32Array; sampleRate: number }

const sourcesOf = (doc: LegacyDoc): SourceRef[] =>
  doc.sources ?? (doc.sourceId ? [{ id: doc.sourceId, name: doc.sourceName ?? 'source' }] : [])

export const saveSource = async (left: Float32Array, right: Float32Array, sampleRate: number): Promise<string> => {
  const id = newId()
  await put<StoredAudio>('audio', { id, left, right, sampleRate })
  return id
}

export const deleteSource = async (id: string) => {
  await remove('audio', id)
}

export const saveProject = async (doc: ProjectDoc) => {
  await put<ProjectDoc>('projects', { ...doc, updatedAt: Date.now() })
}

export const listProjects = async (): Promise<ProjectDoc[]> =>
  (await all<ProjectDoc>('projects')).sort((a, b) => b.updatedAt - a.updatedAt)

export const loadProject = async (id: string): Promise<{ doc: ProjectDoc; sources: (SourceAudio | null)[] } | null> => {
  const stored = await get<ProjectDoc>('projects', id)
  if (!stored) return null
  const doc = { ...stored, sources: sourcesOf(stored) }
  const sources = await Promise.all(
    doc.sources.map(async (ref) => {
      const audio = ref && (await get<StoredAudio>('audio', ref.id))
      return audio ? { id: audio.id, name: ref!.name, left: audio.left, right: audio.right, sampleRate: audio.sampleRate } : null
    }),
  )
  return { doc, sources }
}

export const renameProject = async (id: string, name: string) => {
  const doc = await get<ProjectDoc>('projects', id)
  if (doc) await put<ProjectDoc>('projects', { ...doc, name })
}

export const deleteProject = async (id: string) => {
  const doc = await get<ProjectDoc>('projects', id)
  if (!doc) return
  await remove('projects', id)
  for (const ref of sourcesOf(doc)) if (ref) await remove('audio', ref.id)
}
