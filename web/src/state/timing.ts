export type OutputTimestamp = { contextTime?: number; performanceTime?: number }
export type RenderClock = { currentTime: number; now: number; latency: number }

const TRUSTED_WINDOW = 0.5

export const audibleTime = (timeStamp: number, output: OutputTimestamp, clock: RenderClock): number => {
  const fallback = clock.currentTime - clock.latency + (timeStamp - clock.now) / 1000
  if (!output.performanceTime || !output.contextTime) return fallback
  const measured = output.contextTime + (timeStamp - output.performanceTime) / 1000
  return measured <= clock.currentTime && measured >= clock.currentTime - TRUSTED_WINDOW ? measured : fallback
}

export const frameAt = (
  tick: { frame: number; time: number },
  time: number,
  sampleRate: number,
  limit = Number.POSITIVE_INFINITY,
): number => Math.max(0, Math.min(limit, Math.round(tick.frame + (time - tick.time) * sampleRate)))
