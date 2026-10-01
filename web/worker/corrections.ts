import { CATEGORIES } from '../src/classify/categories.ts'
import { sha256Hex } from '../src/corrections/hash.ts'

export type CorrectionStore = { save(id: string, label: string, audio: ArrayBuffer): Promise<void> }

const MAX_BYTES = 16 * 1024 * 1024
const isCategory = (label: string | null) => (CATEGORIES as readonly (string | null)[]).includes(label)

export async function handleCorrections(request: Request, store: CorrectionStore): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url)
  if (pathname === '/api/corrections/session') return new Response(null, { status: 204 })
  if (pathname === '/api/corrections/login') return new Response('ログインした。元のタブに戻ってよい。', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const id = pathname.match(/^\/api\/corrections\/([0-9a-f]{64})$/)?.[1]
  if (!id) return new Response(null, { status: 404 })
  if (request.method !== 'PUT') return new Response(null, { status: 405 })
  const label = searchParams.get('label')
  if (!isCategory(label)) return new Response(null, { status: 400 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return new Response(null, { status: 413 })
  const audio = await request.arrayBuffer()
  if (audio.byteLength === 0 || audio.byteLength > MAX_BYTES || (await sha256Hex(audio)) !== id) return new Response(null, { status: 400 })
  await store.save(id, label!, audio)
  return new Response(null, { status: 204 })
}
