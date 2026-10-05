<script lang="ts">
  import type { Style, StyleChoice } from '../generate/generate'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const labels: Record<Style, string> = {
    boom_bap: 'ブーンバップ',
    dilla: 'ヨレ（Dilla）',
    breakbeat: 'ブレイクビーツ',
    four_on_floor: '4つ打ち',
  }
  const styles: { value: StyleChoice; label: string }[] = [
    { value: 'auto', label: 'BPM に合わせる' },
    ...(Object.keys(labels) as Style[]).map((value) => ({ value, label: labels[value] })),
  ]

  const rows = (events: { pad: number }[]) => [...new Set(events.map((e) => e.pad))].sort((a, b) => a - b)
</script>

<section class="generator">
  <div class="controls">
    <select bind:value={session.style} aria-label="スタイル">
      {#each styles as s}<option value={s.value}>{s.label}</option>{/each}
    </select>
    <label>
      密度
      <input type="range" min="0" max="1" step="0.05" bind:value={session.density} />
    </label>
    <label>
      ヨレ
      <input type="range" min="0" max="1" step="0.05" bind:value={session.looseness} />
    </label>
    <button class="go" onclick={() => session.generateCandidates()} disabled={!session.sample || session.songMode}>
      自動で組む <kbd>G</kbd>
    </button>
  </div>
  {#if session.candidates.length > 0}
    <div class="candidates">
      {#each session.candidates as candidate, i}
        {@const pads = rows(candidate.events)}
        <button
          class="candidate"
          aria-pressed={session.previewing === i}
          onclick={() => session.preview(i)}
          aria-label="候補 {i + 1}（{labels[candidate.style]}）"
          title={labels[candidate.style]}
        >
          <svg viewBox="0 0 {session.patternBeats * 4} {Math.max(1, pads.length)}" preserveAspectRatio="none">
            {#each candidate.events as e}
              <rect
                x={Math.max(0, (e.beat + e.nudge) * 4)}
                y={pads.indexOf(e.pad) + 0.15}
                width="0.7"
                height="0.7"
                class:auto={e.auto}
              />
            {/each}
          </svg>
        </button>
      {/each}
      <div class="decide">
        <button onclick={() => session.adopt()}>採用</button>
        <button onclick={() => session.revert()}>元に戻す</button>
      </div>
    </div>
    <p class="muted hint">候補をクリックすると、次の周回から切り替わる</p>
  {/if}
</section>

<style>
  .generator {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .go {
    background: var(--accent);
    border-color: var(--accent);
    color: #140a05;
    font-weight: 700;
  }

  .go kbd {
    background: transparent;
    border-color: rgba(0, 0, 0, 0.35);
  }

  .candidates {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: stretch;
  }

  .candidate {
    width: 150px;
    height: 64px;
    padding: 6px;
  }

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  rect {
    fill: var(--text);
  }

  rect.auto {
    fill: var(--accent);
  }

  .decide {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hint {
    margin: 0;
    font-size: 12px;
  }
</style>
