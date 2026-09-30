export type ToWorklet =
  | { type: 'load'; left: Float32Array; right: Float32Array }
  | { type: 'markers'; frames: number[] }
  | { type: 'pad'; pad: number; pitch: number; gain: number }
  | { type: 'stretched'; pad: number; left: Float32Array | null; right: Float32Array | null }
  | { type: 'trigger'; pad: number; velocity: number }
  | { type: 'note'; slice: number; semitones: number; velocity: number }
  | { type: 'audition'; from: number | null }
  | { type: 'transport'; bpm: number; playing: boolean; metronome: boolean; lengthBeats: number }
  | { type: 'groove'; grid: number; strength: number; swing: number }
  | { type: 'events'; events: { beat: number; pad: number; velocity: number; nudge: number }[] }
  | { type: 'record'; pad: number; velocity: number; time: number }

export type FromWorklet =
  | { type: 'tick'; beat: number; auditionFrame: number | null; time: number }
  | { type: 'recorded'; pad: number; velocity: number; beat: number }
