export type View = { start: number; end: number }

const clampTo = (start: number, width: number, total: number): View => {
  const w = Math.min(width, total)
  const s = Math.max(0, Math.min(total - w, start))
  return { start: Math.round(s), end: Math.round(s + w) }
}

export const zoomView = (view: View, anchor: number, factor: number, total: number, minWidth = 256): View => {
  const width = view.end - view.start
  const next = Math.max(Math.min(minWidth, total), Math.min(total, width * factor))
  const ratio = (anchor - view.start) / width
  return clampTo(anchor - ratio * next, next, total)
}

export const scrollView = (view: View, delta: number, total: number): View =>
  clampTo(view.start + delta, view.end - view.start, total)

export const follow = (view: View, frame: number, total: number): View =>
  frame >= view.start && frame < view.end ? view : clampTo(frame, view.end - view.start, total)
