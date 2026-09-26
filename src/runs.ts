// Operations on rich-text runs. Offsets count characters across the whole text box.
import { resolveStyle, type Run, type RunStyle, type TextEl, type TextStyle } from './flyer'

export const STYLE_KEYS = ['bold', 'italic', 'underline', 'color', 'size', 'font'] as const
export type StyleKey = (typeof STYLE_KEYS)[number]

/** A style change; `undefined` for a key clears that override. */
export type StylePatch = { [K in StyleKey]?: RunStyle[K] | undefined }

export function plainText(runs: Run[]): string {
  return runs.map((r) => r.text).join('')
}

export function styleOf(run: RunStyle): RunStyle {
  const st: RunStyle = {}
  for (const k of STYLE_KEYS) if (run[k] !== undefined) (st as Record<string, unknown>)[k] = run[k]
  return st
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return STYLE_KEYS.every((k) => a[k] === b[k])
}

/** Drops empty runs and merges neighbours that look the same. */
export function normalize(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && sameStyle(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text }
    else out.push({ ...styleOf(r), text: r.text })
  }
  return out
}

/** Splits runs so that `pos` falls on a run boundary. */
function splitAt(runs: Run[], pos: number): Run[] {
  const out: Run[] = []
  let at = 0
  for (const r of runs) {
    const end = at + r.text.length
    if (pos > at && pos < end) {
      out.push({ ...r, text: r.text.slice(0, pos - at) }, { ...r, text: r.text.slice(pos - at) })
    } else out.push(r)
    at = end
  }
  return out
}

export function applyStyle(runs: Run[], start: number, end: number, patch: StylePatch): Run[] {
  let at = 0
  const out = splitAt(splitAt(runs, start), end).map((r) => {
    const from = at
    at += r.text.length
    if (from < start || at > end) return r
    const next: Run = { ...r }
    for (const k of Object.keys(patch) as StyleKey[]) {
      if (patch[k] === undefined) delete next[k]
      else (next as unknown as Record<string, unknown>)[k] = patch[k]
    }
    return next
  })
  return normalize(out)
}

/** Style of the character just before `pos` (or at it, at the very start): what typing there inherits. */
export function styleAt(runs: Run[], pos: number): RunStyle {
  let at = 0
  for (const r of runs) {
    at += r.text.length
    if (pos <= at && (pos > at - r.text.length || pos === 0)) return styleOf(r)
  }
  return runs.length ? styleOf(runs[runs.length - 1]) : {}
}

export function replaceText(runs: Run[], start: number, end: number, text: string, style?: RunStyle): Run[] {
  const st = style ?? styleAt(runs, start)
  let at = 0
  const kept: Run[] = []
  let inserted = false
  for (const r of splitAt(splitAt(runs, start), end)) {
    const from = at
    at += r.text.length
    if (!inserted && from >= start) {
      kept.push({ ...st, text })
      inserted = true
    }
    if (from >= start && at <= end && r.text.length) continue
    kept.push(r)
  }
  if (!inserted) kept.push({ ...st, text })
  return normalize(kept)
}

/** Resolved styles of every character range between start and end. */
export function stylesInRange(el: TextEl, start: number, end: number): TextStyle[] {
  const out: TextStyle[] = []
  let at = 0
  for (const r of el.runs) {
    const from = at
    at += r.text.length
    if (at > start && from < end) out.push(resolveStyle(el, r))
  }
  return out.length ? out : [resolveStyle(el, styleAt(el.runs, start))]
}

/** Removes one kind of override from every run, so the text box setting applies throughout. */
export function clearKey(runs: Run[], key: StyleKey): Run[] {
  return normalize(
    runs.map((r) => {
      const next = { ...r }
      delete next[key]
      return next
    }),
  )
}
