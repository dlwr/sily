import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Plugin } from 'vite'

const isCorrection = (row: unknown) => {
  const { features, label } = (row ?? {}) as { features?: unknown; label?: unknown }
  return Array.isArray(features) && features.every((v) => typeof v === 'number') && typeof label === 'string'
}

export async function saveCorrections(body: string, file: string) {
  const corrections: unknown = JSON.parse(body)
  if (!Array.isArray(corrections) || !corrections.every(isCorrection)) throw new Error('not a list of corrections')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(corrections))
}

export function correctionsSink(file: string): Plugin {
  return {
    name: 'sily-corrections-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__sily/corrections', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        for await (const chunk of req) body += chunk
        try {
          await saveCorrections(body, file)
          res.statusCode = 204
        } catch {
          res.statusCode = 400
        }
        res.end()
      })
    },
  }
}
