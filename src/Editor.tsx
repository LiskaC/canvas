import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import {
  blankPage,
  newText,
  PAGE_H,
  PAGE_NAMES,
  PAGE_W,
  round1,
  uid,
  type Flyer,
  type FlyerEl,
  type ImageEl,
  type TextEl,
} from './flyer'
import PageStage from './PageStage'
import Inspector from './Inspector'
import { exportPdf, exportPngs, readImageFile } from './render'
import { applyStyle, type StylePatch } from './runs'
import type { TextSel } from './RichText'

const BLEED_MM = 3
const PAD = 40
const LABEL_H = 36
const NARROW = '(max-width: 820px)'

export type LayerMove = 'front' | 'forward' | 'backward' | 'back'

function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(NARROW).matches,
  )
}

interface Props {
  projectName: string
  initial: Flyer
  onFlyerChange: (f: Flyer) => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export default function Editor({ projectName, initial, onFlyerChange, sidebarOpen, onToggleSidebar }: Props) {
  const [flyer, setFlyer] = useState<Flyer>(initial)
  const [activePage, setActivePage] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [textSel, setTextSel] = useState<TextSel | null>(null)
  const [showGuides, setShowGuides] = useState(true)
  const [bleed, setBleed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [hist, setHist] = useState({ undo: false, redo: false })
  const [ws, setWs] = useState({ w: 900, h: 700 })
  const narrow = useNarrow()

  const flyerRef = useRef(flyer)
  const past = useRef<Flyer[]>([])
  const future = useRef<Flyer[]>([])
  const lastKey = useRef<{ key: string; t: number } | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    flyerRef.current = flyer
    if (flyer !== initial) onFlyerChange(flyer)
  }, [flyer, initial, onFlyerChange])

  // ---- workspace size -> page scale ---------------------------------------
  useEffect(() => {
    const node = workspaceRef.current
    if (!node) return
    const ro = new ResizeObserver(() => setWs({ w: node.clientWidth, h: node.clientHeight }))
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const pageCount = flyer.pages.length
  const cols = pageCount === 2 && ws.w >= 620 ? 2 : 1
  const fitW = (ws.w - (narrow ? 32 : PAD * (cols + 1))) / (PAGE_W * cols)
  const fitH = (ws.h - PAD * 2 - LABEL_H) / PAGE_H
  // On narrow screens the workspace grows with its content, so only width can set the scale.
  const s = Math.max(1.2, Math.min(narrow ? fitW : Math.min(fitW, fitH), 7))

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

  function stopEditing() {
    setEditingId(null)
    setTextSel(null)
  }

  function travel(redo: boolean) {
    const from = redo ? future : past
    const to = redo ? past : future
    const target = from.current.pop()
    if (!target) return
    to.current.push(flyerRef.current)
    lastKey.current = null
    setFlyer(target)
    setActivePage((p) => Math.min(p, target.pages.length - 1))
    stopEditing()
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
  const editingSel =
    selected?.type === 'text' && editingId === selected.id && textSel && textSel.start !== textSel.end
      ? { start: Math.min(textSel.start, textSel.end), end: Math.max(textSel.start, textSel.end) }
      : null

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
    stopEditing()
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
    if (!selected || pageCount < 2) return
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

  function setPageCount(n: number) {
    if (n === pageCount) return
    checkpoint()
    if (n === 1) {
      const dropped = flyer.pages[1]
      setFlyer((f) => ({ pages: f.pages.slice(0, 1) }))
      setActivePage(0)
      if (selectedPage === 1) {
        setSelectedId(null)
        stopEditing()
      }
      if (dropped.elements.length) showToast('Page 2 removed. Undo brings it back.')
    } else {
      setFlyer((f) => ({ pages: [...f.pages, blankPage()] }))
    }
  }

  function setBackground(index: number, color: string) {
    checkpoint(`bg${index}`)
    setFlyer((f) => ({ pages: f.pages.map((p, i) => (i === index ? { ...p, background: color } : p)) }))
  }

  /** Formats the selected words while editing text. */
  function formatSelection(patch: StylePatch, key: string) {
    if (selected?.type !== 'text' || !editingSel) return
    checkpoint(`${selected.id}:fmt:${key}`)
    updateEl(selected.id, { runs: applyStyle(selected.runs, editingSel.start, editingSel.end, patch) } as Partial<TextEl>)
  }

  async function runExport(kind: 'pdf' | 'png') {
    stopEditing()
    setBusy(kind)
    try {
      const b = bleed ? BLEED_MM : 0
      if (kind === 'pdf') await exportPdf(flyerRef.current, b, projectName)
      else await exportPngs(flyerRef.current, b, projectName)
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
        travel(e.shiftKey)
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        travel(true)
        return
      }
      if (!selected || editingId) return
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
    <div className="editor">
      <header className="topbar">
        <div className="brand">
          <button
            type="button"
            className="btn btn-quiet btn-icon"
            onClick={onToggleSidebar}
            aria-pressed={sidebarOpen}
            title={sidebarOpen ? 'Hide projects' : 'Show projects'}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
              <path d="M6 2.5v11" stroke="currentColor" />
            </svg>
          </button>
          <div className="brand-text">
            <span className="brand-name">{projectName}</span>
            <span className="brand-meta">A6 · 105 × 148 mm</span>
          </div>
        </div>

        <div className="toolgroup">
          <div className="seg seg-inline" role="group" aria-label="Pages">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                className={'seg-btn' + (pageCount === n ? ' is-on' : '')}
                aria-pressed={pageCount === n}
                onClick={() => setPageCount(n)}
              >
                {n === 1 ? '1 page' : '2 pages'}
              </button>
            ))}
          </div>
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
        </div>

        <div className="toolgroup">
          <button type="button" className="btn btn-quiet" onClick={() => travel(false)} disabled={!hist.undo} title="Undo (⌘Z)">
            Undo
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => travel(true)} disabled={!hist.redo} title="Redo (⇧⌘Z)">
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
            {busy === 'png' ? 'Rendering…' : 'PNG'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => runExport('pdf')}>
            {busy === 'pdf' ? 'Rendering…' : 'Download PDF'}
          </button>
        </div>
      </header>

      <main
        ref={workspaceRef}
        className={'workspace' + (cols === 2 ? ' two-up' : '')}
        style={{ '--cm': `${s * 10}px` } as CSSProperties}
        onPointerDown={() => {
          setSelectedId(null)
          stopEditing()
        }}
      >
        {flyer.pages.map((page, i) => (
          <PageStage
            key={i}
            page={page}
            index={i}
            pageCount={pageCount}
            scale={s}
            active={activePage === i}
            selectedId={selectedPage === i ? selectedId : null}
            editingId={editingId}
            showGuides={showGuides}
            textSel={textSel}
            onTextSel={setTextSel}
            onUndo={travel}
            onActivate={() => {
              setActivePage(i)
              setSelectedId(null)
              stopEditing()
            }}
            onSelect={(id) => {
              setActivePage(i)
              setSelectedId(id)
              if (id !== editingId) stopEditing()
            }}
            onChange={updateEl}
            onCheckpoint={checkpoint}
            onStartEdit={(id) => {
              if (editingId === id) return
              checkpoint()
              setTextSel(null)
              setEditingId(id)
            }}
            onEndEdit={stopEditing}
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
        editing={!!selected && editingId === selected.id}
        textSel={editingSel}
        onFormat={formatSelection}
        onStartEdit={() => {
          if (selected?.type !== 'text') return
          checkpoint()
          setEditingId(selected.id)
        }}
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
