<script lang="ts">
  import { CATEGORIES, CATEGORY_LABELS, type Category } from '../classify/categories'
  import type { Session } from '../state/session.svelte'
  import PadFx from './PadFx.svelte'
  import PadLibrary from './PadLibrary.svelte'

  let { session }: { session: Session } = $props()

  const pad = $derived(session.pads[session.selectedPad])
  const label = $derived(session.labelOf(session.selectedPad))
  const semitones = $derived(Math.round(pad.pitch))
  const cents = $derived(Math.round((pad.pitch - semitones) * 100))
</script>

<section>
  <h2>パッド {session.selectedPad + 1}</h2>
  <label>
    種類
    <select
      value={label?.category ?? ''}
      disabled={!label}
      onchange={(e) => session.setLabel(session.selectedPad, e.currentTarget.value as Category)}
    >
      {#each CATEGORIES as c}<option value={c}>{CATEGORY_LABELS[c]}</option>{/each}
    </select>
    <span class="num muted">{label ? (label.manual ? '手動' : `${Math.round(label.confidence * 100)}%`) : ''}</span>
  </label>
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
  <label>
    チョーク
    <select
      value={pad.chokeAuto ? 'auto' : String(pad.choke)}
      onchange={(e) => {
        const v = e.currentTarget.value
        session.setPad(session.selectedPad, v === 'auto' ? { chokeAuto: true } : { chokeAuto: false, choke: Number(v) })
      }}
      title="同じグループのパッドは、どれかが鳴ると他の音を止める（ハットの開閉など）"
    >
      <option value="auto">自動（ハット同士）</option>
      <option value="0">なし</option>
      {#each [1, 2, 3] as g}<option value={String(g)}>グループ {g}</option>{/each}
    </select>
    <span class="num muted">{pad.choke > 0 ? pad.choke : ''}</span>
  </label>
  {#if !pad.sample && (!pad.pitchAuto || !pad.fxAuto)}
    <button onclick={() => session.resetPadShape(session.selectedPad)} title="手で変えたピッチと音作りを、自動で整えた値に戻す">
      ピッチと音作りを自動に戻す
    </button>
  {:else if !pad.sample && session.autoShape}
    <p class="muted hint">ピッチと音作りは自動で整えている（キー {session.key.minor ? '短調' : '長調'}）</p>
  {/if}
  <PadFx {session} />
  <PadLibrary {session} />
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
  <button onclick={() => session.buildKit()} disabled={!session.sample} title="全スライスから役ごとにいちばん近い音を選んでパッドに乗せる">
    素材からキットを組む
  </button>
  <button onclick={() => session.arrangePads()} disabled={!session.sample}>定番の配置に並べ替える</button>
  <button onclick={() => session.exportCorrections()} disabled={session.correctionCount === 0}>
    直したラベルを書き出す（{session.correctionCount}）
  </button>
  {#if session.correctionsSent > 0 || session.correctionsUnsent > 0}
    <span>直したラベル: 送信済み {session.correctionsSent} 件{#if session.correctionsUnsent > 0}・未送信 {session.correctionsUnsent} 件{/if}</span>
  {/if}
  {#if session.correctionLogin}
    <a href="/api/corrections/login" target="_blank" rel="noopener">直したラベルを送るにはログイン</a>
  {/if}
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
