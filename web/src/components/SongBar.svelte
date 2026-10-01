<script lang="ts">
  import { PATTERN_NAMES } from '../state/song'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const position = $derived(session.songPosition())
</script>

<div class="song-bar">
  <div class="group">
    <span class="muted">パターン</span>
    {#each PATTERN_NAMES as name}
      <button
        class="pattern"
        aria-pressed={session.currentPattern === name}
        class:used={session.hasPattern(name)}
        onclick={() => session.selectPattern(name)}
        title={session.playing && !session.songMode ? 'この小節の終わりで切り替える' : '編集するパターンを切り替える'}
      >
        {name}
      </button>
    {/each}
    <select
      value=""
      onchange={(e) => {
        session.copyPatternTo(e.currentTarget.value)
        e.currentTarget.value = ''
      }}
      title="今のパターンを別の名前に複製して、そちらを開く"
    >
      <option value="" disabled>{session.currentPattern} を複製…</option>
      {#each PATTERN_NAMES.filter((n) => n !== session.currentPattern) as name}<option value={name}>{name} へ</option>{/each}
    </select>
  </div>
  <div class="group">
    <span class="muted">曲</span>
    {#each session.song as name, i}
      <button class="section" class:now={session.songMode && session.playing && position.index === i} onclick={() => session.removeFromSong(i)} title="クリックで外す">
        {name}
      </button>
    {/each}
    <button onclick={() => session.addToSong(session.currentPattern)}>{session.currentPattern} を足す</button>
    <label>
      <input type="checkbox" checked={session.songMode} disabled={session.song.length === 0} onchange={(e) => session.setSongMode(e.currentTarget.checked)} />
      曲で再生
    </label>
  </div>
</div>

<style>
  .song-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    align-items: center;
    margin-bottom: 8px;
  }

  .group {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .group > .muted {
    margin-right: 4px;
  }

  button {
    min-width: 28px;
  }

  .pattern:not(.used):not([aria-pressed='true']) {
    color: var(--muted);
  }

  .section.now {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
