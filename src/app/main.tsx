import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { initTheme } from '../shared/theme/themeStore';
import { initReaderPrefs } from '../shared/theme/readerPrefs';
import '../styles/index.css';

initTheme();
initReaderPrefs();

// 发现新版本后立刻接管并刷新，避免 GitHub Pages 一直停在旧缓存
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
