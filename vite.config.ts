import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: '/',
          name: 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
          short_name: 'منظومة DST',
          description:
            'منظومة مؤسسية لإدارة ومراقبة صرف الأسمدة الزراعية والجرارات والبوليصات وقراءة الكشوف بالذكاء الاصطناعي.',
          lang: 'ar',
          dir: 'rtl',
          theme_color: '#065f46',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: [
            '**/vendor-exceljs-*.js',
            '**/vendor-jspdf-*.js',
            '**/vendor-html2canvas-*.js',
            '**/vendor-heic-*.js',
            '**/vendor-docx-*.js',
          ],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /\/assets\/vendor-(exceljs|jspdf|html2canvas|heic|docx)-.*\.js$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'dst-heavy-lazy-chunks',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
          navigateFallbackDenylist: [/^\/api\//, /^\/assets\//, /^\/dev-sw\.js$/],
        },
        devOptions: {
          enabled: false,
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/exceljs')) return 'vendor-exceljs';
            if (id.includes('node_modules/jspdf')) return 'vendor-jspdf';
            if (id.includes('node_modules/html2canvas')) return 'vendor-html2canvas';
            if (id.includes('node_modules/heic2any')) return 'vendor-heic';
            if (id.includes('node_modules/docx')) return 'vendor-docx';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
