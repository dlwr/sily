import { strFromU8, unzipSync } from 'fflate'
import { MAX_SHARE_BYTES, MAX_SOURCE_SECONDS } from '../src/share/limits.ts'

export type ShareRecord = { id: string; name: string; bpm: number | null; createdAt: string }
export type Limits = { since: string; perDay: number; total: number }
export type CreateResult = 'created' | 'daily' | 'total'

export type ShareStore = {
  create(owner: string, record: ShareRecord, body: Uint8Array, limits: Limits): Promise<CreateResult>
  list(owner: string): Promise<ShareRecord[]>
  remove(owner: string, id: string): Promise<boolean>
  find(id: string): Promise<ShareRecord | null>
  body(id: string): Promise<ReadableStream | Uint8Array | null>
}

const PER_DAY = 3
const TOTAL = 20

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Audio = { sampleRate?: unknown; frames?: unknown }

type Manifest = {
  format?: string
  project?: { name?: unknown; state?: { bpm?: unknown } }
  source?: Audio | null
  samples?: (Audio & { id?: unknown })[]
}

const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024
const BYTES_PER_FRAME = 8

const MIN_SAMPLE_RATE = 8000
const MAX_SAMPLE_RATE = 192000

const plausible = ({ sampleRate, frames }: Audio) =>
  typeof sampleRate === 'number' &&
  sampleRate >= MIN_SAMPLE_RATE &&
  sampleRate <= MAX_SAMPLE_RATE &&
  Number.isInteger(frames) &&
  (frames as number) >= 0

const readManifest = (bytes: Uint8Array): Manifest | null => {
  try {
    const sizes = new Map<string, number>()
    const files = unzipSync(bytes, {
      filter: (f) => {
        sizes.set(f.name, f.originalSize)
        return f.name === 'project.json' && f.originalSize <= MAX_MANIFEST_BYTES
      },
    })
    const manifest = JSON.parse(strFromU8(files['project.json'])) as Manifest
    if (manifest.format !== 'sily') return null
    if ([...sizes.values()].reduce((a, b) => a + b, 0) > MAX_UNPACKED_BYTES) return null
    const expected = new Map<string, Audio>([['project.json', {}]])
    if (manifest.source) expected.set('source.f32', manifest.source)
    for (const sample of manifest.samples ?? []) expected.set(`samples/${sample.id}.f32`, sample)
    if (sizes.size !== expected.size) return null
    for (const [name, audio] of expected) {
      if (!sizes.has(name)) return null
      if (name === 'project.json') continue
      if (!plausible(audio) || sizes.get(name) !== (audio.frames as number) * BYTES_PER_FRAME) return null
    }
    return manifest
  } catch {
    return null
  }
}

const readCapped = async (request: Request, max: number): Promise<Uint8Array | null> => {
  if (!request.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = request.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const startOfUtcDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString()

export async function handleShares(
  request: Request,
  owner: string,
  store: ShareStore,
  now: Date,
  newId: () => string,
): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/shares') {
    if (request.method === 'GET') return json(await store.list(owner))
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    if (Number(request.headers.get('content-length') ?? 0) > MAX_SHARE_BYTES) return new Response(null, { status: 413 })
    const body = await readCapped(request, MAX_SHARE_BYTES)
    if (!body) return new Response(null, { status: 413 })
    const manifest = readManifest(body)
    if (!manifest) return new Response(null, { status: 400 })
    const source = manifest.source
    if (source && (source.frames as number) > MAX_SOURCE_SECONDS * (source.sampleRate as number)) return new Response(null, { status: 400 })
    const name = typeof manifest.project?.name === 'string' ? manifest.project.name.slice(0, 100) : '無題'
    const bpm = typeof manifest.project?.state?.bpm === 'number' ? manifest.project.state.bpm : null
    const record = { id: newId(), name, bpm, createdAt: now.toISOString() }
    const result = await store.create(owner, record, body, { since: startOfUtcDay(now), perDay: PER_DAY, total: TOTAL })
    if (result !== 'created') return json({ reason: result }, 429)
    return json({ ...record, url: `/s/${record.id}` }, 201)
  }
  const id = pathname.match(/^\/api\/shares\/([\w-]+)$/)?.[1]
  if (!id) return new Response(null, { status: 404 })
  if (request.method !== 'DELETE') return new Response(null, { status: 405 })
  return new Response(null, { status: (await store.remove(owner, id)) ? 204 : 404 })
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const titleOf = (share: ShareRecord) => (share.bpm === null ? share.name : `${share.name}（${share.bpm} BPM）`)

export const withPreview = (html: string, share: ShareRecord, origin: string) => {
  const title = escape(titleOf(share))
  const meta = [
    `<meta property="og:title" content="${title}">`,
    '<meta property="og:description" content="sily で作ったビート。開くと鳴る">',
    '<meta property="og:type" content="music.song">',
    `<meta property="og:url" content="${origin}/s/${share.id}">`,
    `<meta property="og:image" content="${origin}/og.png">`,
    '<meta name="twitter:card" content="summary">',
  ].join('')
  return html.replace(/<title>[^<]*<\/title>/, `<title>${title} - sily</title>`).replace('</head>', `${meta}</head>`)
}

export async function handlePublicShare(request: Request, store: ShareStore, html: () => Promise<string>): Promise<Response> {
  const { pathname, origin } = new URL(request.url)
  const [, id, rest] = pathname.match(/^\/s\/([\w-]+)(\/bundle)?$/) ?? []
  if (!id) return new Response(null, { status: 404 })
  const share = await store.find(id)
  if (!share) return new Response('この共有は見つからなかった', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  if (!rest) {
    return new Response(withPreview(await html(), share, origin), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'referrer-policy': 'no-referrer',
      },
    })
  }
  const body = await store.body(id)
  if (!body) return new Response(null, { status: 404 })
  return new Response(body, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=300',
    },
  })
}
