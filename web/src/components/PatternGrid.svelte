<script lang="ts">
  import { CATEGORY_LABELS } from '../classify/categories'
  import { padKeyLabel } from '../state/keymap'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const rows = Array.from({ length: 16 }, (_, i) => i)
  const steps = $derived(Math.round(session.patternBeats / session.grid))
  const wrap = (b: number) => ((b % session.patternBeats) + session.patternBeats) % session.patternBeats
  const pct = (b: number) => `${(wrap(b) / session.patternBeats) * 100}%`
  const position = $derived(session.songPosition())
  const showPlayhead = $derived(!session.songMode || session.song[position.index] === session.currentPattern)

  let drag: { id: string; x: number; width: number } | null = null
  let loops = $state(4)
  let exporting = $state(false)

  const exportWav = async () => {
    exporting = true
    try {
      await session.exportWav(session.songMode ? 1 : loops)
    } finally {
      exporting = false
    }
  }

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
    const delta = ((e.clientX - drag.x) / drag.width) * session.patternBeats
    if (Math.abs(delta) < 0.001) return
    session.nudge(drag.id, delta)
    drag.x = e.clientX
  }
</script>

<div class="pattern" oncontextmenu={(e) => e.preventDefault()} role="grid" tabindex="-1">
  {#each rows as pad}
    {@const label = session.labelOf(pad)}
    <div class="row-wrap" class:empty={!session.hasSound(pad)} class:silenced={!session.audible(pad)}>
      <button class="name" class:selected={session.selectedPad === pad} onclick={() => (session.selectedPad = pad)}>
        <span class="key">{padKeyLabel(pad)}</span>
        <span class="category">{label ? CATEGORY_LABELS[label.category] : ''}</span>
      </button>
      <button class="toggle" aria-pressed={session.muted[pad]} onclick={() => session.toggleMute(pad)} title="ミュート">M</button>
      <button class="toggle" aria-pressed={session.soloed[pad]} onclick={() => session.toggleSolo(pad)} title="ソロ">S</button>
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
            class:auto={ev.auto}
            class:stand-in={ev.auto && ev.standIn}
            style:left={pct(ev.beat + ev.nudge)}
            style:opacity={0.25 + ev.velocity * 0.75}
            title="ドラッグでずらす / ホイールで音程 / Alt+ホイールで強さ / 右クリックで削除"
            role="gridcell"
            tabindex="-1"
            onpointerdown={(e) => onEventDown(e, ev.id)}
            onpointermove={onEventMove}
            onpointerup={() => (drag = null)}
            onwheel={(e) => {
              e.preventDefault()
              if (e.altKey) session.changeVelocity(ev.id, e.deltaY < 0 ? 0.05 : -0.05)
              else session.shiftPitch(ev.id, e.deltaY < 0 ? 1 : -1)
            }}
          >{#if ev.pitch !== 0}<span class="pitch num">{ev.pitch > 0 ? '+' : ''}{ev.pitch}</span>{/if}</span>
        {/each}
      </div>
    </div>
  {/each}
  {#if showPlayhead}
    <div class="playhead" style:left="calc(var(--name-width) + (100% - var(--name-width)) * {position.beat / session.patternBeats})"></div>
  {/if}
</div>
<div class="footer">
  <span class="muted">枠だけのノートは自動で組んだもの（点線は、足りない役を近い音で代役させたもの） / 空いたマスをクリックで置く / ノートはドラッグでずらす・ホイールで音程・Alt+ホイールで強さ / 右クリックで削除</span>
  <div class="actions">
    {#if !session.songMode}
      <select bind:value={loops} title="書き出す周回数">
        {#each [1, 4, 8] as n}<option value={n}>{n}周</option>{/each}
      </select>
    {/if}
    <button onclick={exportWav} disabled={exporting || (!session.songMode && session.events.length === 0)}>
      {exporting ? '書き出し中…' : session.songMode ? '曲を WAV 書き出し' : 'WAV 書き出し'}
    </button>
    <button onclick={() => session.clearPattern()} disabled={session.events.length === 0}>パターン消去</button>
  </div>
</div>

<style>
  .pattern {
    --name-width: 128px;
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

  .row-wrap.empty {
    opacity: 0.4;
  }

  .row-wrap.silenced .row {
    opacity: 0.35;
  }

  .toggle {
    width: 20px;
    height: 100%;
    padding: 0;
    margin-right: 2px;
    font-size: 10px;
    line-height: 1;
  }

  .toggle[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }

  .name {
    display: flex;
    gap: 6px;
    align-items: baseline;
    width: calc(var(--name-width) - 44px);
    height: 100%;
    padding: 0 4px 0 0;
    background: none;
    border: none;
    font-size: 11px;
    color: var(--muted);
    text-align: left;
    cursor: pointer;
  }

  .name .key {
    width: 12px;
    font-weight: 700;
  }

  .name .category {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .name.selected {
    color: var(--accent);
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

  .event.auto {
    background: transparent;
    border: 2px solid var(--accent);
  }

  .event.stand-in {
    border-style: dashed;
  }

  .pitch {
    position: absolute;
    left: 9px;
    top: -1px;
    font-size: 10px;
    color: var(--text);
    pointer-events: none;
    white-space: nowrap;
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

  .actions {
    display: flex;
    gap: 6px;
  }

  .footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    font-size: 12px;
  }
</style>
