import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { resolveStyle, spanStyle, type Run, type RunStyle, type TextEl } from './flyer'
import { applyStyle, normalize, plainText, replaceText, styleAt, stylesInRange, type StyleKey } from './runs'

export interface TextSel {
  start: number
  end: number
}

/** Read-only rendering of a text box's runs. */
export function RunSpans({ el, scale }: { el: TextEl; scale: number }) {
  if (!el.runs.length) return <>{'​'}</>
  return (
    <>
      {el.runs.map((r, i) => (
        <span key={i} style={spanStyle(resolveStyle(el, r), scale)}>
          {r.text}
        </span>
      ))}
    </>
  )
}

// ---- DOM <-> runs ------------------------------------------------------------

function fillDom(root: HTMLElement, el: TextEl, scale: number) {
  root.textContent = ''
  for (const r of el.runs) {
    const span = document.createElement('span')
    const { text, ...style } = r
    span.dataset.style = JSON.stringify(style)
    Object.assign(span.style, spanStyle(resolveStyle(el, r), scale))
    span.textContent = text
    root.append(span)
  }
  // Lets the caret sit on the empty line after a trailing newline.
  if (plainText(el.runs).endsWith('\n')) {
    const br = document.createElement('br')
    br.dataset.trail = ''
    root.append(br)
  }
}

function readDom(root: HTMLElement): Run[] {
  const runs: Run[] = []
  const visit = (node: Node, style: RunStyle) => {
    for (const child of node.childNodes) {
      if (child instanceof Text) runs.push({ ...style, text: child.data })
      else if (child instanceof HTMLBRElement) {
        if (!('trail' in child.dataset)) runs.push({ ...style, text: '\n' })
      } else if (child instanceof HTMLElement) {
        const own = child.dataset.style ? (JSON.parse(child.dataset.style) as RunStyle) : style
        if (child.tagName === 'DIV' && runs.length && !plainText(runs).endsWith('\n')) {
          runs.push({ ...style, text: '\n' })
        }
        visit(child, own)
      }
    }
  }
  visit(root, {})
  return normalize(runs)
}

function isCounted(n: Node): boolean {
  return n instanceof Text || (n instanceof HTMLBRElement && !('trail' in n.dataset))
}

function pointToOffset(root: HTMLElement, node: Node, offset: number): number {
  const point = document.createRange()
  point.setStart(node, offset)
  let count = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!isCounted(n)) continue
    if (n === node) return count + offset
    if (point.comparePoint(n, 0) >= 0) break
    count += n instanceof Text ? n.data.length : 1
  }
  return count
}

function offsetToPoint(root: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let left = offset
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof Text) {
      if (left <= n.data.length) return [n, left]
      left -= n.data.length
    } else if (isCounted(n)) {
      if (left === 0) return [n.parentNode!, [...n.parentNode!.childNodes].indexOf(n as ChildNode)]
      left -= 1
    }
  }
  return [root, root.childNodes.length]
}

function readSelection(root: HTMLElement): TextSel | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null
  return { start: pointToOffset(root, r.startContainer, r.startOffset), end: pointToOffset(root, r.endContainer, r.endOffset) }
}

function rangeFor(root: HTMLElement, s: TextSel): Range {
  const r = document.createRange()
  r.setStart(...offsetToPoint(root, s.start))
  r.setEnd(...offsetToPoint(root, s.end))
  return r
}

function writeSelection(root: HTMLElement, s: TextSel) {
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(rangeFor(root, s))
}

const HIGHLIGHT = 'flyer-text-selection'
const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'

// ---- editor -------------------------------------------------------------------

interface Props {
  el: TextEl
  scale: number
  sel: TextSel | null
  onRuns: (runs: Run[]) => void
  onSelection: (sel: TextSel) => void
  onExit: () => void
  onUndo: (redo: boolean) => void
}

/**
 * Edits a text box in place. The DOM is rebuilt from the runs after every change, so it only
 * ever holds the spans this component wrote, and formatting lives in the runs, not in the markup.
 */
export function RichEditor({ el, scale, sel, onRuns, onSelection, onExit, onUndo }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const pending = useRef<RunStyle | null>(null) // formatting for the next typed characters
  const nextSel = useRef<TextSel | null>(null)
  const firstRender = useRef(true)
  const [focused, setFocused] = useState(false)

  useLayoutEffect(() => {
    const root = ref.current!
    const live = document.activeElement === root ? readSelection(root) : null
    fillDom(root, el, scale)
    if (firstRender.current) {
      firstRender.current = false
      root.focus()
      const all = { start: 0, end: plainText(el.runs).length }
      writeSelection(root, all)
      onSelection(all)
      return
    }
    const want = nextSel.current ?? live
    nextSel.current = null
    if (want && document.activeElement === root) writeSelection(root, want)
    // Rebuilding the DOM from runs is only needed when they change, and callbacks are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, scale])

  // Keep the selected words visibly marked while the side panel has focus.
  useEffect(() => {
    if (!canHighlight) return
    const root = ref.current
    if (!root || focused || !sel || sel.start === sel.end) {
      CSS.highlights.delete(HIGHLIGHT)
      return
    }
    CSS.highlights.set(HIGHLIGHT, new Highlight(rangeFor(root, sel)))
    return () => {
      CSS.highlights.delete(HIGHLIGHT)
    }
  }, [el, scale, sel, focused])

  useEffect(() => {
    const onChange = () => {
      const root = ref.current
      if (!root || document.activeElement !== root) return
      const s = readSelection(root)
      if (s) onSelection(s)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [onSelection])

  function commit(runs: Run[], caret: TextSel) {
    nextSel.current = caret
    onRuns(runs)
  }

  function toggle(key: Extract<StyleKey, 'bold' | 'italic' | 'underline'>) {
    const s = readSelection(ref.current!)
    if (!s) return
    const [a, b] = [Math.min(s.start, s.end), Math.max(s.start, s.end)]
    if (a === b) {
      const current = pending.current?.[key] ?? resolveStyle(el, styleAt(el.runs, a))[key]
      pending.current = { ...pending.current, [key]: !current }
      return
    }
    const allOn = stylesInRange(el, a, b).every((st) => st[key])
    commit(applyStyle(el.runs, a, b, { [key]: !allOn }), { start: a, end: b })
  }

  function insert(text: string) {
    const s = readSelection(ref.current!)
    if (!s) return
    const [a, b] = [Math.min(s.start, s.end), Math.max(s.start, s.end)]
    const style = pending.current ? { ...styleAt(el.runs, a), ...pending.current } : undefined
    pending.current = null
    commit(replaceText(el.runs, a, b, text, style), { start: a + text.length, end: a + text.length })
  }

  return (
    <div
      ref={ref}
      className="editable"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPointerDown={() => {
        pending.current = null
      }}
      onBeforeInput={(e) => {
        // Typed characters go through the runs so pending formatting (e.g. ⌘B then type) applies.
        const ne = e.nativeEvent as InputEvent
        if (ne.isComposing || ne.inputType !== 'insertText' || !ne.data) return
        e.preventDefault()
        insert(ne.data)
      }}
      onInput={(e) => {
        // Deletions, spellcheck and IME input: let the browser edit, then read the result back.
        if ((e.nativeEvent as InputEvent).isComposing) return
        const root = e.currentTarget
        const s = readSelection(root)
        commit(readDom(root), s ?? { start: 0, end: 0 })
      }}
      onCompositionEnd={(e) => {
        const root = e.currentTarget
        commit(readDom(root), readSelection(root) ?? { start: 0, end: 0 })
      }}
      onPaste={(e) => {
        e.preventDefault()
        insert(e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'))
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        const mod = e.metaKey || e.ctrlKey
        const k = e.key.toLowerCase()
        if (e.key === 'Escape') onExit()
        else if (e.key === 'Enter') {
          e.preventDefault()
          insert('\n')
        } else if (mod && (k === 'b' || k === 'i' || k === 'u')) {
          e.preventDefault()
          toggle(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline')
        } else if (mod && (k === 'z' || k === 'y')) {
          e.preventDefault()
          onUndo(k === 'y' || e.shiftKey)
        } else if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
          pending.current = null
        }
      }}
    />
  )
}
