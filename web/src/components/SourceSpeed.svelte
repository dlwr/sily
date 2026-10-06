<script lang="ts">
  import type { Session } from '../state/session.svelte'
  import { rateToSemitones } from '../state/source'

  let { session }: { session: Session } = $props()

  const SHORT_SECONDS = 8

  const speed = $derived(session.bank.sourceSpeed)
  const semitones = $derived(rateToSemitones(speed.rate))
  const short = $derived(session.bank.sample !== null && session.bank.sample.left.length < SHORT_SECONDS * session.sampleRate)
  const presets = [
    { label: '45→33', rate: 100 / 3 / 45 },
    { label: '等速', rate: 1 },
    { label: '33→45', rate: 45 / (100 / 3) },
  ]
</script>

<div class="speed">
  <div class="modes" role="radiogroup" aria-label="速度の変え方">
    <button aria-pressed={speed.mode === 'tape'} onclick={() => session.setSourceSpeed({ mode: 'tape' })}>回転数</button>
    <button aria-pressed={speed.mode === 'stretch'} onclick={() => session.setSourceSpeed({ mode: 'stretch' })}>
      ストレッチ
    </button>
  </div>
  <label>
    速度
    <input
      type="range"
      min="0.5"
      max="2"
      step="0.01"
      value={speed.rate}
      onchange={(e) => session.setSourceSpeed({ rate: Number(e.currentTarget.value) })}
      disabled={!session.bank.sample}
    />
    <span class="num">×{speed.rate.toFixed(2)}</span>
    {#if speed.mode === 'tape'}
      <span class="num muted">{semitones >= 0 ? '+' : ''}{semitones.toFixed(1)} 半音</span>
    {/if}
  </label>
  {#each presets as p}
    <button onclick={() => session.setSourceSpeed({ rate: p.rate })} disabled={!session.bank.sample}>{p.label}</button>
  {/each}
  <button onclick={() => session.matchBpm(speed.mode)} disabled={!session.bank.sample}>BPM に合わせる</button>
  {#if session.bank.sourceBpm}
    <span class="muted num">元の BPM {session.bank.sourceBpm}</span>
    <button onclick={() => session.scaleSourceBpm(2)} title="推定が半分にずれていたら直す。切り直してキットを組み直す">×2</button>
    <button onclick={() => session.scaleSourceBpm(0.5)} title="推定が倍にずれていたら直す。切り直してキットを組み直す">÷2</button>
    {#if short}<span class="hint">8秒より短い録音は BPM が半分に出やすい。速い曲なら ×2 を確かめて</span>{/if}
  {/if}
</div>

<style>
  .hint {
    color: var(--accent);
    font-size: 12px;
  }

  .speed {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 4px 0 8px;
  }

  .modes {
    display: flex;
    gap: 4px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
