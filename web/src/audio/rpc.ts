export type RpcPort = {
  onmessage: ((e: MessageEvent) => void) | null
  onerror?: ((e: ErrorEvent) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

type Reply<R, E> = { id: number; result?: R; error?: string } | { id?: undefined; event: E }

export class WorkerRpc<P, R, E = never> {
  private port: RpcPort | null = null
  private pending = new Map<number, { resolve: (r: R) => void; reject: (e: Error) => void }>()
  private next = 0

  constructor(
    private spawn: () => RpcPort,
    private onEvent: (event: E) => void = () => {},
  ) {}

  call(payload: P, transfer: Transferable[] = []): Promise<R> {
    const port = (this.port ??= this.listen(this.spawn()))
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      port.postMessage({ id, payload }, transfer)
    })
  }

  private listen(port: RpcPort): RpcPort {
    port.onmessage = (e: MessageEvent<Reply<R, E>>) => {
      if (e.data.id === undefined) return this.onEvent(e.data.event)
      const pending = this.pending.get(e.data.id)
      if (!pending) return
      this.pending.delete(e.data.id)
      if (e.data.error !== undefined) pending.reject(new Error(e.data.error))
      else pending.resolve(e.data.result as R)
    }
    port.onerror = (e: ErrorEvent) => {
      this.port = null
      const error = new Error(e.message || 'worker crashed')
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    }
    return port
  }
}
