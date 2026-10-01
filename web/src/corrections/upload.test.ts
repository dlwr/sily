import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from './hash'
import { uploadCorrection } from './upload'

const wav = new Uint8Array([1, 2, 3]).buffer
const respond = (response: Partial<Response>) => vi.stubGlobal('fetch', vi.fn(async () => response as Response))

afterEach(() => vi.unstubAllGlobals())

describe('uploadCorrection', () => {
  it('puts the audio at its hash with the label', async () => {
    respond({ ok: true, status: 204, type: 'basic' })
    await uploadCorrection(wav, 'kick')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/corrections/${await sha256Hex(wav)}?label=kick`)
  })

  it('reports saved when the server accepts it', async () => {
    respond({ ok: true, status: 204, type: 'basic' })
    expect(await uploadCorrection(wav, 'kick')).toBe('saved')
  })

  it('asks for login when Access redirects', async () => {
    respond({ ok: false, status: 0, type: 'opaqueredirect' })
    expect(await uploadCorrection(wav, 'kick')).toBe('login')
  })

  it('asks for login when the worker refuses', async () => {
    respond({ ok: false, status: 403, type: 'basic' })
    expect(await uploadCorrection(wav, 'kick')).toBe('login')
  })

  it('reports failure on other errors', async () => {
    respond({ ok: false, status: 500, type: 'basic' })
    expect(await uploadCorrection(wav, 'kick')).toBe('failed')
  })

  it('reports failure when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    expect(await uploadCorrection(wav, 'kick')).toBe('failed')
  })
})
