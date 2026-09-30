const NAME = 'sily'
const VERSION = 1

export type StoreName = 'audio' | 'samples' | 'projects'

let connection: Promise<IDBDatabase> | null = null

export const openStore = (): Promise<IDBDatabase> =>
  (connection = new Promise((resolve, reject) => {
    const open = indexedDB.open(NAME, VERSION)
    open.onupgradeneeded = () => {
      for (const name of ['audio', 'samples', 'projects']) {
        if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name, { keyPath: 'id' })
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  }))

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const store = async (name: StoreName, mode: IDBTransactionMode) =>
  (await (connection ??= openStore())).transaction(name, mode).objectStore(name)

export const put = async <T extends { id: string }>(name: StoreName, value: T) => {
  await done((await store(name, 'readwrite')).put(value))
}

export const get = async <T>(name: StoreName, id: string): Promise<T | null> =>
  ((await done((await store(name, 'readonly')).get(id))) as T | undefined) ?? null

export const all = async <T>(name: StoreName): Promise<T[]> => (await done((await store(name, 'readonly')).getAll())) as T[]

export const remove = async (name: StoreName, id: string) => {
  await done((await store(name, 'readwrite')).delete(id))
}

export const newId = () => crypto.randomUUID()

export type StoredAudio = { id: string; left: Float32Array; right: Float32Array; sampleRate: number }
