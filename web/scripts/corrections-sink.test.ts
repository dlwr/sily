import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileStore } from './corrections-sink'

const id = 'a'.repeat(64)
const audio = new Uint8Array([1, 2, 3]).buffer

describe('fileStore', () => {
  it('writes the audio into the folder for its label', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sily-'))
    await fileStore(dir).save(id, 'kick', audio)
    expect([...(await readFile(join(dir, 'kick', `${id}.wav`)))]).toEqual([1, 2, 3])
  })

  it('moves the audio when it is labelled again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sily-'))
    await fileStore(dir).save(id, 'kick', audio)
    await fileStore(dir).save(id, 'snare', audio)
    expect(await readdir(join(dir, 'kick'))).toEqual([])
  })

  it('keeps the audio under the new label', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sily-'))
    await fileStore(dir).save(id, 'kick', audio)
    await fileStore(dir).save(id, 'snare', audio)
    expect(await readdir(join(dir, 'snare'))).toEqual([`${id}.wav`])
  })

  it('ignores stray files next to the label folders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sily-'))
    await writeFile(join(dir, '.DS_Store'), '')
    await fileStore(dir).save(id, 'kick', audio)
    expect(await readdir(join(dir, 'kick'))).toEqual([`${id}.wav`])
  })
})
