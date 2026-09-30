export type RpcPort = {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

type Reply<R> = { id: number; result?: R; error?: string }

export class WorkerRpc<P, R> {
  private port: RpcPort | null = null
  private pending = new Map<number, { resolve: (r: R) => void; reject: (e: Error) => void }>()
  private next = 0

  constructor(private spawn: () => RpcPort) {}

  call(payload: P, transfer: Transferable[] = []): Promise<R> {
    const port = (this.port ??= this.listen(this.spawn()))
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      port.postMessage({ id, payload }, transfer)
    })
  }

  private listen(port: RpcPort): RpcPort {
    port.onmessage = (e: MessageEvent<Reply<R>>) => {
      const pending = this.pending.get(e.data.id)
      if (!pending) return
      this.pending.delete(e.data.id)
      if (e.data.error !== undefined) pending.reject(new Error(e.data.error))
      else pending.resolve(e.data.result as R)
    }
    return port
  }
}
