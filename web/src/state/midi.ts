const FIRST_PAD_NOTE = 36
const PADS = 16
const MIDDLE_C = 60

export const noteOn = (data: Uint8Array): { note: number; velocity: number } | null => {
  if (data.length < 3 || (data[0] & 0xf0) !== 0x90 || data[2] === 0) return null
  return { note: data[1], velocity: data[2] / 127 }
}

export const padForMidiNote = (note: number): number | undefined => {
  const pad = note - FIRST_PAD_NOTE
  return pad >= 0 && pad < PADS ? pad : undefined
}

export const semitonesForMidiNote = (note: number): number => note - MIDDLE_C
