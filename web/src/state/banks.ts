import { MAX_SOURCES } from '../share/limits'
import type { Label } from './bank.svelte'
import type { SourceSpeed } from './source'

export const BANKS = MAX_SOURCES
export const BANK_PADS = 16
export const PADS = BANKS * BANK_PADS

export const bankOf = (pad: number) => Math.floor(pad / BANK_PADS)

export const BANK_NAMES = ['A', 'B', 'C', 'D']

export const padName = (pad: number) => `${BANK_NAMES[bankOf(pad)]}${(pad % BANK_PADS) + 1}`

export const bankForSource = (banks: { sample: unknown }[], focused: number): number => {
  if (!banks[focused].sample) return focused
  const empty = banks.findIndex((b) => !b.sample)
  return empty < 0 ? focused : empty
}

export const inBank = <T>(xs: T[], bank: number): T[] => xs.slice(bank * BANK_PADS, (bank + 1) * BANK_PADS)

export const withBank = <T>(xs: T[], bank: number, local: T[]): T[] => [
  ...xs.slice(0, bank * BANK_PADS),
  ...local,
  ...xs.slice((bank + 1) * BANK_PADS),
]

export const mapBankEvents = <E extends { pad: number }>(events: E[], bank: number, f: (local: E[]) => E[]): E[] => {
  const base = bank * BANK_PADS
  const local = events.filter((e) => bankOf(e.pad) === bank).map((e) => ({ ...e, pad: e.pad - base }))
  return [...events.filter((e) => bankOf(e.pad) !== bank), ...f(local).map((e) => ({ ...e, pad: e.pad + base }))]
}

export const extendToBanks = <T>(xs: T[] | undefined, fill: (pad: number) => T): T[] =>
  Array.from({ length: PADS }, (_, pad) => (xs && pad < xs.length ? xs[pad] : fill(pad)))

export type BankState = {
  markers: number[]
  labels: Record<number, Label>
  sourceSpeed: SourceSpeed
  sourceBpm: number | null
  heldOut: boolean
}

type Saved = Partial<BankState> & { banks?: Partial<BankState>[] }

const filled = (bank: Partial<BankState>): BankState => ({
  markers: bank.markers ?? [],
  labels: bank.labels ?? {},
  sourceSpeed: bank.sourceSpeed ?? { mode: 'tape', rate: 1 },
  sourceBpm: bank.sourceBpm ?? null,
  heldOut: bank.heldOut ?? false,
})

export const readBanks = ({ banks, ...legacy }: Saved): BankState[] => {
  const saved = banks ?? [legacy]
  return Array.from({ length: BANKS }, (_, b) => filled(saved[b] ?? {}))
}
