import type { FxSettings } from '../fx/fx'

export type ToWorklet =
  | { type: 'fx'; pad: number | null; fx: FxSettings }
  | { type: 'load'; left: Float32Array; right: Float32Array }
  | { type: 'markers'; frames: number[] }
  | { type: 'padSlices'; slices: number[] }
  | { type: 'pad'; pad: number; pitch: number; gain: number; reverse: boolean; choke: number }
  | { type: 'stretched'; pad: number; pitch: number; left: Float32Array; right: Float32Array }
  | { type: 'clearStretched'; pad: number }
  | { type: 'sourceRate'; rate: number }
  | { type: 'trigger'; pad: number; velocity: number; pitch: number }
  | { type: 'note'; slice: number; semitones: number; velocity: number }
  | { type: 'audition'; from: number | null }
  | { type: 'transport'; bpm: number; playing: boolean; metronome: boolean; lengthBeats: number }
  | { type: 'playLimit'; beats: number | null }
  | { type: 'groove'; grid: number; strength: number; swing: number }
  | { type: 'events'; events: { beat: number; pad: number; velocity: number; nudge: number; pitch: number }[] }
  | { type: 'queueEvents'; events: { beat: number; pad: number; velocity: number; nudge: number; pitch: number }[] }
  | { type: 'record'; pad: number; velocity: number; pitch: number; time: number }

export type FromWorklet =
  | { type: 'tick'; beat: number; auditionFrame: number | null; time: number }
  | { type: 'recorded'; pad: number; velocity: number; pitch: number; beat: number }
