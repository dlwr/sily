import { describe, expect, it } from 'vitest'
import { noteOff, noteOn, padForMidiNote, semitonesForMidiNote } from './midi'

describe('noteOn', () => {
  it('reads the note and velocity of a note-on on any channel', () => {
    expect(noteOn(new Uint8Array([0x99, 36, 127]))).toEqual({ note: 36, velocity: 1 })
  })

  it('scales the velocity to 0-1', () => {
    expect(noteOn(new Uint8Array([0x90, 60, 64]))?.velocity).toBeCloseTo(64 / 127)
  })

  it('treats a note-on with zero velocity as a release', () => {
    expect(noteOn(new Uint8Array([0x90, 60, 0]))).toBeNull()
  })

  it('ignores note-offs', () => {
    expect(noteOn(new Uint8Array([0x80, 60, 64]))).toBeNull()
  })

  it('ignores other messages', () => {
    expect(noteOn(new Uint8Array([0xb0, 1, 64]))).toBeNull()
  })

  it('ignores truncated messages', () => {
    expect(noteOn(new Uint8Array([0x90, 60]))).toBeNull()
  })
})

describe('noteOff', () => {
  it('reads the note of a note-off on any channel', () => {
    expect(noteOff(new Uint8Array([0x89, 36, 64]))).toBe(36)
  })

  it('reads a note-on with zero velocity as a note-off', () => {
    expect(noteOff(new Uint8Array([0x90, 60, 0]))).toBe(60)
  })

  it('ignores a sounding note-on', () => {
    expect(noteOff(new Uint8Array([0x90, 60, 1]))).toBeNull()
  })

  it('ignores truncated messages', () => {
    expect(noteOff(new Uint8Array([0x80, 60]))).toBeNull()
  })
})

describe('padForMidiNote', () => {
  it('maps 36 to the first pad like an MPC bank A', () => {
    expect(padForMidiNote(36)).toBe(0)
  })

  it('maps 51 to the last pad', () => {
    expect(padForMidiNote(51)).toBe(15)
  })

  it('ignores notes outside the bank', () => {
    expect([35, 52].map(padForMidiNote)).toEqual([undefined, undefined])
  })
})

describe('semitonesForMidiNote', () => {
  it('plays middle C at the original pitch', () => {
    expect(semitonesForMidiNote(60)).toBe(0)
  })

  it('counts semitones from middle C', () => {
    expect([48, 67].map(semitonesForMidiNote)).toEqual([-12, 7])
  })
})
