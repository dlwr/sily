import { describe, expect, it } from 'vitest'
import { isSilent } from './level'

describe('isSilent', () => {
  it('hears nothing in a recording of zeros', () => {
    expect(isSilent([new Float32Array(1000), new Float32Array(1000)])).toBe(true)
  })

  it('treats a faint noise floor as silence', () => {
    expect(isSilent([new Float32Array(1000).fill(0.00005)])).toBe(true)
  })

  it('hears a sound in either channel', () => {
    const right = new Float32Array(1000)
    right[500] = 0.2
    expect(isSilent([new Float32Array(1000), right])).toBe(false)
  })
})
