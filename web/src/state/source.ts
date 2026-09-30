export type SourceSpeed = { mode: 'tape' | 'stretch'; rate: number }

export const rateToSemitones = (rate: number): number => 12 * Math.log2(rate)

export const rateForBpm = (projectBpm: number, sourceBpm: number): number => projectBpm / sourceBpm

export class SourceMap {
  constructor(
    readonly sourceFrames: number,
    readonly engineFrames: number,
  ) {}

  private get scale() {
    return this.engineFrames / this.sourceFrames
  }

  toEngine(frame: number): number {
    return Math.round(frame * this.scale)
  }

  fromEngine(frame: number): number {
    return Math.round(frame / this.scale)
  }
}
