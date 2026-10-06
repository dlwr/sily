<script lang="ts">
  import { BANK_NAMES, bankOf } from '../state/banks'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const playing = $derived(new Set(session.events.map((e) => bankOf(e.pad))))
</script>

<div class="banks" role="tablist" title="[ と ] でも切り替えられる">
  {#each session.banks as bank (bank.index)}
    <button
      role="tab"
      aria-selected={bank.index === session.focusedBank}
      class:empty={!bank.sample}
      onclick={() => session.focusBank(bank.index)}
    >
      <span class="letter">{BANK_NAMES[bank.index]}</span>
      <span class="name">{bank.sample?.name ?? '空き'}</span>
      {#if playing.has(bank.index)}<span class="notes" title="今のパターンで鳴っている"></span>{/if}
    </button>
  {/each}
</div>

<style>
  .banks {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
  }

  button {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 220px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 6px 10px;
    color: var(--muted);
  }

  button[aria-selected='true'] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .letter {
    font-weight: 700;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty .name {
    opacity: 0.6;
  }

  .notes {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
</style>
