import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import Editor from './Editor'
import Sidebar, { type NodeRef } from './Sidebar'
import { emptyFlyer, uid, type Flyer } from './flyer'
import { thumbnail } from './render'
import {
  deleteProject,
  loadLibrary,
  loadProject,
  saveLibrary,
  saveProject,
  type Library,
  type ProjectMeta,
} from './storage'

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

export default function App() {
  const [lib, setLib] = useState<Library | null>(null)
  const [current, setCurrent] = useState<{ id: string; flyer: Flyer } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => readPref('a6-sidebar') !== 'closed')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [targetFolder, setTargetFolder] = useState<string | null>(null)

  const pending = useRef<{ id: string; flyer: Flyer } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const currentId = useRef<string | null>(null)

  useEffect(() => {
    loadLibrary()
      .then(async (l) => {
        const flyer = await loadProject(l.currentId)
        currentId.current = l.currentId
        setLib(l)
        setCurrent({ id: l.currentId, flyer })
        const meta = l.projects.find((p) => p.id === l.currentId)
        setTargetFolder(meta?.folderId ?? null)
        if (!meta?.thumb) ensureThumb(l.currentId, flyer)
      })
      .catch((e: Error) => setError(`Your projects couldn't be loaded: ${e.message}`))
  }, [])

  useEffect(() => {
    if (lib) saveLibrary(lib).catch(() => setError('Saving the project list failed. Is browser storage full?'))
  }, [lib])

  /** Writes the open flyer now instead of waiting for the autosave delay. */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    await saveProject(p.id, p.flyer)
    const thumb = await thumbnail(p.flyer).catch(() => undefined)
    setLib((l) =>
      l && {
        ...l,
        projects: l.projects.map((m) => (m.id === p.id ? { ...m, updatedAt: Date.now(), thumb: thumb ?? m.thumb } : m)),
      },
    )
  }, [])

  const onFlyerChange = useCallback(
    (flyer: Flyer) => {
      if (!currentId.current) return
      pending.current = { id: currentId.current, flyer }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        flush().catch(() => setError('Autosave failed. Is browser storage full?'))
      }, 600)
    },
    [flush],
  )

  useEffect(() => {
    const save = () => void flush()
    const onHide = () => document.visibilityState === 'hidden' && save()
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [flush])

  /** Projects saved before thumbnails existed get one the first time they open. */
  function ensureThumb(id: string, flyer: Flyer) {
    thumbnail(flyer)
      .then((thumb) =>
        setLib((l) => l && { ...l, projects: l.projects.map((m) => (m.id === id && !m.thumb ? { ...m, thumb } : m)) }),
      )
      .catch(() => {})
  }

  async function open(id: string) {
    await flush()
    const flyer = await loadProject(id)
    currentId.current = id
    setCurrent({ id, flyer })
    setLib((l) => l && { ...l, currentId: id })
    if (!lib?.projects.find((p) => p.id === id)?.thumb) ensureThumb(id, flyer)
  }

  function expand(folderId: string | null) {
    if (!folderId) return
    setLib((l) => l && { ...l, folders: l.folders.map((f) => (f.id === folderId ? { ...f, collapsed: false } : f)) })
  }

  async function newProject(folderId: string | null) {
    await flush()
    const id = uid()
    const flyer = emptyFlyer(2)
    await saveProject(id, flyer)
    const meta: ProjectMeta = { id, name: 'Untitled flyer', folderId, updatedAt: Date.now() }
    currentId.current = id
    setLib((l) => l && { ...l, projects: [...l.projects, meta], currentId: id })
    expand(folderId)
    setCurrent({ id, flyer })
    setRenaming(id)
  }

  function newFolder(parentId: string | null) {
    const id = uid()
    setLib((l) => l && { ...l, folders: [...l.folders, { id, name: 'New folder', parentId }] })
    expand(parentId)
    setTargetFolder(id)
    setRenaming(id)
  }

  function rename(node: NodeRef, raw: string) {
    const name = raw.trim()
    if (!name) return
    setLib((l) => {
      if (!l) return l
      return node.kind === 'folder'
        ? { ...l, folders: l.folders.map((f) => (f.id === node.id ? { ...f, name } : f)) }
        : { ...l, projects: l.projects.map((p) => (p.id === node.id ? { ...p, name } : p)) }
    })
  }

  async function duplicate(id: string) {
    if (!lib) return
    await flush()
    const src = lib.projects.find((p) => p.id === id)
    if (!src) return
    const copyId = uid()
    await saveProject(copyId, await loadProject(id))
    setLib((l) => l && { ...l, projects: [...l.projects, { ...src, id: copyId, name: `${src.name} copy`, updatedAt: Date.now() }] })
  }

  async function remove(node: NodeRef) {
    if (!lib) return
    if (node.kind === 'folder') {
      const folder = lib.folders.find((f) => f.id === node.id)
      if (!folder) return
      // Contents move up to the parent, so deleting a folder never deletes a flyer.
      setLib((l) =>
        l && {
          ...l,
          folders: l.folders
            .filter((f) => f.id !== node.id)
            .map((f) => (f.parentId === node.id ? { ...f, parentId: folder.parentId } : f)),
          projects: l.projects.map((p) => (p.folderId === node.id ? { ...p, folderId: folder.parentId } : p)),
        },
      )
      if (targetFolder === node.id) setTargetFolder(folder.parentId)
      return
    }
    if (pending.current?.id === node.id) pending.current = null
    await deleteProject(node.id)
    const rest = lib.projects.filter((p) => p.id !== node.id)
    setLib((l) => l && { ...l, projects: l.projects.filter((p) => p.id !== node.id) })
    if (node.id !== lib.currentId) return
    const next = [...rest].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (next) await open(next.id)
    else await newProject(null)
  }

  function move(node: NodeRef, folderId: string | null) {
    setLib((l) => {
      if (!l) return l
      if (node.kind === 'project') {
        return { ...l, projects: l.projects.map((p) => (p.id === node.id ? { ...p, folderId } : p)) }
      }
      // A folder can't move into itself or one of its own subfolders.
      for (let f: string | null = folderId; f; f = l.folders.find((x) => x.id === f)?.parentId ?? null) {
        if (f === node.id) return l
      }
      return { ...l, folders: l.folders.map((f) => (f.id === node.id ? { ...f, parentId: folderId } : f)) }
    })
    expand(folderId)
  }

  function toggleSidebar() {
    setSidebarOpen((o) => {
      writePref('a6-sidebar', o ? 'closed' : 'open')
      return !o
    })
  }

  if (error && !lib) return <p className="fatal">{error}</p>
  if (!lib || !current) return <p className="fatal">Opening your flyers…</p>

  const meta = lib.projects.find((p) => p.id === current.id)
  return (
    <div className={'app' + (sidebarOpen ? '' : ' sidebar-closed')}>
      {sidebarOpen && (
        <Sidebar
          lib={lib}
          targetFolder={targetFolder}
          renaming={renaming}
          onTargetFolder={setTargetFolder}
          onRenaming={setRenaming}
          onOpen={(id) => void open(id)}
          onNewProject={(f) => void newProject(f)}
          onNewFolder={newFolder}
          onRename={rename}
          onDuplicate={(id) => void duplicate(id)}
          onDelete={(n) => void remove(n)}
          onMove={move}
          onToggleFolder={(id) =>
            setLib((l) => l && { ...l, folders: l.folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)) })
          }
        />
      )}
      <Editor
        key={current.id}
        projectName={meta?.name ?? 'Untitled flyer'}
        initial={current.flyer}
        onFlyerChange={onFlyerChange}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  )
}
