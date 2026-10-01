<script lang="ts">
  import { untrack } from 'svelte'
  import type { Session } from '../state/session.svelte'
  import { follow, scrollView, zoomView, type View } from '../state/view'

  let { session }: { session: Session } = $props()

  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let dragging: number | null = null

  const HANDLE_PX = 6
  const ZOOM_SPEED = 0.01

  const total = $derived(session.sample?.left.length ?? 0)
  let view = $state<View>({ start: 0, end: 1 })
  const zoomed = $derived(view.start > 0 || view.end < total)

  $effect(() => {
    view = { start: 0, end: Math.max(1, session.sample?.left.length ?? 1) }
  })

  $effect(() => {
    const frame = session.auditionFrame
    if (frame !== null && total > 0) view = follow(untrack(() => view), frame, total)
  })

  const frameOfX = (x: number) =>
    Math.max(0, Math.min(total - 1, Math.round(view.start + (x / width) * (view.end - view.start))))
  const xOfFrame = (frame: number) => ((frame - view.start) / (view.end - view.start)) * width

  const onwheel = (e: WheelEvent) => {
    if (!session.sample) return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      view = zoomView(view, frameOfX(e.offsetX), Math.exp(e.deltaY * ZOOM_SPEED), total)
      return
    }
    const horizontal = e.shiftKey ? e.deltaY : e.deltaX
    if (horizontal === 0 || !zoomed) return
    e.preventDefault()
    view = scrollView(view, (horizontal / width) * (view.end - view.start), total)
  }

  $effect(() => {
    canvas.addEventListener('wheel', onwheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onwheel)
  })

  const peaks = $derived.by(() => {
    const mono = session.sample?.mono
    if (!mono || width === 0) return null
    const columns = Math.floor(width)
    const min = new Float32Array(columns)
    const max = new Float32Array(columns)
    const per = (view.end - view.start) / columns
    for (let c = 0; c < columns; c++) {
      let lo = 0
      let hi = 0
      const from = Math.floor(view.start + c * per)
      const end = Math.min(mono.length, Math.max(from + 1, Math.floor(view.start + (c + 1) * per)))
      for (let i = from; i < end; i++) {
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
      if (m < view.start || m > view.end) return
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
    dragging = session.moveMarker(dragging, frameOfX(e.offsetX))
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
  {#each session.hits as hit, pad}
    {@const range = hit > 0 && session.pads[pad].sample === null ? session.sliceRange(pad) : null}
    {#if range}
      {#key hit}
        <div
          class="hit"
          style:left="{xOfFrame(range[0])}px"
          style:width="{Math.max(2, xOfFrame(range[1]) - xOfFrame(range[0]))}px"
        ></div>
      {/key}
    {/if}
  {/each}
  {#if session.auditionFrame !== null && session.sample}
    <div class="playhead" style:transform="translateX({xOfFrame(session.auditionFrame)}px)"></div>
  {/if}
  {#if zoomed}
    <div class="overview" aria-hidden="true">
      <span style:left="{(view.start / total) * 100}%" style:width="{((view.end - view.start) / total) * 100}%"></span>
    </div>
    <button class="fit" onclick={() => (view = { start: 0, end: total })}>全体</button>
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

  .hit {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent);
    opacity: 0;
    pointer-events: none;
    animation: hit 260ms ease-out;
  }

  @keyframes hit {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 0;
    }
  }

  .overview {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 4px;
    background: var(--line);
    pointer-events: none;
  }

  .overview span {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--muted);
  }

  .fit {
    position: absolute;
    right: 6px;
    bottom: 10px;
    padding: 2px 8px;
    font-size: 12px;
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
