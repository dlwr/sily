import type { Role } from '../classify/categories'

const PAD_ROWS = [
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR'],
  ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
]

const NOTES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL']

export const padKeyLabel = (pad: number): string => PAD_ROWS[Math.floor(pad / 4)][pad % 4].replace(/^(Key|Digit)/, '')

export const padForCode = (code: string): number | undefined => {
  const index = PAD_ROWS.flat().indexOf(code)
  return index < 0 ? undefined : index
}

export const noteForCode = (code: string): number | undefined => {
  const index = NOTES.indexOf(code)
  return index < 0 ? undefined : index
}

export const LABEL_KEYS: [string, Role][] = [
  ['KeyK', 'kick'],
  ['KeyS', 'snare'],
  ['KeyH', 'closed_hat'],
  ['KeyO', 'open_hat'],
  ['KeyE', 'perc'],
  ['KeyB', 'bass'],
  ['KeyU', 'upper'],
]

export const labelForCode = (code: string): Role | undefined => LABEL_KEYS.find(([key]) => key === code)?.[1]
