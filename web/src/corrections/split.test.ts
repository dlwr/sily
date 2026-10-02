import { describe, expect, it } from 'vitest'
import { chooseSplit, splitFor } from './split'

describe('splitFor', () => {
  it('holds out a recording whose hash falls in the first fifth', () => {
    expect(splitFor('00000005' + 'f'.repeat(56))).toBe('eval')
  })

  it('trains on the other recordings', () => {
    expect(splitFor('00000001' + '0'.repeat(56))).toBe('train')
  })

  it('holds out about a fifth of recordings', () => {
    const hashes = Array.from({ length: 1000 }, (_, i) => (i * 2654435761 >>> 0).toString(16).padStart(8, '0'))
    const held = hashes.filter((h) => splitFor(h) === 'eval').length
    expect(held).toBeGreaterThan(150)
    expect(held).toBeLessThan(250)
  })
})

describe('chooseSplit', () => {
  it('holds out a recording marked for evaluation even if its hash would train', () => {
    expect(chooseSplit('train', true)).toBe('eval')
  })

  it('follows the hash when the recording is not marked', () => {
    expect([chooseSplit('train', false), chooseSplit('eval', false)]).toEqual(['train', 'eval'])
  })
})
