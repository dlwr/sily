import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileStore } from './corrections-sink'

const id = 'a'.repeat(64)
const audio = new Uint8Array([1, 2, 3]).buffer
const dirs = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sily-'))
  return { train: join(root, 'train'), eval: join(root, 'eval') }
}

describe('fileStore', () => {
  it('writes the audio into the folder for its label', async () => {
    const d = await dirs()
    await fileStore(d).save(id, 'kick', 'train', audio)
    expect([...(await readFile(join(d.train, 'kick', `${id}.wav`)))]).toEqual([1, 2, 3])
  })

  it('writes held-out audio into the eval folder', async () => {
    const d = await dirs()
    await fileStore(d).save(id, 'kick', 'eval', audio)
    expect(await readdir(join(d.eval, 'kick'))).toEqual([`${id}.wav`])
  })

  it('moves the audio when it is labelled again', async () => {
    const d = await dirs()
    await fileStore(d).save(id, 'kick', 'train', audio)
    await fileStore(d).save(id, 'snare', 'train', audio)
    expect(await readdir(join(d.train, 'kick'))).toEqual([])
  })

  it('keeps the audio under the new label', async () => {
    const d = await dirs()
    await fileStore(d).save(id, 'kick', 'train', audio)
    await fileStore(d).save(id, 'snare', 'train', audio)
    expect(await readdir(join(d.train, 'snare'))).toEqual([`${id}.wav`])
  })

  it('ignores stray files next to the label folders', async () => {
    const d = await dirs()
    await fileStore(d).save(id, 'kick', 'train', audio)
    await writeFile(join(d.train, '.DS_Store'), '')
    await fileStore(d).save(id, 'snare', 'train', audio)
    expect(await readdir(join(d.train, 'snare'))).toEqual([`${id}.wav`])
  })
})
