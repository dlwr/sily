<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const position = $derived(`${Math.floor(session.beat / 4) + 1}.${Math.floor(session.beat % 4) + 1}`)
</script>

<header>
  <h1>sily</h1>
  <div class="group">
    <button aria-pressed={session.playing} onclick={() => session.togglePlaying()}>
      {session.playing ? 'Stop' : 'Play'} <kbd>Space</kbd>
    </button>
    <button class="rec" aria-pressed={session.recording} onclick={() => session.toggleRecording()}>
      Rec <kbd>Enter</kbd>
    </button>
    <span class="num position">{position}</span>
  </div>
  <label class="group">
    BPM
    <input
      type="number"
      class="num"
      min="40"
      max="240"
      step="0.1"
      value={session.bpm}
      onchange={(e) => session.setTransport({ bpm: Number(e.currentTarget.value) })}
    />
    <button onclick={() => session.detectBpm()} disabled={!session.sample}>推定</button>
  </label>
  <label class="group">
    長さ
    <select value={session.bars} onchange={(e) => session.setTransport({ bars: Number(e.currentTarget.value) })}>
      {#each [1, 2, 4] as bars}<option value={bars}>{bars}小節</option>{/each}
    </select>
  </label>
  <label class="group">
    <input
      type="checkbox"
      checked={session.metronome}
      onchange={(e) => session.setTransport({ metronome: e.currentTarget.checked })}
    />
    クリック
  </label>
  <label class="group">
    グリッド
    <select value={session.grid} onchange={(e) => session.setGroove({ grid: Number(e.currentTarget.value) })}>
      <option value={0.5}>1/8</option>
      <option value={0.25}>1/16</option>
      <option value={0.125}>1/32</option>
    </select>
  </label>
  <label class="group">
    クオンタイズ
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={session.strength}
      oninput={(e) => session.setGroove({ strength: Number(e.currentTarget.value) })}
    />
    <span class="num value">{Math.round(session.strength * 100)}%</span>
  </label>
  <label class="group">
    スウィング
    <input
      type="range"
      min="0.5"
      max="0.75"
      step="0.01"
      value={session.swing}
      oninput={(e) => session.setGroove({ swing: Number(e.currentTarget.value) })}
    />
    <span class="num value">{Math.round(session.swing * 100)}%</span>
  </label>
</header>

<style>
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }

  h1 {
    margin: 0 8px 0 0;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--accent);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  input[type='number'] {
    width: 72px;
  }

  .position {
    min-width: 40px;
    font-size: 18px;
    font-weight: 600;
  }

  .value {
    min-width: 36px;
    color: var(--muted);
  }

  .rec[aria-pressed='true'] {
    background: rgba(230, 40, 40, 0.25);
    border-color: #e62828;
  }
</style>
