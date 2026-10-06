<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()
</script>

{#if session.shared}
  <aside class="banner">
    <span>共有されたプロジェクト「{session.shared.name}」。ここで編集しても保存されない。</span>
    <button class="save" onclick={() => session.saveShared()}>自分のプロジェクトとして保存</button>
    <a class="muted report" href="https://github.com/dlwr/sily/issues" target="_blank" rel="noopener">問題があれば連絡</a>
  </aside>
{/if}

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: var(--accent-soft);
    border-bottom: 1px solid var(--accent);
  }

  .save {
    background: var(--accent);
    border-color: var(--accent);
    color: #140a05;
    font-weight: 700;
  }

  .report {
    margin-left: auto;
    font-size: 12px;
  }
</style>
