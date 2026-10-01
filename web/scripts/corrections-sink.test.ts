import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { saveCorrections } from './corrections-sink'

const target = async () => join(await mkdtemp(join(tmpdir(), 'sily-')), 'nested', 'corrections.json')

describe('saveCorrections', () => {
  it('writes the posted corrections to the file', async () => {
    const file = await target()
    const corrections = [{ features: [0.1, 0.2], label: 'kick' }]
    await saveCorrections(JSON.stringify(corrections), file)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(corrections)
  })

  it('replaces what was written before', async () => {
    const file = await target()
    await saveCorrections(JSON.stringify([{ features: [1], label: 'kick' }]), file)
    await saveCorrections(JSON.stringify([{ features: [2], label: 'snare' }]), file)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([{ features: [2], label: 'snare' }])
  })

  it('rejects a body that is not a list of corrections', async () => {
    const file = await target()
    await expect(saveCorrections(JSON.stringify([{ features: 'x', label: 'kick' }]), file)).rejects.toThrow()
  })
})
