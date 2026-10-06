<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const pad = $derived(session.selectedPad)
  const p = $derived(session.pads[pad])
  const percent = (v: number) => `${Math.round(v * 100)}%`
  const pan = (v: number) => (Math.abs(v) < 0.01 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`)
  const isOn = $derived(p.comp > 0 || p.sends.reverb > 0 || p.sends.delay > 0 || p.pan !== 0)
</script>

<details class="mix" open={isOn}>
  <summary>ミックス {p.mixAuto && isOn ? '（自動）' : ''}</summary>
  <label>
    パン
    <input
      type="range"
      min="-1"
      max="1"
      step="0.05"
      value={p.pan}
      oninput={(e) => session.setPadMix(pad, { pan: Number(e.currentTarget.value) })}
      ondblclick={() => session.setPadMix(pad, { pan: 0 })}
    />
    <span class="num">{pan(p.pan)}</span>
  </label>
  <label>
    コンプ
    <input type="range" min="0" max="1" step="0.05" value={p.comp} oninput={(e) => session.setPadMix(pad, { comp: Number(e.currentTarget.value) })} />
    <span class="num">{percent(p.comp)}</span>
  </label>
  <label>
    リバーブ
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={p.sends.reverb}
      oninput={(e) => session.setPadMix(pad, { sends: { ...p.sends, reverb: Number(e.currentTarget.value) } })}
    />
    <span class="num">{percent(p.sends.reverb)}</span>
  </label>
  <label>
    ディレイ
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={p.sends.delay}
      oninput={(e) => session.setPadMix(pad, { sends: { ...p.sends, delay: Number(e.currentTarget.value) } })}
    />
    <span class="num">{percent(p.sends.delay)}</span>
  </label>
</details>

<style>
  .mix {
    border-top: 1px solid var(--line);
    padding-top: 8px;
  }

  summary {
    cursor: pointer;
    font-weight: 600;
    margin-bottom: 8px;
  }

  label {
    display: grid;
    grid-template-columns: 84px 1fr 44px;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
</style>
