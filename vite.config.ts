import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'

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

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  return {
  base: pages ? '/KyTunes/' : '/',
  plugins: [
    react(),
    tailwindcss(),
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
