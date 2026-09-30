<script lang="ts">
  import { CATEGORY_LABELS, type Category } from '../classify/categories'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const pad = $derived(session.selectedPad)
  const own = $derived(session.pads[pad].sample)
</script>

<details class="library">
  <summary>ライブラリ {own ? `（${own.name}）` : ''}</summary>
  <div class="row">
    <button onclick={() => session.savePadToLibrary(pad)} disabled={!session.hasSound(pad)}>このパッドの音を保存</button>
    {#if own}<button onclick={() => session.clearPadSample(pad)}>素材のスライスに戻す</button>{/if}
  </div>
  {#if session.library.length === 0}
    <p class="muted hint">保存した音はまだない。保存した音は、別の素材を読み込んでもパッドに残る</p>
  {:else}
    <ul>
      {#each session.library as item (item.id)}
        <li>
          <button class="load" onclick={() => session.loadLibrarySample(item.id, pad)} title="選択中のパッドに読み込む">
            <span class="name">{item.name}</span>
            <span class="muted">{CATEGORY_LABELS[item.category as Category] ?? item.category}</span>
          </button>
          <button class="delete" onclick={() => session.deleteLibrarySample(item.id)} aria-label="{item.name} を削除">削除</button>
        </li>
      {/each}
    </ul>
  {/if}
</details>

<style>
  .library {
    border-top: 1px solid var(--line);
    padding-top: 8px;
  }

  summary {
    cursor: pointer;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  li {
    display: flex;
    gap: 4px;
  }

  .load {
    flex: 1;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    text-align: left;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delete {
    font-size: 12px;
  }

  .hint {
    margin: 0;
    font-size: 12px;
  }
</style>
