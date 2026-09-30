import { describe, expect, it } from 'vitest'
import { follow, scrollView, zoomView } from './view'

const total = 10000

describe('zoomView', () => {
  it('halves the visible range when zooming in', () => {
    const v = zoomView({ start: 0, end: 10000 }, 5000, 0.5, total)
    expect(v.end - v.start).toBe(5000)
  })

  it('keeps the frame under the cursor in place', () => {
    const v = zoomView({ start: 0, end: 10000 }, 2000, 0.5, total)
    expect((2000 - v.start) / (v.end - v.start)).toBeCloseTo(0.2)
  })

  it('never zooms out past the whole sample', () => {
    expect(zoomView({ start: 1000, end: 9000 }, 5000, 4, total)).toEqual({ start: 0, end: 10000 })
  })

  it('never zooms in below the minimum width', () => {
    const v = zoomView({ start: 0, end: 1000 }, 500, 0.001, total, 256)
    expect(v.end - v.start).toBe(256)
  })

  it('stays inside the sample near the edges', () => {
    const v = zoomView({ start: 0, end: 10000 }, 9900, 0.5, total)
    expect([v.start >= 0, v.end <= total]).toEqual([true, true])
  })
})

describe('scrollView', () => {
  it('moves the range by the given frames', () => {
    expect(scrollView({ start: 1000, end: 3000 }, 500, total)).toEqual({ start: 1500, end: 3500 })
  })

  it('stops at the end of the sample', () => {
    expect(scrollView({ start: 7000, end: 9000 }, 5000, total)).toEqual({ start: 8000, end: 10000 })
  })

  it('stops at the start of the sample', () => {
    expect(scrollView({ start: 1000, end: 3000 }, -5000, total)).toEqual({ start: 0, end: 2000 })
  })
})

describe('follow', () => {
  it('leaves the view alone while the frame is visible', () => {
    expect(follow({ start: 1000, end: 3000 }, 2000, total)).toEqual({ start: 1000, end: 3000 })
  })

  it('pages forward when the frame runs off the right edge', () => {
    expect(follow({ start: 1000, end: 3000 }, 3100, total)).toEqual({ start: 3100, end: 5100 })
  })

  it('jumps back when the frame is before the view', () => {
    expect(follow({ start: 5000, end: 7000 }, 100, total)).toEqual({ start: 100, end: 2100 })
  })
})
