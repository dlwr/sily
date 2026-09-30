import { AutoTokenizer, ClapTextModelWithProjection } from '@huggingface/transformers'
import fs from 'node:fs'

const MODEL = 'Xenova/clap-htsat-unfused'
const PROMPTS = {
  bass: ['a bass guitar note', 'a deep synth bass note', 'an 808 bass hit'],
  keys: ['a piano chord', 'an electric piano chord', 'an organ chord'],
  vocal: ['a human voice singing', 'a vocal chop', 'a person speaking'],
  melody: ['a melodic synth lead', 'a guitar melody', 'a string section phrase'],
  fx: ['a sound effect', 'a riser noise sweep', 'a vinyl scratch'],
}

const tokenizer = await AutoTokenizer.from_pretrained(MODEL)
const model = await ClapTextModelWithProjection.from_pretrained(MODEL, { dtype: 'q8' })
const out = {}
for (const [label, prompts] of Object.entries(PROMPTS)) {
  const inputs = tokenizer(prompts, { padding: true, truncation: true })
  const { text_embeds } = await model(inputs)
  out[label] = text_embeds.tolist().map((v) => {
    const norm = Math.hypot(...v)
    return v.map((x) => +(x / norm).toFixed(5))
  })
}
fs.writeFileSync(new URL('../src/classify/clap-labels.json', import.meta.url), JSON.stringify(out))
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${v.length}x${v[0].length}`])))
