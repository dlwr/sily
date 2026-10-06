export type SharedProject = { id: string; name: string; bpm: number | null; createdAt: string }
export type UploadResult = { url: string } | 'login' | 'daily' | 'total' | 'large' | 'failed'

const needsLogin = (res: Response) => res.type === 'opaqueredirect' || res.status === 401 || res.status === 403

export async function uploadShare(bundle: Uint8Array): Promise<UploadResult> {
  try {
    const res = await fetch('/api/shares', {
      method: 'POST',
      body: bundle.slice(),
      headers: { 'content-type': 'application/octet-stream' },
      redirect: 'manual',
    })
    if (res.ok) return { url: (await res.json()).url }
    if (needsLogin(res)) return 'login'
    if (res.status === 413) return 'large'
    if (res.status === 429) return (await res.json()).reason === 'daily' ? 'daily' : 'total'
    return 'failed'
  } catch {
    return 'failed'
  }
}

export async function listShares(): Promise<SharedProject[] | 'login' | 'failed'> {
  try {
    const res = await fetch('/api/shares', { redirect: 'manual' })
    if (res.ok) return await res.json()
    return needsLogin(res) ? 'login' : 'failed'
  } catch {
    return 'failed'
  }
}

export async function deleteShare(id: string): Promise<boolean> {
  try {
    return (await fetch(`/api/shares/${id}`, { method: 'DELETE', redirect: 'manual' })).ok
  } catch {
    return false
  }
}

export async function fetchShare(id: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`/s/${id}/bundle`)
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

export const sharedIdFrom = (pathname: string): string | null => pathname.match(/^\/s\/([\w-]+)\/?$/)?.[1] ?? null
