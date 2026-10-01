<script lang="ts">
  import type { Session } from '../state/session.svelte'

  let { session }: { session: Session } = $props()

  let devices = $state<MediaDeviceInfo[]>([])
  let deviceId = $state('')
  let fileInput: HTMLInputElement

  const refreshDevices = async () => {
    if (!session.sily) return
    devices = await session.sily.inputs()
  }

  $effect(() => {
    if (session.sily) refreshDevices()
  })

  const capture = async () => {
    await session.toggleCapture({ device: deviceId || undefined })
    refreshDevices()
  }
</script>

<div class="tools">
  <div class="group">
    <button onclick={() => fileInput.click()}>ファイルを開く</button>
    <input
      bind:this={fileInput}
      type="file"
      accept="audio/*"
      hidden
      onchange={(e) => {
        const file = e.currentTarget.files?.[0]
        if (file) session.loadFile(file)
      }}
    />
    <select bind:value={deviceId} title="録音する入力デバイス（BlackHole など）">
      <option value="">既定の入力</option>
      {#each devices as d}<option value={d.deviceId}>{d.label || '入力デバイス'}</option>{/each}
    </select>
    <button
      class="rec"
      aria-pressed={session.capturing === 'device'}
      disabled={session.capturing === 'display'}
      onclick={capture}
    >
      {session.capturing === 'device' ? '録音を止めて取り込む' : '録音'}
    </button>
    <button
      class="rec"
      aria-pressed={session.capturing === 'display'}
      disabled={session.capturing === 'device'}
      onclick={() => session.toggleCapture('display')}
      title="タブや画面を共有して、その音を録る"
    >
      {session.capturing === 'display' ? '録音を止めて取り込む' : 'PCの音を録音'}
    </button>
  </div>
  <div class="group">
    <button aria-pressed={session.auditionFrame !== null} onclick={() => session.toggleAudition()} disabled={!session.sample}>
      試聴 <kbd>P</kbd>
    </button>
    <span class="muted">再生中に <kbd>M</kbd> でマーカー</span>
  </div>
  <div class="group">
    <button onclick={() => session.detectOnsets()} disabled={!session.sample}>トランジェント検出</button>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      bind:value={session.sensitivity}
      title="感度"
    />
  </div>
  <div class="group">
    均等
    {#each [4, 8, 16] as n}
      <button onclick={() => session.gridSlice(n)} disabled={!session.sample}>{n}</button>
    {/each}
    <button onclick={() => session.clearMarkers()} disabled={session.markers.length === 0}>マーカー消去</button>
  </div>
  <div class="group">
    <button aria-pressed={session.labelingSlice !== null} onclick={() => (session.labelingSlice === null ? session.startLabeling() : session.stopLabeling())} disabled={!session.sample}>
      ラベル付け <kbd>L</kbd>
    </button>
  </div>
  <p class="hint muted">
    ピンチか Ctrl+ホイールで拡大、横スクロールで移動 / クリックで試聴位置 / ダブルクリックでそのスライスを選択中のパッドへ / Shift+クリックでマーカー追加 / 右クリックで削除 / マーカーはドラッグで移動
  </p>
</div>

<style>
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    align-items: center;
    padding: 8px 0;
  }

  .group {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    flex-basis: 100%;
  }

  .rec[aria-pressed='true'] {
    background: rgba(230, 40, 40, 0.25);
    border-color: #e62828;
  }
</style>
