<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const pad = $derived(session.pads[session.selectedPad])
  const semitones = $derived(Math.round(pad.pitch))
  const cents = $derived(Math.round((pad.pitch - semitones) * 100))
</script>

<section>
  <h2>パッド {session.selectedPad + 1}</h2>
  <label>
    ピッチ
    <input
      type="range"
      min="-24"
      max="24"
      step="1"
      value={semitones}
      onchange={(e) => session.setPad(session.selectedPad, { pitch: Number(e.currentTarget.value) + cents / 100 })}
    />
    <span class="num">{semitones > 0 ? '+' : ''}{semitones}</span>
  </label>
  <label>
    微調整
    <input
      type="range"
      min="-50"
      max="50"
      step="1"
      value={cents}
      onchange={(e) => session.setPad(session.selectedPad, { pitch: semitones + Number(e.currentTarget.value) / 100 })}
    />
    <span class="num">{cents > 0 ? '+' : ''}{cents}¢</span>
  </label>
  <label>
    音量
    <input
      type="range"
      min="0"
      max="1.5"
      step="0.05"
      value={pad.gain}
      oninput={(e) => session.setPad(session.selectedPad, { gain: Number(e.currentTarget.value) })}
    />
    <span class="num">{Math.round(pad.gain * 100)}%</span>
  </label>
  <div class="modes" role="radiogroup" aria-label="ピッチの扱い">
    <button aria-pressed={!pad.stretch} onclick={() => session.setPad(session.selectedPad, { stretch: false })}>
      速度と連動
    </button>
    <button aria-pressed={pad.stretch} onclick={() => session.setPad(session.selectedPad, { stretch: true })}>
      長さを保つ
    </button>
  </div>
  <button aria-pressed={pad.reverse} onclick={() => session.setPad(session.selectedPad, { reverse: !pad.reverse })}>
    逆再生
  </button>
  <button aria-pressed={session.keyboardMode} onclick={() => (session.keyboardMode = !session.keyboardMode)}>
    鍵盤モード <kbd>Tab</kbd>
  </button>
  {#if session.keyboardMode}
    <p class="muted hint"><kbd>A</kbd>〜<kbd>L</kbd> が白鍵、<kbd>W</kbd><kbd>E</kbd><kbd>T</kbd><kbd>Y</kbd><kbd>U</kbd><kbd>O</kbd> が黒鍵</p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 220px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
  }

  label {
    display: grid;
    grid-template-columns: 48px 1fr 40px;
    align-items: center;
    gap: 8px;
  }

  .modes {
    display: flex;
    gap: 4px;
  }

  .hint {
    margin: 0;
    font-size: 12px;
  }
</style>
