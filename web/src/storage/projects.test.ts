import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { openStore } from './db'
import { deleteProject, listProjects, loadProject, renameProject, saveProject, saveSource, type ProjectDoc } from './projects'

const doc = (id: string, name = id, ...sourceIds: (string | null)[]): ProjectDoc => ({
  id,
  name,
  version: 1,
  updatedAt: 0,
  sources: sourceIds.map((sourceId) => (sourceId ? { id: sourceId, name: 'break.wav' } : null)),
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
    expect([loaded!.doc.state, Array.from(loaded!.sources[0]!.right)]).toEqual([{ bpm: 90 }, [0.30000001192092896, 0.4000000059604645]])
  })

  it('loads the source of each bank in place', async () => {
    const first = await saveSource(new Float32Array([0.1]), new Float32Array([0.1]), 44100)
    const third = await saveSource(new Float32Array([0.5]), new Float32Array([0.5]), 48000)
    await saveProject(doc('a', 'a', first, null, third))
    const loaded = await loadProject('a')
    expect(loaded!.sources.map((s) => s?.sampleRate ?? null)).toEqual([44100, null, 48000])
  })

  it('loads a project saved with a single source', async () => {
    const sourceId = await saveSource(new Float32Array([0.1]), new Float32Array([0.1]), 44100)
    const { sources: _, ...rest } = doc('a')
    await saveProject({ ...rest, sourceId, sourceName: 'old.wav' } as unknown as ProjectDoc)
    const [source] = (await loadProject('a'))!.sources
    expect([source?.id, source?.name]).toEqual([sourceId, 'old.wav'])
  })

  it('loads a project without a source', async () => {
    await saveProject(doc('a'))
    expect((await loadProject('a'))!.sources).toEqual([])
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

  it('deletes the source audio of every bank', async () => {
    const first = await saveSource(new Float32Array([0.1]), new Float32Array([0.1]), 44100)
    const second = await saveSource(new Float32Array([0.2]), new Float32Array([0.2]), 44100)
    await saveProject(doc('a', 'a', first, second))
    await saveProject(doc('b', 'b', first, second))
    await deleteProject('a')
    expect((await loadProject('b'))!.sources).toEqual([null, null])
  })
})
