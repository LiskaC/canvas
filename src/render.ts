import {
  boxStyle,
  cssFont,
  PAGE_H,
  PAGE_NAMES,
  PAGE_W,
  PT_TO_MM,
  resolveStyle,
  type Flyer,
  type Page,
  type TextEl,
  type TextStyle,
} from './flyer'
import { plainText } from './runs'

const PRINT_DPI = 300
const PRINT_PX_PER_MM = PRINT_DPI / 25.4

const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not load image'))
      img.src = src
    })
    imageCache.set(src, p)
  }
  return p
}

interface Piece {
  text: string
  st: TextStyle
  font: string
  w: number
}

interface Tok {
  kind: 'word' | 'space' | 'nl'
  pieces: Piece[]
}

const tokWidth = (t: Tok) => t.pieces.reduce((n, p) => n + p.w, 0)

/**
 * Lays rich text out the way the browser does with `white-space: pre-wrap; overflow-wrap: anywhere`:
 * words break at spaces, spaces at a wrap hang off the line end, and over-long words break anywhere.
 */
function layoutLines(ctx: CanvasRenderingContext2D, el: TextEl, s: number, maxWidth: number): Piece[][] {
  const piece = (text: string, st: TextStyle): Piece => {
    const font = cssFont(st, s)
    ctx.font = font
    return { text, st, font, w: ctx.measureText(text).width }
  }
  const toks: Tok[] = []
  for (const run of el.runs) {
    const st = resolveStyle(el, run)
    for (const m of run.text.matchAll(/\n|[^\S\n]+|\S+/g)) {
      const text = m[0]
      const kind = text === '\n' ? 'nl' : /\s/.test(text[0]) ? 'space' : 'word'
      const last = toks[toks.length - 1]
      if (kind !== 'nl' && last?.kind === kind) last.pieces.push(piece(text, st))
      else toks.push({ kind, pieces: kind === 'nl' ? [] : [piece(text, st)] })
    }
  }

  const lines: Piece[][] = [[]]
  let width = 0 // including trailing spaces
  let hasWord = false
  const newLine = () => {
    lines.push([])
    width = 0
    hasWord = false
  }
  for (const tok of toks) {
    const line = () => lines[lines.length - 1]
    if (tok.kind === 'nl') {
      newLine()
      continue
    }
    const w = tokWidth(tok)
    if (tok.kind === 'space' || width + w <= maxWidth) {
      line().push(...tok.pieces)
      width += w
      hasWord ||= tok.kind === 'word'
      continue
    }
    if (hasWord) newLine()
    if (width + w <= maxWidth) {
      line().push(...tok.pieces)
      width += w
      hasWord = true
      continue
    }
    // A word wider than the box: break it between characters.
    for (const pc of tok.pieces) {
      for (const ch of pc.text) {
        const c = piece(ch, pc.st)
        if (hasWord && width + c.w > maxWidth) newLine()
        const cur = line()
        const last = cur[cur.length - 1]
        if (last && last.st === pc.st && last.text.trim()) {
          last.text += ch
          last.w += c.w
        } else cur.push(c)
        width += c.w
        hasWord = true
      }
    }
  }
  // A trailing newline does not open a new line in the browser either.
  if (lines.length > 1 && lines[lines.length - 1].length === 0 && plainText(el.runs).endsWith('\n')) lines.pop()
  return lines
}

const metricsCache = new Map<string, { asc: number; desc: number }>()

function fontMetrics(ctx: CanvasRenderingContext2D, font: string) {
  let m = metricsCache.get(font)
  if (!m) {
    ctx.font = font
    const tm = ctx.measureText('Hg')
    m = {
      asc: tm.fontBoundingBoxAscent ?? tm.actualBoundingBoxAscent,
      desc: tm.fontBoundingBoxDescent ?? tm.actualBoundingBoxDescent,
    }
    metricsCache.set(font, m)
  }
  return m
}

function drawText(ctx: CanvasRenderingContext2D, el: TextEl, s: number) {
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const width = el.w * s
  const strut = boxStyle(el)
  const lines = layoutLines(ctx, el, s, width).map((line) => {
    // CSS line box: every inline box sits on the baseline with its own half-leading around it.
    let above = 0
    let below = 0
    for (const st of [strut, ...line.map((p) => p.st)]) {
      const { asc, desc } = fontMetrics(ctx, cssFont(st, s))
      const half = (st.size * PT_TO_MM * s * el.lineHeight - (asc + desc)) / 2
      above = Math.max(above, asc + half)
      below = Math.max(below, desc + half)
    }
    return { line, above, below }
  })
  if (el.fill) {
    const pad = (el.padding ?? 0) * s
    const h = lines.reduce((n, l) => n + l.above + l.below, 0)
    ctx.fillStyle = el.fill
    ctx.fillRect(el.x * s - pad, el.y * s - pad, width + pad * 2, h + pad * 2)
  }
  let y = el.y * s
  for (const { line, above, below } of lines) {
    const baseline = y + above
    let end = line.length
    while (end > 0 && !line[end - 1].text.trim()) end--
    const used = line.slice(0, end).reduce((n, p) => n + p.w, 0)
    let x = el.x * s + (el.align === 'left' ? 0 : el.align === 'center' ? (width - used) / 2 : width - used)
    for (const p of line) {
      ctx.font = p.font
      ctx.fillStyle = p.st.color
      ctx.fillText(p.text, x, baseline)
      if (p.st.underline && p.text.trim()) {
        const px = p.st.size * PT_TO_MM * s
        ctx.fillRect(x, baseline + px * 0.11, p.w, Math.max(1, px * 0.06))
      }
      x += p.w
    }
    y = baseline + below
  }
}

async function ensureFonts(flyer: Flyer) {
  const loads: Promise<unknown>[] = []
  for (const el of flyer.pages.flatMap((p) => p.elements)) {
    if (el.type !== 'text') continue
    for (const st of [boxStyle(el), ...el.runs.map((r) => resolveStyle(el, r))]) {
      loads.push(document.fonts.load(cssFont(st, 10), plainText(el.runs) || 'a'))
    }
  }
  await Promise.all(loads)
}

export async function renderPage(page: Page, pxPerMm: number, bleedMm = 0): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((PAGE_W + bleedMm * 2) * pxPerMm)
  canvas.height = Math.round((PAGE_H + bleedMm * 2) * pxPerMm)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = page.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(bleedMm * pxPerMm, bleedMm * pxPerMm)
  for (const el of page.elements) {
    if (el.type === 'image') {
      const img = await loadImage(el.src)
      ctx.globalAlpha = el.opacity
      ctx.drawImage(img, el.x * pxPerMm, el.y * pxPerMm, el.w * pxPerMm, el.h * pxPerMm)
      ctx.globalAlpha = 1
    } else {
      drawText(ctx, el, pxPerMm)
    }
  }
  return canvas
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A safe file name from the project name. */
function fileBase(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flyer'
}

export async function exportPdf(flyer: Flyer, bleedMm: number, name: string) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), ensureFonts(flyer)])
  const w = PAGE_W + bleedMm * 2
  const h = PAGE_H + bleedMm * 2
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [w, h] })
  for (let i = 0; i < flyer.pages.length; i++) {
    const canvas = await renderPage(flyer.pages[i], PRINT_PX_PER_MM, bleedMm)
    if (i > 0) pdf.addPage([w, h], 'portrait')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h)
  }
  saveBlob(pdf.output('blob'), `${fileBase(name)}-a6${bleedMm ? '-bleed' : ''}.pdf`)
}

export async function exportPngs(flyer: Flyer, bleedMm: number, name: string) {
  await ensureFonts(flyer)
  for (let i = 0; i < flyer.pages.length; i++) {
    const canvas = await renderPage(flyer.pages[i], PRINT_PX_PER_MM, bleedMm)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (blob) saveBlob(blob, flyer.pages.length > 1 ? `${fileBase(name)}-page${i + 1}-${PAGE_NAMES[i].toLowerCase()}.png` : `${fileBase(name)}.png`)
  }
}

/** Reads an uploaded file, shrinking very large photos so autosave and export stay fast. */
export async function readImageFile(file: File): Promise<{ src: string; width: number; height: number }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
  const img = await loadImage(dataUrl)
  const MAX = 2400
  const long = Math.max(img.naturalWidth, img.naturalHeight)
  if (file.type === 'image/svg+xml' || long <= MAX) {
    return { src: dataUrl, width: img.naturalWidth || 400, height: img.naturalHeight || 400 }
  }
  const k = MAX / long
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * k)
  canvas.height = Math.round(img.naturalHeight * k)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const src = file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png')
  return { src, width: canvas.width, height: canvas.height }
}

/** Small preview of the front page for the project list. */
export async function thumbnail(flyer: Flyer): Promise<string> {
  await ensureFonts(flyer)
  const canvas = await renderPage(flyer.pages[0], 0.8)
  return canvas.toDataURL('image/jpeg', 0.75)
}
