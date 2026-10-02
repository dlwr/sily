import { createRemoteJWKSet, jwtVerify } from 'jose'
import { handleCorrections, type CorrectionStore } from './corrections.ts'

type Env = {
  DB: D1Database
  AUDIO: R2Bucket
  ACCESS_TEAM_DOMAIN: string
  ACCESS_AUD: string
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined

async function authorized(request: Request, env: Env) {
  const token = request.headers.get('cf-access-jwt-assertion')
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  try {
    await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD })
    return true
  } catch {
    return false
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

export default {
  async fetch(request, env) {
    if (!(await authorized(request, env))) return new Response(null, { status: 403 })
    return handleCorrections(request, cloudStore(env))
  },
} satisfies ExportedHandler<Env>
