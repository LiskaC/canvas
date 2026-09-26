import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import {
  emptyFlyer,
  newText,
  PAGE_H,
  PAGE_NAMES,
  PAGE_W,
  round1,
  sampleFlyer,
  uid,
  type Flyer,
  type FlyerEl,
  type ImageEl,
} from './flyer'
import PageStage from './PageStage'
import Inspector from './Inspector'
import { exportPdf, exportPngs, readImageFile } from './render'
import { loadFlyer, saveFlyer } from './storage'

const BLEED_MM = 3
const PAD = 40
const LABEL_H = 36

export type LayerMove = 'front' | 'forward' | 'backward' | 'back'

export default function App() {
  const [flyer, setFlyer] = useState<Flyer>(sampleFlyer)
  const [activePage, setActivePage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showGuides, setShowGuides] = useState(true)
  const [bleed, setBleed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hist, setHist] = useState({ undo: false, redo: false })
  const [ws, setWs] = useState({ w: 900, h: 700 })

  const flyerRef = useRef(flyer)
  const past = useRef<Flyer[]>([])
  const future = useRef<Flyer[]>([])
  const lastKey = useRef<{ key: string; t: number } | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    flyerRef.current = flyer
  }, [flyer])

  // ---- persistence -------------------------------------------------------
  useEffect(() => {
    loadFlyer<Flyer>()
      .then((f) => {
        if (f?.pages?.length === 2) setFlyer(f)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      saveFlyer(flyer).catch(() => showToast('Autosave failed. Download a PDF to keep your work.'))
    }, 400)
    return () => clearTimeout(t)
  }, [flyer, loaded])

  // ---- workspace size -> page scale ---------------------------------------
  useEffect(() => {
    const node = workspaceRef.current
    if (!node) return
    const ro = new ResizeObserver(() => setWs({ w: node.clientWidth, h: node.clientHeight }))
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const twoUp = ws.w >= 620
  const scale = twoUp
    ? Math.min((ws.w - PAD * 3) / (PAGE_W * 2), (ws.h - PAD * 2 - LABEL_H) / PAGE_H)
    : (ws.w - PAD * 2) / PAGE_W
  const s = Math.max(1.2, Math.min(scale, 7))

  // ---- history --------------------------------------------------------------
  const syncHist = () => setHist({ undo: past.current.length > 0, redo: future.current.length > 0 })

  /** Snapshot before a change. Calls sharing a key within a second collapse into one undo step. */
  const checkpoint = useCallback((key?: string) => {
    const now = Date.now()
    if (key && lastKey.current?.key === key && now - lastKey.current.t < 1000) {
      lastKey.current.t = now
      return
    }
    lastKey.current = key ? { key, t: now } : null
    past.current.push(flyerRef.current)
    if (past.current.length > 100) past.current.shift()
    future.current = []
    syncHist()
  }, [])

  function undo() {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(flyerRef.current)
    lastKey.current = null
    setFlyer(prev)
    setEditingId(null)
    syncHist()
  }

  function redo() {
    const next = future.current.pop()
    if (!next) return
    past.current.push(flyerRef.current)
    lastKey.current = null
    setFlyer(next)
    setEditingId(null)
    syncHist()
  }

  // ---- element operations -----------------------------------------------------
  const updateEl = useCallback((id: string, patch: Partial<FlyerEl>) => {
    setFlyer((f) => ({
      pages: f.pages.map((p) => ({
        ...p,
        elements: p.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as FlyerEl) : el)),
      })),
    }))
  }, [])

  const selectedPage = flyer.pages.findIndex((p) => p.elements.some((el) => el.id === selectedId))
  const selected = selectedPage >= 0 ? flyer.pages[selectedPage].elements.find((el) => el.id === selectedId)! : null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500)
  }

  function editPage(index: number, fn: (els: FlyerEl[]) => FlyerEl[]) {
    setFlyer((f) => ({ pages: f.pages.map((p, i) => (i === index ? { ...p, elements: fn(p.elements) } : p)) }))
  }

  function addText() {
    checkpoint()
    const el = newText({ y: PAGE_H / 2 - 5 })
    editPage(activePage, (els) => [...els, el])
    setSelectedId(el.id)
    setEditingId(el.id)
  }

  async function addImages(files: File[], pageIndex: number, at?: { x: number; y: number }) {
    const added: ImageEl[] = []
    for (const file of files) {
      try {
        const { src, width, height } = await readImageFile(file)
        const ratio = width / height
        let w = PAGE_W * 0.7
        let h = w / ratio
        if (h > PAGE_H * 0.7) {
          h = PAGE_H * 0.7
          w = h * ratio
        }
        const cx = at?.x ?? PAGE_W / 2
        const cy = at?.y ?? PAGE_H / 2
        const off = added.length * 4
        added.push({
          id: uid(), type: 'image', src, opacity: 1,
          w: round1(w), h: round1(h), x: round1(cx - w / 2 + off), y: round1(cy - h / 2 + off),
        })
      } catch {
        showToast(`${file.name} couldn't be opened as an image.`)
      }
    }
    if (!added.length) return
    checkpoint()
    editPage(pageIndex, (els) => [...els, ...added])
    setActivePage(pageIndex)
    setSelectedId(added[added.length - 1].id)
  }

  function deleteSelected() {
    if (!selected) return
    checkpoint()
    editPage(selectedPage, (els) => els.filter((el) => el.id !== selected.id))
    setSelectedId(null)
    setEditingId(null)
  }

  function duplicateSelected() {
    if (!selected) return
    checkpoint()
    const copy = { ...selected, id: uid(), x: selected.x + 4, y: selected.y + 4 }
    editPage(selectedPage, (els) => [...els, copy])
    setSelectedId(copy.id)
  }

  function moveLayer(dir: LayerMove) {
    if (!selected) return
    checkpoint()
    editPage(selectedPage, (els) => {
      const i = els.findIndex((el) => el.id === selected.id)
      const rest = els.filter((_, j) => j !== i)
      const to =
        dir === 'front' ? rest.length
        : dir === 'back' ? 0
        : dir === 'forward' ? Math.min(i + 1, rest.length)
        : Math.max(i - 1, 0)
      rest.splice(to, 0, els[i])
      return rest
    })
  }

  function moveToOtherSide() {
    if (!selected) return
    checkpoint()
    const from = selectedPage
    const to = 1 - from
    setFlyer((f) => ({
      pages: f.pages.map((p, i) =>
        i === from ? { ...p, elements: p.elements.filter((el) => el.id !== selected.id) }
        : i === to ? { ...p, elements: [...p.elements, selected] }
        : p,
      ),
    }))
    setActivePage(to)
    showToast(`Moved to page ${to + 1} (${PAGE_NAMES[to].toLowerCase()})`)
  }

  function setBackground(index: number, color: string) {
    checkpoint(`bg${index}`)
    setFlyer((f) => ({ pages: f.pages.map((p, i) => (i === index ? { ...p, background: color } : p)) }))
  }

  function startOver() {
    checkpoint()
    setFlyer(emptyFlyer())
    setSelectedId(null)
    setEditingId(null)
    setActivePage(0)
  }

  async function runExport(kind: 'pdf' | 'png') {
    setEditingId(null)
    setBusy(kind)
    try {
      const b = bleed ? BLEED_MM : 0
      if (kind === 'pdf') await exportPdf(flyerRef.current, b)
      else await exportPngs(flyerRef.current, b)
    } catch (err) {
      showToast(`Export failed: ${(err as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  // ---- keyboard ------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (!selected) return
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      } else if (e.key === 'Enter' && selected.type === 'text') {
        e.preventDefault()
        checkpoint()
        setEditingId(selected.id)
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 5 : 0.5
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        checkpoint(`nudge:${selected.id}`)
        updateEl(selected.id, { x: round1(selected.x + dx), y: round1(selected.y + dy) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">A6 Flyer</span>
          <span className="brand-meta">105 × 148 mm · portrait · 2 pages</span>
        </div>

        <div className="toolgroup">
          <button type="button" className="btn" onClick={addText}>
            <span aria-hidden="true" className="btn-glyph">T</span> Add text
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <span aria-hidden="true" className="btn-glyph">▣</span> Add image
          </button>
          <input
            ref={fileRef}
            id="image-upload"
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length) void addImages(files, activePage)
            }}
          />
          <span className="toolgroup-note">to page {activePage + 1}</span>
        </div>

        <div className="toolgroup">
          <button type="button" className="btn btn-quiet" onClick={undo} disabled={!hist.undo} title="Undo (⌘Z)">
            Undo
          </button>
          <button type="button" className="btn btn-quiet" onClick={redo} disabled={!hist.redo} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <label className="check">
            <input id="guides" type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
            Guides
          </label>
        </div>

        <div className="toolgroup toolgroup-end">
          <label className="check" title="Adds 3 mm on every edge for professional printing">
            <input id="bleed" type="checkbox" checked={bleed} onChange={(e) => setBleed(e.target.checked)} />
            3 mm bleed
          </label>
          <button type="button" className="btn" disabled={!!busy} onClick={() => runExport('png')}>
            {busy === 'png' ? 'Rendering…' : 'PNGs'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => runExport('pdf')}>
            {busy === 'pdf' ? 'Rendering…' : 'Download PDF'}
          </button>
        </div>
      </header>

      <main
        ref={workspaceRef}
        className={'workspace' + (twoUp ? ' two-up' : '')}
        style={{ '--cm': `${s * 10}px` } as CSSProperties}
        onPointerDown={() => {
          setSelectedId(null)
          setEditingId(null)
        }}
      >
        {flyer.pages.map((page, i) => (
          <PageStage
            key={i}
            page={page}
            index={i}
            scale={s}
            active={activePage === i}
            selectedId={selectedPage === i ? selectedId : null}
            editingId={editingId}
            showGuides={showGuides}
            onActivate={() => {
              setActivePage(i)
              setSelectedId(null)
            }}
            onSelect={(id) => {
              setActivePage(i)
              setSelectedId(id)
              if (id !== editingId) setEditingId(null)
            }}
            onChange={updateEl}
            onCheckpoint={checkpoint}
            onStartEdit={(id) => {
              checkpoint()
              setEditingId(id)
            }}
            onEndEdit={() => setEditingId(null)}
            onDropFiles={(files, x, y) => void addImages(files, i, { x, y })}
          />
        ))}
      </main>

      <Inspector
        flyer={flyer}
        activePage={activePage}
        selected={selected}
        selectedPage={selectedPage}
        bleedMm={bleed ? BLEED_MM : 0}
        onPatch={(patch, key) => {
          if (!selected) return
          checkpoint(`${selected.id}:${key}`)
          updateEl(selected.id, patch)
        }}
        onBackground={setBackground}
        onLayer={moveLayer}
        onOtherSide={moveToOtherSide}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
        onStartOver={startOver}
        onReplaceImage={async (file) => {
          if (selected?.type !== 'image') return
          try {
            const { src, width, height } = await readImageFile(file)
            checkpoint()
            updateEl(selected.id, { src, h: round1(selected.w * (height / width)) })
          } catch {
            showToast(`${file.name} couldn't be opened as an image.`)
          }
        }}
      />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
