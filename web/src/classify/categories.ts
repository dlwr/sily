export const CATEGORIES = [
  'kick',
  'snare',
  'clap',
  'rim',
  'closed_hat',
  'open_hat',
  'tom',
  'cymbal',
  'perc',
  'bass',
  'keys',
  'vocal',
  'melody',
  'fx',
  'upper',
] as const

export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  kick: 'キック',
  snare: 'スネア',
  clap: 'クラップ',
  rim: 'リム',
  closed_hat: 'ハット閉',
  open_hat: 'ハット開',
  tom: 'タム',
  cymbal: 'シンバル',
  perc: 'パーカッション',
  bass: 'ベース',
  keys: 'キー',
  vocal: 'ボーカル',
  melody: 'メロディ',
  fx: 'FX',
  upper: 'うわもの',
}

const KIT_ORDER: Category[] = [
  'kick',
  'snare',
  'clap',
  'rim',
  'closed_hat',
  'open_hat',
  'tom',
  'cymbal',
  'perc',
  'bass',
  'keys',
  'melody',
  'vocal',
  'upper',
  'fx',
]

export const arrangePads = (padSlices: number[], label: (slice: number) => Category | null): number[] => {
  const rank = (slice: number) => {
    const category = label(slice)
    return category === null ? KIT_ORDER.length : KIT_ORDER.indexOf(category)
  }
  return padSlices
    .map((slice, pad) => ({ slice, pad }))
    .sort((a, b) => rank(a.slice) - rank(b.slice) || a.pad - b.pad)
    .map(({ slice }) => slice)
}

export const remapEvents = <E extends { pad: number }>(events: E[], before: number[], after: number[]): E[] =>
  events.map((e) => {
    if (e.pad >= before.length) return e
    const pad = after.indexOf(before[e.pad])
    return pad < 0 ? e : { ...e, pad }
  })
