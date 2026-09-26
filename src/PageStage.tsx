import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { fontStack, PAGE_H, PAGE_NAMES, PAGE_W, PT_TO_MM, round1, SAFE_MARGIN, type FlyerEl, type Page } from './flyer'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const IMAGE_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
// Text height follows its content, so text only resizes from the sides and bottom corners.
const TEXT_HANDLES: Handle[] = ['e', 'se', 'sw', 'w']
const SNAP_MM = 1.5

interface Props {
  page: Page
  index: number
  scale: number
  active: boolean
  selectedId: string | null
  editingId: string | null
  showGuides: boolean
  onActivate: () => void
  onSelect: (id: string | null) => void
  onChange: (id: string, patch: Partial<FlyerEl>) => void
  onCheckpoint: () => void
  onStartEdit: (id: string) => void
  onEndEdit: () => void
  onDropFiles: (files: File[], xMm: number, yMm: number) => void
}

export default function PageStage(props: Props) {
  const { page, index, scale: s, selectedId, editingId } = props
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const [snap, setSnap] = useState({ v: false, h: false })
  const [textH, setTextH] = useState(0)
  const selected = page.elements.find((el) => el.id === selectedId) ?? null

  // Track the rendered height of the selected text box so its selection frame fits.
  useEffect(() => {
    if (selected?.type !== 'text') return
    const node = nodes.current.get(selected.id)
    if (!node) return
    const ro = new ResizeObserver(() => setTextH(node.offsetHeight / s))
    ro.observe(node)
    return () => ro.disconnect()
  }, [selected?.id, selected?.type, s])

  function startDrag(e: ReactPointerEvent, el: FlyerEl, handle: Handle | null) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const node = nodes.current.get(el.id)
    const h = el.type === 'image' ? el.h : (node?.offsetHeight ?? 0) / s
    let moved = false

    const onMove = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return
        moved = true
        props.onCheckpoint()
      }
      const dx = (ev.clientX - startX) / s
      const dy = (ev.clientY - startY) / s

      if (!handle) {
        let x = el.x + dx
        let y = el.y + dy
        let v = false
        let hz = false
        if (!ev.altKey) {
          if (Math.abs(x + el.w / 2 - PAGE_W / 2) < SNAP_MM) {
            x = PAGE_W / 2 - el.w / 2
            v = true
          }
          if (Math.abs(y + h / 2 - PAGE_H / 2) < SNAP_MM) {
            y = PAGE_H / 2 - h / 2
            hz = true
          }
        }
        setSnap({ v, h: hz })
        props.onChange(el.id, { x: round1(x), y: round1(y) })
        return
      }

      const left = handle.includes('w')
      const right = handle.includes('e')
      const top = handle.includes('n')
      const bottom = handle.includes('s')
      let w = el.w + (right ? dx : left ? -dx : 0)

      if (el.type === 'text') {
        w = Math.max(w, 5)
        const patch: Partial<FlyerEl> = { w: round1(w), x: round1(left ? el.x + el.w - w : el.x) }
        if (bottom) Object.assign(patch, { size: Math.max(4, round1(el.size * (w / el.w))) })
        props.onChange(el.id, patch)
        return
      }

      let hh = el.h + (bottom ? dy : top ? -dy : 0)
      const corner = (left || right) && (top || bottom)
      if (corner && !ev.shiftKey) {
        const kx = w / el.w
        const ky = hh / el.h
        const k = Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky
        w = el.w * k
        hh = el.h * k
      }
      w = Math.max(w, 3)
      hh = Math.max(hh, 3)
      props.onChange(el.id, {
        w: round1(w),
        h: round1(hh),
        x: round1(left ? el.x + el.w - w : el.x),
        y: round1(top ? el.y + el.h - hh : el.y),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setSnap({ v: false, h: false })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const W = PAGE_W * s
  const H = PAGE_H * s
  const selH = selected ? (selected.type === 'image' ? selected.h : textH) : 0

  return (
    <div className={'page-wrap' + (props.active ? ' is-active' : '')}>
      <button type="button" className="page-label" onClick={props.onActivate}>
        <span className="page-label-name">
          Page {index + 1} · {PAGE_NAMES[index]}
        </span>
        <span className="page-label-size">105 × 148 mm</span>
      </button>
      <div
        className="page"
        style={{ width: W, height: H }}
        onPointerDown={(e) => {
          e.stopPropagation()
          props.onSelect(null)
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
          if (files.length) props.onDropFiles(files, (e.clientX - r.left) / s, (e.clientY - r.top) / s)
        }}
      >
        <div className="page-clip" style={{ background: page.background }}>
          {page.elements.map((el) => {
            const register = (n: HTMLDivElement | null) => {
              if (n) nodes.current.set(el.id, n)
              else nodes.current.delete(el.id)
            }
            const common = {
              ref: register,
              onPointerDown: (e: ReactPointerEvent) => {
                if (editingId === el.id) {
                  e.stopPropagation()
                  return
                }
                props.onSelect(el.id)
                startDrag(e, el, null)
              },
            }
            if (el.type === 'image') {
              return (
                <div
                  key={el.id}
                  {...common}
                  className="el el-image"
                  style={{ left: el.x * s, top: el.y * s, width: el.w * s, height: el.h * s, opacity: el.opacity }}
                >
                  <img src={el.src} alt="" draggable={false} />
                </div>
              )
            }
            const editing = editingId === el.id
            return (
              <div
                key={el.id + (editing ? '-edit' : '')}
                {...common}
                className={'el el-text' + (editing ? ' is-editing' : '')}
                onDoubleClick={() => props.onStartEdit(el.id)}
                style={{
                  left: el.x * s,
                  top: el.y * s,
                  width: el.w * s,
                  fontFamily: fontStack(el.font),
                  fontSize: el.size * PT_TO_MM * s,
                  fontWeight: el.bold ? 700 : 400,
                  fontStyle: el.italic ? 'italic' : 'normal',
                  lineHeight: el.lineHeight,
                  color: el.color,
                  textAlign: el.align,
                }}
              >
                {editing ? (
                  <EditableText
                    text={el.text}
                    onText={(text) => props.onChange(el.id, { text })}
                    onDone={props.onEndEdit}
                  />
                ) : (
                  el.text || '​'
                )}
              </div>
            )
          })}
        </div>

        {selected?.type === 'image' && (
          // Faded view of the parts of the selected image that hang off the page.
          <div
            className="ghost"
            style={{
              clipPath: `path(evenodd, "M -99999 -99999 H 99999 V 99999 H -99999 Z M 0 0 H ${W} V ${H} H 0 Z")`,
            }}
          >
            <img
              src={selected.src}
              alt=""
              draggable={false}
              onPointerDown={(e) => startDrag(e, selected, null)}
              style={{ left: selected.x * s, top: selected.y * s, width: selected.w * s, height: selected.h * s }}
            />
          </div>
        )}

        {props.showGuides && (
          <div className="guide-safe" style={{ inset: SAFE_MARGIN * s }} title="Keep text inside this line" />
        )}
        {snap.v && <div className="guide-snap guide-snap-v" />}
        {snap.h && <div className="guide-snap guide-snap-h" />}

        {selected && (
          <div
            className="selection"
            style={{ left: selected.x * s, top: selected.y * s, width: selected.w * s, height: selH * s }}
          >
            {editingId !== selected.id &&
              (selected.type === 'image' ? IMAGE_HANDLES : TEXT_HANDLES).map((hd) => (
                <span
                  key={hd}
                  className={`handle handle-${hd}`}
                  onPointerDown={(e) => startDrag(e, selected, hd)}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EditableText({ text, onText, onDone }: { text: string; onText: (t: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  // Uncontrolled while editing: React never rewrites the text under the caret.
  useLayoutEffect(() => {
    const n = ref.current
    if (!n) return
    n.textContent = text
    n.focus()
    const range = document.createRange()
    range.selectNodeContents(n)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // Only on mount; later text changes come from this element itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <span
      ref={ref}
      className="editable"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      onInput={(e) => onText(e.currentTarget.innerText.replace(/\n$/, ''))}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}
