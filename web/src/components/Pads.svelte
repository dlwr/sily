<script lang="ts">
  import { padKeyLabel } from '../state/keymap'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const rows = [12, 8, 4, 0].map((start) => [0, 1, 2, 3].map((i) => start + i))
</script>

<div class="pads">
  {#each rows as row}
    {#each row as pad}
      <button
        class="pad"
        class:selected={session.selectedPad === pad}
        class:empty={!session.sliceRange(pad)}
        onpointerdown={(e) => session.padDown(pad, e.timeStamp)}
      >
        {#key session.hits[pad]}<span class="flash" class:on={session.hits[pad] > 0}></span>{/key}
        <span class="key">{padKeyLabel(pad)}</span>
        <span class="num label">{pad + 1}</span>
        {#if session.pads[pad].stretch}<span class="mode">ST</span>{/if}
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
