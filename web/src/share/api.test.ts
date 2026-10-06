import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteShare, fetchShare, listShares, sharedIdFrom, uploadShare } from './api'

const bytes = new Uint8Array([1, 2, 3])
const respond = (response: Partial<Response>) => vi.stubGlobal('fetch', vi.fn(async () => response as Response))

afterEach(() => vi.unstubAllGlobals())

describe('uploadShare', () => {
  it('posts the bundle to the shares endpoint', async () => {
    respond({ ok: true, status: 201, type: 'basic', json: async () => ({ url: '/s/abc' }) })
    await uploadShare(bytes)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/shares')
  })

  it('gives the link of a created share', async () => {
    respond({ ok: true, status: 201, type: 'basic', json: async () => ({ url: '/s/abc' }) })
    expect(await uploadShare(bytes)).toEqual({ url: '/s/abc' })
  })

  it('asks for login when Access redirects', async () => {
    respond({ ok: false, status: 0, type: 'opaqueredirect' })
    expect(await uploadShare(bytes)).toBe('login')
  })

  it('asks for login when the worker refuses', async () => {
    respond({ ok: false, status: 403, type: 'basic' })
    expect(await uploadShare(bytes)).toBe('login')
  })

  it('tells when the daily limit is reached', async () => {
    respond({ ok: false, status: 429, type: 'basic', json: async () => ({ reason: 'daily' }) })
    expect(await uploadShare(bytes)).toBe('daily')
  })

  it('tells when too many shares are kept', async () => {
    respond({ ok: false, status: 429, type: 'basic', json: async () => ({ reason: 'total' }) })
    expect(await uploadShare(bytes)).toBe('total')
  })

  it('tells when the bundle is too large', async () => {
    respond({ ok: false, status: 413, type: 'basic' })
    expect(await uploadShare(bytes)).toBe('large')
  })

  it('reports failure when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    expect(await uploadShare(bytes)).toBe('failed')
  })
})

describe('listShares', () => {
  it('gives the shares of the person logged in', async () => {
    respond({ ok: true, status: 200, type: 'basic', json: async () => [{ id: 'a', name: 'beat', bpm: 90, createdAt: 'x' }] })
    expect(await listShares()).toEqual([{ id: 'a', name: 'beat', bpm: 90, createdAt: 'x' }])
  })

  it('asks for login when not logged in', async () => {
    respond({ ok: false, status: 0, type: 'opaqueredirect' })
    expect(await listShares()).toBe('login')
  })
})

describe('deleteShare', () => {
  it('deletes the share by its id', async () => {
    respond({ ok: true, status: 204, type: 'basic' })
    await deleteShare('abc')
    expect(vi.mocked(fetch).mock.calls[0]).toMatchObject(['/api/shares/abc', { method: 'DELETE' }])
  })
})

describe('fetchShare', () => {
  it('fetches the bundle of a share', async () => {
    respond({ ok: true, status: 200, type: 'basic', arrayBuffer: async () => bytes.buffer })
    expect(await fetchShare('abc')).toEqual(bytes)
  })

  it('gives nothing for a missing share', async () => {
    respond({ ok: false, status: 404, type: 'basic' })
    expect(await fetchShare('abc')).toBeNull()
  })
})

describe('sharedIdFrom', () => {
  it('reads the share id from a share page path', () => {
    expect(sharedIdFrom('/s/Ab_9-x')).toBe('Ab_9-x')
  })

  it('gives nothing on other pages', () => {
    expect(sharedIdFrom('/')).toBeNull()
  })
})
