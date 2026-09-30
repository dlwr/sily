import { all, get, newId, put, remove, type StoredAudio } from './db'

export type ProjectDoc = {
  id: string
  name: string
  version: number
  updatedAt: number
  sourceId: string | null
  sourceName: string | null
  state: Record<string, unknown>
}

export type SourceAudio = { left: Float32Array; right: Float32Array; sampleRate: number }

export const saveSource = async (left: Float32Array, right: Float32Array, sampleRate: number): Promise<string> => {
  const id = newId()
  await put<StoredAudio>('audio', { id, left, right, sampleRate })
  return id
}

export const saveProject = async (doc: ProjectDoc) => {
  await put<ProjectDoc>('projects', { ...doc, updatedAt: Date.now() })
}

export const listProjects = async (): Promise<ProjectDoc[]> =>
  (await all<ProjectDoc>('projects')).sort((a, b) => b.updatedAt - a.updatedAt)

export const loadProject = async (id: string): Promise<{ doc: ProjectDoc; source: SourceAudio | null } | null> => {
  const doc = await get<ProjectDoc>('projects', id)
  if (!doc) return null
  const audio = doc.sourceId ? await get<StoredAudio>('audio', doc.sourceId) : null
  return { doc, source: audio ? { left: audio.left, right: audio.right, sampleRate: audio.sampleRate } : null }
}

export const renameProject = async (id: string, name: string) => {
  const doc = await get<ProjectDoc>('projects', id)
  if (doc) await put<ProjectDoc>('projects', { ...doc, name })
}

export const deleteProject = async (id: string) => {
  const doc = await get<ProjectDoc>('projects', id)
  if (!doc) return
  await remove('projects', id)
  if (doc.sourceId) await remove('audio', doc.sourceId)
}
