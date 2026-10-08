import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import { execFile } from 'node:child_process'

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
        if (req.url?.split('?')[0] !== '/dev-share') {
          next()
          return
        }
        const info = await devShareInfo()
        res.statusCode = info ? 200 : 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(info ?? { error: 'Tailscale is not available.' }))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  return {
  base: pages ? '/KyTunes/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    devSharePlugin(),
    VitePWA({
      disable: pages,
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'KyTunes',
        short_name: 'KyTunes',
        description: 'Play a folder on this computer, or stream your library from another machine.',
        theme_color: '#6366f1',
        background_color: '#111827',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
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
