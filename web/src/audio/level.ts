const SILENCE = 1e-3

export const isSilent = (channels: Float32Array[]): boolean => channels.every((c) => c.every((x) => Math.abs(x) < SILENCE))
