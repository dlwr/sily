import { describe, expect, it } from 'vitest'
import { noteForCode, padForCode } from './keymap'

describe('padForCode', () => {
  it('maps the bottom row to pads 1-4 like an MPC', () => {
    expect(['KeyZ', 'KeyX', 'KeyC', 'KeyV'].map(padForCode)).toEqual([0, 1, 2, 3])
  })

  it('maps the number row to the top pads', () => {
    expect(['Digit1', 'Digit4'].map(padForCode)).toEqual([12, 15])
  })

  it('ignores keys outside the grid', () => {
    expect(padForCode('KeyM')).toBeUndefined()
  })
})

describe('noteForCode', () => {
  it('maps the home row to white keys', () => {
    expect(['KeyA', 'KeyS', 'KeyD', 'KeyF'].map(noteForCode)).toEqual([0, 2, 4, 5])
  })

  it('maps the upper row to black keys', () => {
    expect(['KeyW', 'KeyE', 'KeyT'].map(noteForCode)).toEqual([1, 3, 6])
  })

  it('ignores keys that are not notes', () => {
    expect(noteForCode('KeyR')).toBeUndefined()
  })
})
