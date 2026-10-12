import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { hostStatus, startHost, stopHost } from './scripts/dev-host.ts'

function libraryProxyTarget(): string {
  try {
    const raw = fs.readFileSync(new URL('./library.config.json', import.meta.url), 'utf8')
    const port = JSON.parse(raw).port
    if (typeof port === 'number') return `http://127.0.0.1:${port}`
  } catch {
    // library server not configured yet
  }
  return 'http://127.0.0.1:8787'
}

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 4000, maxBuffer: 2_000_000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

async function devShareInfo(): Promise<{ url: string; qr: string | null } | null> {
  const bins = [
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
    '/usr/local/bin/tailscale',
    '/opt/homebrew/bin/tailscale',
    'tailscale',
  ]
  let stdout = ''
  for (const bin of bins) {
    try {
      stdout = await execFileAsync(bin, ['status', '--json'])
      break
    } catch {
      // try the next install location
    }
  }
  if (!stdout) return null
  let dns = ''
  try {
    dns = JSON.parse(stdout).Self?.DNSName?.replace(/\.$/, '') || ''
  } catch {
    return null
  }
  if (!dns) return null
  const url = `https://${dns}/`
  let qr: string | null = null
  try {
    const mod = await import('qrcode')
    const QRCode = mod.default ?? mod
    qr = await QRCode.toDataURL(url, { margin: 1, width: 280 })
  } catch {
    qr = null
  }
  return { url, qr }
}

function devSharePlugin(): Plugin {
  return {
    name: 'kytunes-dev-share',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0]
        if (pathname !== '/dev-share' && pathname !== '/dev-host' && pathname !== '/dev-host/start' && pathname !== '/dev-host/stop') {
          next()
          return
        }
        const ip = req.socket.remoteAddress || ''
        const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
        if (!local) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        try {
          if (pathname === '/dev-share') {
            const info = await devShareInfo()
            res.statusCode = info ? 200 : 404
            res.end(JSON.stringify(info ?? { error: 'Tailscale is not available.' }))
            return
          }
          if (pathname === '/dev-host/start' && req.method === 'POST') {
            const raw = await readRequestBody(req)
            const body = raw ? JSON.parse(raw) as { musicDir?: string; password?: string } : {}
            const status = await startHost({ musicDir: body.musicDir, password: body.password })
            res.statusCode = 200
            res.end(JSON.stringify(status))
            return
          }
          if (pathname === '/dev-host/stop' && req.method === 'POST') {
            const status = await stopHost()
            res.statusCode = 200
            res.end(JSON.stringify(status))
            return
          }
          const status = await hostStatus()
          res.statusCode = 200
          res.end(JSON.stringify(status))
        } catch (error) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not change hosting.' }))
        }
      })
      return () => {
        server.httpServer?.on('close', () => {
          void stopHost()
        })
      }
    },
  }
}

function readRequestBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 8192) {
        reject(new Error('Request is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  // Branch previews on GitHub Pages build under /KyTunes/preview/<branch>/.
  const base = process.env.KYTUNES_BASE || (pages ? '/KyTunes/' : '/')
  const preview = base.includes('/preview/')
  return {
  base,
  plugins: [
    react(),
    tailwindcss(),
    devSharePlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png', 'favicon-16.png'],
      manifest: {
        name: preview ? `KyTunes (${base.split('/preview/')[1].replace(/\/$/, '')})` : 'KyTunes',
        short_name: 'KyTunes',
        description: 'Play music saved on this device, or connect a library and keep the songs you play.',
        theme_color: '#6366f1',
        background_color: '#111827',
        display: 'standalone',
        id: base,
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The main site's service worker also covers /preview/, so keep it from answering for previews.
        navigateFallbackDenylist: preview ? [/^\/api\//] : [/^\/api\//, /\/preview\//],
        runtimeCaching: [
          {
            urlPattern: /\/demo\/.+\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'demo-audio',
              rangeRequests: true,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: libraryProxyTarget(),
        changeOrigin: true,
      },
    },
  },
  }
})
