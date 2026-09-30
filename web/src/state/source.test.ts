import { describe, expect, it } from 'vitest'
import { rateForBpm, rateToSemitones, SourceMap } from './source'

describe('rateToSemitones', () => {
  it('reads an octave from a doubled rate', () => {
    expect(rateToSemitones(2)).toBeCloseTo(12)
  })

  it('reads 45 to 33 rpm as about five semitones down', () => {
    expect(rateToSemitones(100 / 3 / 45)).toBeCloseTo(-5.2, 2)
  })
})

describe('rateForBpm', () => {
  it('speeds up a slower source to the project tempo', () => {
    expect(rateForBpm(90, 60)).toBeCloseTo(1.5)
  })
})

describe('SourceMap', () => {
  it('maps frames one to one at tape speed', () => {
    const map = new SourceMap(1000, 1000)
    expect(map.toEngine(400)).toBe(400)
  })

  it('scales frames into a stretched buffer', () => {
    const map = new SourceMap(1000, 2000)
    expect(map.toEngine(400)).toBe(800)
  })

  it('scales engine frames back to source frames', () => {
    const map = new SourceMap(1000, 2000)
    expect(map.fromEngine(801)).toBe(401)
  })
})
