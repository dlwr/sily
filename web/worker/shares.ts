import { strFromU8, unzipSync } from 'fflate'

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

export const MAX_SHARE_BYTES = 20 * 1024 * 1024
export const MAX_SOURCE_SECONDS = 15
const PER_DAY = 3
const TOTAL = 20

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Manifest = {
  format?: string
  project?: { name?: unknown; state?: { bpm?: unknown } }
  source?: { sampleRate?: number; frames?: number } | null
}

const readManifest = (bytes: Uint8Array): Manifest | null => {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'project.json' })
    const manifest = JSON.parse(strFromU8(files['project.json'])) as Manifest
    return manifest.format === 'sily' ? manifest : null
  } catch {
    return null
  }
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
    const body = new Uint8Array(await request.arrayBuffer())
    if (body.byteLength > MAX_SHARE_BYTES) return new Response(null, { status: 413 })
    const manifest = readManifest(body)
    if (!manifest) return new Response(null, { status: 400 })
    const source = manifest.source
    if (source && (source.frames ?? 0) > MAX_SOURCE_SECONDS * (source.sampleRate ?? 0)) return new Response(null, { status: 400 })
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
