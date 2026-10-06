import type { Category } from '../classify/categories'
import { sha256Hex } from './hash'
import type { Split } from './split'

export type UploadResult = 'saved' | 'login' | 'refused' | 'failed'

export async function uploadCorrection(wav: ArrayBuffer, label: Category, split: Split): Promise<UploadResult> {
  try {
    const res = await fetch(`/api/corrections/${await sha256Hex(wav)}?label=${label}&split=${split}`, {
      method: 'PUT',
      body: wav,
      headers: { 'content-type': 'audio/wav' },
      redirect: 'manual',
    })
    if (res.ok) return 'saved'
    if (res.type === 'opaqueredirect' || res.status === 401) return 'login'
    if (res.status === 403) return 'refused'
    return 'failed'
  } catch {
    return 'failed'
  }
}
