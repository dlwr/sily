import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { handleCorrections, type CorrectionStore } from '../worker/corrections.ts'

export const fileStore = (dir: string): CorrectionStore => ({
  async save(id, label, audio) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const labels = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    await Promise.all(labels.map((other) => rm(join(dir, other, `${id}.wav`), { force: true })))
    await mkdir(join(dir, label), { recursive: true })
    await writeFile(join(dir, label, `${id}.wav`), new Uint8Array(audio))
  },
})

export function correctionsSink(dir: string): Plugin {
  const store = fileStore(dir)
  return {
    name: 'sily-corrections-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/corrections', async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk)
        const request = new Request(`http://localhost${req.originalUrl}`, {
          method: req.method,
          body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        })
        try {
          const response = await handleCorrections(request, store)
          res.statusCode = response.status
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          server.config.logger.error(String(e))
          res.statusCode = 500
          res.end()
        }
      })
    },
  }
}
