import type { Label } from './bank.svelte'
import type { SourceSpeed } from './source'

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

export const readBanks = ({ banks, ...legacy }: Saved): BankState[] => (banks ?? [legacy]).map(filled)
