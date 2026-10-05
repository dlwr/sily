import { describe, expect, it } from 'vitest'
import { WorkerRpc, type RpcPort } from './rpc'

class FakePort implements RpcPort {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  sent: { id: number; payload: unknown }[] = []
  postMessage(message: { id: number; payload: unknown }) {
    this.sent.push(message)
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
  crash(message: string) {
    this.onerror?.({ message } as ErrorEvent)
  }
}

describe('WorkerRpc', () => {
  it('resolves each call with its own reply', async () => {
    const port = new FakePort()
    const rpc = new WorkerRpc<string, number>(() => port)
    const a = rpc.call('a')
    const b = rpc.call('b')
    port.reply({ id: port.sent[1].id, result: 2 })
    port.reply({ id: port.sent[0].id, result: 1 })
    expect(await Promise.all([a, b])).toEqual([1, 2])
  })

  it('rejects a call whose worker reported an error', async () => {
    const port = new FakePort()
    const rpc = new WorkerRpc<string, number>(() => port)
    const call = rpc.call('a')
    port.reply({ id: port.sent[0].id, error: 'boom' })
    await expect(call).rejects.toThrow('boom')
  })

  it('starts the worker only when first called', () => {
    let started = 0
    const rpc = new WorkerRpc<string, number>(() => {
      started++
      return new FakePort()
    })
    expect(started).toBe(0)
    rpc.call('a')
    rpc.call('b')
    expect(started).toBe(1)
  })

  it('passes messages without an id to the event listener', () => {
    const port = new FakePort()
    const events: unknown[] = []
    const rpc = new WorkerRpc<string, number, { loaded: number }>(() => port, (event) => events.push(event))
    rpc.call('a')
    port.reply({ event: { loaded: 3 } })
    expect(events).toEqual([{ loaded: 3 }])
  })

  it('rejects pending calls when the worker crashes', async () => {
    const port = new FakePort()
    const rpc = new WorkerRpc<string, number>(() => port)
    const call = rpc.call('a')
    port.crash('out of memory')
    await expect(call).rejects.toThrow('out of memory')
  })

  it('starts a fresh worker after a crash', () => {
    let started = 0
    const ports: FakePort[] = []
    const rpc = new WorkerRpc<string, number>(() => {
      started++
      const port = new FakePort()
      ports.push(port)
      return port
    })
    rpc.call('a').catch(() => {})
    ports[0].crash('boom')
    rpc.call('b')
    expect(started).toBe(2)
  })
})
