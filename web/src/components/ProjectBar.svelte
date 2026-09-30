<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  let confirming = $state(false)
  let fileInput: HTMLInputElement
  let timer: ReturnType<typeof setTimeout> | undefined

  const remove = () => {
    if (!session.projectId) return
    if (!confirming) {
      confirming = true
      clearTimeout(timer)
      timer = setTimeout(() => (confirming = false), 3000)
      return
    }
    confirming = false
    session.removeProject(session.projectId)
  }
</script>

<div class="project">
  <input
    class="name"
    value={session.projectName}
    aria-label="プロジェクト名"
    onchange={(e) => (session.projectName = e.currentTarget.value.trim() || session.projectName)}
  />
  <select
    value={session.projectId ?? ''}
    aria-label="プロジェクトを開く"
    onchange={(e) => session.openProject(e.currentTarget.value)}
  >
    {#each session.projects as p (p.id)}
      <option value={p.id}>{p.name}</option>
    {/each}
    {#if !session.projects.some((p) => p.id === session.projectId)}
      <option value={session.projectId ?? ''}>{session.projectName}（未保存）</option>
    {/if}
  </select>
  <button onclick={() => session.newProject()}>新規</button>
  <button onclick={() => session.exportProject()} title="音声ごと1ファイルに書き出す">書き出し</button>
  <button onclick={() => fileInput.click()} title=".sily ファイルを読み込む">読み込み</button>
  <input
    bind:this={fileInput}
    type="file"
    accept=".sily"
    hidden
    onchange={(e) => {
      const file = e.currentTarget.files?.[0]
      if (file) session.importProject(file)
      e.currentTarget.value = ''
    }}
  />
  <button class:danger={confirming} onclick={remove}>{confirming ? '本当に削除' : '削除'}</button>
</div>

<style>
  .project {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .name {
    width: 160px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 4px 6px;
  }

  select {
    max-width: 140px;
  }

  .danger {
    background: rgba(230, 40, 40, 0.25);
    border-color: #e62828;
  }
</style>
