<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let dragging: number | null = null

  const HANDLE_PX = 6

  const frameOfX = (x: number) => {
    const len = session.sample?.left.length ?? 0
    return Math.max(0, Math.min(len - 1, Math.round((x / width) * len)))
  }
  const xOfFrame = (frame: number) => (frame / (session.sample?.left.length ?? 1)) * width

  const peaks = $derived.by(() => {
    const mono = session.sample?.mono
    if (!mono || width === 0) return null
    const columns = Math.floor(width)
    const min = new Float32Array(columns)
    const max = new Float32Array(columns)
    const per = mono.length / columns
    for (let c = 0; c < columns; c++) {
      let lo = 0
      let hi = 0
      const end = Math.min(mono.length, Math.floor((c + 1) * per))
      for (let i = Math.floor(c * per); i < end; i++) {
        const v = mono[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      min[c] = lo
      max[c] = hi
    }
    return { min, max }
  })

  $effect(() => {
    const ctx = canvas.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const css = getComputedStyle(canvas)
    const color = (name: string) => css.getPropertyValue(name).trim()
    const mid = height / 2

    const selected = session.sliceRange(session.selectedPad)
    if (selected) {
      ctx.fillStyle = color('--accent-soft')
      ctx.fillRect(xOfFrame(selected[0]), 0, xOfFrame(selected[1]) - xOfFrame(selected[0]), height)
    }

    if (peaks) {
      ctx.fillStyle = color('--wave')
      for (let c = 0; c < peaks.min.length; c++) {
        const top = mid - peaks.max[c] * mid * 0.95
        const bottom = mid - peaks.min[c] * mid * 0.95
        ctx.fillRect(c, top, 1, Math.max(1, bottom - top))
      }
    }

    ctx.font = '600 12px system-ui, sans-serif'
    session.markers.forEach((m, i) => {
      const x = Math.round(xOfFrame(m)) + 0.5
      ctx.strokeStyle = color('--marker')
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      const pad = session.padSlices.indexOf(i)
      if (pad >= 0) {
        ctx.fillStyle = color('--marker')
        ctx.fillRect(x, 0, 18, 16)
        ctx.fillStyle = '#111'
        ctx.fillText(String(pad + 1), x + 3, 12)
      }
    })
  })

  const markerNear = (x: number) => session.markers.find((m) => Math.abs(xOfFrame(m) - x) <= HANDLE_PX) ?? null

  const onpointerdown = (e: PointerEvent) => {
    if (!session.sample) return
    const x = e.offsetX
    if (e.button === 2 || e.altKey) {
      session.removeMarkerNear(frameOfX(x), (HANDLE_PX / width) * session.sample.left.length)
      return
    }
    if (e.shiftKey) {
      session.addMarker(frameOfX(x))
      return
    }
    const near = markerNear(x)
    if (near !== null) {
      dragging = near
      canvas.setPointerCapture(e.pointerId)
      return
    }
    session.auditionFrom(frameOfX(x))
  }

  const onpointermove = (e: PointerEvent) => {
    if (dragging === null) {
      canvas.style.cursor = markerNear(e.offsetX) !== null ? 'ew-resize' : 'crosshair'
      return
    }
    const to = frameOfX(e.offsetX)
    session.moveMarker(dragging, to)
    dragging = to
  }
</script>

<div class="wave" bind:clientWidth={width} bind:clientHeight={height}>
  <canvas
    bind:this={canvas}
    style:width="{width}px"
    style:height="{height}px"
    {onpointerdown}
    {onpointermove}
    onpointerup={() => (dragging = null)}
    oncontextmenu={(e) => e.preventDefault()}
    ondblclick={(e) => session.assignSliceAt(frameOfX(e.offsetX))}
  ></canvas>
  {#if session.auditionFrame !== null && session.sample}
    <div class="playhead" style:transform="translateX({xOfFrame(session.auditionFrame)}px)"></div>
  {/if}
  {#if !session.sample}
    <p class="empty">音声ファイルをドロップ、または下の「PCの音を録音」で鳴っている音を取り込む</p>
  {/if}
</div>

<style>
  .wave {
    position: relative;
    height: 180px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 3px;
    overflow: hidden;
  }

  canvas {
    display: block;
    cursor: crosshair;
    touch-action: none;
  }

  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: var(--accent);
    pointer-events: none;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--muted);
    pointer-events: none;
  }
</style>
