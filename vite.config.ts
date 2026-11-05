/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  // 相对路径：构建产物可部署到任意静态目录（含 GitHub Pages 子路径 /Novel/）
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: '魔法少女的魔女审判 · 互动小说',
        short_name: '魔女审判',
        description: '文本优先的互动小说播放器（支持离线游玩）',
        lang: 'zh-CN',
        theme_color: '#120f1c',
        background_color: '#120f1c',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
