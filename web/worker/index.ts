import { createRemoteJWKSet, jwtVerify } from 'jose'
import { isOwner } from './auth.ts'
import { handleCorrections, type CorrectionStore } from './corrections.ts'
import { handlePublicShare, handleShares, type ShareRecord, type ShareStore } from './shares.ts'

type Env = {
  DB: D1Database
  AUDIO: R2Bucket
  ASSETS: Fetcher
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
  OWNER_EMAIL?: string
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined

async function verifiedEmail(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD })
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}

const cloudStore = (env: Env): CorrectionStore => ({
  async save(id, label, split, audio) {
    await env.AUDIO.put(`corrections/${id}.wav`, audio, { httpMetadata: { contentType: 'audio/wav' } })
    await env.DB.prepare(
      'INSERT INTO corrections (id, label, split, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (id) DO UPDATE SET label = excluded.label, split = excluded.split, updated_at = excluded.updated_at',
    )
      .bind(id, label, split, new Date().toISOString())
      .run()
  },
})

type ShareRow = { id: string; name: string; bpm: number | null; created_at: string }
const toRecord = (row: ShareRow): ShareRecord => ({ id: row.id, name: row.name, bpm: row.bpm, createdAt: row.created_at })
const bundleKey = (id: string) => `shares/${id}.sily`

const shareStore = (env: Env): ShareStore => ({
  async create(owner, record, body, limits) {
    const { meta } = await env.DB.prepare(
      `INSERT INTO shares (id, owner, name, bpm, bytes, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT COUNT(*) FROM shares WHERE owner = ?2 AND created_at >= ?7) < ?8
         AND (SELECT COUNT(*) FROM shares WHERE owner = ?2 AND deleted_at IS NULL) < ?9`,
    )
      .bind(record.id, owner, record.name, record.bpm, body.byteLength, record.createdAt, limits.since, limits.perDay, limits.total)
      .run()
    if (meta.changes === 0) {
      const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE owner = ?1 AND created_at >= ?2')
        .bind(owner, limits.since)
        .first<number>('n')
      return (today ?? 0) >= limits.perDay ? 'daily' : 'total'
    }
    try {
      await env.AUDIO.put(bundleKey(record.id), body, { httpMetadata: { contentType: 'application/octet-stream' } })
    } catch (error) {
      await env.DB.prepare('DELETE FROM shares WHERE id = ?1').bind(record.id).run()
      throw error
    }
    return 'created'
  },
  async list(owner) {
    const { results } = await env.DB.prepare(
      'SELECT id, name, bpm, created_at FROM shares WHERE owner = ?1 AND deleted_at IS NULL ORDER BY created_at DESC',
    )
      .bind(owner)
      .all<ShareRow>()
    return results.map(toRecord)
  },
  async remove(owner, id) {
    const { meta } = await env.DB.prepare('UPDATE shares SET deleted_at = ?3 WHERE id = ?1 AND owner = ?2 AND deleted_at IS NULL')
      .bind(id, owner, new Date().toISOString())
      .run()
    if (meta.changes === 0) return false
    await env.AUDIO.delete(bundleKey(id))
    return true
  },
  async find(id) {
    const row = await env.DB.prepare('SELECT id, name, bpm, created_at FROM shares WHERE id = ?1 AND deleted_at IS NULL')
      .bind(id)
      .first<ShareRow>()
    return row && toRecord(row)
  },
  async body(id) {
    return (await env.AUDIO.get(bundleKey(id)))?.body ?? null
  },
})

const newShareId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const indexHtml = (request: Request, env: Env) => async () => (await env.ASSETS.fetch(new URL('/', request.url))).text()

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/s/')) return handlePublicShare(request, shareStore(env), indexHtml(request, env))
    const email = await verifiedEmail(request, env)
    if (!email) return new Response(null, { status: 401 })
    if (pathname === '/api/login' || pathname === '/api/corrections/login') return new Response('ログインした。元のタブに戻ってよい。', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    if (pathname === '/api/shares' || pathname.startsWith('/api/shares/')) return handleShares(request, email, shareStore(env), new Date(), newShareId)
    if (!isOwner(email, env.OWNER_EMAIL)) return new Response(null, { status: 403 })
    return handleCorrections(request, cloudStore(env))
  },
} satisfies ExportedHandler<Env>
