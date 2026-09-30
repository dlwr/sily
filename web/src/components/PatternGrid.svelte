<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const rows = Array.from({ length: 16 }, (_, i) => i)
  const steps = $derived(Math.round(session.lengthBeats / session.grid))
  const wrap = (b: number) => ((b % session.lengthBeats) + session.lengthBeats) % session.lengthBeats
  const pct = (b: number) => `${(wrap(b) / session.lengthBeats) * 100}%`

  let drag: { id: string; x: number; width: number } | null = null

  const onRowDown = (e: PointerEvent, pad: number) => {
    if (e.target !== e.currentTarget || e.button !== 0) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const step = Math.floor(((e.clientX - rect.left) / rect.width) * steps)
    session.toggleStepAt(pad, step * session.grid)
  }

  const onEventDown = (e: PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button === 2) {
      session.remove(id)
      return
    }
    const row = (e.currentTarget as HTMLElement).parentElement!
    drag = { id, x: e.clientX, width: row.getBoundingClientRect().width }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onEventMove = (e: PointerEvent) => {
    if (!drag) return
    const delta = ((e.clientX - drag.x) / drag.width) * session.lengthBeats
    if (Math.abs(delta) < 0.001) return
    session.nudge(drag.id, delta)
    drag.x = e.clientX
  }
</script>

<div class="pattern" oncontextmenu={(e) => e.preventDefault()} role="grid" tabindex="-1">
  {#each rows as pad}
    <div class="row-wrap">
      <span class="num name" class:selected={session.selectedPad === pad}>{pad + 1}</span>
      <div
        class="row"
        style:--steps={steps}
        style:--beat-steps={1 / session.grid}
        role="row"
        tabindex="-1"
        onpointerdown={(e) => onRowDown(e, pad)}
      >
        {#each session.events.filter((ev) => ev.pad === pad) as ev (ev.id)}
          <span
            class="event"
            style:left={pct(ev.beat + ev.nudge)}
            style:opacity={0.4 + ev.velocity * 0.6}
            title="ドラッグでずらす / 右クリックで削除"
            role="gridcell"
            tabindex="-1"
            onpointerdown={(e) => onEventDown(e, ev.id)}
            onpointermove={onEventMove}
            onpointerup={() => (drag = null)}
          ></span>
        {/each}
      </div>
    </div>
  {/each}
  <div class="playhead" style:left="calc(28px + (100% - 28px) * {session.beat / session.lengthBeats})"></div>
</div>
<div class="footer">
  <span class="muted">空いたマスをクリックで置く / ノートはドラッグでずらす / 右クリックで削除</span>
  <button onclick={() => session.clearPattern()} disabled={session.events.length === 0}>パターン消去</button>
</div>

<style>
  .pattern {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    user-select: none;
  }

  .row-wrap {
    display: flex;
    align-items: center;
    height: 18px;
  }

  .name {
    width: 28px;
    font-size: 11px;
    color: var(--muted);
  }

  .name.selected {
    color: var(--accent);
    font-weight: 700;
  }

  .row {
    position: relative;
    flex: 1;
    height: 100%;
    background-color: var(--surface);
    background-image:
      linear-gradient(to right, var(--line) 1px, transparent 1px),
      linear-gradient(to right, #3a3c40 1px, transparent 1px);
    background-size:
      calc(100% / var(--steps)) 100%,
      calc(100% / var(--steps) * var(--beat-steps)) 100%;
    cursor: pointer;
  }

  .event {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 7px;
    margin-left: -1px;
    background: var(--accent);
    border-radius: 2px;
    cursor: ew-resize;
  }

  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--text);
    opacity: 0.6;
    pointer-events: none;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    font-size: 12px;
  }
</style>
