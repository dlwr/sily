import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { correctionsSink } from './scripts/corrections-sink.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    correctionsSink({
      train: fileURLToPath(new URL('../tmp/train/corrections', import.meta.url)),
      eval: fileURLToPath(new URL('../tmp/train/eval', import.meta.url)),
    }),
  ],
})
