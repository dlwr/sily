export class History<T> {
  private past: T[] = []
  private future: T[] = []
  private last: { key: string; at: number } | null = null

  constructor(
    private mergeMs = 500,
    private now: () => number = () => performance.now(),
    private limit = 100,
  ) {}

  record(state: T, key?: string) {
    const at = this.now()
    const merging = key !== undefined && this.last?.key === key && at - this.last.at < this.mergeMs
    this.last = key === undefined ? null : { key, at }
    this.future = []
    if (merging) return
    this.past.push(state)
    if (this.past.length > this.limit) this.past.shift()
  }

  undo(current: T): T | undefined {
    const previous = this.past.pop()
    if (previous === undefined) return undefined
    this.future.push(current)
    this.last = null
    return previous
  }

  redo(current: T): T | undefined {
    const next = this.future.pop()
    if (next === undefined) return undefined
    this.past.push(current)
    this.last = null
    return next
  }
}
