<script lang="ts">
  import { deleteShare, listShares, type SharedProject } from '../share/api'

  let open = $state(false)
  let shares = $state<SharedProject[] | 'login' | 'failed' | null>(null)
  let confirming = $state<string | null>(null)
  let copied = $state<string | null>(null)

  const load = async () => {
    shares = null
    shares = await listShares()
  }

  const toggle = () => {
    open = !open
    if (open) load()
  }

  const linkOf = (id: string) => new URL(`/s/${id}`, location.origin).href

  const copy = async (id: string) => {
    await navigator.clipboard?.writeText(linkOf(id))
    copied = id
  }

  const remove = async (id: string) => {
    if (confirming !== id) {
      confirming = id
      return
    }
    confirming = null
    if (await deleteShare(id)) await load()
  }
</script>

<svelte:window onfocus={() => open && shares === 'login' && load()} />

<div class="shares">
  <button aria-expanded={open} onclick={toggle}>共有したもの</button>
  {#if open}
    <div class="panel">
      {#if shares === null}
        <p class="muted">読み込み中…</p>
      {:else if shares === 'login'}
        <a href="/api/login" target="_blank" rel="noopener">ログインすると一覧が見られる</a>
      {:else if shares === 'failed'}
        <p class="muted">一覧を取れなかった</p>
      {:else if shares.length === 0}
        <p class="muted">まだ何も共有していない</p>
      {:else}
        <ul>
          {#each shares as share (share.id)}
            <li>
              <a class="name" href={linkOf(share.id)} target="_blank" rel="noopener">{share.name}</a>
              <span class="muted num">{new Date(share.createdAt).toLocaleDateString('ja-JP')}</span>
              <button onclick={() => copy(share.id)}>{copied === share.id ? 'コピーした' : 'リンクをコピー'}</button>
              <button class:danger={confirming === share.id} onclick={() => remove(share.id)}>
                {confirming === share.id ? '本当に削除' : '削除'}
              </button>
            </li>
          {/each}
        </ul>
        <p class="muted">{shares.length} / 20</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .shares {
    position: relative;
  }

  .panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 10;
    min-width: 360px;
    max-width: calc(100vw - 32px);
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 3px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  p {
    margin: 6px 0 0;
  }

  .danger {
    background: rgba(230, 40, 40, 0.25);
    border-color: #e62828;
  }
</style>
