<script lang="ts">
  import type { Session } from '../state/session.svelte'
  import ProjectBar from './ProjectBar.svelte'

  let { session }: { session: Session } = $props()

  const NOTES = ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B']

  const position = $derived(`${Math.floor(session.beat / 4) + 1}.${Math.floor(session.beat % 4) + 1}`)
</script>

<header>
  <h1>sily</h1>
  <ProjectBar {session} />
  <div class="group">
    <button aria-pressed={session.playing} onclick={() => session.togglePlaying()}>
      {session.playing ? 'Stop' : 'Play'} <kbd>Space</kbd>
    </button>
    <button class="rec" aria-pressed={session.recording} onclick={() => session.toggleRecording()}>
      Rec <kbd>Enter</kbd>
    </button>
    <span class="num position">{position}</span>
    {#if session.midiInputs.length}<span class="muted" title={session.midiInputs.join('\n')}>MIDI</span>{/if}
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
      {#each [1, 2, 4, 8] as bars}<option value={bars}>{bars}小節</option>{/each}
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
  <label class="group" title="音程のある音を合わせるキー。素材から推定し、選べば固定する">
    キー
    <select
      value={`${session.key.root}:${session.key.minor ? 'm' : ''}`}
      onchange={(e) => {
        const [root, mode] = e.currentTarget.value.split(':')
        session.setKey({ root: Number(root), minor: mode === 'm' })
      }}
    >
      {#each NOTES as note, root}
        <option value={`${root}:`}>{note}</option>
        <option value={`${root}:m`}>{note}m</option>
      {/each}
    </select>
    {#if session.keyAuto}<span class="muted">推定</span>{/if}
  </label>
  <label class="group" title="分類に合わせて、各パッドのピッチと EQ を自動で整える">
    <input type="checkbox" checked={session.autoShape} onchange={(e) => session.setAutoShape(e.currentTarget.checked)} />
    自動で整える
  </label>
  <label class="group" title="全体の音圧を上げる（天井 -0.3dB）">
    マスター
    <input
      type="range"
      min="0"
      max="18"
      step="0.5"
      value={session.masterFx.drive_db}
      oninput={(e) => session.setMasterFx({ drive_db: Number(e.currentTarget.value) })}
    />
    <span class="num value">+{session.masterFx.drive_db.toFixed(1)}</span>
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
