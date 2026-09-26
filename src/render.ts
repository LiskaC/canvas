import { cssFont, PAGE_H, PAGE_NAMES, PAGE_W, PT_TO_MM, type Flyer, type Page, type TextEl } from './flyer'

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

/** Greedy line wrapping that mirrors `white-space: pre-wrap; overflow-wrap: anywhere`. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  const fits = (s: string) => ctx.measureText(s.trimEnd()).width <= maxWidth
  for (const para of text.split('\n')) {
    let line = ''
    for (let tok of para.match(/\S+|\s+/g) ?? []) {
      if (/^\s/.test(tok)) {
        line += tok
        continue
      }
      if (fits(line + tok)) {
        line += tok
        continue
      }
      if (line.trim()) out.push(line.trimEnd())
      while (!fits(tok) && tok.length > 1) {
        let i = tok.length - 1
        while (i > 1 && !fits(tok.slice(0, i))) i--
        out.push(tok.slice(0, i))
        tok = tok.slice(i)
      }
      line = tok
    }
    out.push(line.trimEnd())
  }
  return out
}

function drawText(ctx: CanvasRenderingContext2D, el: TextEl, s: number) {
  ctx.font = cssFont(el, s)
  ctx.fillStyle = el.color
  ctx.textAlign = el.align
  ctx.textBaseline = 'alphabetic'
  const width = el.w * s
  const lh = el.size * PT_TO_MM * s * el.lineHeight
  const ax = el.align === 'left' ? el.x * s : el.align === 'center' ? el.x * s + width / 2 : el.x * s + width
  const m = ctx.measureText('Hg')
  // Place the baseline the way CSS does: centre the font's content box in the line box.
  const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent
  const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent
  wrapLines(ctx, el.text, width).forEach((line, i) => {
    const baseline = el.y * s + i * lh + (lh - (asc + desc)) / 2 + asc
    ctx.fillText(line, ax, baseline)
  })
}

async function ensureFonts(flyer: Flyer) {
  const loads = flyer.pages
    .flatMap((p) => p.elements)
    .filter((el): el is TextEl => el.type === 'text')
    .map((el) => document.fonts.load(cssFont(el, 10), el.text || 'a'))
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

export async function exportPdf(flyer: Flyer, bleedMm: number) {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), ensureFonts(flyer)])
  const w = PAGE_W + bleedMm * 2
  const h = PAGE_H + bleedMm * 2
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [w, h] })
  for (let i = 0; i < flyer.pages.length; i++) {
    const canvas = await renderPage(flyer.pages[i], PRINT_PX_PER_MM, bleedMm)
    if (i > 0) pdf.addPage([w, h], 'portrait')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h)
  }
  saveBlob(pdf.output('blob'), bleedMm ? 'flyer-a6-bleed.pdf' : 'flyer-a6.pdf')
}

export async function exportPngs(flyer: Flyer, bleedMm: number) {
  await ensureFonts(flyer)
  for (let i = 0; i < flyer.pages.length; i++) {
    const canvas = await renderPage(flyer.pages[i], PRINT_PX_PER_MM, bleedMm)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (blob) saveBlob(blob, `flyer-page${i + 1}-${PAGE_NAMES[i].toLowerCase()}.png`)
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
