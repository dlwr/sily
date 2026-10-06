<script lang="ts">
  import { CATEGORY_LABELS } from '../classify/categories'
  import { BANK_PADS, padName, PADS } from '../state/banks'
  import { meterHeight } from '../state/meters'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const pads = $derived(Array.from({ length: BANK_PADS }, (_, i) => session.bankBase + i))
  const level = (i: number) => meterHeight(session.meters[i] ?? 0)
  const percent = (v: number) => `${Math.round(v * 100)}%`
  const DELAY_LENGTHS = [
    { beats: 0.25, name: '1/16' },
    { beats: 0.5, name: '1/8' },
    { beats: 0.75, name: '付点8分' },
    { beats: 1, name: '1/4' },
    { beats: 1.5, name: '付点4分' },
    { beats: 2, name: '1/2' },
  ]
</script>

<div class="mixer">
  {#each pads as pad (pad)}
    {@const p = session.pads[pad]}
    {@const label = session.labelOf(pad)}
    <div class="strip" class:selected={session.selectedPad === pad} class:empty={!session.hasSound(pad)}>
      <button class="name" onclick={() => (session.selectedPad = pad)}>
        <span>{padName(pad)}</span>
        <span class="muted category">{label ? CATEGORY_LABELS[label.category] : ''}</span>
      </button>
      <div class="channel">
        <div class="meter"><div class="fill" style:height="{level(pad) * 100}%"></div></div>
        <input
          class="fader"
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={p.gain}
          aria-label="{padName(pad)} の音量"
          oninput={(e) => session.setPad(pad, { gain: Number(e.currentTarget.value) })}
        />
      </div>
      <span class="num">{percent(p.gain)}</span>
      <input
        type="range"
        min="-1"
        max="1"
        step="0.05"
        value={p.pan}
        title="パン"
        aria-label="{padName(pad)} のパン"
        oninput={(e) => session.setPadMix(pad, { pan: Number(e.currentTarget.value) })}
        ondblclick={() => session.setPadMix(pad, { pan: 0 })}
      />
      <label title="リバーブへの送り">
        R
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={p.sends.reverb}
          oninput={(e) => session.setPadMix(pad, { sends: { ...p.sends, reverb: Number(e.currentTarget.value) } })}
        />
      </label>
      <label title="ディレイへの送り">
        D
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={p.sends.delay}
          oninput={(e) => session.setPadMix(pad, { sends: { ...p.sends, delay: Number(e.currentTarget.value) } })}
        />
      </label>
      <div class="toggles">
        <button aria-pressed={session.muted[pad]} onclick={() => session.toggleMute(pad)} title="ミュート">M</button>
        <button aria-pressed={session.soloed[pad]} onclick={() => session.toggleSolo(pad)} title="ソロ">S</button>
      </div>
    </div>
  {/each}

  <div class="strip return">
    <span class="name">リバーブ</span>
    <div class="channel">
      <div class="meter"><div class="fill" style:height="{level(PADS) * 100}%"></div></div>
      <input
        class="fader"
        type="range"
        min="0"
        max="1.5"
        step="0.01"
        value={session.returns.reverb.level}
        aria-label="リバーブの戻り"
        oninput={(e) => session.setReturns({ reverb: { level: Number(e.currentTarget.value) } })}
      />
    </div>
    <span class="num">{percent(session.returns.reverb.level)}</span>
    <label>
      広さ
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={session.returns.reverb.size}
        oninput={(e) => session.setReturns({ reverb: { size: Number(e.currentTarget.value) } })}
      />
    </label>
    <label title="高音の減り方">
      こもり
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={session.returns.reverb.damping}
        oninput={(e) => session.setReturns({ reverb: { damping: Number(e.currentTarget.value) } })}
      />
    </label>
  </div>

  <div class="strip return">
    <span class="name">ディレイ</span>
    <div class="channel">
      <div class="meter"><div class="fill" style:height="{level(PADS + 1) * 100}%"></div></div>
      <input
        class="fader"
        type="range"
        min="0"
        max="1.5"
        step="0.01"
        value={session.returns.delay.level}
        aria-label="ディレイの戻り"
        oninput={(e) => session.setReturns({ delay: { level: Number(e.currentTarget.value) } })}
      />
    </div>
    <span class="num">{percent(session.returns.delay.level)}</span>
    <select
      value={session.returns.delay.beats}
      aria-label="ディレイの長さ"
      onchange={(e) => session.setReturns({ delay: { beats: Number(e.currentTarget.value) } })}
    >
      {#each DELAY_LENGTHS as d}<option value={d.beats}>{d.name}</option>{/each}
    </select>
    <label title="繰り返しの多さ">
      反復
      <input
        type="range"
        min="0"
        max="0.9"
        step="0.01"
        value={session.returns.delay.feedback}
        oninput={(e) => session.setReturns({ delay: { feedback: Number(e.currentTarget.value) } })}
      />
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={session.returns.delay.pingPong}
        onchange={(e) => session.setReturns({ delay: { pingPong: e.currentTarget.checked } })}
      />
      左右に振る
    </label>
  </div>

  <div class="strip master">
    <span class="name">マスター</span>
    <div class="channel">
      <div class="meter"><div class="fill" style:height="{level(PADS + 2) * 100}%"></div></div>
    </div>
    <label title="全体を軽くまとめるコンプ">
      グルー
      <input type="range" min="0" max="1" step="0.05" value={session.glue} oninput={(e) => session.setGlue(Number(e.currentTarget.value))} />
    </label>
    <label title="全体の音圧を上げる">
      音圧
      <input
        type="range"
        min="0"
        max="18"
        step="0.5"
        value={session.masterFx.drive_db}
        oninput={(e) => session.setMasterFx({ drive_db: Number(e.currentTarget.value) })}
      />
    </label>
  </div>
</div>

<style>
  .mixer {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 6px;
  }

  .strip {
    flex: none;
    width: 64px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 6px 4px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 3px;
  }

  .strip.selected {
    border-color: var(--accent);
  }

  .strip.empty {
    opacity: 0.5;
  }

  .strip.return,
  .strip.master {
    width: 88px;
    background: var(--surface-2);
  }

  .name {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 2px 4px;
    font-weight: 600;
    background: none;
    border: none;
    text-align: left;
    min-width: 0;
  }

  .category {
    font-weight: 400;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .channel {
    display: flex;
    gap: 4px;
    height: 140px;
    justify-content: center;
  }

  .meter {
    width: 8px;
    background: var(--bg);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }

  .fill {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--accent);
  }

  .fader {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 22px;
    height: 100%;
    margin: 0;
  }

  input[type='range']:not(.fader) {
    width: 100%;
    margin: 0;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
  }

  label.check {
    flex-direction: row;
    align-items: center;
  }

  .num {
    text-align: center;
    font-size: 12px;
  }

  .toggles {
    display: flex;
    gap: 2px;
  }

  .toggles button {
    flex: 1;
    padding: 2px 0;
  }

  select {
    width: 100%;
  }
</style>
