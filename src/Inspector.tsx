import { useRef, useState, type ReactNode } from 'react'
import type { LayerMove } from './App'
import { FONTS, fontStack, PAGE_H, PAGE_NAMES, PAGE_W, round1, type Align, type Flyer, type FlyerEl } from './flyer'
import { loadImage } from './render'

const SWATCHES = ['#ffffff', '#fbf4e6', '#f2d7d0', '#d9e8d5', '#17324f', '#1b1f1d', '#c8166b', '#f28c28']

interface Props {
  flyer: Flyer
  activePage: number
  selected: FlyerEl | null
  selectedPage: number
  bleedMm: number
  onPatch: (patch: Partial<FlyerEl>, key: string) => void
  onBackground: (page: number, color: string) => void
  onLayer: (dir: LayerMove) => void
  onOtherSide: () => void
  onDuplicate: () => void
  onDelete: () => void
  onStartOver: () => void
  onReplaceImage: (file: File) => void
}

export default function Inspector(props: Props) {
  const { selected: el } = props
  return (
    <aside className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      {!el && <PagePanel {...props} />}
      {el?.type === 'text' && <TextPanel {...props} />}
      {el?.type === 'image' && <ImagePanel {...props} />}
      {el && <ArrangePanel {...props} />}
    </aside>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      {children}
    </section>
  )
}

function NumField(p: {
  id: string
  label: string
  value: number
  unit: string
  step?: number
  min?: number
  onChange: (n: number) => void
}) {
  return (
    <label className="field field-num" htmlFor={p.id}>
      <span className="field-label">{p.label}</span>
      <span className="num">
        <input
          id={p.id}
          type="number"
          value={round1(p.value)}
          step={p.step ?? 0.5}
          min={p.min}
          onChange={(e) => {
            const n = parseFloat(e.target.value)
            if (!Number.isNaN(n)) p.onChange(n)
          }}
        />
        <span className="num-unit">{p.unit}</span>
      </span>
    </label>
  )
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="color-row">
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <code className="color-hex">{value.toUpperCase()}</code>
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={'swatch' + (c === value.toLowerCase() ? ' is-on' : '')}
            style={{ background: c }}
            aria-label={`Use ${c}`}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  )
}

function PagePanel({ flyer, activePage, onBackground, onStartOver }: Props) {
  const [confirming, setConfirming] = useState(false)
  const page = flyer.pages[activePage]
  return (
    <>
      <Section title={`Page ${activePage + 1} · ${PAGE_NAMES[activePage]}`}>
        <ColorField
          id="page-bg"
          label="Background"
          value={page.background}
          onChange={(c) => onBackground(activePage, c)}
        />
        <p className="hint">Click a page label to switch pages. New text and images go on the page you last clicked.</p>
      </Section>
      <Section title="How it works">
        <ul className="keys">
          <li><span>Drag</span> move an item; it snaps to the page centre (hold <kbd>Alt</kbd> to skip)</li>
          <li><span>Corners</span> resize; images keep their shape unless you hold <kbd>Shift</kbd></li>
          <li><span>Double-click</span> text to type on the page</li>
          <li><span>Drop</span> image files straight onto either page</li>
          <li><kbd>←↑→↓</kbd> nudge 0.5 mm, with <kbd>Shift</kbd> 5 mm</li>
          <li><kbd>⌘D</kbd> duplicate · <kbd>⌫</kbd> delete · <kbd>⌘Z</kbd> undo</li>
        </ul>
        <p className="hint">The dashed line marks a 4 mm safe margin. Printers may trim anything outside it.</p>
      </Section>
      <Section title="Flyer">
        <p className="hint">Your flyer saves automatically in this browser.</p>
        {confirming ? (
          <div className="btn-row">
            <button type="button" className="btn btn-danger" onClick={() => { onStartOver(); setConfirming(false) }}>
              Clear both pages
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)}>
            Start a blank flyer
          </button>
        )}
      </Section>
    </>
  )
}

function TextPanel({ selected, onPatch }: Props) {
  if (selected?.type !== 'text') return null
  const el = selected
  const aligns: { v: Align; label: string }[] = [
    { v: 'left', label: 'Left' },
    { v: 'center', label: 'Centre' },
    { v: 'right', label: 'Right' },
  ]
  return (
    <Section title="Text">
      <div className="field">
        <label className="field-label" htmlFor="text-content">Words</label>
        <textarea
          id="text-content"
          rows={4}
          value={el.text}
          onChange={(e) => onPatch({ text: e.target.value }, 'text')}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="text-font">Typeface</label>
        <select
          id="text-font"
          value={el.font}
          style={{ fontFamily: fontStack(el.font) }}
          onChange={(e) => onPatch({ font: e.target.value }, 'font')}
        >
          {FONTS.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: fontStack(f.family) }}>
              {f.family}
            </option>
          ))}
        </select>
      </div>
      <div className="grid2">
        <NumField id="text-size" label="Size" unit="pt" step={1} min={4} value={el.size} onChange={(n) => onPatch({ size: Math.max(4, n) }, 'size')} />
        <NumField id="text-lh" label="Line spacing" unit="×" step={0.05} min={0.7} value={el.lineHeight} onChange={(n) => onPatch({ lineHeight: Math.max(0.7, n) }, 'lh')} />
      </div>
      <div className="field">
        <span className="field-label">Style</span>
        <div className="seg">
          <button type="button" className={'seg-btn' + (el.bold ? ' is-on' : '')} aria-pressed={el.bold} onClick={() => onPatch({ bold: !el.bold }, 'bold')}>
            <b>Bold</b>
          </button>
          <button type="button" className={'seg-btn' + (el.italic ? ' is-on' : '')} aria-pressed={el.italic} onClick={() => onPatch({ italic: !el.italic }, 'italic')}>
            <i>Italic</i>
          </button>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Align</span>
        <div className="seg">
          {aligns.map((a) => (
            <button key={a.v} type="button" className={'seg-btn' + (el.align === a.v ? ' is-on' : '')} aria-pressed={el.align === a.v} onClick={() => onPatch({ align: a.v }, 'align')}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <ColorField id="text-color" label="Colour" value={el.color} onChange={(c) => onPatch({ color: c }, 'color')} />
      <div className="grid2">
        <NumField id="text-x" label="X" unit="mm" value={el.x} onChange={(n) => onPatch({ x: n }, 'x')} />
        <NumField id="text-y" label="Y" unit="mm" value={el.y} onChange={(n) => onPatch({ y: n }, 'y')} />
        <NumField id="text-w" label="Width" unit="mm" min={5} value={el.w} onChange={(n) => onPatch({ w: Math.max(5, n) }, 'w')} />
      </div>
      <button type="button" className="btn btn-quiet" onClick={() => onPatch({ x: round1((PAGE_W - el.w) / 2) }, 'center')}>
        Centre across page
      </button>
    </Section>
  )
}

function ImagePanel({ selected, bleedMm, onPatch, onReplaceImage }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  if (selected?.type !== 'image') return null
  const el = selected

  function fillPage() {
    const pw = PAGE_W + bleedMm * 2
    const ph = PAGE_H + bleedMm * 2
    const ratio = el.w / el.h
    const [w, h] = ratio > pw / ph ? [ph * ratio, ph] : [pw, pw / ratio]
    onPatch({ w: round1(w), h: round1(h), x: round1((PAGE_W - w) / 2), y: round1((PAGE_H - h) / 2) }, 'fill')
  }

  async function restoreShape() {
    const img = await loadImage(el.src)
    onPatch({ h: round1(el.w * (img.naturalHeight / img.naturalWidth)) }, 'shape')
  }

  return (
    <Section title="Image">
      <div className="grid2">
        <NumField id="img-x" label="X" unit="mm" value={el.x} onChange={(n) => onPatch({ x: n }, 'x')} />
        <NumField id="img-y" label="Y" unit="mm" value={el.y} onChange={(n) => onPatch({ y: n }, 'y')} />
        <NumField id="img-w" label="Width" unit="mm" min={3} value={el.w} onChange={(n) => onPatch({ w: Math.max(3, n) }, 'w')} />
        <NumField id="img-h" label="Height" unit="mm" min={3} value={el.h} onChange={(n) => onPatch({ h: Math.max(3, n) }, 'h')} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="img-opacity">
          Opacity <span className="field-value">{Math.round(el.opacity * 100)}%</span>
        </label>
        <input
          id="img-opacity"
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={el.opacity}
          onChange={(e) => onPatch({ opacity: parseFloat(e.target.value) }, 'opacity')}
        />
      </div>
      <div className="btn-row">
        <button type="button" className="btn" onClick={fillPage} title={bleedMm ? 'Covers the page including bleed' : 'Covers the whole page'}>
          Fill page
        </button>
        <button type="button" className="btn" onClick={() => void restoreShape()}>
          Restore proportions
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Replace…
        </button>
        <input
          ref={fileRef}
          id="img-replace"
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onReplaceImage(f)
          }}
        />
      </div>
    </Section>
  )
}

function ArrangePanel({ selectedPage, onLayer, onOtherSide, onDuplicate, onDelete }: Props) {
  const other = 1 - selectedPage
  return (
    <Section title="Arrange">
      <div className="field">
        <span className="field-label">Layer</span>
        <div className="seg seg-4">
          <button type="button" className="seg-btn" onClick={() => onLayer('front')} title="In front of everything">To front</button>
          <button type="button" className="seg-btn" onClick={() => onLayer('forward')} title="Up one layer">Forward</button>
          <button type="button" className="seg-btn" onClick={() => onLayer('backward')} title="Down one layer">Backward</button>
          <button type="button" className="seg-btn" onClick={() => onLayer('back')} title="Behind everything">To back</button>
        </div>
      </div>
      <button type="button" className="btn" onClick={onOtherSide}>
        Move to page {other + 1} ({PAGE_NAMES[other].toLowerCase()})
      </button>
      <div className="btn-row">
        <button type="button" className="btn" onClick={onDuplicate}>Duplicate</button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>Delete</button>
      </div>
    </Section>
  )
}
