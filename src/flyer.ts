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

// Text height is not stored: it follows from the width, font and content.
export interface TextEl extends BaseEl {
  type: 'text'
  text: string
  font: string
  size: number // points
  color: string
  bold: boolean
  italic: boolean
  align: Align
  lineHeight: number
}

export type FlyerEl = ImageEl | TextEl

export interface Page {
  background: string
  elements: FlyerEl[] // painted in order, last on top
}

export interface Flyer {
  pages: Page[] // [front, back]
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

/** CSS/canvas font shorthand for a text element at the given scale. */
export function cssFont(el: TextEl, pxPerMm: number): string {
  const px = el.size * PT_TO_MM * pxPerMm
  return `${el.italic ? 'italic ' : ''}${el.bold ? 700 : 400} ${px}px ${fontStack(el.font)}`
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export const round1 = (n: number) => Math.round(n * 10) / 10

export function newText(partial: Partial<TextEl> = {}): TextEl {
  return {
    id: uid(),
    type: 'text',
    x: 12,
    y: 60,
    w: 81,
    text: 'Your text here',
    font: 'Work Sans',
    size: 18,
    color: '#1b1f1d',
    bold: false,
    italic: false,
    align: 'center',
    lineHeight: 1.2,
    ...partial,
  }
}

export function emptyFlyer(): Flyer {
  return {
    pages: [
      { background: '#ffffff', elements: [] },
      { background: '#ffffff', elements: [] },
    ],
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
            text:
              '40+ local makers: ceramics, prints, textiles and wood\n\n' +
              'Live letterpress demos at 11am and 2pm\n\n' +
              'Street food from the Riverside kitchens\n\n' +
              'Free entry · Dogs welcome',
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
