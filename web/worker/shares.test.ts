import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { pack, type Bundle } from '../src/storage/bundle'
import { handlePublicShare, handleShares, type ShareRecord, type ShareStore } from './shares'

const memoryStore = () => {
  const records: (ShareRecord & { owner: string; deleted: boolean })[] = []
  const bodies = new Map<string, Uint8Array>()
  const store: ShareStore = {
    async create(owner, record, body, limits) {
      const mine = records.filter((r) => r.owner === owner)
      if (mine.filter((r) => r.createdAt >= limits.since).length >= limits.perDay) return 'daily'
      if (mine.filter((r) => !r.deleted).length >= limits.total) return 'total'
      records.push({ ...record, owner, deleted: false })
      bodies.set(record.id, body)
      return 'created'
    },
    async list(owner) {
      return records.filter((r) => r.owner === owner && !r.deleted).map(({ id, name, bpm, createdAt }) => ({ id, name, bpm, createdAt }))
    },
    async remove(owner, id) {
      const record = records.find((r) => r.id === id && r.owner === owner && !r.deleted)
      if (!record) return false
      record.deleted = true
      bodies.delete(id)
      return true
    },
    async find(id) {
      const record = records.find((r) => r.id === id && !r.deleted)
      return record ? { id: record.id, name: record.name, bpm: record.bpm, createdAt: record.createdAt } : null
    },
    async body(id) {
      return bodies.get(id) ?? null
    },
  }
  return { store, records }
}

const bundle = (over: Partial<Bundle> = {}): Uint8Array =>
  pack({
    project: { name: 'beat', state: { bpm: 92 } },
    source: { name: 'break.wav', sampleRate: 100, left: new Float32Array(1000), right: new Float32Array(1000) },
    samples: [],
    ...over,
  })

const now = new Date('2026-10-06T12:00:00Z')
let counter = 0
const nextId = () => `id${++counter}`

const upload = (store: ShareStore, body: Uint8Array = bundle(), owner = 'a@example.com', at = now) =>
  handleShares(new Request('https://sily.test/api/shares', { method: 'POST', body: body.slice() }), owner, store, at, nextId)

describe('handleShares', () => {
  it('answers an upload with the link to the share', async () => {
    const { store } = memoryStore()
    const res = await upload(store)
    expect([res.status, (await res.json()).url]).toEqual([201, `/s/id${counter}`])
  })

  it('takes the name and tempo from the bundle', async () => {
    const { store, records } = memoryStore()
    await upload(store)
    expect([records[0].name, records[0].bpm]).toEqual(['beat', 92])
  })

  it('rejects bytes that are not a sily project', async () => {
    const { store } = memoryStore()
    expect((await upload(store, new Uint8Array([1, 2, 3]))).status).toBe(400)
  })

  it('rejects a source longer than fifteen seconds', async () => {
    const { store } = memoryStore()
    const long = bundle({ source: { name: 'x', sampleRate: 100, left: new Float32Array(1600), right: new Float32Array(1600) } })
    expect((await upload(store, long)).status).toBe(400)
  })

  it('rejects an upload that is too large', async () => {
    const { store } = memoryStore()
    expect((await upload(store, new Uint8Array(21 * 1024 * 1024))).status).toBe(413)
  })

  it('rejects a streamed upload that grows too large', async () => {
    const { store } = memoryStore()
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > 24) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const request = new Request('https://sily.test/api/shares', { method: 'POST', body, duplex: 'half' } as RequestInit)
    expect((await handleShares(request, 'a@example.com', store, now, nextId)).status).toBe(413)
  })

  it('rejects source audio longer than its manifest says', async () => {
    const { store } = memoryStore()
    const files = unzipSync(bundle())
    files['source.f32'] = new Uint8Array(1600 * 8)
    expect((await upload(store, zipSync(files))).status).toBe(400)
  })

  it('rejects a bundle that would unpack too large', async () => {
    const { store } = memoryStore()
    const files = unzipSync(bundle())
    files['samples/huge.f32'] = new Uint8Array(65 * 1024 * 1024)
    expect((await upload(store, zipSync(files, { level: 9 }))).status).toBe(400)
  })

  it('refuses a fourth upload on the same day', async () => {
    const { store } = memoryStore()
    for (let i = 0; i < 3; i++) await upload(store)
    const res = await upload(store)
    expect([res.status, (await res.json()).reason]).toEqual([429, 'daily'])
  })

  it('counts the day in UTC', async () => {
    const { store } = memoryStore()
    for (let i = 0; i < 3; i++) await upload(store, bundle(), 'a@example.com', new Date('2026-10-05T23:30:00Z'))
    expect((await upload(store, bundle(), 'a@example.com', new Date('2026-10-06T00:30:00Z'))).status).toBe(201)
  })

  it('still counts deleted shares against the day', async () => {
    const { store } = memoryStore()
    for (let i = 0; i < 3; i++) await upload(store)
    const [first] = await store.list('a@example.com')
    await handleShares(new Request(`https://sily.test/api/shares/${first.id}`, { method: 'DELETE' }), 'a@example.com', store, now, nextId)
    expect((await upload(store)).status).toBe(429)
  })

  it('refuses an upload once twenty shares are kept', async () => {
    const { store } = memoryStore()
    for (let day = 1; day <= 7; day++) for (let i = 0; i < 3; i++) await upload(store, bundle(), 'a@example.com', new Date(`2026-09-0${day}T12:00:00Z`))
    const res = await upload(store)
    expect([res.status, (await res.json()).reason]).toEqual([429, 'total'])
  })

  it('lists only the shares of the person asking', async () => {
    const { store } = memoryStore()
    await upload(store, bundle(), 'a@example.com')
    await upload(store, bundle({ project: { name: 'other', state: {} } }), 'b@example.com')
    const res = await handleShares(new Request('https://sily.test/api/shares'), 'b@example.com', store, now, nextId)
    expect((await res.json()).map((s: ShareRecord) => s.name)).toEqual(['other'])
  })

  it('deletes a share of the person asking', async () => {
    const { store } = memoryStore()
    const { id } = await (await upload(store)).json()
    await handleShares(new Request(`https://sily.test/api/shares/${id}`, { method: 'DELETE' }), 'a@example.com', store, now, nextId)
    expect(await store.find(id)).toBeNull()
  })

  it('does not delete a share of someone else', async () => {
    const { store } = memoryStore()
    const { id } = await (await upload(store)).json()
    const res = await handleShares(new Request(`https://sily.test/api/shares/${id}`, { method: 'DELETE' }), 'b@example.com', store, now, nextId)
    expect(res.status).toBe(404)
  })
})

const html = async () => '<!doctype html><html><head><title>sily</title></head><body></body></html>'
const view = (store: ShareStore, path: string) => handlePublicShare(new Request(`https://sily.test${path}`), store, html)

describe('handlePublicShare', () => {
  it('names the project in the link preview', async () => {
    const { store } = memoryStore()
    const { id } = await (await upload(store)).json()
    expect(await (await view(store, `/s/${id}`)).text()).toContain('<meta property="og:title" content="beat（92 BPM）">')
  })

  it('isolates the page like the app so audio threads can share memory', async () => {
    const { store } = memoryStore()
    const { id } = await (await upload(store)).json()
    const res = await view(store, `/s/${id}`)
    expect([res.headers.get('cross-origin-opener-policy'), res.headers.get('cross-origin-embedder-policy')]).toEqual(['same-origin', 'require-corp'])
  })

  it('escapes the project name in the page', async () => {
    const { store } = memoryStore()
    const { id } = await (await upload(store, bundle({ project: { name: '"><script>', state: {} } }))).json()
    expect(await (await view(store, `/s/${id}`)).text()).not.toContain('<script>')
  })

  it('answers an unknown share with 404', async () => {
    const { store } = memoryStore()
    expect((await view(store, '/s/nothing')).status).toBe(404)
  })

  it('serves the bundle as opaque bytes', async () => {
    const { store } = memoryStore()
    const { id } = await (await upload(store)).json()
    const res = await view(store, `/s/${id}/bundle`)
    expect([res.headers.get('content-type'), res.headers.get('x-content-type-options')]).toEqual(['application/octet-stream', 'nosniff'])
  })

  it('serves the uploaded bytes', async () => {
    const { store } = memoryStore()
    const body = bundle()
    const { id } = await (await upload(store, body)).json()
    expect(new Uint8Array(await (await view(store, `/s/${id}/bundle`)).arrayBuffer())).toEqual(body)
  })

  it('stops serving a deleted share', async () => {
    const { store } = memoryStore()
    const { id } = await (await upload(store)).json()
    await store.remove('a@example.com', id)
    expect((await view(store, `/s/${id}/bundle`)).status).toBe(404)
  })
})
