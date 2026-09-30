import type { Category } from '../classify/categories'

export type FxSettings = {
  highpass_hz: number
  lowpass_hz: number
  low_db: number
  mid_db: number
  mid_hz: number
  high_db: number
  drive_db: number
  ceiling_db: number
}

export const DEFAULT_FX: FxSettings = {
  highpass_hz: 0,
  lowpass_hz: 0,
  low_db: 0,
  mid_db: 0,
  mid_hz: 1000,
  high_db: 0,
  drive_db: 0,
  ceiling_db: -0.3,
}

type Preset = { name: string; for: Category[] | 'all'; settings: Partial<FxSettings> }

const HATS: Category[] = ['closed_hat', 'open_hat', 'cymbal']
const UPPER: Category[] = ['keys', 'melody', 'vocal', 'upper', 'fx']

const PRESETS: Preset[] = [
  { name: 'キックを太く', for: ['kick'], settings: { low_db: 6, mid_db: -3, mid_hz: 350, drive_db: 6 } },
  { name: 'キックを締める', for: ['kick'], settings: { highpass_hz: 30, low_db: 3, mid_db: -5, mid_hz: 400, high_db: 3 } },
  { name: 'スネアを抜けさせる', for: ['snare', 'clap', 'rim'], settings: { highpass_hz: 90, mid_db: 3, mid_hz: 2500, high_db: 3, drive_db: 4 } },
  { name: 'スネアを太く', for: ['snare', 'clap'], settings: { mid_db: 4, mid_hz: 220, drive_db: 6 } },
  { name: 'ハットを明るく', for: HATS, settings: { highpass_hz: 400, high_db: 5 } },
  { name: 'ハットを柔らかく', for: HATS, settings: { highpass_hz: 300, lowpass_hz: 9000, high_db: -3 } },
  { name: 'パーカッションを前に', for: ['perc', 'tom', 'rim'], settings: { highpass_hz: 120, mid_db: 3, mid_hz: 1500, drive_db: 4 } },
  { name: 'ベースを太く', for: ['bass'], settings: { low_db: 5, lowpass_hz: 4000, drive_db: 4 } },
  { name: 'うわものを馴染ませる', for: UPPER, settings: { highpass_hz: 150, lowpass_hz: 9000, mid_db: -2, mid_hz: 400 } },
  { name: 'ローファイ', for: 'all', settings: { highpass_hz: 120, lowpass_hz: 4500, drive_db: 8 } },
  { name: '潰す', for: 'all', settings: { drive_db: 18, ceiling_db: -1 } },
]

export const presetsFor = (category: Category | undefined): { name: string; settings: FxSettings }[] => [
  { name: 'リセット', settings: DEFAULT_FX },
  ...PRESETS.filter((p) => p.for === 'all' || (category !== undefined && p.for.includes(category))).map((p) => ({
    name: p.name,
    settings: { ...DEFAULT_FX, ...p.settings },
  })),
]

export const isFlat = (fx: FxSettings): boolean =>
  fx.highpass_hz === 0 && fx.lowpass_hz === 0 && fx.low_db === 0 && fx.mid_db === 0 && fx.high_db === 0 && fx.drive_db === 0
