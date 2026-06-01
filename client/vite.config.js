import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  return {
    base: '/',
    plugins: [
      tailwindcss(),
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon.png', 'favicon.png', 'offline.html'],
        manifest: {
          name: 'The Plume Championship',
          short_name: 'TPC',
          description: '羽毛球俱乐部记分系统',
          theme_color: '#f6f8fa',
          background_color: '#f6f8fa',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/?source=pwa',
          lang: 'zh-CN',
          dir: 'ltr',
          categories: ['sports', 'utilities'],
          icons: [
            { src: 'icon-72.png', sizes: '72x72', type: 'image/png' },
            { src: 'icon-96.png', sizes: '96x96', type: 'image/png' },
            { src: 'icon-128.png', sizes: '128x128', type: 'image/png' },
            { src: 'icon-144.png', sizes: '144x144', type: 'image/png' },
            { src: 'icon-152.png', sizes: '152x152', type: 'image/png' },
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-384.png', sizes: '384x384', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          // SPA NavigationRoute 已自动处理离线导航（index.html 在 precache 中），
          // offline.html 仅作为 includeAssets 兜底预缓存，不额外注册 navigateFallback 避免冲突
          runtimeCaching: [
            // 赛季/俱乐部/球员/场地/称号 — 变化慢，Stale While Revalidate
            {
              urlPattern: /\/api\/(club|players|seasons|titles|venues|bookings)/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'api-reference',
                expiration: { maxEntries: 50, maxAgeSeconds: 300 },
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            // 比赛/轮次/对局 — 变化快，Network First 短缓存
            {
              urlPattern: /\/api\/(matches|rounds|games|match-games)/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-matchdata',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 50, maxAgeSeconds: 30 },
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            // 其他 API 兜底 — Network First
            {
              urlPattern: /\/api\//,
              handler: 'NetworkFirst',
              options: { cacheName: 'api-cache', expiration: { maxEntries: 100, maxAgeSeconds: 3600 } }
            },
            {
              urlPattern: /\.(png|jpg|jpeg|svg|gif|webp)$/,
              handler: 'CacheFirst',
              options: { cacheName: 'image-cache', expiration: { maxEntries: 50, maxAgeSeconds: 2592000 } }
            },
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 10, maxAgeSeconds: 31536000 }
              }
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    build: {
      outDir: mode === 'test' ? 'dist-test' : 'dist',
      cssCodeSplit: true,
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/vue') || id.includes('node_modules/@vue') ||
                id.includes('node_modules/vue-router') || id.includes('node_modules/pinia')) {
              return 'vue-vendor'
            }
            if (id.includes('node_modules/axios')) {
              return 'utils-vendor'
            }
          }
        }
      }
    },
    server: {
      proxy: {
        '/api': 'http://localhost:3000',
        '/uploads': 'http://localhost:3000'
      }
    }
  }
})
