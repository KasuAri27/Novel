import { defineConfig } from 'vite';

// 播放器构建：纯静态站点，产物放 dist/。
// story.json 放在 public/story/ 下，会被原样拷到站点根，播放器用 fetch('story/story.json') 取。
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    port: 5173,
    open: false,
  },
});
