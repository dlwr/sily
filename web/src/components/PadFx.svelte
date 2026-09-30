<script lang="ts">
  import { isFlat, presetsFor, type FxSettings } from '../fx/fx'
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  const pad = $derived(session.selectedPad)
  const fx = $derived(session.pads[pad].fx)
  const presets = $derived(presetsFor(session.labelOf(pad)?.category))

  const set = (patch: Partial<FxSettings>) => session.setPadFx(pad, patch)
  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
  const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`
  const logHz = (t: number, lo: number, hi: number) => Math.round(lo * (hi / lo) ** t)
  const toT = (v: number, lo: number, hi: number) => Math.log(v / lo) / Math.log(hi / lo)
</script>

<details class="fx" open={!isFlat(fx)}>
  <summary>音作り {isFlat(fx) ? '' : '（オン）'}</summary>
  <label>
    プリセット
    <select
      value=""
      onchange={(e) => {
        const p = presets.find((p) => p.name === e.currentTarget.value)
        if (p) session.setPadFx(pad, p.settings)
        e.currentTarget.value = ''
      }}
    >
      <option value="" disabled>選ぶ</option>
      {#each presets as p}<option value={p.name}>{p.name}</option>{/each}
    </select>
    <span></span>
  </label>
  <label>
    ローカット
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={fx.highpass_hz === 0 ? 0 : toT(fx.highpass_hz, 20, 2000)}
      oninput={(e) => {
        const t = Number(e.currentTarget.value)
        set({ highpass_hz: t < 0.02 ? 0 : logHz(t, 20, 2000) })
      }}
    />
    <span class="num">{fx.highpass_hz === 0 ? 'オフ' : hz(fx.highpass_hz)}</span>
  </label>
  <label>
    ハイカット
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={fx.lowpass_hz === 0 ? 1 : toT(fx.lowpass_hz, 500, 20000)}
      oninput={(e) => {
        const t = Number(e.currentTarget.value)
        set({ lowpass_hz: t > 0.98 ? 0 : logHz(t, 500, 20000) })
      }}
    />
    <span class="num">{fx.lowpass_hz === 0 ? 'オフ' : hz(fx.lowpass_hz)}</span>
  </label>
  <label>
    低域
    <input type="range" min="-12" max="12" step="0.5" value={fx.low_db} oninput={(e) => set({ low_db: Number(e.currentTarget.value) })} />
    <span class="num">{db(fx.low_db)}</span>
  </label>
  <label>
    中域
    <input type="range" min="-12" max="12" step="0.5" value={fx.mid_db} oninput={(e) => set({ mid_db: Number(e.currentTarget.value) })} />
    <span class="num">{db(fx.mid_db)}</span>
  </label>
  <label>
    中域の帯域
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={toT(fx.mid_hz, 150, 6000)}
      oninput={(e) => set({ mid_hz: logHz(Number(e.currentTarget.value), 150, 6000) })}
    />
    <span class="num">{hz(fx.mid_hz)}</span>
  </label>
  <label>
    高域
    <input type="range" min="-12" max="12" step="0.5" value={fx.high_db} oninput={(e) => set({ high_db: Number(e.currentTarget.value) })} />
    <span class="num">{db(fx.high_db)}</span>
  </label>
  <label>
    マキシマイザ
    <input type="range" min="0" max="24" step="0.5" value={fx.drive_db} oninput={(e) => set({ drive_db: Number(e.currentTarget.value) })} />
    <span class="num">{db(fx.drive_db)}</span>
  </label>
  <label>
    天井
    <input type="range" min="-12" max="0" step="0.1" value={fx.ceiling_db} oninput={(e) => set({ ceiling_db: Number(e.currentTarget.value) })} />
    <span class="num">{fx.ceiling_db.toFixed(1)}</span>
  </label>
</details>

<style>
  .fx {
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
