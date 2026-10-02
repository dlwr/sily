import { AutoProcessor, ClapAudioModelWithProjection } from '@huggingface/transformers'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { CLAP_RATE, clipForClap, MAX_CLIP_SECONDS, normalize } from '../src/classify/clap.ts'

const MODEL = 'Xenova/clap-htsat-unfused'
const CACHE = new URL('../../tmp/train/clap-cache-fp32.jsonl', import.meta.url)

const cached = new Map<string, number[]>()
try {
  for (const line of readFileSync(CACHE, 'utf8').split('\n').filter(Boolean)) {
    const { key, embedding } = JSON.parse(line)
    cached.set(key, embedding)
  }
} catch {}

const decode = (path: string): Float32Array => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-t', String(MAX_CLIP_SECONDS), '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(CLAP_RATE), '-'], {
    maxBuffer: 1 << 30,
  })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

const processor = await AutoProcessor.from_pretrained(MODEL)
const model = await ClapAudioModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' })
const paths = readFileSync(0, 'utf8').split('\n').filter(Boolean)
for (const path of paths) {
  const { mtimeMs, size } = statSync(path)
  const key = `${path}:${mtimeMs}:${size}`
  let embedding = cached.get(key)
  if (!embedding) {
    try {
      const { audio_embeds } = await model(await processor(clipForClap(decode(path), CLAP_RATE)))
      embedding = normalize(Array.from(audio_embeds.data as Float32Array)).map((x) => +x.toFixed(6))
    } catch (error) {
      process.stderr.write(`${path}: ${error}\n`)
      continue
    }
    appendFileSync(CACHE, JSON.stringify({ key, embedding }) + '\n')
  }
  process.stdout.write(`${path}\t${embedding.join('\t')}\n`)
}
