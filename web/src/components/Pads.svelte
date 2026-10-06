<script lang="ts">
  import { CATEGORY_LABELS } from '../classify/categories'
  import { padKeyLabel } from '../state/keymap'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const rows = [12, 8, 4, 0].map((start) => [0, 1, 2, 3].map((i) => start + i))
</script>

<div class="pads">
  {#each rows as row}
    {#each row as local}
      {@const pad = session.bankBase + local}
      <button
        class="pad"
        class:selected={session.selectedPad === pad}
        class:empty={!session.hasSound(pad)}
        class:own={session.pads[pad].sample !== null}
        onpointerdown={(e) => session.padDown(pad, e.timeStamp)}
      >
        {#key session.hits[pad]}<span class="flash" class:on={session.hits[pad] > 0}></span>{/key}
        <span class="key">{padKeyLabel(local)}</span>
        <span class="bottom">
          <span class="num label">{local + 1}</span>
          {#if session.labelOf(pad)}
            {@const label = session.labelOf(pad)!}
            <span class="category" class:unsure={!label.manual && label.confidence < 0.5}>
              {CATEGORY_LABELS[label.category]}
            </span>
          {/if}
        </span>
        {#if session.pads[pad].stretch || session.pads[pad].reverse}
          <span class="mode">{[session.pads[pad].stretch && '長', session.pads[pad].reverse && '逆'].filter(Boolean).join(' ')}</span>
        {/if}
      </button>
    {/each}
  {/each}
</div>

<style>
  .pads {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    width: min(100%, 340px);
    aspect-ratio: 1;
  }

  .pad {
    position: relative;
    overflow: hidden;
    padding: 6px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    user-select: none;
  }

  .pad.own {
    border-style: dashed;
  }

  .pad.selected {
    border-color: var(--accent);
  }

  .pad.empty {
    opacity: 0.45;
  }

  .key {
    font-size: 16px;
    font-weight: 700;
  }

  .bottom {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    width: 100%;
    gap: 4px;
  }

  .category {
    font-size: 11px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .category.unsure {
    color: var(--muted);
  }

  .label {
    font-size: 11px;
    color: var(--muted);
  }

  .mode {
    position: absolute;
    right: 6px;
    top: 6px;
    font-size: 10px;
    color: var(--accent);
  }

  .flash {
    position: absolute;
    inset: 0;
    background: var(--accent);
    opacity: 0;
    pointer-events: none;
  }

  .flash.on {
    animation: hit 220ms ease-out;
  }

  @keyframes hit {
    from {
      opacity: 0.55;
    }
    to {
      opacity: 0;
    }
  }
</style>
