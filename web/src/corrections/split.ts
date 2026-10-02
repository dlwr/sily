export const SPLITS = ['train', 'eval'] as const
export type Split = (typeof SPLITS)[number]

const HELD_OUT_EVERY = 5

export const splitFor = (sourceHash: string): Split => (parseInt(sourceHash.slice(0, 8), 16) % HELD_OUT_EVERY === 0 ? 'eval' : 'train')
