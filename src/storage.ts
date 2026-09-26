// Projects live in IndexedDB rather than localStorage: localStorage holds about 5 MB,
// which a single uploaded photo can fill. Both stay in this browser on this device.
import { emptyFlyer, migrateFlyer, sampleFlyer, uid, type Flyer } from './flyer'

const DB = 'a6-flyer'
const STORE = 'kv'

export interface Folder {
  id: string
  name: string
  parentId: string | null
  collapsed?: boolean
}

export interface ProjectMeta {
  id: string
  name: string
  folderId: string | null
  updatedAt: number
  thumb?: string
}

export interface Library {
  folders: Folder[]
  projects: ProjectMeta[]
  currentId: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function write(fn: (store: IDBObjectStore) => void): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const flyerKey = (id: string) => `flyer:${id}`

export async function loadProject(id: string): Promise<Flyer> {
  const f = await get<Flyer>(flyerKey(id))
  return f ? migrateFlyer(f) : emptyFlyer()
}

export const saveProject = (id: string, flyer: Flyer) => write((s) => s.put(flyer, flyerKey(id)))
export const deleteProject = (id: string) => write((s) => s.delete(flyerKey(id)))
export const saveLibrary = (lib: Library) => write((s) => s.put(lib, 'library'))

/** Loads the project list, creating it on first run from any flyer saved before projects existed. */
export async function loadLibrary(): Promise<Library> {
  const lib = await get<Library>('library')
  if (lib?.projects.length) return lib
  const legacy = await get<Flyer>('flyer')
  const id = uid()
  await saveProject(id, legacy ? migrateFlyer(legacy) : sampleFlyer())
  const fresh: Library = {
    folders: [],
    projects: [{ id, name: legacy ? 'My first flyer' : 'Riverside Makers Market', folderId: null, updatedAt: Date.now() }],
    currentId: id,
  }
  await saveLibrary(fresh)
  return fresh
}
