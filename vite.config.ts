/// <reference types="vitest/config" />
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { TABLE_NAMES } from './src/types/tables';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Registered manually in src/main.tsx, and only in live mode: in mock mode the
      // MSW worker must own the '/' scope, and a browser allows one worker per scope.
      injectRegister: false,
      registerType: 'autoUpdate',
      manifest: {
        name: 'AEGIS Mission Console',
        short_name: 'AEGIS',
        description: 'Astronaut health, cognition and mission planning console.',
        theme_color: '#0a1324',
        background_color: '#0a1324',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // App shell: every built JS/CSS/HTML file, so the app loads with the network off.
        globPatterns: ['**/*.{js,css,html,svg,ico,png,woff2}'],
        // Mock fixture chunks are never precached (they only exist in mock builds).
        globIgnores: [
          'mockServiceWorker.js',
          'assets/browser-*.js',
          ...TABLE_NAMES.map((t) => `assets/${t}-*.js`),
        ],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    // Mock-mode fixture chunks (src/mocks/fixtures/*.json) are generated from the
    // real CSVs and are loaded lazily, one table at a time. The largest
    // (sensor_readings, assessment_trials) are several MB by design. They are
    // dropped entirely from live-mode builds.
    chunkSizeWarningLimit: 12000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    css: false,
    testTimeout: 15_000,
  },
});
