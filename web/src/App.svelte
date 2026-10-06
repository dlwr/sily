<script lang="ts">
  import Generator from './components/Generator.svelte'
  import LabelingPanel from './components/LabelingPanel.svelte'
  import PadInspector from './components/PadInspector.svelte'
  import Pads from './components/Pads.svelte'
  import PatternGrid from './components/PatternGrid.svelte'
  import SharedBanner from './components/SharedBanner.svelte'
  import SliceTools from './components/SliceTools.svelte'
  import SongBar from './components/SongBar.svelte'
  import SourceSpeed from './components/SourceSpeed.svelte'
  import Transport from './components/Transport.svelte'
  import Waveform from './components/Waveform.svelte'
  import { labelForCode, noteForCode, padForCode } from './state/keymap'
  import { fetchShare, sharedIdFrom } from './share/api'
  import { Session } from './state/session.svelte'

  const session = new Session()
  let starting = $state(false)
  let failed = $state('')
  const sharedId = sharedIdFrom(location.pathname)
  const sharedBytes = sharedId ? fetchShare(sharedId) : null
  const sharedTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? null

  const start = async () => {
    starting = true
    try {
      const bytes = await sharedBytes
      if (sharedId && !bytes) {
        failed = '共有されたプロジェクトを取れなかった'
        return
      }
      await session.start(sharedId && bytes ? { id: sharedId, bytes } : undefined)
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e)
    } finally {
      starting = false
    }
  }

  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox'
      ? true
      : target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement

  const heldKeys = new Map<string, number>()

  const releaseKeys = () => {
    heldKeys.clear()
    session.releasePads()
  }

  const onkeyup = (e: KeyboardEvent) => {
    const pad = heldKeys.get(e.code)
    if (pad === undefined) return
    heldKeys.delete(e.code)
    session.padUp(pad)
  }

  const onkeydown = (e: KeyboardEvent) => {
    if (!session.sily || e.repeat || typing(e.target)) return
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
      e.preventDefault()
      if (e.shiftKey) session.redo()
      else session.undo()
      return
    }
    if (e.metaKey || e.ctrlKey) return
    if (session.labelingSlice !== null) {
      onLabelingKey(e, session.labelingSlice)
      return
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault()
        session.togglePlaying()
        return
      case 'Enter':
        e.preventDefault()
        session.toggleRecording()
        return
      case 'Tab':
        e.preventDefault()
        heldKeys.clear()
        session.toggleKeyboardMode()
        return
      case 'KeyN':
        session.toggleNoteRepeat()
        return
      case 'KeyP':
        session.toggleAudition()
        return
      case 'KeyM':
        session.markAtKey(e.timeStamp)
        return
    }
    if (e.code === 'KeyL' && !session.keyboardMode) {
      session.startLabeling()
      return
    }
    if (e.code === 'KeyG' && !session.keyboardMode) {
      session.generateCandidates()
      return
    }
    if (session.keyboardMode) {
      const note = noteForCode(e.code)
      if (note !== undefined) session.noteDown(note, e.timeStamp)
      return
    }
    const pad = padForCode(e.code)
    if (pad !== undefined) {
      e.preventDefault()
      heldKeys.set(e.code, pad)
      session.padDown(pad, e.timeStamp)
    }
  }

  const onLabelingKey = (e: KeyboardEvent, slice: number) => {
    const label = labelForCode(e.code)
    if (label) return session.labelAndNext(label)
    const current = session.sliceLabel(slice)
    switch (e.code) {
      case 'ArrowLeft':
        return session.showLabelingSlice(slice - 1)
      case 'ArrowRight':
        return session.showLabelingSlice(slice + 1)
      case 'Space':
        e.preventDefault()
        return session.playSlice(slice)
      case 'Enter':
        e.preventDefault()
        if (current) session.labelAndNext(current.category)
        return
      case 'Period': {
        const previous = session.sliceLabel(slice - 1)
        if (slice > 0 && previous) session.labelAndNext(previous.category)
        return
      }
      case 'Backspace':
        e.preventDefault()
        return session.mergeLabelingSlice()
      case 'Escape':
        return session.stopLabeling()
    }
  }

  const ondrop = (e: DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    if (file) session.loadFile(file)
  }
</script>

<svelte:document onvisibilitychange={() => document.hidden && releaseKeys()} />
<svelte:window {onkeydown} {onkeyup} onblur={releaseKeys} ondragover={(e) => e.preventDefault()} {ondrop} onfocus={() => session.correctionLogin && session.flushCorrections()} />

{#if !session.sily}
  <main class="start">
    <h1>sily</h1>
    {#if sharedId}
      <p>{sharedTitle ?? '共有されたプロジェクト'}</p>
      <button class="go" onclick={start} disabled={starting}>{starting ? '準備中…' : '開いて鳴らす'}</button>
    {:else}
      <p class="muted">サンプルを取り込んで、切って、叩いてループを作る。</p>
      <button class="go" onclick={start} disabled={starting}>{starting ? '準備中…' : '音を出す準備をする'}</button>
    {/if}
    {#if failed}<p class="error">起動できなかった: {failed}</p>{/if}
  </main>
{:else}
  <SharedBanner {session} />
  <Transport {session} />
  <main>
    <section class="source">
      <div class="title">
        <h2>{session.sample?.name ?? 'ソース'}</h2>
        {#if session.sample}
          <span class="muted num">
            {(session.sample.left.length / session.sampleRate).toFixed(2)} 秒 / {Math.max(1, session.markers.length)} スライス
          </span>
        {/if}
        {#if session.processing > 0}<span class="muted">ストレッチを計算中…</span>{/if}
        {#if session.refining}
          {@const download = session.modelDownload}
          {#if download && download.loaded < download.total}
            <span class="muted num">モデルを読み込み中 {(download.loaded / 1e6).toFixed(0)} / {(download.total / 1e6).toFixed(0)} MB</span>
            <progress value={download.loaded} max={download.total}></progress>
          {:else}
            <span class="muted num">音を聞き分け中 {session.refined} / {session.refineTotal}</span>
            <progress value={session.refined} max={session.refineTotal}></progress>
          {/if}
        {/if}
        {#if session.message}<span class="error">{session.message}</span>{/if}
      </div>
      <Waveform {session} />
      <SourceSpeed {session} />
      <SliceTools {session} />
      {#if session.labelingSlice !== null}<LabelingPanel {session} />{/if}
    </section>
    <section class="play">
      <div class="pad-area">
        <Pads {session} />
        <PadInspector {session} />
      </div>
      <div class="pattern-area">
        <Generator {session} />
        <SongBar {session} />
        <PatternGrid {session} />
      </div>
    </section>
  </main>
{/if}

<style>
  main {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .start {
    min-height: 100vh;
    justify-content: center;
    align-items: flex-start;
    max-width: 560px;
    margin: 0 auto;
  }

  .start h1 {
    margin: 0;
    font-size: 64px;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: var(--accent);
  }

  .go {
    padding: 10px 18px;
    background: var(--accent);
    border-color: var(--accent);
    color: #140a05;
    font-weight: 700;
  }

  .title {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 8px;
  }

  progress {
    align-self: center;
    width: 160px;
    height: 4px;
    appearance: none;
    border: 0;
    background: var(--surface-2);
  }

  progress::-webkit-progress-bar {
    background: var(--surface-2);
  }

  progress::-webkit-progress-value {
    background: var(--accent);
  }

  progress::-moz-progress-bar {
    background: var(--accent);
  }

  h2 {
    margin: 0;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .play {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
  }

  .pad-area {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    width: min(100%, 340px);
  }

  .pattern-area {
    flex: 1;
    min-width: 320px;
  }

  .error {
    color: #ff6b6b;
  }
</style>
