import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore } from './db'
import { deleteProject, listProjects, loadProject, renameProject, saveProject, saveSource, type ProjectDoc } from './projects'

const doc = (id: string, name = id, sourceId: string | null = null): ProjectDoc => ({
  id,
  name,
  version: 1,
  updatedAt: 0,
  sourceId,
  sourceName: sourceId ? 'break.wav' : null,
  state: { bpm: 90 },
})

const tick = () => new Promise((r) => setTimeout(r, 5))

beforeEach(async () => {
  indexedDB = new IDBFactory()
  await openStore()
})

describe('projects', () => {
  it('lists projects by last update, newest first', async () => {
    await saveProject(doc('a'))
    await tick()
    await saveProject(doc('b'))
    await tick()
    await saveProject(doc('c'))
    await tick()
    await saveProject(doc('a'))
    expect((await listProjects()).map((p) => p.id)).toEqual(['a', 'c', 'b'])
  })

  it('loads a project with its source audio', async () => {
    const sourceId = await saveSource(new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4]), 44100)
    await saveProject(doc('a', 'a', sourceId))
    const loaded = await loadProject('a')
    expect([loaded!.doc.state, Array.from(loaded!.source!.right)]).toEqual([{ bpm: 90 }, [0.30000001192092896, 0.4000000059604645]])
  })

  it('loads a project without a source', async () => {
    await saveProject(doc('a'))
    expect((await loadProject('a'))!.source).toBeNull()
  })

  it('renames a project', async () => {
    await saveProject(doc('a', 'old'))
    await renameProject('a', 'new')
    expect((await listProjects())[0].name).toBe('new')
  })

  it('deletes a project and its source audio', async () => {
    const sourceId = await saveSource(new Float32Array([0.1]), new Float32Array([0.1]), 44100)
    await saveProject(doc('a', 'a', sourceId))
    await deleteProject('a')
    expect([await listProjects(), await loadProject('a')]).toEqual([[], null])
  })
})
