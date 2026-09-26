// A6 portrait, in millimetres. All element geometry is stored in mm.
export const PAGE_W = 105
export const PAGE_H = 148
export const PT_TO_MM = 25.4 / 72
export const SAFE_MARGIN = 4
export const PAGE_NAMES = ['Front', 'Back'] as const

export type Align = 'left' | 'center' | 'right'

interface BaseEl {
  id: string
  x: number
  y: number
  w: number
}

export interface ImageEl extends BaseEl {
  type: 'image'
  h: number
  src: string
  opacity: number
}

/** Character formatting. On a run, each key overrides the text box's own setting. */
export interface RunStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  size?: number // points
  font?: string
}

export interface Run extends RunStyle {
  text: string
}

export type TextStyle = Required<RunStyle>

// Text height is not stored: it follows from the width, font and content.
export interface TextEl extends BaseEl {
  type: 'text'
  runs: Run[]
  font: string
  size: number // points
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
  align: Align
  lineHeight: number
  fill?: string // box background; none when unset
  padding?: number // mm the background extends past the text on every side
}

export type FlyerEl = ImageEl | TextEl

export interface Page {
  background: string
  elements: FlyerEl[] // painted in order, last on top
}

export interface Flyer {
  pages: Page[] // [front] or [front, back]
}

export const FONTS: { family: string; fallback: string }[] = [
  { family: 'Work Sans', fallback: 'sans-serif' },
  { family: 'Bricolage Grotesque', fallback: 'sans-serif' },
  { family: 'Archivo Black', fallback: 'sans-serif' },
  { family: 'Fraunces', fallback: 'serif' },
  { family: 'DM Serif Display', fallback: 'serif' },
  { family: 'Caveat', fallback: 'cursive' },
  { family: 'Space Mono', fallback: 'monospace' },
]

export function fontStack(family: string): string {
  const f = FONTS.find((x) => x.family === family)
  return `"${family}", ${f?.fallback ?? 'sans-serif'}`
}

/** The text box's own style, used where a run sets nothing. */
export function boxStyle(el: TextEl): TextStyle {
  const { bold, italic, underline, color, size, font } = el
  return { bold, italic, underline, color, size, font }
}

export function resolveStyle(el: TextEl, run: RunStyle): TextStyle {
  return {
    bold: run.bold ?? el.bold,
    italic: run.italic ?? el.italic,
    underline: run.underline ?? el.underline,
    color: run.color ?? el.color,
    size: run.size ?? el.size,
    font: run.font ?? el.font,
  }
}

/** CSS/canvas font shorthand at the given scale. */
export function cssFont(st: TextStyle, pxPerMm: number): string {
  const px = st.size * PT_TO_MM * pxPerMm
  return `${st.italic ? 'italic ' : ''}${st.bold ? 700 : 400} ${px}px ${fontStack(st.font)}`
}

/** Inline style for one run, as plain strings so it works for React and the DOM alike. */
export function spanStyle(st: TextStyle, pxPerMm: number): Record<string, string> {
  return {
    fontFamily: fontStack(st.font),
    fontSize: `${st.size * PT_TO_MM * pxPerMm}px`,
    fontWeight: st.bold ? '700' : '400',
    fontStyle: st.italic ? 'italic' : 'normal',
    color: st.color,
    textDecoration: st.underline ? 'underline' : 'none',
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export const round1 = (n: number) => Math.round(n * 10) / 10

export function newText(partial: Partial<TextEl> & { text?: string } = {}): TextEl {
  const { text = 'Your text here', ...rest } = partial
  return {
    id: uid(),
    type: 'text',
    x: 12,
    y: 60,
    w: 81,
    runs: [{ text }],
    font: 'Work Sans',
    size: 18,
    color: '#1b1f1d',
    bold: false,
    italic: false,
    underline: false,
    align: 'center',
    lineHeight: 1.2,
    ...rest,
  }
}

export function blankPage(): Page {
  return { background: '#ffffff', elements: [] }
}

export function emptyFlyer(pageCount = 2): Flyer {
  return { pages: Array.from({ length: pageCount }, blankPage) }
}

/** Brings flyers saved by older versions up to the current shape. */
export function migrateFlyer(f: Flyer): Flyer {
  return {
    pages: f.pages.map((p) => ({
      ...p,
      elements: p.elements.map((el) => {
        if (el.type !== 'text') return el
        const old = el as TextEl & { text?: string }
        if (old.runs) return el
        const { text = '', ...rest } = old
        return { ...rest, runs: [{ text }], underline: false }
      }),
    })),
  }
}

function svgUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

function sunSvg(): string {
  let rays = ''
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const x1 = 200 + Math.cos(a) * 140
    const y1 = 200 + Math.sin(a) * 140
    const x2 = 200 + Math.cos(a) * 185
    const y2 = 200 + Math.sin(a) * 185
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`
  }
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">` +
      `<circle cx="200" cy="200" r="115" fill="#f28c28"/>` +
      `<g stroke="#f28c28" stroke-width="16" stroke-linecap="round">${rays}</g></svg>`,
  )
}

function riverSvg(): string {
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="420" viewBox="0 0 1050 420">` +
      `<path d="M0 90 Q 130 20 262 90 T 525 90 T 787 90 T 1050 90 V 420 H 0 Z" fill="#2f6fa3"/>` +
      `<path d="M0 200 Q 130 130 262 200 T 525 200 T 787 200 T 1050 200 V 420 H 0 Z" fill="#4c8fc4"/>` +
      `</svg>`,
  )
}

/** An example flyer so the editor opens showing what it can do. */
export function sampleFlyer(): Flyer {
  return {
    pages: [
      {
        background: '#17324f',
        elements: [
          { id: uid(), type: 'image', src: sunSvg(), x: 58, y: -12, w: 60, h: 60, opacity: 1 },
          { id: uid(), type: 'image', src: riverSvg(), x: -3, y: 108, w: 111, h: 44.4, opacity: 1 },
          newText({
            x: 10, y: 40, w: 85, text: 'Riverside\nMakers\nMarket', font: 'DM Serif Display',
            size: 36, color: '#fbf4e6', align: 'left', lineHeight: 1.0,
          }),
          newText({
            x: 10, y: 84, w: 85, text: 'Sat 12 October · 10am–4pm', size: 12,
            bold: true, color: '#f28c28', align: 'left',
          }),
          newText({
            x: 10, y: 91, w: 85, text: 'Old Corn Exchange, Bridge Street', size: 10,
            color: '#fbf4e6', align: 'left',
          }),
        ],
      },
      {
        background: '#fbf4e6',
        elements: [
          newText({
            x: 10, y: 14, w: 85, text: "What's on", font: 'Fraunces', size: 24,
            bold: true, color: '#17324f', align: 'left',
          }),
          newText({
            x: 10, y: 30, w: 85, size: 10.5, color: '#1b1f1d', align: 'left', lineHeight: 1.45,
            runs: [
              { text: '40+ local makers', bold: true },
              { text: ': ceramics, prints, textiles and wood\n\n' },
              { text: 'Live letterpress demos', bold: true },
              { text: ' at 11am and 2pm\n\n' },
              { text: 'Street food', bold: true },
              { text: ' from the Riverside kitchens\n\n' },
              { text: 'Free entry', bold: true, color: '#c8166b' },
              { text: ' · Dogs welcome' },
            ],
          }),
          newText({
            x: 10, y: 128, w: 85, text: 'riversidemakers.example', font: 'Space Mono',
            size: 8, color: '#17324f', align: 'left',
          }),
        ],
      },
    ],
  }
}
