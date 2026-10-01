<script lang="ts">
  import { CATEGORY_LABELS } from '../classify/categories'
  import { LABEL_KEYS } from '../state/keymap'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const slice = $derived(session.labelingSlice ?? 0)
  const label = $derived(session.sliceLabel(slice))
</script>

<div class="labeling">
  <div class="status">
    <strong class="num">スライス {slice + 1} / {session.sliceCount}</strong>
    {#if label}
      <span>{CATEGORY_LABELS[label.category]}</span>
      <span class="muted">{label.manual ? '手で付けた' : `自動 ${Math.round(label.confidence * 100)}%`}</span>
    {/if}
    <span class="muted">直したラベル: 送信済み {session.correctionsSent} 件</span>
  </div>
  <div class="keys">
    {#each LABEL_KEYS as [code, category]}
      <button class:current={label?.category === category} onclick={() => session.labelAndNext(category)}>
        <kbd>{code.replace('Key', '')}</kbd>{CATEGORY_LABELS[category]}
      </button>
    {/each}
  </div>
  <div class="nav">
    <button onclick={() => session.showLabelingSlice(slice - 1)} disabled={slice === 0}><kbd>←</kbd>前</button>
    <button onclick={() => session.playSlice(slice)}><kbd>Space</kbd>もう一度聴く</button>
    <button onclick={() => label && session.labelAndNext(label.category)} disabled={!label}><kbd>Enter</kbd>このラベルで合っている</button>
    <button onclick={() => session.showLabelingSlice(slice + 1)} disabled={slice + 1 >= session.sliceCount}><kbd>→</kbd>飛ばす</button>
    <button onclick={() => session.stopLabeling()}><kbd>Esc</kbd>終わる</button>
  </div>
</div>

<style>
  .labeling {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    padding: 10px;
    border: 1px solid var(--accent);
    border-radius: 3px;
  }

  .status {
    display: flex;
    gap: 12px;
    align-items: baseline;
  }

  .keys,
  .nav {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .keys button.current {
    border-color: var(--accent);
  }

  kbd {
    margin-right: 4px;
  }
</style>
